use k8s_openapi::api::apps::v1::Deployment as K8sDeploy;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};
use super::workloads::{build_pod_template, PodTemplateSpec};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Deployment {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub up_to_date: i32,
    pub available: i32,
    pub age: String,
    pub image: String,
    pub pod_template: Option<PodTemplateSpec>,
}

#[tauri::command]
pub async fn list_deployments(context: String, namespace: String) -> Result<Vec<Deployment>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sDeploy> = namespaced_or_all!(client, K8sDeploy, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list deployments: {}", e))?;
    Ok(list.items.into_iter().map(|d| {
        let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        let ready = d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
        let up_to_date = d.status.as_ref().and_then(|s| s.updated_replicas).unwrap_or(0);
        let available = d.status.as_ref().and_then(|s| s.available_replicas).unwrap_or(0);
        let image = d.spec.as_ref()
            .and_then(|sp| sp.template.spec.as_ref())
            .and_then(|spec| spec.containers.first())
            .and_then(|c| c.image.as_deref())
            .unwrap_or("—")
            .to_string();
        Deployment {
            name: d.metadata.name.unwrap_or_default(),
            namespace: d.metadata.namespace.unwrap_or_default(),
            ready: format!("{}/{}", ready, desired),
            up_to_date,
            available,
            age: age_from_timestamp(d.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            image,
            pod_template: d.spec.as_ref().map(|sp| build_pod_template(Some(&sp.template))).flatten(),
        }
    }).collect())
}
