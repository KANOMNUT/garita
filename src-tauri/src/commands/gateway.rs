use kube::{
    api::{ApiResource, DynamicObject, ListParams},
    Api,
};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context};

// ─── Gateway ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GatewayInfo {
    pub name: String,
    pub namespace: String,
    pub gateway_class_name: String,
    pub listeners: Vec<String>,
    pub addresses: Vec<String>,
    pub status: String,
    pub age: String,
}

pub(crate) fn gateway_api_resource() -> ApiResource {
    ApiResource {
        group: "gateway.networking.k8s.io".to_string(),
        version: "v1".to_string(),
        api_version: "gateway.networking.k8s.io/v1".to_string(),
        kind: "Gateway".to_string(),
        plural: "gateways".to_string(),
    }
}

fn gatewayclass_api_resource() -> ApiResource {
    ApiResource {
        group: "gateway.networking.k8s.io".to_string(),
        version: "v1".to_string(),
        api_version: "gateway.networking.k8s.io/v1".to_string(),
        kind: "GatewayClass".to_string(),
        plural: "gatewayclasses".to_string(),
    }
}

pub(crate) fn httproute_api_resource() -> ApiResource {
    ApiResource {
        group: "gateway.networking.k8s.io".to_string(),
        version: "v1".to_string(),
        api_version: "gateway.networking.k8s.io/v1".to_string(),
        kind: "HTTPRoute".to_string(),
        plural: "httproutes".to_string(),
    }
}

/// Find the status string of the given condition type in a serde_json array.
fn condition_status<'a>(conditions: &'a [serde_json::Value], cond_type: &str) -> Option<&'a str> {
    conditions.iter().find_map(|c| {
        if c["type"].as_str() == Some(cond_type) {
            c["status"].as_str()
        } else {
            None
        }
    })
}

#[tauri::command]
pub async fn list_gateways(
    context: String,
    namespace: String,
) -> Result<Vec<GatewayInfo>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = gateway_api_resource();
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
            return Err(format!("Failed to list gateways: {}", msg));
        }
    };

    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let rows = list
        .items
        .into_iter()
        .map(|obj| {
            let spec = &obj.data["spec"];
            let status_data = &obj.data["status"];

            let gateway_class_name = spec["gatewayClassName"]
                .as_str()
                .unwrap_or("")
                .to_string();

            // listeners: each as "name:port"
            let listeners: Vec<String> = spec["listeners"]
                .as_array()
                .unwrap_or(&empty_vec)
                .iter()
                .map(|l| {
                    let lname = l["name"].as_str().unwrap_or("");
                    let port = l["port"].as_u64().unwrap_or(0);
                    format!("{}:{}", lname, port)
                })
                .collect();

            // addresses: extract .value fields
            let addresses: Vec<String> = status_data["addresses"]
                .as_array()
                .unwrap_or(&empty_vec)
                .iter()
                .filter_map(|a| a["value"].as_str().map(|s| s.to_string()))
                .collect();

            // Health: Programmed=True → Healthy; Accepted=False → Degraded; else Progressing
            let conds = status_data["conditions"].as_array().unwrap_or(&empty_vec);
            let health = if condition_status(conds, "Programmed") == Some("True") {
                "Healthy"
            } else if condition_status(conds, "Accepted") == Some("False") {
                "Degraded"
            } else {
                "Progressing"
            }
            .to_string();

            GatewayInfo {
                name: obj.metadata.name.unwrap_or_default(),
                namespace: obj.metadata.namespace.unwrap_or_default(),
                gateway_class_name,
                listeners,
                addresses,
                status: health,
                age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            }
        })
        .collect();

    Ok(rows)
}

// ─── HTTPRoute ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HttpRouteInfo {
    pub name: String,
    pub namespace: String,
    pub parent_refs: Vec<String>,
    pub hostnames: Vec<String>,
    pub rule_count: usize,
    pub status: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_http_routes(
    context: String,
    namespace: String,
) -> Result<Vec<HttpRouteInfo>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = httproute_api_resource();
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
            return Err(format!("Failed to list http routes: {}", msg));
        }
    };

    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let rows = list
        .items
        .into_iter()
        .map(|obj| {
            let spec = &obj.data["spec"];
            let status_data = &obj.data["status"];

            // parentRefs: each as "Kind/name" (default Kind = Gateway)
            let parent_refs: Vec<String> = spec["parentRefs"]
                .as_array()
                .unwrap_or(&empty_vec)
                .iter()
                .map(|r| {
                    let kind = r["kind"].as_str().unwrap_or("Gateway");
                    let rname = r["name"].as_str().unwrap_or("");
                    format!("{}/{}", kind, rname)
                })
                .collect();

            let hostnames: Vec<String> = spec["hostnames"]
                .as_array()
                .unwrap_or(&empty_vec)
                .iter()
                .filter_map(|h| h.as_str().map(|s| s.to_string()))
                .collect();

            let rule_count = spec["rules"]
                .as_array()
                .map(|r| r.len())
                .unwrap_or(0);

            // Health rollup: any parent Accepted=True → Healthy;
            //                all parents Accepted=False → Degraded; else Progressing
            let parents = status_data["parents"].as_array().unwrap_or(&empty_vec);
            let any_accepted = parents.iter().any(|p| {
                let conds = p["conditions"].as_array().unwrap_or(&empty_vec);
                condition_status(conds, "Accepted") == Some("True")
            });
            let all_rejected = !parents.is_empty()
                && parents.iter().all(|p| {
                    let conds = p["conditions"].as_array().unwrap_or(&empty_vec);
                    condition_status(conds, "Accepted") == Some("False")
                });

            let health = if any_accepted {
                "Healthy"
            } else if all_rejected {
                "Degraded"
            } else {
                "Progressing"
            }
            .to_string();

            HttpRouteInfo {
                name: obj.metadata.name.unwrap_or_default(),
                namespace: obj.metadata.namespace.unwrap_or_default(),
                parent_refs,
                hostnames,
                rule_count,
                status: health,
                age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            }
        })
        .collect();

    Ok(rows)
}

// ─── GatewayClass ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_gateway_classes(context: String) -> Result<Vec<String>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = gatewayclass_api_resource();
    let api: Api<DynamicObject> = Api::all_with(client, &ar);

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
            return Err(format!("Failed to list gateway classes: {}", msg));
        }
    };

    Ok(list
        .items
        .into_iter()
        .filter_map(|obj| obj.metadata.name)
        .collect())
}
