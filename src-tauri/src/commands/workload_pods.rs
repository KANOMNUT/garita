use k8s_openapi::api::apps::v1::{
    DaemonSet as K8sDaemonSet, Deployment as K8sDeployment, ReplicaSet as K8sReplicaSet,
    StatefulSet as K8sStatefulSet,
};
use k8s_openapi::api::batch::v1::{CronJob as K8sCronJob, Job as K8sJob};
use k8s_openapi::api::core::v1::Pod as K8sPod;
use kube::{api::ListParams, Api};

use super::pods::{convert_pod, Pod};
use super::utils::client_for_context;

/// Collect the UIDs of all ReplicaSets owned by the given Deployment UID.
async fn replicaset_uids_for_deployment(
    api: &Api<K8sReplicaSet>,
    deploy_uid: &str,
) -> Result<Vec<String>, String> {
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list replicasets: {}", e))?;

    Ok(list
        .items
        .into_iter()
        .filter(|rs| {
            rs.metadata
                .owner_references
                .as_deref()
                .unwrap_or_default()
                .iter()
                .any(|or| or.uid == deploy_uid)
        })
        .filter_map(|rs| rs.metadata.uid)
        .collect())
}

/// Collect the UIDs of all Jobs owned by the given CronJob UID.
async fn job_uids_for_cronjob(
    api: &Api<K8sJob>,
    cronjob_uid: &str,
) -> Result<Vec<String>, String> {
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list jobs: {}", e))?;

    Ok(list
        .items
        .into_iter()
        .filter(|j| {
            j.metadata
                .owner_references
                .as_deref()
                .unwrap_or_default()
                .iter()
                .any(|or| or.uid == cronjob_uid)
        })
        .filter_map(|j| j.metadata.uid)
        .collect())
}

/// Return pods in `namespace` whose ownerReferences contain any UID in `owner_uids`.
async fn pods_owned_by(
    api: &Api<K8sPod>,
    owner_uids: &[String],
) -> Result<Vec<Pod>, String> {
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("Failed to list pods: {}", e))?;

    Ok(list
        .items
        .into_iter()
        .filter(|p| {
            p.metadata
                .owner_references
                .as_deref()
                .unwrap_or_default()
                .iter()
                .any(|or| owner_uids.contains(&or.uid))
        })
        .map(convert_pod)
        .collect())
}

/// List pods that belong to a given workload.
///
/// `kind` values: `"deploy"`, `"sts"`, `"ds"`, `"jobs"`, `"cron"`, `"rs"`
///
/// Ownership resolution:
/// - `deploy`  — Pods owned by ReplicaSets owned by the Deployment
/// - `sts`     — Pods directly owned by the StatefulSet
/// - `ds`      — Pods directly owned by the DaemonSet
/// - `jobs`    — Pods directly owned by the Job
/// - `cron`    — Pods owned by Jobs owned by the CronJob
/// - `rs`      — Pods directly owned by the ReplicaSet
#[tauri::command]
pub async fn list_workload_pods(
    context: String,
    namespace: String,
    kind: String,
    name: String,
) -> Result<Vec<Pod>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let pod_api: Api<K8sPod> = Api::namespaced(client.clone(), &namespace);

    match kind.as_str() {
        "deploy" => {
            let deploy_api: Api<K8sDeployment> = Api::namespaced(client.clone(), &namespace);
            let deploy = deploy_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get deployment: {}", e))?;
            let deploy_uid = match deploy.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };

            let rs_api: Api<K8sReplicaSet> = Api::namespaced(client.clone(), &namespace);
            let rs_uids = replicaset_uids_for_deployment(&rs_api, &deploy_uid).await?;
            if rs_uids.is_empty() {
                return Ok(vec![]);
            }
            pods_owned_by(&pod_api, &rs_uids).await
        }

        "sts" => {
            let sts_api: Api<K8sStatefulSet> = Api::namespaced(client.clone(), &namespace);
            let sts = sts_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get statefulset: {}", e))?;
            let uid = match sts.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };
            pods_owned_by(&pod_api, &[uid]).await
        }

        "ds" => {
            let ds_api: Api<K8sDaemonSet> = Api::namespaced(client.clone(), &namespace);
            let ds = ds_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get daemonset: {}", e))?;
            let uid = match ds.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };
            pods_owned_by(&pod_api, &[uid]).await
        }

        "jobs" => {
            let job_api: Api<K8sJob> = Api::namespaced(client.clone(), &namespace);
            let job = job_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get job: {}", e))?;
            let uid = match job.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };
            pods_owned_by(&pod_api, &[uid]).await
        }

        "cron" => {
            let cron_api: Api<K8sCronJob> = Api::namespaced(client.clone(), &namespace);
            let cron = cron_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get cronjob: {}", e))?;
            let cron_uid = match cron.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };

            let job_api: Api<K8sJob> = Api::namespaced(client.clone(), &namespace);
            let job_uids = job_uids_for_cronjob(&job_api, &cron_uid).await?;
            if job_uids.is_empty() {
                return Ok(vec![]);
            }
            pods_owned_by(&pod_api, &job_uids).await
        }

        "rs" => {
            let rs_api: Api<K8sReplicaSet> = Api::namespaced(client.clone(), &namespace);
            let rs = rs_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get replicaset: {}", e))?;
            let uid = match rs.metadata.uid {
                Some(uid) => uid,
                None => return Ok(vec![]),
            };
            pods_owned_by(&pod_api, &[uid]).await
        }

        other => Err(format!("Failed to list workload pods: unknown kind '{}'", other)),
    }
}
