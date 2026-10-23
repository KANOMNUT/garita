//! Node drain building blocks: a side-effect-free preview and a single-pod eviction.
//!
//! The drain itself is driven pod-by-pod from the frontend (`cordon_node` -> `preview_node_drain`
//! -> `evict_pod` per pod). There is deliberately no long-running backend task, so there is no
//! cancellation registry and no orphaned task if the window goes away.
//!
//! **Eviction only. Nothing in this file calls `delete`.** A PodDisruptionBudget refusal
//! (HTTP 429) is reported as `blocked`; it is never worked around.

use std::collections::{BTreeMap, BTreeSet};

use futures::future::join_all;
use k8s_openapi::api::core::v1::{Node as K8sNode, Pod as K8sPod};
use k8s_openapi::api::policy::v1::PodDisruptionBudget;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::LabelSelector;
use kube::api::{EvictParams, ListParams};
use kube::Api;
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

const MIRROR_ANNOTATION: &str = "kubernetes.io/config.mirror";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DrainPdbRef {
    pub name: String,
    pub disruptions_allowed: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DrainPodPreview {
    pub namespace: String,
    pub name: String,
    pub category: String, // "evict" | "daemonset" | "mirror"
    pub owner_kind: Option<String>,
    pub owner_name: Option<String>,
    pub unmanaged: bool,
    pub has_empty_dir: bool,
    pub pdbs: Vec<DrainPdbRef>,
    pub may_be_blocked: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DrainPreview {
    pub node: String,
    pub unschedulable: bool,
    pub node_ready: bool,
    pub pods: Vec<DrainPodPreview>,
    pub pdb_lookup_errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EvictionResult {
    pub namespace: String,
    pub name: String,
    pub outcome: String, // "evicted" | "blocked" | "gone" | "failed"
    pub message: String,
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/// The controller ownerReference, if any (`controller == Some(true)`).
fn controller_ref(pod: &K8sPod) -> Option<(&str, &str)> {
    pod.metadata
        .owner_references
        .as_ref()?
        .iter()
        .find(|r| r.controller == Some(true))
        .map(|r| (r.kind.as_str(), r.name.as_str()))
}

/// `"mirror"` (checked first) / `"daemonset"` / `"evict"` (everything else, including
/// unmanaged, completed and terminating pods).
pub(crate) fn pod_category(pod: &K8sPod) -> &'static str {
    let is_mirror = pod
        .metadata
        .annotations
        .as_ref()
        .map(|a| a.contains_key(MIRROR_ANNOTATION))
        .unwrap_or(false);
    if is_mirror {
        return "mirror";
    }
    match controller_ref(pod) {
        Some(("DaemonSet", _)) => "daemonset",
        _ => "evict",
    }
}

/// Controller `(kind, name)`. A ReplicaSet whose name ends in `-<pod-template-hash>` is reported
/// as its Deployment, with no extra API call; otherwise the raw controller is returned.
pub(crate) fn controller_owner(pod: &K8sPod) -> Option<(String, String)> {
    let (kind, name) = controller_ref(pod)?;
    if kind == "ReplicaSet" {
        let hash = pod
            .metadata
            .labels
            .as_ref()
            .and_then(|l| l.get("pod-template-hash"))
            .filter(|h| !h.is_empty());
        if let Some(h) = hash {
            if let Some(dep) = name.strip_suffix(&format!("-{}", h)) {
                if !dep.is_empty() {
                    return Some(("Deployment".to_string(), dep.to_string()));
                }
            }
        }
    }
    Some((kind.to_string(), name.to_string()))
}

/// Display-only PDB selector match (the API server enforces the real check).
/// `None` selector matches nothing; an empty selector matches every pod.
pub(crate) fn selector_matches(
    selector: Option<&LabelSelector>,
    labels: &BTreeMap<String, String>,
) -> bool {
    let sel = match selector {
        Some(s) => s,
        None => return false,
    };
    if let Some(ml) = &sel.match_labels {
        if !ml.iter().all(|(k, v)| labels.get(k) == Some(v)) {
            return false;
        }
    }
    if let Some(exprs) = &sel.match_expressions {
        for e in exprs {
            let values: &[String] = e.values.as_deref().unwrap_or(&[]);
            let present = labels.get(&e.key);
            let ok = match e.operator.as_str() {
                "In" => present.map(|v| values.contains(v)).unwrap_or(false),
                "NotIn" => present.map(|v| !values.contains(v)).unwrap_or(true),
                "Exists" => present.is_some(),
                "DoesNotExist" => present.is_none(),
                _ => false,
            };
            if !ok {
                return false;
            }
        }
    }
    true
}

/// A pod to be evicted that is covered by a PDB with no disruptions left.
pub(crate) fn may_be_blocked(category: &str, pdbs: &[DrainPdbRef]) -> bool {
    category == "evict" && pdbs.iter().any(|p| p.disruptions_allowed <= 0)
}

/// Map an eviction API error to an outcome. Only a 429 that names a disruption budget is
/// `blocked`; a bare 429 is API Priority & Fairness throttling and is `failed`.
pub(crate) fn classify_eviction_error(code: u16, message: &str) -> &'static str {
    match code {
        429 if message.to_lowercase().contains("disruption budget") => "blocked",
        404 => "gone",
        _ => "failed",
    }
}

fn node_is_ready(node: &K8sNode) -> bool {
    node.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| cs.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
        .unwrap_or(false)
}

fn pod_has_empty_dir(pod: &K8sPod) -> bool {
    pod.spec
        .as_ref()
        .and_then(|s| s.volumes.as_ref())
        .map(|vs| vs.iter().any(|v| v.empty_dir.is_some()))
        .unwrap_or(false)
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Side-effect-free drain preview: one GET on the node, one LIST of pods on it, and one LIST of
/// PDBs per namespace present. Never writes. Point-in-time: the drain re-fetches after cordon.
#[tauri::command]
pub async fn preview_node_drain(context: String, node: String) -> Result<DrainPreview, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let node_api: Api<K8sNode> = Api::all(client.clone());
    let node_obj = node_api.get(&node).await
        .map_err(|e| format!("Failed to get node: {}", e))?;

    let pod_api: Api<K8sPod> = Api::all(client.clone());
    let lp = ListParams::default().fields(&format!("spec.nodeName={}", node));
    let pod_list = pod_api.list(&lp).await
        .map_err(|e| format!("Failed to list pods on node: {}", e))?;

    let namespaces: BTreeSet<String> = pod_list
        .items
        .iter()
        .map(|p| p.metadata.namespace.clone().unwrap_or_default())
        .collect();

    let lookups = join_all(namespaces.iter().map(|ns| {
        let api: Api<PodDisruptionBudget> = Api::namespaced(client.clone(), ns);
        async move { (ns.clone(), api.list(&ListParams::default()).await) }
    }))
    .await;

    let mut pdbs_by_ns: BTreeMap<String, Vec<PodDisruptionBudget>> = BTreeMap::new();
    let mut pdb_lookup_errors: Vec<String> = Vec::new();
    for (ns, res) in lookups {
        match res {
            Ok(list) => {
                pdbs_by_ns.insert(ns, list.items);
            }
            Err(e) => pdb_lookup_errors.push(format!(
                "Failed to list PodDisruptionBudgets in {}: {}",
                ns, e
            )),
        }
    }

    let empty_labels: BTreeMap<String, String> = BTreeMap::new();
    let mut pods: Vec<DrainPodPreview> = pod_list
        .items
        .iter()
        .map(|pod| {
            let namespace = pod.metadata.namespace.clone().unwrap_or_default();
            let name = pod.metadata.name.clone().unwrap_or_default();
            let category = pod_category(pod);
            let labels = pod.metadata.labels.as_ref().unwrap_or(&empty_labels);
            let pdbs: Vec<DrainPdbRef> = pdbs_by_ns
                .get(&namespace)
                .map(|list| {
                    list.iter()
                        .filter(|pdb| {
                            selector_matches(pdb.spec.as_ref().and_then(|s| s.selector.as_ref()), labels)
                        })
                        .map(|pdb| DrainPdbRef {
                            name: pdb.metadata.name.clone().unwrap_or_default(),
                            disruptions_allowed: pdb
                                .status
                                .as_ref()
                                .map(|s| s.disruptions_allowed)
                                .unwrap_or(0),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let owner = controller_owner(pod);
            let unmanaged = category != "mirror" && owner.is_none();
            let (owner_kind, owner_name) = match owner {
                Some((k, n)) => (Some(k), Some(n)),
                None => (None, None),
            };
            DrainPodPreview {
                namespace,
                name,
                category: category.to_string(),
                owner_kind,
                owner_name,
                unmanaged,
                has_empty_dir: pod_has_empty_dir(pod),
                may_be_blocked: may_be_blocked(category, &pdbs),
                pdbs,
            }
        })
        .collect();
    pods.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));

    Ok(DrainPreview {
        node,
        unschedulable: node_obj
            .spec
            .as_ref()
            .and_then(|s| s.unschedulable)
            .unwrap_or(false),
        node_ready: node_is_ready(&node_obj),
        pods,
        pdb_lookup_errors,
    })
}

/// Evict one pod through the Eviction API (which honours PodDisruptionBudgets). There is no
/// fallback of any kind: a refusal is reported, never retried as a delete.
#[tauri::command]
pub async fn evict_pod(
    context: String,
    namespace: String,
    name: String,
) -> Result<EvictionResult, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);

    let (outcome, message) = match api.evict(&name, &EvictParams::default()).await {
        Ok(_) => ("evicted", String::new()),
        Err(kube::Error::Api(ae)) => (classify_eviction_error(ae.code, &ae.message), ae.message),
        Err(e) => ("failed", e.to_string()),
    };
    // Every API outcome is an `Ok` for the caller, so the log carries the real verdict:
    // only an accepted eviction (and an already-gone pod) reads as ok.
    let logged: Result<(), String> = match outcome {
        "evicted" | "gone" => Ok(()),
        other => Err(format!("{}: {}", other, message)),
    };
    crate::app_log::log_write(&context, "evict", "pod", &namespace, &name, None, &logged);
    Ok(EvictionResult {
        namespace,
        name,
        outcome: outcome.to_string(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelectorRequirement, ObjectMeta, OwnerReference};

    fn owner(kind: &str, name: &str, controller: Option<bool>) -> OwnerReference {
        OwnerReference {
            api_version: "v1".into(),
            kind: kind.into(),
            name: name.into(),
            uid: "u".into(),
            controller,
            block_owner_deletion: None,
        }
    }

    fn pod(owners: Option<Vec<OwnerReference>>, labels: &[(&str, &str)], mirror: bool) -> K8sPod {
        let mut annotations = BTreeMap::new();
        if mirror {
            annotations.insert(MIRROR_ANNOTATION.to_string(), "x".to_string());
        }
        K8sPod {
            metadata: ObjectMeta {
                name: Some("p".into()),
                namespace: Some("ns".into()),
                owner_references: owners,
                labels: Some(labels.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
                annotations: Some(annotations),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn req(key: &str, op: &str, values: &[&str]) -> LabelSelectorRequirement {
        LabelSelectorRequirement {
            key: key.into(),
            operator: op.into(),
            values: if values.is_empty() {
                None
            } else {
                Some(values.iter().map(|s| s.to_string()).collect())
            },
        }
    }

    fn sel_expr(r: LabelSelectorRequirement) -> LabelSelector {
        LabelSelector { match_expressions: Some(vec![r]), match_labels: None }
    }

    #[test]
    fn mirror_wins_over_daemonset() {
        let p = pod(Some(vec![owner("DaemonSet", "ds", Some(true))]), &[], true);
        assert_eq!(pod_category(&p), "mirror");
    }

    #[test]
    fn daemonset_via_controller_ref() {
        let p = pod(Some(vec![owner("DaemonSet", "ds", Some(true))]), &[], false);
        assert_eq!(pod_category(&p), "daemonset");
        // a non-controller DaemonSet ref does not count
        let q = pod(Some(vec![owner("DaemonSet", "ds", Some(false))]), &[], false);
        assert_eq!(pod_category(&q), "evict");
    }

    #[test]
    fn unmanaged_when_owner_is_not_controller() {
        let p = pod(Some(vec![owner("Foo", "f", None), owner("Bar", "b", Some(false))]), &[], false);
        assert_eq!(controller_owner(&p), None);
        assert_eq!(pod_category(&p), "evict");
        assert_eq!(controller_owner(&pod(None, &[], false)), None);
    }

    #[test]
    fn replicaset_maps_to_deployment_only_with_matching_hash() {
        let p = pod(
            Some(vec![owner("ReplicaSet", "web-7d9f", Some(true))]),
            &[("pod-template-hash", "7d9f")],
            false,
        );
        assert_eq!(controller_owner(&p), Some(("Deployment".into(), "web".into())));

        let wrong_hash = pod(
            Some(vec![owner("ReplicaSet", "web-7d9f", Some(true))]),
            &[("pod-template-hash", "zzzz")],
            false,
        );
        assert_eq!(controller_owner(&wrong_hash), Some(("ReplicaSet".into(), "web-7d9f".into())));

        let no_label = pod(Some(vec![owner("ReplicaSet", "foo-abc", Some(true))]), &[], false);
        assert_eq!(controller_owner(&no_label), Some(("ReplicaSet".into(), "foo-abc".into())));
    }

    #[test]
    fn selector_none_matches_nothing_and_empty_matches_all() {
        let l = labels(&[("app", "web")]);
        assert!(!selector_matches(None, &l));
        assert!(selector_matches(Some(&LabelSelector::default()), &l));
        assert!(selector_matches(Some(&LabelSelector::default()), &BTreeMap::new()));
    }

    #[test]
    fn selector_match_labels() {
        let l = labels(&[("app", "web"), ("tier", "fe")]);
        let ok = LabelSelector { match_labels: Some(labels(&[("app", "web")])), match_expressions: None };
        let bad = LabelSelector { match_labels: Some(labels(&[("app", "db")])), match_expressions: None };
        assert!(selector_matches(Some(&ok), &l));
        assert!(!selector_matches(Some(&bad), &l));
    }

    #[test]
    fn selector_operators() {
        let l = labels(&[("app", "web")]);
        assert!(selector_matches(Some(&sel_expr(req("app", "In", &["web", "api"]))), &l));
        assert!(!selector_matches(Some(&sel_expr(req("app", "In", &["api"]))), &l));
        assert!(!selector_matches(Some(&sel_expr(req("x", "In", &["web"]))), &l));

        assert!(selector_matches(Some(&sel_expr(req("app", "NotIn", &["api"]))), &l));
        assert!(!selector_matches(Some(&sel_expr(req("app", "NotIn", &["web"]))), &l));
        assert!(selector_matches(Some(&sel_expr(req("x", "NotIn", &["web"]))), &l));

        assert!(selector_matches(Some(&sel_expr(req("app", "Exists", &[]))), &l));
        assert!(!selector_matches(Some(&sel_expr(req("x", "Exists", &[]))), &l));

        assert!(selector_matches(Some(&sel_expr(req("x", "DoesNotExist", &[]))), &l));
        assert!(!selector_matches(Some(&sel_expr(req("app", "DoesNotExist", &[]))), &l));

        assert!(!selector_matches(Some(&sel_expr(req("app", "Bogus", &["web"]))), &l));
    }

    #[test]
    fn eviction_classification() {
        assert_eq!(
            classify_eviction_error(429, "Cannot evict pod as it would violate the pod's disruption budget."),
            "blocked"
        );
        assert_eq!(classify_eviction_error(429, "Too many requests"), "failed");
        assert_eq!(classify_eviction_error(404, "pods \"x\" not found"), "gone");
        assert_eq!(classify_eviction_error(500, "multiple PodDisruptionBudgets"), "failed");
        assert_eq!(classify_eviction_error(429, "violates the DISRUPTION BUDGET"), "blocked");
    }

    #[test]
    fn may_be_blocked_threshold() {
        let zero = [DrainPdbRef { name: "a".into(), disruptions_allowed: 0 }];
        let one = [DrainPdbRef { name: "a".into(), disruptions_allowed: 1 }];
        assert!(may_be_blocked("evict", &zero));
        assert!(!may_be_blocked("evict", &one));
        assert!(!may_be_blocked("daemonset", &zero));
        assert!(!may_be_blocked("evict", &[]));
    }
}
