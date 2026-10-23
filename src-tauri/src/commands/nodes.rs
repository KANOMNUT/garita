use std::collections::HashMap;
use k8s_openapi::api::core::v1::Node as K8sNode;
use kube::{api::{ApiResource, DynamicObject, ListParams}, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context, parse_mem_bytes};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NodeTaint {
    pub key: String,
    pub value: String,
    pub effect: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Node {
    pub name: String,
    pub status: String,
    pub roles: String,
    pub age: String,
    pub version: String,
    pub os_image: String,
    pub cpu_capacity: String,
    pub memory_capacity: String,
    pub pod_capacity: String,
    pub cpu_percent: Option<u32>,
    pub mem_percent: Option<u32>,
    pub pod_count: Option<u32>,
    pub labels: std::collections::BTreeMap<String, String>,
    pub taints: Vec<NodeTaint>,
    pub unschedulable: bool,
}

fn node_status(node: &K8sNode) -> String {
    let ready = node.status.as_ref()
        .and_then(|s| s.conditions.as_ref())
        .and_then(|c| c.iter().find(|c| c.type_ == "Ready"))
        .map(|c| c.status == "True")
        .unwrap_or(false);
    if ready { "ok".to_string() } else { "not-ready".to_string() }
}

fn node_roles(node: &K8sNode) -> String {
    let mut roles = Vec::new();
    if let Some(lbls) = &node.metadata.labels {
        if lbls.contains_key("node-role.kubernetes.io/control-plane")
            || lbls.contains_key("node-role.kubernetes.io/master") {
            roles.push("control-plane");
        }
        if lbls.contains_key("node-role.kubernetes.io/worker") || roles.is_empty() {
            roles.push("worker");
        }
    }
    if roles.is_empty() { "<none>".to_string() } else { roles.join(",") }
}

fn parse_cpu_millicores(s: &str) -> u64 {
    if let Some(v) = s.strip_suffix('m') {
        v.parse::<u64>().unwrap_or(0)
    } else if let Some(v) = s.strip_suffix('n') {
        v.parse::<u64>().unwrap_or(0) / 1_000_000
    } else if let Some(v) = s.strip_suffix('u') {
        v.parse::<u64>().unwrap_or(0) / 1_000
    } else {
        s.parse::<u64>().unwrap_or(0) * 1000
    }
}

pub(crate) async fn fetch_node_metrics(client: kube::Client) -> HashMap<String, (u64, u64)> {
    let ar = ApiResource {
        group: "metrics.k8s.io".to_string(),
        version: "v1beta1".to_string(),
        api_version: "metrics.k8s.io/v1beta1".to_string(),
        kind: "NodeMetrics".to_string(),
        plural: "nodes".to_string(),
    };
    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let Ok(list) = api.list(&ListParams::default()).await else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for item in list.items {
        let name = item.metadata.name.unwrap_or_default();
        if let Some(usage) = item.data.get("usage").and_then(|u| u.as_object()) {
            let cpu = usage.get("cpu").and_then(|v| v.as_str()).unwrap_or("0");
            let mem = usage.get("memory").and_then(|v| v.as_str()).unwrap_or("0");
            map.insert(name, (parse_cpu_millicores(cpu), parse_mem_bytes(mem).unwrap_or(0).max(0) as u64));
        }
    }
    map
}

#[tauri::command]
pub async fn list_nodes(context: String) -> Result<Vec<Node>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sNode> = Api::all(client.clone());
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list nodes: {}", e))?;

    let metrics = fetch_node_metrics(client).await;

    Ok(list.items.into_iter().map(|n| {
        let status   = node_status(&n);
        let roles    = node_roles(&n);
        let age      = age_from_timestamp(n.metadata.creation_timestamp.as_ref().map(|t| &t.0));
        let cap      = n.status.as_ref().and_then(|s| s.capacity.as_ref());
        let cpu_cap  = cap.and_then(|c| c.get("cpu")).map(|q| q.0.clone()).unwrap_or_default();
        let mem_cap  = cap.and_then(|c| c.get("memory")).map(|q| q.0.clone()).unwrap_or_default();
        let pod_cap  = cap.and_then(|c| c.get("pods")).map(|q| q.0.clone()).unwrap_or_default();
        let alloc    = n.status.as_ref().and_then(|s| s.allocatable.as_ref());
        let alloc_cpu = alloc.and_then(|a| a.get("cpu")).map(|q| q.0.clone());
        let alloc_mem = alloc.and_then(|a| a.get("memory")).map(|q| q.0.clone());
        let version  = n.status.as_ref().and_then(|s| s.node_info.as_ref()).map(|i| i.kubelet_version.clone()).unwrap_or_default();
        let os_image = n.status.as_ref().and_then(|s| s.node_info.as_ref()).map(|i| i.os_image.clone()).unwrap_or_default();
        let labels   = n.metadata.labels.clone().unwrap_or_default();
        let unschedulable = n.spec.as_ref().and_then(|s| s.unschedulable).unwrap_or(false);
        let taints   = n.spec.as_ref()
            .and_then(|s| s.taints.as_ref())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|t| NodeTaint {
                key: t.key.clone(),
                value: t.value.clone().unwrap_or_default(),
                effect: t.effect.clone(),
            })
            .collect();
        let name     = n.metadata.name.unwrap_or_default();

        // Usage as a share of ALLOCATABLE (the `kubectl top node` default), not capacity.
        let (cpu_percent, mem_percent) = metrics.get(&name).map(|&(cpu_m, mem_b)| {
            let cap_m = alloc_cpu.as_deref().map(parse_cpu_millicores).unwrap_or(0);
            let cap_b = alloc_mem.as_deref().and_then(parse_mem_bytes).unwrap_or(0).max(0) as u64;
            let cpu_pct = if cap_m > 0 { Some(((cpu_m * 100) / cap_m).min(100) as u32) } else { None };
            let mem_pct = if cap_b > 0 { Some(((mem_b * 100) / cap_b).min(100) as u32) } else { None };
            (cpu_pct, mem_pct)
        }).unwrap_or((None, None));

        Node {
            name,
            status, roles, age, version, os_image,
            cpu_capacity: cpu_cap,
            memory_capacity: mem_cap,
            pod_capacity: pod_cap,
            cpu_percent,
            mem_percent,
            pod_count: None,
            labels,
            taints,
            unschedulable,
        }
    }).collect())
}

use kube::api::{Patch, PatchParams, DeleteParams};
use serde_json::json;

#[tauri::command]
pub async fn cordon_node(context: String, node: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sNode> = Api::all(client);
        let patch = json!({ "spec": { "unschedulable": true } });
        api.patch(&node, &PatchParams::default(), &Patch::Merge(&patch)).await
            .map_err(|e| format!("Failed to cordon node: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "cordon", "node", "", &node, None, &result);
    result
}

#[tauri::command]
pub async fn uncordon_node(context: String, node: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sNode> = Api::all(client);
        let patch = json!({ "spec": { "unschedulable": false } });
        api.patch(&node, &PatchParams::default(), &Patch::Merge(&patch)).await
            .map_err(|e| format!("Failed to uncordon node: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "uncordon", "node", "", &node, None, &result);
    result
}

#[tauri::command]
pub async fn delete_node(context: String, node: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sNode> = Api::all(client);
        api.delete(&node, &DeleteParams::default()).await
            .map_err(|e| format!("Failed to delete node: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "delete", "node", "", &node, None, &result);
    result
}

#[tauri::command]
pub async fn add_node_taint(context: String, node: String, key: String, value: String, effect: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sNode> = Api::all(client);
        let current = api.get(&node).await
            .map_err(|e| format!("Failed to get node: {}", e))?;

        let mut taints: Vec<serde_json::Value> = current.spec.as_ref()
            .and_then(|s| s.taints.as_ref())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|t| {
                let mut m = json!({ "key": t.key, "effect": t.effect });
                if let Some(v) = t.value { m["value"] = json!(v); }
                m
            })
            .collect();

        // skip if identical (key + effect) already present
        let already = taints.iter().any(|t| t["key"] == key && t["effect"] == effect);
        if !already {
            let mut entry = json!({ "key": key, "effect": effect });
            if !value.is_empty() { entry["value"] = json!(value); }
            taints.push(entry);
        }

        api.patch(&node, &PatchParams::default(), &Patch::Merge(&json!({ "spec": { "taints": taints } }))).await
            .map_err(|e| format!("Failed to add taint: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "taint-add", "node", "", &node, None, &result);
    result
}

#[tauri::command]
pub async fn remove_node_taint(context: String, node: String, key: String, effect: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sNode> = Api::all(client);
        let current = api.get(&node).await
            .map_err(|e| format!("Failed to get node: {}", e))?;

        let taints: Vec<serde_json::Value> = current.spec.as_ref()
            .and_then(|s| s.taints.as_ref())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|t| !(t.key == key && t.effect == effect))
            .map(|t| {
                let mut m = json!({ "key": t.key, "effect": t.effect });
                if let Some(v) = t.value { m["value"] = json!(v); }
                m
            })
            .collect();

        api.patch(&node, &PatchParams::default(), &Patch::Merge(&json!({ "spec": { "taints": taints } }))).await
            .map_err(|e| format!("Failed to remove taint: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "taint-remove", "node", "", &node, None, &result);
    result
}
