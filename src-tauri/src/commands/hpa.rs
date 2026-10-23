use k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler as K8sHPA;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HPA {
    pub name: String,
    pub namespace: String,
    pub reference: String,
    pub min_replicas: i32,
    pub max_replicas: i32,
    pub current_replicas: i32,
    pub desired_replicas: i32,
    pub cpu_current: Option<i32>,
    pub cpu_target: Option<i32>,
    pub mem_current: Option<String>,
    pub mem_target: Option<String>,
    pub age: String,
}

#[tauri::command]
pub async fn list_hpas(context: String, namespace: String) -> Result<Vec<HPA>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sHPA> = namespaced_or_all!(client, K8sHPA, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list HPAs: {}", e))?;
    Ok(list.items.into_iter().map(|h| {
        let spec = h.spec.as_ref();
        let status = h.status.as_ref();
        let reference = spec.map(|s| format!("{}/{}", s.scale_target_ref.kind, s.scale_target_ref.name))
            .unwrap_or_default();
        let min_replicas = spec.and_then(|s| s.min_replicas).unwrap_or(1);
        let max_replicas = spec.map(|s| s.max_replicas).unwrap_or(0);
        let current_replicas = status.and_then(|s| s.current_replicas).unwrap_or(0);
        let desired_replicas = status.map(|s| s.desired_replicas).unwrap_or(0);

        let cpu_target = spec.and_then(|s| s.metrics.as_ref()).and_then(|ms| {
            ms.iter().find_map(|m| {
                if m.type_ == "Resource" {
                    m.resource.as_ref().and_then(|r| {
                        if r.name == "cpu" { r.target.average_utilization } else { None }
                    })
                } else { None }
            })
        });
        let cpu_current = status.and_then(|s| s.current_metrics.as_ref()).and_then(|cms| {
            cms.iter().find_map(|m| {
                if m.type_ == "Resource" {
                    m.resource.as_ref().and_then(|r| {
                        if r.name == "cpu" { r.current.average_utilization } else { None }
                    })
                } else { None }
            })
        });

        let mem_target = spec.and_then(|s| s.metrics.as_ref()).and_then(|ms| {
            ms.iter().find_map(|m| {
                if m.type_ == "Resource" {
                    m.resource.as_ref().and_then(|r| {
                        if r.name == "memory" {
                            r.target.average_utilization.map(|u| format!("{}%", u))
                                .or_else(|| r.target.average_value.as_ref().map(|q| q.0.clone()))
                        } else { None }
                    })
                } else { None }
            })
        });
        let mem_current = status.and_then(|s| s.current_metrics.as_ref()).and_then(|cms| {
            cms.iter().find_map(|m| {
                if m.type_ == "Resource" {
                    m.resource.as_ref().and_then(|r| {
                        if r.name == "memory" {
                            r.current.average_utilization.map(|u| format!("{}%", u))
                                .or_else(|| r.current.average_value.as_ref().map(|q| q.0.clone()))
                        } else { None }
                    })
                } else { None }
            })
        });

        HPA {
            name: h.metadata.name.unwrap_or_default(),
            namespace: h.metadata.namespace.unwrap_or_default(),
            reference,
            min_replicas,
            max_replicas,
            current_replicas,
            desired_replicas,
            cpu_current,
            cpu_target,
            mem_current,
            mem_target,
            age: age_from_timestamp(h.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}
