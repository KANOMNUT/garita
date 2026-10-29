use k8s_openapi::api::core::v1::Namespace;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::extras::ResourceCondition;
use super::utils::{age_from_timestamp, client_for_context};

/// One namespace for the Namespaces page, the namespace picker and every consumer that needs only
/// names. Mirrors `NamespaceRow` in `src/types/k8s.ts`.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NamespaceRow {
    /// `metadata.name`.
    pub name: String,
    /// `status.phase` verbatim (`"Active"` or `"Terminating"`); `""` when the API sent none.
    pub phase: String,
    /// Formatted age of `metadata.creationTimestamp`; `"—"` when absent.
    pub age: String,
    /// `metadata.labels`, sorted by key (a `BTreeMap`, so the chip order is stable).
    pub labels: BTreeMap<String, String>,
    /// `metadata.deletionTimestamp` as RFC 3339; `None` when the namespace is not being deleted.
    pub deletion_timestamp: Option<String>,
    /// `status.conditions` in API order.
    pub conditions: Vec<ResourceCondition>,
    /// `spec.finalizers` in API order.
    pub finalizers: Vec<String>,
}

/// Map one API namespace to its row. Pure and total: every absent field has a default, so a
/// namespace with no `spec` and no `status` still yields a row.
pub(crate) fn namespace_row(ns: Namespace) -> NamespaceRow {
    let age = age_from_timestamp(ns.metadata.creation_timestamp.as_ref().map(|t| &t.0));
    let deletion_timestamp = ns.metadata.deletion_timestamp.as_ref().map(|t| t.0.to_rfc3339());
    let phase = ns.status.as_ref().and_then(|s| s.phase.clone()).unwrap_or_default();
    let conditions = ns
        .status
        .and_then(|s| s.conditions)
        .unwrap_or_default()
        .into_iter()
        .map(|c| ResourceCondition {
            type_: c.type_,
            status: c.status,
            reason: c.reason.unwrap_or_default(),
            message: c.message.unwrap_or_default(),
            last_transition: c
                .last_transition_time
                .map(|t| t.0.to_rfc3339())
                .unwrap_or_default(),
        })
        .collect();
    let finalizers = ns.spec.and_then(|s| s.finalizers).unwrap_or_default();

    NamespaceRow {
        name: ns.metadata.name.unwrap_or_default(),
        phase,
        age,
        labels: ns.metadata.labels.unwrap_or_default(),
        deletion_timestamp,
        conditions,
        finalizers,
    }
}

/// Every namespace as a row, in the API's order. The one read behind the Namespaces page and the
/// picker. The error strings are load-bearing: the kube 403 text contains "forbidden", which the
/// frontend's `classifyReadError` and `isForbidden` rely on.
#[tauri::command]
pub async fn list_namespace_rows(context: String) -> Result<Vec<NamespaceRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<Namespace> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list namespaces: {}", e))?;
    Ok(list.items.into_iter().map(namespace_row).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ns_from(v: serde_json::Value) -> Namespace {
        serde_json::from_value::<Namespace>(v).expect("fixture parses")
    }

    #[test]
    fn active_namespace_maps_phase_finalizers_and_sorted_labels() {
        let row = namespace_row(ns_from(json!({
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": "payments",
                "creationTimestamp": "2020-01-01T00:00:00Z",
                "labels": {
                    "team": "pay",
                    "kubernetes.io/metadata.name": "payments",
                    "env": "prod"
                }
            },
            "spec": { "finalizers": ["kubernetes"] },
            "status": { "phase": "Active" }
        })));
        assert_eq!(row.name, "payments");
        assert_eq!(row.phase, "Active");
        assert_ne!(row.age, "—");
        assert!(row.age.contains('d'), "a 2020 namespace is days old, age was {}", row.age);
        assert_eq!(row.finalizers, vec!["kubernetes".to_string()]);
        assert!(row.deletion_timestamp.is_none());
        assert!(row.conditions.is_empty());
        let keys: Vec<&str> = row.labels.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["env", "kubernetes.io/metadata.name", "team"]);
        assert_eq!(row.labels.get("team").map(String::as_str), Some("pay"));
    }

    #[test]
    fn terminating_namespace_carries_deletion_time_and_conditions_in_order() {
        let row = namespace_row(ns_from(json!({
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": "old",
                "creationTimestamp": "2020-01-01T00:00:00Z",
                "deletionTimestamp": "2026-10-28T10:00:00Z"
            },
            "spec": { "finalizers": ["kubernetes"] },
            "status": {
                "phase": "Terminating",
                "conditions": [
                    {
                        "type": "NamespaceContentRemaining",
                        "status": "True",
                        "reason": "SomeResourcesRemain",
                        "message": "Some resources are remaining: pods. has 2 resource instances",
                        "lastTransitionTime": "2026-10-28T10:00:05Z"
                    },
                    {
                        "type": "NamespaceFinalizersRemaining",
                        "status": "True",
                        "reason": "SomeFinalizersRemain",
                        "message": "Some content in the namespace has finalizers remaining: foo/bar in 1 resource instances"
                    }
                ]
            }
        })));
        assert_eq!(row.phase, "Terminating");
        let dt = row.deletion_timestamp.expect("deletion timestamp present");
        assert!(dt.starts_with("2026-10-28T10:00:00"), "deletion timestamp was {}", dt);
        let types: Vec<&str> = row.conditions.iter().map(|c| c.type_.as_str()).collect();
        assert_eq!(types, vec!["NamespaceContentRemaining", "NamespaceFinalizersRemaining"]);
        let first = &row.conditions[0];
        assert_eq!(first.status, "True");
        assert_eq!(first.reason, "SomeResourcesRemain");
        assert!(first.message.starts_with("Some resources are remaining"));
        assert!(first.last_transition.starts_with("2026-10-28T10:00:05"));
        let second = &row.conditions[1];
        assert_eq!(second.reason, "SomeFinalizersRemain");
        assert_eq!(second.last_transition, "", "missing lastTransitionTime maps to an empty string");
    }

    #[test]
    fn condition_without_reason_or_message_defaults_to_empty_strings() {
        let row = namespace_row(ns_from(json!({
            "metadata": { "name": "x" },
            "status": { "conditions": [{ "type": "NamespaceDeletionDiscoveryFailure", "status": "False" }] }
        })));
        let c = &row.conditions[0];
        assert_eq!(c.reason, "");
        assert_eq!(c.message, "");
        assert_eq!(c.last_transition, "");
    }

    #[test]
    fn namespace_without_spec_or_status_gets_empty_defaults() {
        let row = namespace_row(ns_from(json!({ "metadata": { "name": "bare" } })));
        assert_eq!(row.name, "bare");
        assert_eq!(row.phase, "");
        assert_eq!(row.age, "—");
        assert!(row.labels.is_empty());
        assert!(row.deletion_timestamp.is_none());
        assert!(row.conditions.is_empty());
        assert!(row.finalizers.is_empty());
    }

    #[test]
    fn row_serialises_with_the_field_names_the_frontend_reads() {
        let row = namespace_row(ns_from(json!({ "metadata": { "name": "n" } })));
        let v = serde_json::to_value(&row).expect("serialises");
        for key in ["name", "phase", "age", "labels", "deletion_timestamp", "conditions", "finalizers"] {
            assert!(v.get(key).is_some(), "missing key {}", key);
        }
        assert!(v["deletion_timestamp"].is_null());
    }
}
