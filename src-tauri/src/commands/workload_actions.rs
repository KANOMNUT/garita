use chrono::{SecondsFormat, Utc};
use k8s_openapi::api::apps::v1::{
    DaemonSet as K8sDS, Deployment as K8sDeploy, ReplicaSet as K8sRS, StatefulSet as K8sSTS,
};
use kube::{
    api::{ListParams, Patch, PatchParams},
    Api,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::utils::{age_from_timestamp, client_for_context};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RevisionInfo {
    pub revision: i64,
    pub image: String,
    pub age: String,
    /// The ReplicaSet's `spec.template` with `pod-template-hash` stripped (the same helper
    /// rollback uses); `Null` when the ReplicaSet has none.
    pub template: serde_json::Value,
    /// ReplicaSet `creationTimestamp`, RFC3339 (UTC); "" when absent (v2.2.0 timeline).
    pub created_at: String,
}

/// Scale a Deployment or StatefulSet to `replicas`.
#[tauri::command]
pub async fn scale_workload(
    context: String,
    namespace: String,
    kind: String,
    name: String,
    replicas: i32,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let patch = json!({ "spec": { "replicas": replicas } });
        match kind.as_str() {
            "deploy" | "deployment" => {
                let api: Api<K8sDeploy> = Api::namespaced(client, &namespace);
                api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await
                    .map_err(|e| format!("Failed to scale: {}", e))?;
            }
            "sts" | "statefulset" => {
                let api: Api<K8sSTS> = Api::namespaced(client, &namespace);
                api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await
                    .map_err(|e| format!("Failed to scale: {}", e))?;
            }
            _ => return Err(format!("Unsupported kind for scale: {}", kind)),
        }
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "scale", &kind, &namespace, &name, Some(&json!({ "replicas": replicas })), &result);
    result
}

/// Rolling restart by patching spec.template.metadata.annotations with a timestamp.
#[tauri::command]
pub async fn restart_workload(
    context: String,
    namespace: String,
    kind: String,
    name: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let ts = Utc::now().to_rfc3339();
        let patch = json!({
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "kubectl.kubernetes.io/restartedAt": ts
                        }
                    }
                }
            }
        });
        match kind.as_str() {
            "deploy" | "deployment" => {
                let api: Api<K8sDeploy> = Api::namespaced(client, &namespace);
                api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await
                    .map_err(|e| format!("Failed to restart: {}", e))?;
            }
            "sts" | "statefulset" => {
                let api: Api<K8sSTS> = Api::namespaced(client, &namespace);
                api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await
                    .map_err(|e| format!("Failed to restart: {}", e))?;
            }
            "ds" | "daemonset" => {
                let api: Api<K8sDS> = Api::namespaced(client, &namespace);
                api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await
                    .map_err(|e| format!("Failed to restart: {}", e))?;
            }
            _ => return Err(format!("Unsupported kind for restart: {}", kind)),
        }
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "restart", &kind, &namespace, &name, None, &result);
    result
}

#[tauri::command]
pub async fn pause_deployment(
    context: String, namespace: String, name: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let api: Api<K8sDeploy> = Api::namespaced(client, &namespace);
        let patch = json!({ "spec": { "paused": true } });
        api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
            .await
            .map_err(|e| format!("Failed to pause: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "pause", "deploy", &namespace, &name, None, &result);
    result
}

#[tauri::command]
pub async fn resume_deployment(
    context: String, namespace: String, name: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
        let api: Api<K8sDeploy> = Api::namespaced(client, &namespace);
        let patch = json!({ "spec": { "paused": serde_json::Value::Null } });
        api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
            .await
            .map_err(|e| format!("Failed to resume: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "resume", "deploy", &namespace, &name, None, &result);
    result
}


/// The ReplicaSet's `deployment.kubernetes.io/revision`, if present and numeric.
fn rs_revision(rs: &K8sRS) -> Option<i64> {
    rs.metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get("deployment.kubernetes.io/revision"))
        .and_then(|v| v.parse::<i64>().ok())
}

fn rs_owned_by(rs: &K8sRS, deploy_uid: &str) -> bool {
    rs.metadata
        .owner_references
        .as_ref()
        .map(|refs| refs.iter().any(|r| r.uid == deploy_uid))
        .unwrap_or(false)
}

/// Remove `metadata.labels["pod-template-hash"]` (and `labels` if that leaves
/// it empty). A ReplicaSet's template carries the hash its controller added;
/// patching it back into the Deployment would make the controller compute a
/// different hash and create a duplicate ReplicaSet. `kubectl rollout undo`
/// strips it for the same reason.
fn strip_pod_template_hash(template: &mut serde_json::Value) {
    let Some(meta) = template.get_mut("metadata").and_then(|m| m.as_object_mut()) else {
        return;
    };
    let mut drop_labels = false;
    if let Some(labels) = meta.get_mut("labels").and_then(|l| l.as_object_mut()) {
        labels.remove("pod-template-hash");
        drop_labels = labels.is_empty();
    }
    if drop_labels {
        meta.remove("labels");
    }
}

/// A ReplicaSet's pod template as JSON with `pod-template-hash` stripped, or `Null` when it has
/// none (or cannot be serialised). The same value a rollback would patch back.
fn revision_template(rs: &K8sRS) -> serde_json::Value {
    let Some(template) = rs.spec.as_ref().and_then(|s| s.template.as_ref()) else {
        return serde_json::Value::Null;
    };
    match serde_json::to_value(template) {
        Ok(mut v) => {
            strip_pod_template_hash(&mut v);
            v
        }
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
pub async fn list_rollout_history(
    context: String, namespace: String, name: String,
) -> Result<Vec<RevisionInfo>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let deploy_api: Api<K8sDeploy> = Api::namespaced(client.clone(), &namespace);
    let deploy = deploy_api.get(&name).await
        .map_err(|e| format!("Failed to get deployment: {}", e))?;
    let deploy_uid = deploy.metadata.uid.clone().unwrap_or_default();

    let rs_api: Api<K8sRS> = Api::namespaced(client, &namespace);
    let rss = rs_api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list replicasets: {}", e))?;

    let mut history: Vec<RevisionInfo> = rss
        .items
        .iter()
        .filter(|rs| rs_owned_by(rs, &deploy_uid))
        .filter_map(revision_info)
        .collect();

    history.sort_by_key(|r| std::cmp::Reverse(r.revision));
    Ok(history)
}

/// `None` when the ReplicaSet carries no revision annotation.
fn revision_info(rs: &K8sRS) -> Option<RevisionInfo> {
    let revision = rs_revision(rs)?;
    let image = rs
        .spec
        .as_ref()
        .and_then(|s| s.template.as_ref())
        .and_then(|t| t.spec.as_ref())
        .and_then(|s| s.containers.first())
        .and_then(|c| c.image.clone())
        .unwrap_or_default();
    let ts = rs.metadata.creation_timestamp.as_ref().map(|t| &t.0);
    let created_at = ts.map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true)).unwrap_or_default();
    Some(RevisionInfo { revision, image, age: age_from_timestamp(ts), created_at, template: revision_template(rs) })
}

#[tauri::command]
pub async fn rollback_deployment(
    context: String, namespace: String, name: String, revision: i64,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let deploy_api: Api<K8sDeploy> = Api::namespaced(client.clone(), &namespace);
        let deploy = deploy_api.get(&name).await
            .map_err(|e| format!("Failed to get deployment: {}", e))?;
        let deploy_uid = deploy.metadata.uid.clone().unwrap_or_default();

        let rs_api: Api<K8sRS> = Api::namespaced(client, &namespace);
        let rss = rs_api.list(&ListParams::default()).await
            .map_err(|e| format!("Failed to list replicasets: {}", e))?;

        let target = rss
            .items
            .iter()
            .find(|rs| rs_owned_by(rs, &deploy_uid) && rs_revision(rs) == Some(revision))
            .ok_or_else(|| format!("Failed to roll back: revision {} not found", revision))?;

        let template = target
            .spec
            .as_ref()
            .and_then(|s| s.template.clone())
            .ok_or_else(|| format!("Failed to roll back: revision {} has no pod template", revision))?;

        let mut template_json = serde_json::to_value(&template)
            .map_err(|e| format!("Failed to roll back: {}", e))?;
        strip_pod_template_hash(&mut template_json);

        let patch = json!({ "spec": { "template": template_json } });
        deploy_api
            .patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
            .await
            .map_err(|e| format!("Failed to roll back: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "rollback", "deploy", &namespace, &name, None, &result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_info_carries_created_at() {
        let rs: K8sRS = serde_json::from_value(json!({
            "metadata": {"name": "web-1", "creationTimestamp": "2026-03-04T05:06:07Z",
                         "annotations": {"deployment.kubernetes.io/revision": "3"}}
        })).expect("rs");
        let r = revision_info(&rs).expect("revision");
        assert_eq!((r.revision, r.created_at.as_str()), (3, "2026-03-04T05:06:07Z"));
        let bare: K8sRS = serde_json::from_value(json!({
            "metadata": {"name": "web-2", "annotations": {"deployment.kubernetes.io/revision": "4"}}
        })).expect("rs");
        assert_eq!(revision_info(&bare).expect("revision").created_at, "");
        let none: K8sRS = serde_json::from_value(json!({"metadata": {"name": "x"}})).expect("rs");
        assert!(revision_info(&none).is_none());
    }

    #[test]
    fn strips_hash_keeping_other_labels() {
        let mut t = json!({"metadata": {"labels": {"app": "web", "pod-template-hash": "abc123"}}, "spec": {}});
        strip_pod_template_hash(&mut t);
        assert_eq!(t, json!({"metadata": {"labels": {"app": "web"}}, "spec": {}}));
    }

    #[test]
    fn hash_as_only_label_removes_labels() {
        let mut t = json!({"metadata": {"labels": {"pod-template-hash": "abc123"}, "annotations": {"a": "b"}}});
        strip_pod_template_hash(&mut t);
        assert_eq!(t, json!({"metadata": {"annotations": {"a": "b"}}}));
    }

    #[test]
    fn no_labels_is_unchanged() {
        let mut t = json!({"metadata": {"name": "x"}, "spec": {"containers": []}});
        let before = t.clone();
        strip_pod_template_hash(&mut t);
        assert_eq!(t, before);
        let mut no_meta = json!({"spec": {}});
        let before = no_meta.clone();
        strip_pod_template_hash(&mut no_meta);
        assert_eq!(no_meta, before);
    }

    fn rs_with_template(labels: &[(&str, &str)]) -> K8sRS {
        use k8s_openapi::api::apps::v1::ReplicaSetSpec;
        use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec};
        use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
        K8sRS {
            spec: Some(ReplicaSetSpec {
                template: Some(PodTemplateSpec {
                    metadata: Some(ObjectMeta {
                        labels: Some(labels.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
                        ..Default::default()
                    }),
                    spec: Some(PodSpec {
                        containers: vec![Container { name: "app".into(), image: Some("nginx:1".into()), ..Default::default() }],
                        ..Default::default()
                    }),
                }),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn revision_template_is_stripped_by_the_rollback_helper() {
        let rs = rs_with_template(&[("app", "web"), ("pod-template-hash", "abc123")]);
        let t = revision_template(&rs);
        assert_eq!(t["metadata"]["labels"], json!({"app": "web"}));
        assert_eq!(t["spec"]["containers"][0]["image"], "nginx:1");
        // Identical to what rollback patches back.
        let mut rollback = serde_json::to_value(rs.spec.as_ref().and_then(|s| s.template.clone()).expect("tpl")).expect("json");
        strip_pod_template_hash(&mut rollback);
        assert_eq!(t, rollback);
    }

    #[test]
    fn revision_template_without_a_template_is_null() {
        assert_eq!(revision_template(&K8sRS::default()), serde_json::Value::Null);
    }

    #[test]
    fn null_template_does_not_panic() {
        let mut t = serde_json::Value::Null;
        strip_pod_template_hash(&mut t);
        assert_eq!(t, serde_json::Value::Null);
    }
}
