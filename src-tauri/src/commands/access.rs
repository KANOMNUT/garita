//! `can_i` — batched SelfSubjectAccessReview.
//!
//! See `docs/plan-kubeconfig-and-parity.md` §3.4 for the frozen contract.
//!
//! **FAIL OPEN. Not negotiable.** Only an explicit `allowed: false` from the server greys
//! anything out in the UI. If the SSAR request itself errors — aggregation layer down, network
//! blip, RBAC denying `SelfSubjectAccessReview` creation itself (rare but possible) — every
//! action must stay enabled. SSAR answers RBAC only; admission webhooks (Kyverno/OPA/Gatekeeper)
//! can still deny a permitted request, so this is a UI hint, not a guarantee, and the
//! confirm-and-fail error path on every mutating command stays exactly as it is.

use futures::future::join_all;
use k8s_openapi::api::authorization::v1::{
    ResourceAttributes, SelfSubjectAccessReview, SelfSubjectAccessReviewSpec,
};
use kube::{api::PostParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AccessCheck {
    pub group: String,
    pub resource: String,
    pub verb: String,
    pub namespace: String,
    /// `ResourceAttributes.subresource` (for example `ephemeralcontainers`, `eviction`). Absent in
    /// older callers' JSON, hence `#[serde(default)]`.
    #[serde(default)]
    pub subresource: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AccessResult {
    pub allowed: bool,
    pub reason: String,
}

async fn check_one(api: Api<SelfSubjectAccessReview>, check: AccessCheck) -> AccessResult {
    let ssar = SelfSubjectAccessReview {
        metadata: Default::default(),
        spec: SelfSubjectAccessReviewSpec {
            resource_attributes: Some(ResourceAttributes {
                group: Some(check.group),
                resource: Some(check.resource),
                verb: Some(check.verb),
                namespace: Some(check.namespace),
                subresource: check.subresource.filter(|s| !s.is_empty()),
                ..Default::default()
            }),
            non_resource_attributes: None,
        },
        status: None,
    };

    match api.create(&PostParams::default(), &ssar).await {
        Ok(result) => {
            let status = result.status.unwrap_or_default();
            let reason = status
                .reason
                .filter(|r| !r.is_empty())
                .or_else(|| status.evaluation_error.filter(|e| !e.is_empty()))
                .unwrap_or_default();
            AccessResult { allowed: status.allowed, reason }
        }
        // Fail open — see module doc.
        Err(e) => AccessResult {
            allowed: true,
            reason: format!("Permission check unavailable: {}", e),
        },
    }
}

/// One batched command, never a per-object check — RBAC is rarely `resourceNames`-scoped, and a
/// per-row check on a large table would be one request per row. Results are returned in input
/// order (`join_all` preserves the order of the futures it was given).
#[tauri::command]
pub async fn can_i(context: String, checks: Vec<AccessCheck>) -> Result<Vec<AccessResult>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<SelfSubjectAccessReview> = Api::all(client);

    let futures = checks.into_iter().map(|check| check_one(api.clone(), check));
    Ok(join_all(futures).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_check_without_subresource_deserializes_to_none() {
        let c: AccessCheck = serde_json::from_str(
            r#"{"group":"","resource":"pods","verb":"delete","namespace":"default"}"#,
        )
        .expect("old-shape JSON still parses");
        assert_eq!(c.subresource, None);
        assert_eq!(c.resource, "pods");
    }

    #[test]
    fn access_check_with_subresource_round_trips() {
        let c: AccessCheck = serde_json::from_str(
            r#"{"group":"","resource":"pods","verb":"create","namespace":"kube-system","subresource":"eviction"}"#,
        )
        .expect("parses");
        assert_eq!(c.subresource.as_deref(), Some("eviction"));
        let null: AccessCheck = serde_json::from_str(
            r#"{"group":"","resource":"pods","verb":"update","namespace":"x","subresource":null}"#,
        )
        .expect("null parses");
        assert_eq!(null.subresource, None);
    }
}
