use kube::{
    api::{ApiResource, DynamicObject, ListParams},
    Api,
};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Certificate {
    pub name: String,
    pub namespace: String,
    /// True when `status.conditions[type=Ready].status == "True"`.
    pub ready: bool,
    pub secret_name: String,
    pub issuer_name: String,
    /// `Issuer` or `ClusterIssuer` (from `spec.issuerRef.kind`).
    pub issuer_kind: String,
    pub dns_names: Vec<String>,
    /// Raw ISO timestamp (`status.renewalTime`); frontend formats relative time.
    pub renewal_time: String,
    /// Raw ISO timestamp (`status.notAfter`); frontend formats + colors < 7 days.
    pub not_after: String,
    pub age: String,
    /// Health rollup pill: "Healthy" / "Progressing" / "Degraded".
    pub status: String,
    /// Message from the failing condition (Ready or Issuing), empty if healthy.
    pub last_failure_message: String,
}

/// The cert-manager Certificate CRD descriptor.
pub(crate) fn certificate_api_resource() -> ApiResource {
    ApiResource {
        group: "cert-manager.io".to_string(),
        version: "v1".to_string(),
        api_version: "cert-manager.io/v1".to_string(),
        kind: "Certificate".to_string(),
        plural: "certificates".to_string(),
    }
}

/// Find a condition entry of the given type, returning `(status, message)`.
fn find_condition<'a>(
    conditions: &'a [serde_json::Value],
    cond_type: &str,
) -> Option<(&'a str, &'a str)> {
    conditions.iter().find_map(|c| {
        if c["type"].as_str()? == cond_type {
            let status = c["status"].as_str().unwrap_or("");
            let message = c["message"].as_str().unwrap_or("");
            Some((status, message))
        } else {
            None
        }
    })
}

#[tauri::command]
pub async fn list_certificates(
    context: String,
    namespace: String,
) -> Result<Vec<Certificate>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = certificate_api_resource();
    let api: Api<DynamicObject> = if namespace == "all" || namespace.is_empty() {
        Api::all_with(client, &ar)
    } else {
        Api::namespaced_with(client, &namespace, &ar)
    };

    // cert-manager may not be installed — return an empty list rather than erroring.
    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new()),
        Err(e) => {
            let msg = e.to_string();
            // Some clusters surface a missing CRD as a discovery/not-found error
            // rather than a clean 404 on the list call.
            if msg.contains("not found")
                || msg.contains("could not find the requested resource")
                || msg.contains("the server could not find")
            {
                return Ok(Vec::new());
            }
            return Err(format!("Failed to list certificates: {}", msg));
        }
    };

    let rows = list
        .items
        .into_iter()
        .map(|obj| {
            let spec = &obj.data["spec"];
            let status = &obj.data["status"];

            let empty: Vec<serde_json::Value> = Vec::new();
            let conditions = status["conditions"].as_array().unwrap_or(&empty);

            let ready_cond = find_condition(conditions, "Ready");
            let issuing_cond = find_condition(conditions, "Issuing");

            let ready = ready_cond.map(|(s, _)| s == "True").unwrap_or(false);

            // Health rollup: Ready=True → Healthy; Issuing=True → Progressing; else Degraded.
            let status_pill = if ready {
                "Healthy"
            } else if issuing_cond.map(|(s, _)| s == "True").unwrap_or(false) {
                "Progressing"
            } else {
                "Degraded"
            }
            .to_string();

            // Surface the failing condition's message for the detail panel.
            let last_failure_message = if !ready {
                ready_cond
                    .filter(|(s, _)| *s != "True")
                    .map(|(_, m)| m)
                    .filter(|m| !m.is_empty())
                    .or_else(|| {
                        issuing_cond
                            .map(|(_, m)| m)
                            .filter(|m| !m.is_empty())
                    })
                    .unwrap_or("")
                    .to_string()
            } else {
                String::new()
            };

            let dns_names = spec["dnsNames"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            Certificate {
                name: obj.metadata.name.unwrap_or_default(),
                namespace: obj.metadata.namespace.unwrap_or_default(),
                ready,
                secret_name: spec["secretName"].as_str().unwrap_or("").to_string(),
                issuer_name: spec["issuerRef"]["name"].as_str().unwrap_or("").to_string(),
                issuer_kind: spec["issuerRef"]["kind"]
                    .as_str()
                    .unwrap_or("Issuer")
                    .to_string(),
                dns_names,
                renewal_time: status["renewalTime"].as_str().unwrap_or("").to_string(),
                not_after: status["notAfter"].as_str().unwrap_or("").to_string(),
                age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
                status: status_pill,
                last_failure_message,
            }
        })
        .collect();

    Ok(rows)
}
