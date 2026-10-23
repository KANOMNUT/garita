//! Merge-from-file with a change preview.
//!
//! See `docs/plan-kubeconfig-and-parity.md` §3.1 for the frozen contract.
//!
//! **Naming is load-bearing: this is NOT `kubectl apply`.** An RFC 7386 JSON merge patch does not
//! prune fields the file removed, so the UI must say "Merge from file" and "These keys will be
//! set:" — never "Apply". Error strings in this file follow the same rule.
//!
//! **GVK → plural is resolved via the discovery API (`kube::discovery::pinned_kind`), never a
//! string rule.** An arbitrary user file can contain any kind, and a suffix pluraliser is wrong
//! for irregular CRD plurals — proof: the old `kind_to_plural` fallback turned `Endpoints` into
//! `endpointss` (fixed separately in `utils.rs`, but the durable fix is: never guess a plural when
//! the server can just tell us).

use kube::{
    api::{Api, ApiResource, DynamicObject, GroupVersionKind, Patch, PatchParams, PostParams},
    discovery::{self, Scope},
    Client,
};
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DocPreview {
    pub index: usize,
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub action: String, // "create" | "update" | "error"
    pub live: Option<serde_json::Value>,
    pub desired: serde_json::Value,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApplyResult {
    pub index: usize,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub action: String, // "created" | "updated" | "failed"
    pub message: String,
}

/// Split a (possibly) multi-document YAML file into JSON values, one per document, preserving
/// the document's 0-based index in the file. Never splits on the literal string `---` — it can
/// appear inside a block scalar (this codebase already ships PEM blocks through YAML). A blank
/// document (e.g. a trailing `---` with nothing after it) parses to `Null` and is dropped rather
/// than surfaced as an empty doc.
///
/// **Must stop iterating the instant one document fails to parse — never call `.next()` on this
/// iterator again afterward.** Verified empirically against serde_yaml 0.9.34 (not documented
/// upstream): once a document in the stream has a scan error, calling `.next()` again never
/// returns `None` — it yields an unbounded sequence of further (also-erroring) "documents"
/// forever. A single `.next()` + a single `deserialize()` call on the errored document itself is
/// fine and returns a normal `Err` immediately; it's specifically asking the iterator to advance
/// *past* an error that hangs. `.collect()`-ing the full iterator after an error is therefore an
/// infinite loop, not a bounded pass over corrupted-but-finite data — which is exactly what
/// `Vec<_>: FromIterator` does by default, so this cannot be written as an iterator chain
/// (`.filter_map(..).collect()`) without reintroducing the hang; it has to be a hand-rolled loop
/// with an explicit `break`. There is nothing recoverable after the first error anyway — bytes
/// past that point in the stream are a byproduct of the same scan failure, not real subsequent
/// documents — so stopping there isn't a feature/safety trade-off, and this is not optional
/// hardening: it's what makes exposing this to arbitrary pasted YAML safe to begin with, with no
/// cluster round-trip involved at all.
pub(crate) fn split_yaml_documents(yaml: &str) -> Vec<(usize, Result<serde_json::Value, String>)> {
    let mut out = Vec::new();
    for (index, document) in serde_yaml::Deserializer::from_str(yaml).enumerate() {
        match serde_json::Value::deserialize(document) {
            Ok(v) if v.is_null() => continue,
            Ok(v) => out.push((index, Ok(v))),
            Err(e) => {
                out.push((
                    index,
                    Err(format!(
                        "Invalid YAML: {}. Parsing stopped here — any documents after this \
                         point in the file were not processed.",
                        e
                    )),
                ));
                break;
            }
        }
    }
    out
}

struct ParsedDoc {
    api_version: String,
    kind: String,
    name: String,
    namespace: String,
    namespaced: bool,
    ar: ApiResource,
    value: serde_json::Value,
}

/// Resolve one parsed document's GVK against the live cluster and pull out the identity fields
/// every caller needs. Scope (namespaced vs cluster) comes from `ApiCapabilities`, never from
/// whether `metadata.namespace` happens to be set in the file.
async fn parse_doc(client: &Client, value: &serde_json::Value) -> Result<ParsedDoc, String> {
    let api_version = value.get("apiVersion").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if api_version.is_empty() {
        return Err("Missing required field: apiVersion".to_string());
    }
    let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if kind.is_empty() {
        return Err("Missing required field: kind".to_string());
    }
    let name = value
        .pointer("/metadata/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return Err("Missing required field: metadata.name".to_string());
    }

    let (group, version) = match api_version.split_once('/') {
        Some((g, v)) => (g.to_string(), v.to_string()),
        None => (String::new(), api_version.clone()),
    };
    let gvk = GroupVersionKind::gvk(&group, &version, &kind);

    let (ar, caps) = discovery::pinned_kind(client, &gvk)
        .await
        .map_err(|e| format!("Failed to discover {} {}: {}", api_version, kind, e))?;

    let namespaced = matches!(caps.scope, Scope::Namespaced);
    let namespace = if namespaced {
        // Falls back to the context's own default namespace (its kubeconfig `namespace:` field,
        // "default" if unset) — never a hardcoded "default" — so a document with no
        // `metadata.namespace` lands where `kubectl apply` would put it: the active context's
        // namespace, not always the cluster's literal `default` namespace.
        value
            .pointer("/metadata/namespace")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| client.default_namespace())
            .to_string()
    } else {
        String::new()
    };

    Ok(ParsedDoc { api_version, kind, name, namespace, namespaced, ar, value: value.clone() })
}

fn api_for(client: &Client, doc: &ParsedDoc) -> Api<DynamicObject> {
    if doc.namespaced {
        Api::namespaced_with(client.clone(), &doc.namespace, &doc.ar)
    } else {
        Api::all_with(client.clone(), &doc.ar)
    }
}

#[tauri::command]
pub async fn preview_yaml_documents(context: String, yaml: String) -> Result<Vec<DocPreview>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let mut out = Vec::new();
    for (index, parsed) in split_yaml_documents(&yaml) {
        let value = match parsed {
            Ok(v) => v,
            Err(e) => {
                out.push(DocPreview {
                    index,
                    api_version: String::new(),
                    kind: String::new(),
                    name: String::new(),
                    namespace: String::new(),
                    action: "error".to_string(),
                    live: None,
                    desired: serde_json::Value::Null,
                    error: Some(e),
                });
                continue;
            }
        };

        // One document's failure never aborts the batch (§3.1).
        let doc = match parse_doc(&client, &value).await {
            Ok(d) => d,
            Err(e) => {
                out.push(DocPreview {
                    index,
                    api_version: value.get("apiVersion").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    kind: value.get("kind").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    name: value.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    namespace: String::new(),
                    action: "error".to_string(),
                    live: None,
                    desired: value,
                    error: Some(e),
                });
                continue;
            }
        };

        let api = api_for(&client, &doc);
        match api.get_opt(&doc.name).await {
            Ok(Some(live)) => match serde_json::to_value(&live) {
                Ok(live_json) => out.push(DocPreview {
                    index,
                    api_version: doc.api_version,
                    kind: doc.kind,
                    name: doc.name,
                    namespace: doc.namespace,
                    action: "update".to_string(),
                    live: Some(live_json),
                    desired: doc.value,
                    error: None,
                }),
                Err(e) => out.push(DocPreview {
                    index,
                    api_version: doc.api_version,
                    kind: doc.kind,
                    name: doc.name,
                    namespace: doc.namespace,
                    action: "error".to_string(),
                    live: None,
                    desired: doc.value,
                    error: Some(format!("Failed to serialize live object: {}", e)),
                }),
            },
            Ok(None) => out.push(DocPreview {
                index,
                api_version: doc.api_version,
                kind: doc.kind,
                name: doc.name,
                namespace: doc.namespace,
                action: "create".to_string(),
                live: None,
                desired: doc.value,
                error: None,
            }),
            Err(e) => out.push(DocPreview {
                index,
                api_version: doc.api_version,
                kind: doc.kind.clone(),
                name: doc.name,
                namespace: doc.namespace,
                action: "error".to_string(),
                live: None,
                desired: doc.value,
                error: Some(format!("Failed to check existing {}: {}", doc.kind, e)),
            }),
        }
    }

    Ok(out)
}

#[tauri::command]
pub async fn apply_yaml_documents(
    context: String,
    yaml: String,
    dry_run: Option<bool>,
) -> Result<Vec<ApplyResult>, String> {
    let dry_run = dry_run.unwrap_or(false);
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let mut out = Vec::new();
    for (index, parsed) in split_yaml_documents(&yaml) {
        let value = match parsed {
            Ok(v) => v,
            Err(e) => {
                out.push(ApplyResult {
                    index,
                    kind: String::new(),
                    name: String::new(),
                    namespace: String::new(),
                    action: "failed".to_string(),
                    message: e,
                });
                continue;
            }
        };

        let doc = match parse_doc(&client, &value).await {
            Ok(d) => d,
            Err(e) => {
                out.push(ApplyResult {
                    index,
                    kind: value.get("kind").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    name: value.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    namespace: String::new(),
                    action: "failed".to_string(),
                    message: e,
                });
                continue;
            }
        };

        let api = api_for(&client, &doc);

        let result = match api.get_opt(&doc.name).await {
            Ok(Some(_)) => {
                let pp = PatchParams { dry_run, ..Default::default() };
                match api.patch(&doc.name, &pp, &Patch::Merge(&doc.value)).await {
                    Ok(_) => ApplyResult {
                        index,
                        kind: doc.kind.clone(),
                        name: doc.name.clone(),
                        namespace: doc.namespace.clone(),
                        action: "updated".to_string(),
                        message: if dry_run {
                            format!("{}/{} would be updated (dry run)", doc.kind, doc.name)
                        } else {
                            format!("{}/{} updated", doc.kind, doc.name)
                        },
                    },
                    Err(e) => ApplyResult {
                        index,
                        kind: doc.kind.clone(),
                        name: doc.name.clone(),
                        namespace: doc.namespace.clone(),
                        action: "failed".to_string(),
                        message: format!("Failed to update {}: {}", doc.kind, e),
                    },
                }
            }
            Ok(None) => match serde_json::from_value::<DynamicObject>(doc.value.clone()) {
                Ok(obj) => {
                    let pp = PostParams { dry_run, ..Default::default() };
                    match api.create(&pp, &obj).await {
                        Ok(_) => ApplyResult {
                            index,
                            kind: doc.kind.clone(),
                            name: doc.name.clone(),
                            namespace: doc.namespace.clone(),
                            action: "created".to_string(),
                            message: if dry_run {
                                format!("{}/{} would be created (dry run)", doc.kind, doc.name)
                            } else {
                                format!("{}/{} created", doc.kind, doc.name)
                            },
                        },
                        Err(e) => ApplyResult {
                            index,
                            kind: doc.kind.clone(),
                            name: doc.name.clone(),
                            namespace: doc.namespace.clone(),
                            action: "failed".to_string(),
                            message: format!("Failed to create {}: {}", doc.kind, e),
                        },
                    }
                }
                Err(e) => ApplyResult {
                    index,
                    kind: doc.kind.clone(),
                    name: doc.name.clone(),
                    namespace: doc.namespace.clone(),
                    action: "failed".to_string(),
                    message: format!("Invalid resource: {}", e),
                },
            },
            Err(e) => ApplyResult {
                index,
                kind: doc.kind.clone(),
                name: doc.name.clone(),
                namespace: doc.namespace.clone(),
                action: "failed".to_string(),
                message: format!("Failed to check existing {}: {}", doc.kind, e),
            },
        };

        // One line per document; never the document body.
        if !dry_run {
            let logged: Result<(), String> = if result.action == "failed" {
                Err(result.message.clone())
            } else {
                Ok(())
            };
            crate::app_log::log_write(&context, "merge", &result.kind, &result.namespace, &result.name, Some(&doc.value), &logged);
        }
        out.push(result);
    }

    Ok(out)
}


#[cfg(test)]
mod tests {
    use super::split_yaml_documents;

    #[test]
    fn splits_multiple_documents_and_preserves_index() {
        let yaml = "kind: A\n---\nkind: B\n---\nkind: C\n";
        let docs = split_yaml_documents(yaml);
        assert_eq!(docs.len(), 3);
        assert_eq!(docs[0].0, 0);
        assert_eq!(docs[1].0, 1);
        assert_eq!(docs[2].0, 2);
        assert_eq!(docs[1].1.as_ref().unwrap()["kind"], "B");
    }

    #[test]
    fn does_not_split_on_dashes_inside_a_block_scalar() {
        // The PEM-in-YAML case this codebase already ships (TLS Secrets) — a
        // literal block scalar containing "---"-shaped content must stay one
        // document, not be split mid-value.
        let yaml = "kind: Secret\ndata: |\n  -----BEGIN CERTIFICATE-----\n  abc\n  -----END CERTIFICATE-----\n";
        let docs = split_yaml_documents(yaml);
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn trailing_separator_with_no_content_is_dropped() {
        let yaml = "kind: A\n---\n";
        let docs = split_yaml_documents(yaml);
        assert_eq!(docs.len(), 1);
    }

    /// A document that fails to parse is reported as an error rather than aborting the whole
    /// call — but per `split_yaml_documents`'s doc comment, nothing *after* it is fabricated
    /// either: the stream is corrupted from that point on, so parsing stops.
    #[test]
    fn invalid_document_is_reported_and_parsing_stops_there() {
        let yaml = "kind: A\n---\nfoo: [1, 2\n---\nkind: C\n";
        let docs = split_yaml_documents(yaml);
        assert_eq!(docs.len(), 2, "the document after the error must not be fabricated");
        assert!(docs[0].1.is_ok());
        assert_eq!(docs[0].0, 0);
        assert!(docs[1].1.is_err());
        assert_eq!(docs[1].0, 1);
    }

    /// Regression test for a genuine hang, not a panic: serde_yaml 0.9.34's streaming
    /// multi-document `Iterator` never returns `None` again once one document fails to parse —
    /// see `split_yaml_documents`'s doc comment. Every one of these inputs hung the process
    /// before the fix (an explicit `break` right after the first error, rather than an
    /// iterator-adaptor chain that would call `.next()` one more time to check for exhaustion).
    /// If this regresses, this test hangs forever rather than failing — that is the bug this
    /// test exists to catch, so a CI timeout on this test IS a failing result, not a flake.
    #[test]
    fn previously_hanging_malformed_documents_now_error_instead() {
        let malformed = [
            "key: \"unterminated\n",
            "foo: [1, 2\n",
            "foo:\n\tbar: 1\n",
            "{unterminated: flow\n",
            "[1,2,{3\n",
        ];
        for bad in malformed {
            // Sandwiched between two good documents: proves the error document is reported (not
            // silently eaten) and iteration does not run away trying to reach the trailing one.
            let yaml = format!("kind: A\n---\n{}---\nkind: C\n", bad);
            let docs = split_yaml_documents(&yaml);
            assert_eq!(docs.len(), 2, "input: {:?}, got {:?}", bad, docs);
            assert!(docs[0].1.is_ok(), "input: {:?}", bad);
            assert!(docs[1].1.is_err(), "expected an error for {:?}, got {:?}", bad, docs[1].1);
        }
    }
}
