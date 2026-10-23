use chrono::Utc;
use k8s_openapi::api::apps::v1::{
    Deployment as K8sDeploy, StatefulSet as K8sSTS,
};
use k8s_openapi::api::batch::v1::{CronJob as K8sCronJob, Job as K8sJob};
use k8s_openapi::api::core::v1::{
    Namespace as K8sNamespace, PersistentVolumeClaim as K8sPVC,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::{api::{DeleteParams, PostParams}, Api};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceCondition {
    pub type_: String,
    pub status: String,
    pub reason: String,
    pub message: String,
    pub last_transition: String,
}

#[tauri::command]
pub async fn trigger_cronjob(
    context: String, namespace: String, name: String,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let cj_api: Api<K8sCronJob> = Api::namespaced(client.clone(), &namespace);
        let cj = cj_api.get(&name).await
            .map_err(|e| format!("Failed to get CronJob: {}", e))?;
        let spec = cj.spec
            .ok_or_else(|| "Failed to read CronJob: it has no spec".to_string())?;
        let jt = spec.job_template;

        let ts = Utc::now().timestamp();
        let job_name = format!("{}-manual-{}", name.chars().take(48).collect::<String>(), ts % 1_000_000);

        let mut annotations: BTreeMap<String, String> = BTreeMap::new();
        annotations.insert("cronjob.kubernetes.io/instantiate".to_string(), "manual".to_string());

        let job = K8sJob {
            metadata: ObjectMeta {
                name: Some(job_name.clone()),
                namespace: Some(namespace.clone()),
                annotations: Some(annotations),
                ..Default::default()
            },
            spec: jt.spec,
            ..Default::default()
        };

        let job_api: Api<K8sJob> = Api::namespaced(client, &namespace);
        job_api
            .create(&PostParams::default(), &job)
            .await
            .map_err(|e| format!("Failed to create job: {}", e))?;
        Ok(job_name)
    }
    .await;
    crate::app_log::log_write(&context, "trigger", "cronjob", &namespace, &name, None, &result);
    result
}

#[tauri::command]
pub async fn create_namespace(context: String, name: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let ns = K8sNamespace {
            metadata: ObjectMeta {
                name: Some(name.clone()),
                ..Default::default()
            },
            ..Default::default()
        };
        let api: Api<K8sNamespace> = Api::all(client);
        api.create(&PostParams::default(), &ns)
            .await
            .map_err(|e| format!("Failed to create namespace: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "create", "namespace", "", &name, None, &result);
    result
}

#[tauri::command]
pub async fn delete_namespace(context: String, name: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let api: Api<K8sNamespace> = Api::all(client);
        api.delete(&name, &DeleteParams::default())
            .await
            .map_err(|e| format!("Failed to delete namespace: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "delete", "namespace", "", &name, None, &result);
    result
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceMetadata {
    pub annotations: HashMap<String, String>,
    pub labels: HashMap<String, String>,
}

/// Returns annotations and labels for any supported resource type.
///
/// Labels matter as much as annotations here: ArgoCD's default
/// `resourceTrackingMethod` is `label`, not `annotation` — the owning app
/// lives in the `argocd.argoproj.io/instance` *label* on a default install,
/// so annotations alone miss it.
#[tauri::command]
pub async fn get_resource_metadata(
    context: String, namespace: String, resource_type: String, name: String,
) -> Result<ResourceMetadata, String> {
    use k8s_openapi::api::apps::v1::DaemonSet as K8sDS;
    use k8s_openapi::api::core::v1::{ConfigMap as K8sCM, Node as K8sNode, PersistentVolume as K8sPV, Pod as K8sPod, Secret as K8sSec, Service as K8sSvc};
    use k8s_openapi::api::networking::v1::Ingress as K8sIngress;

    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;

    macro_rules! get_ns {
        ($T:ty) => {{
            let api: Api<$T> = Api::namespaced(client, &namespace);
            let obj = api.get(&name).await.map_err(|e| e.to_string())?;
            Ok(ResourceMetadata {
                annotations: obj.metadata.annotations.unwrap_or_default().into_iter().collect(),
                labels: obj.metadata.labels.unwrap_or_default().into_iter().collect(),
            })
        }};
    }
    macro_rules! get_all {
        ($T:ty) => {{
            let api: Api<$T> = Api::all(client);
            let obj = api.get(&name).await.map_err(|e| e.to_string())?;
            Ok(ResourceMetadata {
                annotations: obj.metadata.annotations.unwrap_or_default().into_iter().collect(),
                labels: obj.metadata.labels.unwrap_or_default().into_iter().collect(),
            })
        }};
    }

    match resource_type.as_str() {
        "pods" | "pod" => get_ns!(K8sPod),
        "deploy" | "deployment" => get_ns!(K8sDeploy),
        "sts" | "statefulset" => get_ns!(K8sSTS),
        "ds" | "daemonset" => get_ns!(K8sDS),
        "jobs" | "job" => {
            use k8s_openapi::api::batch::v1::Job as K8sJob2;
            get_ns!(K8sJob2)
        }
        "cron" | "cronjob" => get_ns!(K8sCronJob),
        "svc" | "service" => get_ns!(K8sSvc),
        "ing" | "ingress" => get_ns!(K8sIngress),
        "cm" | "configmap" => get_ns!(K8sCM),
        "sec" | "secret" => {
            let r: Result<ResourceMetadata, String> = get_ns!(K8sSec);
            r.map(|mut m| {
                mask_last_applied(&mut m.annotations);
                m
            })
        }
        "pvc" => get_ns!(K8sPVC),
        "pv" => get_all!(K8sPV),
        "nodes" | "node" => get_all!(K8sNode),
        _ => Ok(ResourceMetadata { annotations: HashMap::new(), labels: HashMap::new() }),
    }
}

/// The last-applied annotation holds the whole applied manifest, Secret values included.
/// Keep the key (its presence still shows), hide the text.
fn mask_last_applied(annotations: &mut HashMap<String, String>) {
    if let Some(v) = annotations.get_mut("kubectl.kubernetes.io/last-applied-configuration") {
        *v = super::helm::HELM_REDACTION_SENTINEL.to_string();
    }
}

#[cfg(test)]
mod last_applied_tests {
    use super::*;

    #[test]
    fn last_applied_value_is_masked_key_kept() {
        let k = "kubectl.kubernetes.io/last-applied-configuration";
        let mut a = HashMap::from([(k.to_string(), "{\"data\":{\"p\":\"x\"}}".to_string()), ("o".to_string(), "v".to_string())]);
        mask_last_applied(&mut a);
        assert_eq!(a[k], crate::commands::helm::HELM_REDACTION_SENTINEL);
        assert_eq!(a["o"], "v");
    }
}

/// Returns status conditions for Deployments, StatefulSets, and PVCs.
#[tauri::command]
pub async fn get_workload_conditions(
    context: String, namespace: String, kind: String, name: String,
) -> Result<Vec<ResourceCondition>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;

    macro_rules! ts_str {
        ($t:expr) => {
            $t.map(|t| t.0.to_rfc3339()).unwrap_or_default()
        };
    }

    match kind.as_str() {
        "deploy" | "deployment" => {
            let api: Api<K8sDeploy> = Api::namespaced(client, &namespace);
            let obj = api.get(&name).await.map_err(|e| e.to_string())?;
            Ok(obj
                .status
                .and_then(|s| s.conditions)
                .unwrap_or_default()
                .into_iter()
                .map(|c| ResourceCondition {
                    type_: c.type_,
                    status: c.status,
                    reason: c.reason.unwrap_or_default(),
                    message: c.message.unwrap_or_default(),
                    last_transition: ts_str!(c.last_transition_time),
                })
                .collect())
        }
        "sts" | "statefulset" => {
            let api: Api<K8sSTS> = Api::namespaced(client, &namespace);
            let obj = api.get(&name).await.map_err(|e| e.to_string())?;
            Ok(obj
                .status
                .and_then(|s| s.conditions)
                .unwrap_or_default()
                .into_iter()
                .map(|c| ResourceCondition {
                    type_: c.type_,
                    status: c.status,
                    reason: c.reason.unwrap_or_default(),
                    message: c.message.unwrap_or_default(),
                    last_transition: ts_str!(c.last_transition_time),
                })
                .collect())
        }
        "pvc" => {
            let api: Api<K8sPVC> = Api::namespaced(client, &namespace);
            let obj = api.get(&name).await.map_err(|e| e.to_string())?;
            Ok(obj
                .status
                .and_then(|s| s.conditions)
                .unwrap_or_default()
                .into_iter()
                .map(|c| ResourceCondition {
                    type_: c.type_,
                    status: c.status,
                    reason: c.reason.clone().unwrap_or_default(),
                    message: c.message.clone().unwrap_or_default(),
                    last_transition: ts_str!(c.last_transition_time),
                })
                .collect())
        }
        _ => Ok(vec![]),
    }
}
