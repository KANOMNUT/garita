use k8s_openapi::api::admissionregistration::v1::{
    MutatingWebhookConfiguration as K8sMWC, RuleWithOperations,
    ValidatingWebhookConfiguration as K8sVWC,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::LabelSelector;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::utils::{age_from_timestamp, client_for_context};

// ─── MutatingWebhookConfiguration / ValidatingWebhookConfiguration ────────────
// One row struct, two commands — see docs/plan-kubeconfig-and-parity.md §4.3.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WebhookConfigRow {
    pub name: String,
    pub webhooks: i64,
    pub failure_policy: String, // comma-joined distinct values across webhooks
    pub targets: String,        // comma-joined distinct "group/resource" from rules
    pub age: String,
    pub matches: Vec<WebhookMatch>, // one per (webhook, rule)
}

/// One rule of one webhook, flattened for the Constraints "may apply" check.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WebhookMatch {
    pub webhook: String,
    pub api_groups: Vec<String>,
    pub resources: Vec<String>,
    pub operations: Vec<String>,
    pub scope: String, // "*" | "Namespaced" | "Cluster"
    pub has_namespace_selector: bool,
    pub has_object_selector: bool,
    pub failure_policy: String,
}

/// The fields of a Mutating/ValidatingWebhook this module reads (the two k8s-openapi types share no trait).
struct WebhookIn {
    name: String,
    failure_policy: Option<String>,
    rules: Option<Vec<RuleWithOperations>>,
    namespace_selector: Option<LabelSelector>,
    object_selector: Option<LabelSelector>,
}

fn selector_non_empty(s: &Option<LabelSelector>) -> bool {
    s.as_ref().is_some_and(|s| {
        s.match_labels.as_ref().is_some_and(|m| !m.is_empty())
            || s.match_expressions.as_ref().is_some_and(|e| !e.is_empty())
    })
}

fn webhook_matches(w: &WebhookIn) -> Vec<WebhookMatch> {
    let ns = selector_non_empty(&w.namespace_selector);
    let obj = selector_non_empty(&w.object_selector);
    w.rules
        .iter()
        .flatten()
        .map(|r| WebhookMatch {
            webhook: w.name.clone(),
            api_groups: r.api_groups.clone().unwrap_or_default(),
            resources: r.resources.clone().unwrap_or_default(),
            operations: r.operations.clone().unwrap_or_default(),
            scope: r.scope.clone().unwrap_or_else(|| "*".to_string()),
            has_namespace_selector: ns,
            has_object_selector: obj,
            // Defaults to "Fail" per the k8s API docs when unset.
            failure_policy: w.failure_policy.clone().unwrap_or_else(|| "Fail".to_string()),
        })
        .collect()
}

/// Build a `WebhookConfigRow` from a webhook config's name/age plus the
/// `(failure_policy, rules)` pairs of its individual webhooks. `MutatingWebhook` and
/// `ValidatingWebhook` have identically-shaped fields but are different k8s-openapi types
/// with no shared trait, so callers extract the two fields they need before calling in.
fn build_webhook_row(
    name: String,
    webhooks: Vec<WebhookIn>,
    age: String,
) -> WebhookConfigRow {
    let webhook_count = webhooks.len() as i64;
    let mut failure_policies: BTreeSet<String> = BTreeSet::new();
    let mut targets: BTreeSet<String> = BTreeSet::new();

    for w in &webhooks {
        // Defaults to "Fail" per the k8s API docs when unset.
        failure_policies.insert(w.failure_policy.clone().unwrap_or_else(|| "Fail".to_string()));
        for rule in w.rules.iter().flatten() {
            let groups = rule.api_groups.clone().unwrap_or_default();
            let resources = rule.resources.clone().unwrap_or_default();
            for g in &groups {
                let g_label = if g.is_empty() { "core" } else { g.as_str() };
                for r in &resources {
                    targets.insert(format!("{}/{}", g_label, r));
                }
            }
        }
    }

    WebhookConfigRow {
        name,
        webhooks: webhook_count,
        failure_policy: failure_policies.into_iter().collect::<Vec<_>>().join(", "),
        targets: targets.into_iter().collect::<Vec<_>>().join(", "),
        age,
        matches: webhooks.iter().flat_map(webhook_matches).collect(),
    }
}

#[tauri::command]
pub async fn list_mutating_webhooks(context: String) -> Result<Vec<WebhookConfigRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sMWC> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list mutating webhook configurations: {}", e))?;
    Ok(list.items.into_iter().map(|mwc| {
        let age = age_from_timestamp(mwc.metadata.creation_timestamp.as_ref().map(|t| &t.0));
        let webhooks = mwc.webhooks.unwrap_or_default().into_iter()
            .map(|w| WebhookIn {
                name: w.name,
                failure_policy: w.failure_policy,
                rules: w.rules,
                namespace_selector: w.namespace_selector,
                object_selector: w.object_selector,
            })
            .collect();
        build_webhook_row(mwc.metadata.name.unwrap_or_default(), webhooks, age)
    }).collect())
}

#[tauri::command]
pub async fn list_validating_webhooks(context: String) -> Result<Vec<WebhookConfigRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sVWC> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list validating webhook configurations: {}", e))?;
    Ok(list.items.into_iter().map(|vwc| {
        let age = age_from_timestamp(vwc.metadata.creation_timestamp.as_ref().map(|t| &t.0));
        let webhooks = vwc.webhooks.unwrap_or_default().into_iter()
            .map(|w| WebhookIn {
                name: w.name,
                failure_policy: w.failure_policy,
                rules: w.rules,
                namespace_selector: w.namespace_selector,
                object_selector: w.object_selector,
            })
            .collect();
        build_webhook_row(vwc.metadata.name.unwrap_or_default(), webhooks, age)
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn rule() -> RuleWithOperations {
        RuleWithOperations {
            api_groups: Some(vec!["apps".into()]),
            api_versions: Some(vec!["v1".into()]),
            operations: Some(vec!["CREATE".into()]),
            resources: Some(vec!["deployments".into()]),
            scope: None,
        }
    }

    fn hook(rules: Option<Vec<RuleWithOperations>>, ns: Option<LabelSelector>, obj: Option<LabelSelector>, fp: Option<&str>) -> WebhookIn {
        WebhookIn {
            name: "w".into(),
            failure_policy: fp.map(String::from),
            rules,
            namespace_selector: ns,
            object_selector: obj,
        }
    }

    #[test]
    fn match_without_selectors() {
        // An empty selector `{}` is "match everything", so it is not a selector for our purposes.
        let w = hook(Some(vec![rule()]), None, Some(LabelSelector::default()), None);
        let m = webhook_matches(&w);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].webhook, "w");
        assert_eq!(m[0].scope, "*");
        assert_eq!(m[0].failure_policy, "Fail");
        assert_eq!(m[0].resources, ["deployments"]);
        assert!(!m[0].has_namespace_selector && !m[0].has_object_selector);
    }

    #[test]
    fn match_with_selectors_and_no_rules() {
        let sel = LabelSelector { match_labels: Some(BTreeMap::from([("a".to_string(), "b".to_string())])), match_expressions: None };
        let mut r = rule();
        r.scope = Some("Namespaced".into());
        let w = hook(Some(vec![r]), Some(sel.clone()), Some(sel), Some("Ignore"));
        let m = webhook_matches(&w);
        assert!(m[0].has_namespace_selector && m[0].has_object_selector);
        assert_eq!((m[0].scope.as_str(), m[0].failure_policy.as_str()), ("Namespaced", "Ignore"));
        assert!(webhook_matches(&hook(None, None, None, None)).is_empty());
    }
}
