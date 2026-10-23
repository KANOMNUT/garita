use k8s_openapi::api::core::v1::{LimitRange as K8sLR, ResourceQuota as K8sRQ};
use k8s_openapi::api::scheduling::v1::PriorityClass as K8sPC;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context};

// ─── ResourceQuota ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceQuotaInfo {
    pub name: String,
    pub namespace: String,
    pub cpu_request_used: String,
    pub cpu_request_hard: String,
    pub cpu_limit_used: String,
    pub cpu_limit_hard: String,
    pub memory_request_used: String,
    pub memory_request_hard: String,
    pub memory_limit_used: String,
    pub memory_limit_hard: String,
    pub pods_used: String,
    pub pods_hard: String,
    pub age: String,
}

/// Extract a Quantity value as String from an optional BTreeMap, defaulting to "—".
fn quantity_str(
    map: &Option<std::collections::BTreeMap<String, k8s_openapi::apimachinery::pkg::api::resource::Quantity>>,
    key: &str,
) -> String {
    map.as_ref()
        .and_then(|m| m.get(key))
        .map(|q| q.0.clone())
        .unwrap_or_else(|| "—".to_string())
}

#[tauri::command]
pub async fn list_resource_quotas(
    context: String,
    namespace: String,
) -> Result<Vec<ResourceQuotaInfo>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api: Api<K8sRQ> = if namespace == "all" || namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, &namespace)
    };

    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list resource quotas: {}", e))?;

    let rows = list
        .items
        .into_iter()
        .map(|rq| {
            let used = rq.status.as_ref().and_then(|s| s.used.clone());
            let hard = rq.spec.as_ref().and_then(|s| s.hard.clone());

            ResourceQuotaInfo {
                name: rq.metadata.name.unwrap_or_default(),
                namespace: rq.metadata.namespace.unwrap_or_default(),
                cpu_request_used: quantity_str(&used, "requests.cpu"),
                cpu_request_hard: quantity_str(&hard, "requests.cpu"),
                cpu_limit_used: quantity_str(&used, "limits.cpu"),
                cpu_limit_hard: quantity_str(&hard, "limits.cpu"),
                memory_request_used: quantity_str(&used, "requests.memory"),
                memory_request_hard: quantity_str(&hard, "requests.memory"),
                memory_limit_used: quantity_str(&used, "limits.memory"),
                memory_limit_hard: quantity_str(&hard, "limits.memory"),
                pods_used: quantity_str(&used, "pods"),
                pods_hard: quantity_str(&hard, "pods"),
                age: age_from_timestamp(
                    rq.metadata.creation_timestamp.as_ref().map(|t| &t.0),
                ),
            }
        })
        .collect();

    Ok(rows)
}

// ─── LimitRange ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LimitRangeInfo {
    pub name: String,
    pub namespace: String,
    pub constraint_count: i32,
    pub default_cpu: String,
    pub default_memory: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_limit_ranges(
    context: String,
    namespace: String,
) -> Result<Vec<LimitRangeInfo>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api: Api<K8sLR> = if namespace == "all" || namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, &namespace)
    };

    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list limit ranges: {}", e))?;

    let rows = list
        .items
        .into_iter()
        .map(|lr| {
            let limits = lr
                .spec
                .as_ref()
                .map(|s| s.limits.as_slice())
                .unwrap_or(&[]);

            let constraint_count = limits.len() as i32;

            // Find the first Container-type item for defaults
            let container_item = limits.iter().find(|item| {
                item.type_ == "Container"
            });

            let default_cpu = container_item
                .and_then(|item| item.default.as_ref())
                .and_then(|m| m.get("cpu"))
                .map(|q| q.0.clone())
                .unwrap_or_else(|| "—".to_string());

            let default_memory = container_item
                .and_then(|item| item.default.as_ref())
                .and_then(|m| m.get("memory"))
                .map(|q| q.0.clone())
                .unwrap_or_else(|| "—".to_string());

            LimitRangeInfo {
                name: lr.metadata.name.unwrap_or_default(),
                namespace: lr.metadata.namespace.unwrap_or_default(),
                constraint_count,
                default_cpu,
                default_memory,
                age: age_from_timestamp(
                    lr.metadata.creation_timestamp.as_ref().map(|t| &t.0),
                ),
            }
        })
        .collect();

    Ok(rows)
}

// ─── PriorityClass ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PriorityClassInfo {
    pub name: String,
    pub value: i32,
    pub global_default: bool,
    pub preemption_policy: String,
    pub description: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_priority_classes(context: String) -> Result<Vec<PriorityClassInfo>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api: Api<K8sPC> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list priority classes: {}", e))?;

    let rows = list
        .items
        .into_iter()
        .map(|pc| PriorityClassInfo {
            name: pc.metadata.name.unwrap_or_default(),
            value: pc.value,
            global_default: pc.global_default.unwrap_or(false),
            preemption_policy: pc.preemption_policy.unwrap_or_default(),
            description: pc.description.unwrap_or_default(),
            age: age_from_timestamp(
                pc.metadata.creation_timestamp.as_ref().map(|t| &t.0),
            ),
        })
        .collect();

    Ok(rows)
}
