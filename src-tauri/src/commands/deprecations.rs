//! `scan_deprecated_apis`: deprecated or removed API versions still referenced by the cluster's
//! Helm releases and `kubectl apply` annotations.
//!
//! Hints from an embedded table (`data/deprecated-apis.json`), never a verdict: only Helm
//! manifests and last-applied annotations are scanned, so "nothing found" proves nothing about
//! the rest. Only `apiVersion`, `kind` and `metadata.name/namespace` are read from a release;
//! the decoded release never leaves the backend.

use std::collections::{BTreeSet, HashMap, HashSet};

use k8s_openapi::api::core::v1::Secret;
use kube::{
    api::{ApiResource, DynamicObject, ListParams},
    discovery::{self, ApiGroup, Scope},
    error::DiscoveryError,
    Api, Error as KubeError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::apply_file::split_yaml_documents;
use super::helm::decode_helm_release;
use super::problems::{skip_reason, take, SkippedSource};
use super::utils::client_for_context;

const TABLE_JSON: &str = include_str!("../../data/deprecated-apis.json");
const LAST_APPLIED: &str = "kubectl.kubernetes.io/last-applied-configuration";

#[derive(Deserialize, Debug, Clone)]
pub(crate) struct Entry {
    pub group: String,
    pub version: String,
    pub kind: String,
    pub deprecated_in: String,
    pub removed_in: Option<String>,
    pub replacement: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub(crate) struct Table {
    pub covers_up_to: String,
    pub entries: Vec<Entry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeprecatedApiFinding {
    pub source: String, // "helm" | "last-applied"
    pub api_version: String,
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub helm_release: Option<String>,
    pub helm_release_namespace: Option<String>, // Some for source "helm"
    pub deprecated_in: String,
    pub removed_in: Option<String>,
    pub replacement: Option<String>,
    pub served_by_this_server: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeprecationReport {
    pub findings: Vec<DeprecatedApiFinding>,
    pub server_version: String, // discovery gitVersion verbatim, "" when the version endpoint fails
    pub table_covers_up_to: String,
    pub skipped: Vec<SkippedSource>,
}

fn load_table() -> Result<Table, String> {
    serde_json::from_str(TABLE_JSON).map_err(|e| format!("Failed to load deprecation table: {}", e))
}

/// `(group, version)` of an `apiVersion`; the core group is `""`.
fn split_api_version(api_version: &str) -> (&str, &str) {
    api_version.split_once('/').unwrap_or(("", api_version))
}

pub(crate) fn match_deprecations<'a>(table: &'a Table, api_version: &str, kind: &str) -> Option<&'a Entry> {
    let (group, version) = split_api_version(api_version);
    table.entries.iter().find(|e| e.group == group && e.version == version && e.kind == kind)
}

#[allow(clippy::too_many_arguments)]
fn finding(
    source: &str, e: &Entry, api_version: &str, kind: &str, ns: &str, name: &str,
    release: Option<(&str, &str)>, served: &HashSet<String>,
) -> DeprecatedApiFinding {
    DeprecatedApiFinding {
        source: source.into(),
        api_version: api_version.into(),
        kind: kind.into(),
        namespace: ns.into(),
        name: name.into(),
        helm_release: release.map(|r| r.1.to_string()),
        helm_release_namespace: release.map(|r| r.0.to_string()),
        deprecated_in: e.deprecated_in.clone(),
        removed_in: e.removed_in.clone(),
        replacement: e.replacement.clone(),
        served_by_this_server: served.contains(api_version),
    }
}

/// Findings in one release manifest, plus the parse error that stopped it, if any. The split is
/// the hang-safe loop; nothing after a malformed document is read.
fn manifest_findings(
    table: &Table, rel_ns: &str, rel: &str, manifest: &str, served: &HashSet<String>,
) -> (Vec<DeprecatedApiFinding>, Option<String>) {
    let mut out = Vec::new();
    for (_, doc) in split_yaml_documents(manifest) {
        let doc = match doc {
            Ok(d) => d,
            Err(e) => return (out, Some(e)),
        };
        let (Some(api_version), Some(kind)) =
            (doc.get("apiVersion").and_then(Value::as_str), doc.get("kind").and_then(Value::as_str))
        else {
            continue;
        };
        let Some(entry) = match_deprecations(table, api_version, kind) else { continue };
        let meta = doc.get("metadata");
        let name = meta.and_then(|m| m.get("name")).and_then(Value::as_str).unwrap_or("");
        let ns = meta.and_then(|m| m.get("namespace")).and_then(Value::as_str).unwrap_or(rel_ns);
        out.push(finding("helm", entry, api_version, kind, ns, name, Some((rel_ns, rel)), served));
    }
    (out, None)
}

/// A finding from a last-applied annotation's `apiVersion` (nothing else is read from it).
fn last_applied_finding(
    table: &Table, kind: &str, ns: &str, name: &str, annotation: &str, served: &HashSet<String>,
) -> Option<DeprecatedApiFinding> {
    let v: Value = serde_json::from_str(annotation).ok()?;
    let api_version = v.get("apiVersion").and_then(Value::as_str)?;
    let entry = match_deprecations(table, api_version, kind)?;
    Some(finding("last-applied", entry, api_version, kind, ns, name, None, served))
}

// ─── Command ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_deprecated_apis(context: String, namespace: Option<String>) -> Result<DeprecationReport, String> {
    let table = load_table()?;
    let client = client_for_context(&context).await.map_err(|e| format!("Failed to connect: {}", e))?;
    let ns = namespace.filter(|n| !n.is_empty() && n != "all");
    let server_version = client.apiserver_version().await.map(|i| i.git_version).unwrap_or_default();

    // Discovery for every group the table names; `served` is the set of live apiVersions.
    let groups: BTreeSet<&str> = table.entries.iter().map(|e| e.group.as_str()).collect();
    let looked = futures::future::join_all(groups.iter().map(|g| {
        let client = client.clone();
        let g = g.to_string();
        async move { (g.clone(), discovery::group(&client, &g).await) }
    }))
    .await;
    let mut api_groups: HashMap<String, ApiGroup> = HashMap::new();
    let mut served: HashSet<String> = HashSet::new();
    for (g, r) in looked {
        match r {
            Ok(ag) => {
                for v in ag.versions() {
                    served.insert(format!("{}/{}", g, v));
                }
                api_groups.insert(g, ag);
            }
            Err(KubeError::Discovery(DiscoveryError::MissingApiGroup(_))) => {}
            Err(e) => return Err(format!("Failed to read API discovery: {}", e)),
        }
    }

    let mut skipped = Vec::new();
    let mut findings = Vec::new();

    // Helm releases.
    let secrets: Api<Secret> = match &ns {
        Some(n) => Api::namespaced(client.clone(), n),
        None => Api::all(client.clone()),
    };
    let lp = ListParams::default().labels("owner=helm,status=deployed");
    if let Some(list) = take(secrets.list(&lp).await, "helm-releases", false, &mut skipped) {
        for s in list {
            let s_ns = s.metadata.namespace.clone().unwrap_or_default();
            let bytes = s.data.as_ref().and_then(|d| d.get("release")).map(|b| b.0.as_slice());
            let release = match bytes.map(decode_helm_release) {
                Some(Ok(r)) => r,
                Some(Err(e)) => {
                    skipped.push(SkippedSource {
                        source: "helm-releases".into(),
                        reason: format!("{}/{}: {}", s_ns, s.metadata.name.as_deref().unwrap_or(""), e),
                    });
                    continue;
                }
                None => continue,
            };
            let rel_name = release.get("name").and_then(Value::as_str).unwrap_or("");
            let rel_ns = release.get("namespace").and_then(Value::as_str).unwrap_or(&s_ns);
            let manifest = release.get("manifest").and_then(Value::as_str).unwrap_or("");
            let (found, err) = manifest_findings(&table, rel_ns, rel_name, manifest, &served);
            findings.extend(found);
            if let Some(e) = err {
                skipped.push(SkippedSource { source: "helm-releases".into(), reason: format!("{}/{}: {}", rel_ns, rel_name, e) });
            }
        }
    }

    // Last-applied annotations: each table kind that has a currently served version.
    let kinds: BTreeSet<(&str, &str)> = table.entries.iter().map(|e| (e.group.as_str(), e.kind.as_str())).collect();
    let scans = kinds.iter().filter_map(|(group, kind)| {
        let ag = api_groups.get(*group)?;
        let (ar, scope) = served_resource(ag, &table, group, kind)?;
        // A picked namespace never lists cluster-scoped kinds.
        if scope == Scope::Cluster && ns.is_some() {
            return None;
        }
        let (client, ns) = (client.clone(), ns.clone());
        Some(async move {
            let api: Api<DynamicObject> = match (&ns, scope) {
                (Some(n), Scope::Namespaced) => Api::namespaced_with(client, n, &ar),
                _ => Api::all_with(client, &ar),
            };
            (ar.plural.clone(), ar.group.clone(), ar.kind.clone(), api.list(&ListParams::default()).await)
        })
    });
    for (plural, group, kind, r) in futures::future::join_all(scans).await {
        match r {
            Ok(list) => {
                for o in list.items {
                    let Some(ann) = o.metadata.annotations.as_ref().and_then(|a| a.get(LAST_APPLIED)) else { continue };
                    let ons = o.metadata.namespace.clone().unwrap_or_default();
                    let oname = o.metadata.name.clone().unwrap_or_default();
                    findings.extend(last_applied_finding(&table, &kind, &ons, &oname, ann, &served));
                }
            }
            Err(e) => skipped.push(SkippedSource {
                source: "last-applied".into(),
                reason: format!("{}.{}: {}", plural, group, skip_reason(&e)),
            }),
        }
    }

    findings.sort_by(|a, b| {
        (&a.source, &a.helm_release_namespace, &a.helm_release, &a.api_version, &a.kind, &a.namespace, &a.name)
            .cmp(&(&b.source, &b.helm_release_namespace, &b.helm_release, &b.api_version, &b.kind, &b.namespace, &b.name))
    });
    findings.dedup_by(|a, b| {
        (&a.source, &a.helm_release_namespace, &a.helm_release, &a.api_version, &a.kind, &a.namespace, &a.name)
            == (&b.source, &b.helm_release_namespace, &b.helm_release, &b.api_version, &b.kind, &b.namespace, &b.name)
    });
    Ok(DeprecationReport { findings, server_version, table_covers_up_to: table.covers_up_to, skipped })
}

/// The resource to list for `kind`: the table's replacement version when served, else any served
/// version of the group that has the kind.
fn served_resource(ag: &ApiGroup, table: &Table, group: &str, kind: &str) -> Option<(ApiResource, Scope)> {
    let preferred: Vec<&str> = table
        .entries
        .iter()
        .filter(|e| e.group == group && e.kind == kind)
        .filter_map(|e| e.replacement.as_deref())
        .map(|r| split_api_version(r).1)
        .collect();
    let mut versions: Vec<&str> = preferred;
    versions.extend(ag.versions());
    versions.into_iter().find_map(|v| {
        ag.versioned_resources(v).into_iter().find(|(ar, _)| ar.kind == kind).map(|(ar, caps)| (ar, caps.scope))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served(v: &[&str]) -> HashSet<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn embedded_table_parses() {
        let t = load_table().expect("table");
        assert_eq!(t.covers_up_to, "1.34");
        assert!(t.entries.len() > 20);
        for e in &t.entries {
            assert!(!e.group.is_empty() || e.kind == "ComponentStatus");
            assert!(e.deprecated_in.contains('.') && e.removed_in.as_deref().map_or(true, |r| r.contains('.')), "{e:?}");
        }
    }

    #[test]
    fn match_deprecations_hit_and_miss() {
        let t = load_table().expect("table");
        let e = match_deprecations(&t, "policy/v1beta1", "PodDisruptionBudget").expect("hit");
        assert_eq!((e.removed_in.as_deref(), e.replacement.as_deref()), (Some("1.25"), Some("policy/v1")));
        assert!(match_deprecations(&t, "policy/v1", "PodDisruptionBudget").is_none());
        assert!(match_deprecations(&t, "policy/v1beta1", "Deployment").is_none());
        assert!(match_deprecations(&t, "v1", "Pod").is_none());
    }

    #[test]
    fn helm_manifest_with_removed_api_yields_finding_with_release_namespace() {
        let t = load_table().expect("table");
        let m = "apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n---\napiVersion: batch/v1beta1\nkind: CronJob\nmetadata:\n  name: cj\n";
        let (f, err) = manifest_findings(&t, "prod", "rel", m, &served(&["batch/v1"]));
        assert!(err.is_none());
        assert_eq!(f.len(), 1);
        let f = &f[0];
        assert_eq!((f.source.as_str(), f.kind.as_str(), f.name.as_str(), f.namespace.as_str()), ("helm", "CronJob", "cj", "prod"));
        assert_eq!((f.helm_release.as_deref(), f.helm_release_namespace.as_deref()), (Some("rel"), Some("prod")));
        assert!(!f.served_by_this_server);
        let (g, _) = manifest_findings(&t, "prod", "rel", m, &served(&["batch/v1beta1"]));
        assert!(g[0].served_by_this_server);
    }

    #[test]
    fn malformed_manifest_stops_at_first_error_without_hanging() {
        let t = load_table().expect("table");
        let bad = "apiVersion: batch/v1beta1\nkind: CronJob\nmetadata:\n  name: ok\n---\na: [unclosed\n---\n: : :\n  - x\n---\napiVersion: policy/v1beta1\nkind: PodDisruptionBudget\nmetadata:\n  name: after\n";
        let (f, err) = manifest_findings(&t, "ns", "r", bad, &served(&[]));
        assert!(err.is_some());
        assert_eq!(f.len(), 1); // the document before the error; nothing after it
        assert_eq!(f[0].name, "ok");
    }

    #[test]
    fn last_applied_reads_only_the_api_version() {
        let t = load_table().expect("table");
        let ann = r#"{"apiVersion":"extensions/v1beta1","kind":"Ingress","metadata":{"name":"i"},"spec":{"x":"SECRET"}}"#;
        let f = last_applied_finding(&t, "Ingress", "ns", "i", ann, &served(&["networking.k8s.io/v1"])).expect("hit");
        assert_eq!((f.source.as_str(), f.api_version.as_str(), f.removed_in.as_deref()), ("last-applied", "extensions/v1beta1", Some("1.22")));
        assert!(f.helm_release.is_none() && f.helm_release_namespace.is_none() && !f.served_by_this_server);
        assert!(last_applied_finding(&t, "Ingress", "ns", "i", r#"{"apiVersion":"networking.k8s.io/v1"}"#, &served(&[])).is_none());
        assert!(last_applied_finding(&t, "Ingress", "ns", "i", "not json", &served(&[])).is_none());
    }
}
