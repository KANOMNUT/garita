use k8s_openapi::api::policy::v1::PodDisruptionBudget as K8sPDB;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::LabelSelector;
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PdbRow {
    pub name: String,
    pub namespace: String,
    pub min_available: String,
    pub max_unavailable: String,
    pub desired_healthy: i32,
    pub current_healthy: i32,
    pub disruptions_allowed: i32,
    pub age: String,
    pub match_labels: BTreeMap<String, String>,
    pub has_match_expressions: bool,
}

fn intorstring_to_string(v: &IntOrString) -> String {
    match v {
        IntOrString::Int(n) => n.to_string(),
        IntOrString::String(s) => s.clone(),
    }
}

/// `(matchLabels, has non-empty matchExpressions)` of a PDB selector.
fn selector_parts(sel: Option<&LabelSelector>) -> (BTreeMap<String, String>, bool) {
    let labels = sel.and_then(|s| s.match_labels.clone()).unwrap_or_default();
    let has_exprs = sel
        .and_then(|s| s.match_expressions.as_ref())
        .is_some_and(|e| !e.is_empty());
    (labels, has_exprs)
}

#[tauri::command]
pub async fn list_pdbs(context: String, namespace: String) -> Result<Vec<PdbRow>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPDB> = namespaced_or_all!(client, K8sPDB, namespace);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list PodDisruptionBudgets: {}", e))?;
    Ok(list
        .items
        .into_iter()
        .map(|pdb| {
            let spec = pdb.spec.as_ref();
            let status = pdb.status.as_ref();
            let min_available = spec
                .and_then(|s| s.min_available.as_ref())
                .map(intorstring_to_string)
                .unwrap_or_else(|| "\u{2014}".to_string());
            let max_unavailable = spec
                .and_then(|s| s.max_unavailable.as_ref())
                .map(intorstring_to_string)
                .unwrap_or_else(|| "\u{2014}".to_string());
            let desired_healthy = status.map(|s| s.desired_healthy).unwrap_or(0);
            let current_healthy = status.map(|s| s.current_healthy).unwrap_or(0);
            let disruptions_allowed = status.map(|s| s.disruptions_allowed).unwrap_or(0);
            let (match_labels, has_match_expressions) =
                selector_parts(spec.and_then(|s| s.selector.as_ref()));
            PdbRow {
                name: pdb.metadata.name.unwrap_or_default(),
                namespace: pdb.metadata.namespace.unwrap_or_default(),
                min_available,
                max_unavailable,
                desired_healthy,
                current_healthy,
                disruptions_allowed,
                age: age_from_timestamp(pdb.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
                match_labels,
                has_match_expressions,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::LabelSelectorRequirement;

    #[test]
    fn selector_parts_extracts_labels_and_expressions() {
        assert_eq!(selector_parts(None), (BTreeMap::new(), false));
        let sel = LabelSelector {
            match_labels: Some(BTreeMap::from([("app".to_string(), "web".to_string())])),
            match_expressions: None,
        };
        let (l, e) = selector_parts(Some(&sel));
        assert_eq!(l.get("app").map(String::as_str), Some("web"));
        assert!(!e);
        let sel = LabelSelector {
            match_labels: None,
            match_expressions: Some(vec![LabelSelectorRequirement {
                key: "tier".into(),
                operator: "In".into(),
                values: Some(vec!["a".into()]),
            }]),
        };
        assert_eq!(selector_parts(Some(&sel)), (BTreeMap::new(), true));
        let empty = LabelSelector { match_labels: None, match_expressions: Some(vec![]) };
        assert!(!selector_parts(Some(&empty)).1);
    }
}
