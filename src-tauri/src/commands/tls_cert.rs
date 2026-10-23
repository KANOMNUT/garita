//! TLS certificate detail for a `kubernetes.io/tls`-shaped Secret.
//!
//! This is a lazy detail-tab command, not a new resource type (see
//! docs/plan-tls-cert-and-context-new.md D1): it fetches the Secret itself and returns only
//! parsed *public* certificate metadata from `tls.crt` / `ca.crt`. It never returns, logs, or
//! embeds in an error string anything derived from `tls.key`, nor any raw PEM/DER bytes — same
//! trust-boundary discipline as the ArgoCD repository-secret path.
//!
//! SAFETY / PANIC POLICY: the release profile sets `panic = "abort"` (see `Cargo.toml`), so a
//! panic anywhere in this file's parse path is a hard crash of the whole app on a certificate an
//! attacker controls. `catch_unwind` is not a mitigation (it is a no-op under `panic = "abort"`).
//! Every accessor in the parse path must be used so it cannot panic: no `unwrap()`, no
//! `expect()`, no slice indexing, no arithmetic that can overflow. Correctness here is the only
//! defence.

use k8s_openapi::api::core::v1::Secret as K8sSecret;
use kube::Api;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::{Ipv4Addr, Ipv6Addr};
use x509_parser::certificate::X509Certificate;
use x509_parser::error::PEMError;
use x509_parser::extensions::GeneralName;
use x509_parser::objects::{oid2sn, oid_registry};
use x509_parser::oid_registry::OID_SIG_ED25519;
use x509_parser::pem::Pem;
use x509_parser::prelude::FromDer;
use x509_parser::public_key::PublicKey;
use x509_parser::x509::{SubjectPublicKeyInfo, X509Name};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct TlsCertInfo {
    /// Which Secret key this block came from: "tls.crt" or "ca.crt".
    pub source_key: String,
    /// 0-based position of this PEM block within source_key.
    pub index: usize,
    /// "" when the block parsed cleanly. Non-empty means EVERY other field is a
    /// type default and the UI must render this entry as a parse failure.
    pub parse_error: String,

    pub subject: String,
    pub subject_cn: String,
    pub issuer: String,
    pub issuer_cn: String,
    pub serial: String,
    pub not_before: String,
    pub not_after: String,
    pub dns_names: Vec<String>,
    pub other_sans: Vec<String>,
    pub signature_algorithm: String,
    pub key_algorithm: String,
    pub key_size_bits: Option<u32>,
    pub sha256_fingerprint: String,
    pub is_ca: bool,
    pub self_signed: bool,
}

#[tauri::command]
pub async fn get_tls_certificate_info(
    context: String,
    namespace: String,
    name: String,
) -> Result<Vec<TlsCertInfo>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sSecret> = Api::namespaced(client, &namespace);
    let secret = api.get(&name).await
        .map_err(|e| format!("Failed to fetch secret: {}", e))?;

    // kube-rs already strips the outer Kubernetes base64 layer, so `ByteString.0` is the raw
    // PEM bytes as stored in the Secret — do NOT base64-decode again (same trap documented for
    // the Helm release secret path in helm.rs).
    let data = secret.data.unwrap_or_default();
    let tls_crt = data.get("tls.crt").map(|b| b.0.as_slice());
    let ca_crt = data.get("ca.crt").map(|b| b.0.as_slice());

    if tls_crt.is_none() && ca_crt.is_none() {
        return Err("Secret has no tls.crt or ca.crt key".to_string());
    }

    let mut result = Vec::new();
    if let Some(bytes) = tls_crt {
        result.extend(parse_pem_bundle(bytes, "tls.crt"));
    }
    if let Some(bytes) = ca_crt {
        result.extend(parse_pem_bundle(bytes, "ca.crt"));
    }
    Ok(result)
}

/// Parse every PEM `CERTIFICATE` block in `bytes`. Pure and cluster-independent so it is
/// directly unit-testable without a cluster (see the ponytail check requirement).
///
/// Invariant: the returned Vec's length equals the number of PEM `CERTIFICATE` blocks found.
/// A block that parses as a PEM envelope but fails to decode as DER still gets an entry (with
/// `parse_error` set) — it is never silently dropped. Nor is a block whose *armor* itself is
/// unreadable (bad base64, missing END line, malformed BEGIN line) — the PEM library's own
/// `MissingHeader` variant is the sole signal that no block was ever found at all (it is
/// returned only on reaching EOF while scanning for a `-----BEGIN ` line); every other
/// `PEMError` means a block WAS present and failed to read, and must be reported, not swallowed
/// into a falsely-empty result. Only a well-formed non-CERTIFICATE block (e.g. a `PRIVATE KEY`
/// block accidentally sitting in `tls.crt`, where the label is known and known-not-a-cert) is
/// skipped without being counted.
pub(crate) fn parse_pem_bundle(bytes: &[u8], source_key: &str) -> Vec<TlsCertInfo> {
    let mut out = Vec::new();
    let mut index = 0usize;

    for item in Pem::iter_from_buffer(bytes) {
        let pem = match item {
            Ok(p) => p,
            // MissingHeader is the only variant meaning "no block here at all" (EOF reached
            // while still looking for a BEGIN line) — everything else means a block WAS
            // found but its armor was unreadable, which must be reported, not skipped.
            Err(PEMError::MissingHeader) => continue,
            Err(e) => {
                out.push(TlsCertInfo {
                    source_key: source_key.to_string(),
                    index,
                    // Categorical PEM-armor error only (e.g. "base64 decode error") —
                    // never the input bytes themselves. See module docs.
                    parse_error: e.to_string(),
                    ..Default::default()
                });
                index += 1;
                continue;
            }
        };
        if pem.label != "CERTIFICATE" {
            continue;
        }

        let entry = match X509Certificate::from_der(&pem.contents) {
            Ok((_, cert)) => build_cert_info(source_key, index, &pem.contents, &cert),
            Err(e) => TlsCertInfo {
                source_key: source_key.to_string(),
                index,
                // Categorical parser error description only (e.g. "Parsing Error:
                // Der(...)") — never the input bytes themselves. See module docs.
                parse_error: e.to_string(),
                ..Default::default()
            },
        };
        out.push(entry);
        index += 1;
    }

    out
}

fn build_cert_info(
    source_key: &str,
    index: usize,
    der: &[u8],
    cert: &X509Certificate<'_>,
) -> TlsCertInfo {
    let subject = cert.subject().to_string();
    let issuer = cert.issuer().to_string();

    let subject_cn = common_name(cert.subject());
    let issuer_cn = common_name(cert.issuer());

    // Library formats as lowercase colon-separated hex; contract requires uppercase.
    let serial = cert.raw_serial_as_string().to_uppercase();

    let not_before = rfc3339_from_unix(cert.validity().not_before.timestamp());
    let not_after = rfc3339_from_unix(cert.validity().not_after.timestamp());

    let (dns_names, other_sans) = subject_alt_names(cert);

    let signature_algorithm = oid2sn(&cert.signature_algorithm.algorithm, oid_registry())
        .map(|s| s.to_string())
        .unwrap_or_else(|_| cert.signature_algorithm.algorithm.to_string());

    let (key_algorithm, key_size_bits) = classify_key_algorithm(cert.public_key());

    let sha256_fingerprint = hex_colon_upper(&Sha256::digest(der));

    let is_ca = cert.is_ca();
    let self_signed = subject == issuer;

    TlsCertInfo {
        source_key: source_key.to_string(),
        index,
        parse_error: String::new(),
        subject,
        subject_cn,
        issuer,
        issuer_cn,
        serial,
        not_before,
        not_after,
        dns_names,
        other_sans,
        signature_algorithm,
        key_algorithm,
        key_size_bits,
        sha256_fingerprint,
        is_ca,
        self_signed,
    }
}

/// First CN attribute of the RDN as a string, or "" if absent or non-UTF-8. Never panics and
/// never fails the whole certificate — a malformed CN degrades to an empty placeholder.
fn common_name(name: &X509Name<'_>) -> String {
    name.iter_common_name()
        .next()
        .and_then(|cn| cn.as_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn rfc3339_from_unix(secs: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

/// Read the Subject Alternative Name extension. A duplicate or malformed SAN extension is a
/// real-world certificate defect (`Err` from the library) — treated as "no SANs parsed" rather
/// than failing the whole certificate, since every other field is still valid.
fn subject_alt_names(cert: &X509Certificate<'_>) -> (Vec<String>, Vec<String>) {
    let mut dns_names = Vec::new();
    let mut other_sans = Vec::new();

    let Ok(Some(ext)) = cert.subject_alternative_name() else {
        return (dns_names, other_sans);
    };

    for gn in &ext.value.general_names {
        match gn {
            GeneralName::DNSName(s) => dns_names.push((*s).to_string()),
            GeneralName::RFC822Name(s) => other_sans.push(format!("EMAIL:{}", s)),
            GeneralName::URI(s) => other_sans.push(format!("URI:{}", s)),
            // R13: x509-parser hands us raw IP bytes (4 for v4, 16 for v6). Format as
            // dotted-quad / RFC5952 via a length-checked conversion — never hex/{:?}, and
            // never index. This is a *shipped bug* in a competing product (Aptakube
            // changelog 1.14.0) when done wrong.
            GeneralName::IPAddress(bytes) => {
                other_sans.push(format!("IP:{}", format_ip_san(bytes)))
            }
            GeneralName::DirectoryName(dn) => other_sans.push(format!("DIRNAME:{}", dn)),
            GeneralName::RegisteredID(oid) => other_sans.push(format!("RID:{}", oid)),
            // Deliberately omit the raw OtherName value bytes — only the OID is descriptive
            // and safe to surface; the value is attacker-controlled DER of unknown shape.
            GeneralName::OtherName(oid, _) => other_sans.push(format!("OTHER:{}", oid)),
            GeneralName::Invalid(tag, _) => other_sans.push(format!("INVALID:{:?}", tag)),
            GeneralName::X400Address(_) => other_sans.push("X400:<unsupported>".to_string()),
            GeneralName::EDIPartyName(_) => other_sans.push("EDIPARTY:<unsupported>".to_string()),
        }
    }

    (dns_names, other_sans)
}

/// Length-checked, panic-free IP SAN formatter. A wrong-length slice yields `<invalid>`, never a
/// panic or an index/slice operation on unchecked attacker-controlled bytes.
fn format_ip_san(bytes: &[u8]) -> String {
    match bytes.len() {
        4 => <[u8; 4]>::try_from(bytes)
            .map(|a| Ipv4Addr::from(a).to_string())
            .unwrap_or_else(|_| "<invalid>".to_string()),
        16 => <[u8; 16]>::try_from(bytes)
            .map(|a| Ipv6Addr::from(a).to_string())
            .unwrap_or_else(|_| "<invalid>".to_string()),
        _ => "<invalid>".to_string(),
    }
}

/// Classify the public key algorithm into the fixed set the frontend contract expects:
/// "RSA" | "EC" | "Ed25519" | "DSA" | "unknown". Ed25519 is checked directly by OID first,
/// because `SubjectPublicKeyInfo::parsed()` has no Ed25519 variant and would otherwise report
/// it as `Unknown`.
fn classify_key_algorithm(spki: &SubjectPublicKeyInfo<'_>) -> (String, Option<u32>) {
    if spki.algorithm.algorithm == OID_SIG_ED25519 {
        // Fixed-size by definition — not a "choice" the way RSA/EC vary, so no size to report.
        return ("Ed25519".to_string(), None);
    }
    match spki.parsed() {
        Ok(PublicKey::RSA(rsa)) => ("RSA".to_string(), bits_to_u32(rsa.key_size())),
        Ok(PublicKey::EC(ec)) => ("EC".to_string(), bits_to_u32(ec.key_size())),
        Ok(PublicKey::DSA(y)) => ("DSA".to_string(), bits_to_u32(y.len().saturating_mul(8))),
        _ => ("unknown".to_string(), None),
    }
}

/// 0 means the library could not determine a size (e.g. malformed key material) — report that
/// as "no meaningful size" rather than a misleading `Some(0)`. Uses `try_from` + a clamped
/// fallback rather than `as u32`, so a pathological huge value cannot silently wrap around.
fn bits_to_u32(bits: usize) -> Option<u32> {
    if bits == 0 {
        None
    } else {
        Some(u32::try_from(bits).unwrap_or(u32::MAX))
    }
}

fn hex_colon_upper(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Self-signed RSA-2048 cert generated with:
    /// openssl req -x509 -newkey rsa:2048 -nodes -keyout /dev/null \
    ///   -subj "/CN=example.com/O=Acme/C=US" \
    ///   -addext "subjectAltName=DNS:example.com,DNS:www.example.com,IP:10.0.0.1,IP:::1" \
    ///   -days 365
    pub(crate) const FIXTURE_PEM: &str = "-----BEGIN CERTIFICATE-----
MIIDKjCCAhKgAwIBAgIJAMdbrCKxaMGcMA0GCSqGSIb3DQEBCwUAMDIxFDASBgNV
BAMMC2V4YW1wbGUuY29tMQ0wCwYDVQQKDARBY21lMQswCQYDVQQGEwJVUzAeFw0y
NjA4MjMxNjU0MjNaFw0yNzA4MjMxNjU0MjNaMDIxFDASBgNVBAMMC2V4YW1wbGUu
Y29tMQ0wCwYDVQQKDARBY21lMQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEB
BQADggEPADCCAQoCggEBAOX6wq8/7Mwzb7zpvOm10b/HI3QdVBCnRjYMEM1Op+IS
a1zZ3Cl8AV9voMejWDmDlsf9um2VMLEsvZ2kd5ToKGCY1OqYtz+B6sALViu+WC86
E0nfJ7clwXmGMlmL4zxD/hi4NWtxv9E+pRhjmL6IKuWcvoIVqoKAtjlkMxTQKjQ0
g3OVgFzNWKUayMh35ECOZoEgJfthHdyUwV0UaTP9qZrex4NBGuMpQCVPTF3R0rRo
+jAnSm0EBag4o1RQMBlFo6SmmibfPH0r4u3/RLGeHL7s06sdfhu/++t+K1HdNb1P
IhLbtul22Gi8PAn7DgkuNaTfxi4cIrp/JKoRTGzupNsCAwEAAaNDMEEwPwYDVR0R
BDgwNoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxlLmNvbYcECgAAAYcQAAAAAAAA
AAAAAAAAAAAAATANBgkqhkiG9w0BAQsFAAOCAQEAYtkxClDNdvmWAfY2CNtW3U0H
FoH5tkS9AUgekJ2I8JPyAwYfzHOVcKb68osG9ssfQNNE4MtABjSdaFB8B3AgGRaU
C+Dm7ovnZrOwfyBznkH2aE3Vuxn840poBXudVX52JySAU538uAaEEJgVC5kJjPQv
1b/kzsu+h7yafqGc0avfxXpId4XH9Rvqk2sVhzZtiQ5Hpegk1zERRIiF7Rh/z2d+
iuzmv8X6OW8gI0eXN3sOsa9DhmZYVEM4YIx4PsSh6A/wdEmD3Er7MMpzdpmRIqnc
3UCogvWTDsAheuPyO2no3kiZh5ppJ8cg0FrBlKcZTlohcQl0nse6kCw6ECR9gA==
-----END CERTIFICATE-----
";

    #[test]
    fn real_self_signed_cert_parses_fully() {
        let result = parse_pem_bundle(FIXTURE_PEM.as_bytes(), "tls.crt");
        assert_eq!(result.len(), 1);
        let c = &result[0];
        assert_eq!(c.parse_error, "");
        assert_eq!(c.source_key, "tls.crt");
        assert_eq!(c.index, 0);
        assert!(c.self_signed);
        assert!(!c.is_ca);
        assert!(!c.sha256_fingerprint.is_empty());
        assert_eq!(c.key_algorithm, "RSA");
        assert_eq!(c.key_size_bits, Some(2048));
        assert!(c.dns_names.contains(&"example.com".to_string()));
        assert!(c.dns_names.contains(&"www.example.com".to_string()));
        // R13: IP SANs must be human-readable dotted-quad / RFC5952, never hex/{:?}.
        assert!(c.other_sans.contains(&"IP:10.0.0.1".to_string()));
        assert!(c.other_sans.contains(&"IP:::1".to_string()));
        assert!(!c.not_before.is_empty());
        assert!(!c.not_after.is_empty());
    }

    #[test]
    fn empty_input_yields_empty_vec() {
        assert_eq!(parse_pem_bundle(b"", "tls.crt").len(), 0);
    }

    #[test]
    fn garbage_input_yields_empty_vec() {
        assert_eq!(parse_pem_bundle(b"not pem at all", "tls.crt").len(), 0);
    }

    #[test]
    fn well_formed_armor_with_invalid_base64_body_reports_a_failure_not_an_empty_vec() {
        // BEGIN/END present (a block plainly exists), but the body is not valid base64.
        // This must NOT be swallowed into `len() == 0` — that would be exactly the
        // silently-empty-panel failure the parse_error field exists to prevent: the user
        // is looking at a tls.crt that visibly contains "BEGIN CERTIFICATE".
        let pem_text = "-----BEGIN CERTIFICATE-----\n!!!!not-base64!!!!\n-----END CERTIFICATE-----\n";
        let result = parse_pem_bundle(pem_text.as_bytes(), "tls.crt");
        assert_eq!(result.len(), 1);
        assert_ne!(result[0].parse_error, "");
    }

    #[test]
    fn truncated_der_reports_a_parse_failure_without_panicking() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        // A SEQUENCE tag claiming 0x0300 (768) bytes follow, but none actually do —
        // syntactically valid PEM armor, deliberately invalid DER content.
        let truncated_der: &[u8] = &[0x30, 0x82, 0x03, 0x00];
        let b64 = STANDARD.encode(truncated_der);
        let pem_text = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            b64
        );
        let result = parse_pem_bundle(pem_text.as_bytes(), "tls.crt");
        assert_eq!(result.len(), 1);
        assert_ne!(result[0].parse_error, "");
        // A parse failure must carry only type defaults elsewhere.
        assert_eq!(result[0].subject, "");
        assert_eq!(result[0].sha256_fingerprint, "");
    }

    #[test]
    fn private_key_block_is_skipped_not_counted() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let b64 = STANDARD.encode(b"not a real key, just needs to be valid base64");
        let pem_text = format!(
            "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n",
            b64
        );
        assert_eq!(parse_pem_bundle(pem_text.as_bytes(), "tls.crt").len(), 0);
    }

    #[test]
    fn two_concatenated_certs_both_appear_with_sequential_index() {
        let bundle = format!("{}{}", FIXTURE_PEM, FIXTURE_PEM);
        let result = parse_pem_bundle(bundle.as_bytes(), "ca.crt");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].index, 0);
        assert_eq!(result[1].index, 1);
        assert_eq!(result[0].source_key, "ca.crt");
        assert_eq!(result[1].source_key, "ca.crt");
    }

    #[test]
    fn oversized_garbage_block_does_not_panic_or_hang() {
        // ~1 MiB of valid base64 alphabet ('A' = 0x00 when decoded) inside CERTIFICATE
        // armor. Must fail DER parsing quickly, not panic, not attempt to allocate
        // anything remotely close to attacker-claimed sizes.
        let body = "A".repeat(1_000_000);
        let pem_text = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            body
        );
        let result = parse_pem_bundle(pem_text.as_bytes(), "tls.crt");
        assert_eq!(result.len(), 1);
        assert_ne!(result[0].parse_error, "");
    }

    #[test]
    fn ip_san_formatting_is_length_checked() {
        assert_eq!(format_ip_san(&[10, 0, 0, 1]), "10.0.0.1");
        assert_eq!(
            format_ip_san(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
            "::1"
        );
        assert_eq!(format_ip_san(&[1, 2, 3]), "<invalid>");
        assert_eq!(format_ip_san(&[]), "<invalid>");
    }
}
