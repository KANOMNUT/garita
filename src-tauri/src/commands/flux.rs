use kube::{
    api::{ApiResource, DynamicObject, ListParams},
    Api,
};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context};

// ─── Flux Kustomization ───────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FluxKustomization {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub status: String,
    pub path: String,
    pub source_ref: String,
    pub revision: String,
    pub age: String,
    pub suspended: bool,
}

fn kustomization_api_resource() -> ApiResource {
    ApiResource {
        group: "kustomize.toolkit.fluxcd.io".to_string(),
        version: "v1".to_string(),
        api_version: "kustomize.toolkit.fluxcd.io/v1".to_string(),
        kind: "Kustomization".to_string(),
        plural: "kustomizations".to_string(),
    }
}

/// Find condition status for the given type from a serde_json array.
fn condition_status<'a>(conditions: &'a [serde_json::Value], cond_type: &str) -> &'a str {
    conditions
        .iter()
        .find_map(|c| {
            if c["type"].as_str() == Some(cond_type) {
                c["status"].as_str()
            } else {
                None
            }
        })
        .unwrap_or("Unknown")
}

/// Health rollup for Flux resources.
fn flux_health(suspended: bool, ready: &str, conditions: &[serde_json::Value]) -> String {
    if suspended {
        return "Suspended".to_string();
    }
    if ready == "True" {
        return "Healthy".to_string();
    }
    // Check if any condition reason contains "Progress"
    let is_progressing = conditions.iter().any(|c| {
        c["reason"]
            .as_str()
            .map(|r| r.contains("Progress"))
            .unwrap_or(false)
    });
    if is_progressing {
        "Progressing".to_string()
    } else {
        "Degraded".to_string()
    }
}

#[tauri::command]
pub async fn list_flux_kustomizations(
    context: String,
    namespace: String,
) -> Result<Vec<FluxKustomization>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = kustomization_api_resource();
    let api: Api<DynamicObject> = if namespace == "all" || namespace.is_empty() {
        Api::all_with(client, &ar)
    } else {
        Api::namespaced_with(client, &namespace, &ar)
    };

    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found")
                || msg.contains("could not find the requested resource")
                || msg.contains("the server could not find")
            {
                return Ok(Vec::new());
            }
            return Err(format!("Failed to list flux kustomizations: {}", msg));
        }
    };

    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let rows = list
        .items
        .into_iter()
        .map(|obj| {
            let spec = &obj.data["spec"];
            let status = &obj.data["status"];
            let conditions = status["conditions"].as_array().unwrap_or(&empty_vec);

            let suspended = spec["suspend"].as_bool().unwrap_or(false);
            let ready = condition_status(conditions, "Ready").to_string();
            let status_str = flux_health(suspended, &ready, conditions);

            let source_kind = spec["sourceRef"]["kind"].as_str().unwrap_or("GitRepository");
            let source_name = spec["sourceRef"]["name"].as_str().unwrap_or("");
            let source_ref = format!("{}/{}", source_kind, source_name);

            FluxKustomization {
                name: obj.metadata.name.unwrap_or_default(),
                namespace: obj.metadata.namespace.unwrap_or_default(),
                ready,
                status: status_str,
                path: spec["path"].as_str().unwrap_or("").to_string(),
                source_ref,
                revision: status["lastAppliedRevision"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
                suspended,
            }
        })
        .collect();

    Ok(rows)
}

// ─── Flux HelmRelease ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FluxHelmRelease {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub status: String,
    pub chart: String,
    pub chart_version: String,
    pub age: String,
    pub suspended: bool,
}

fn helmrelease_api_resource() -> ApiResource {
    ApiResource {
        group: "helm.toolkit.fluxcd.io".to_string(),
        version: "v2".to_string(),
        api_version: "helm.toolkit.fluxcd.io/v2".to_string(),
        kind: "HelmRelease".to_string(),
        plural: "helmreleases".to_string(),
    }
}

#[tauri::command]
pub async fn list_flux_helmreleases(
    context: String,
    namespace: String,
) -> Result<Vec<FluxHelmRelease>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = helmrelease_api_resource();
    let api: Api<DynamicObject> = if namespace == "all" || namespace.is_empty() {
        Api::all_with(client, &ar)
    } else {
        Api::namespaced_with(client, &namespace, &ar)
    };

    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found")
                || msg.contains("could not find the requested resource")
                || msg.contains("the server could not find")
            {
                return Ok(Vec::new());
            }
            return Err(format!("Failed to list flux helmreleases: {}", msg));
        }
    };

    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let rows = list
        .items
        .into_iter()
        .map(|obj| {
            let spec = &obj.data["spec"];
            let status = &obj.data["status"];
            let conditions = status["conditions"].as_array().unwrap_or(&empty_vec);

            let suspended = spec["suspend"].as_bool().unwrap_or(false);
            let ready = condition_status(conditions, "Ready").to_string();
            let status_str = flux_health(suspended, &ready, conditions);

            // HelmRelease v2 chart spec location
            let chart = spec["chart"]["spec"]["chart"].as_str().unwrap_or("").to_string();
            let chart_version = spec["chart"]["spec"]["version"]
                .as_str()
                .unwrap_or("")
                .to_string();

            FluxHelmRelease {
                name: obj.metadata.name.unwrap_or_default(),
                namespace: obj.metadata.namespace.unwrap_or_default(),
                ready,
                status: status_str,
                chart,
                chart_version,
                age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
                suspended,
            }
        })
        .collect();

    Ok(rows)
}
