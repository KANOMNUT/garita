use k8s_openapi::api::apps::v1::{DaemonSet as K8sDaemonSet, ReplicaSet as K8sReplicaSet, StatefulSet as K8sSts};
use k8s_openapi::api::batch::v1::{CronJob as K8sCron, Job as K8sJob};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all, parse_cpu_millis, parse_mem_mib};

// ─── Pod template helpers ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PodTemplateContainer {
    pub name: String,
    pub image: String,
    pub is_init: bool,
    pub cpu_request_m: Option<i64>,
    pub mem_request_mi: Option<i64>,
    pub cpu_limit_m: Option<i64>,
    pub mem_limit_mi: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PodTemplateSpec {
    pub containers: Vec<PodTemplateContainer>,
    pub image_pull_policy: Option<String>,
    pub service_account_name: Option<String>,
    pub restart_policy: Option<String>,
}

fn container_to_template(c: &k8s_openapi::api::core::v1::Container, is_init: bool) -> PodTemplateContainer {
    PodTemplateContainer {
        name: c.name.clone(),
        image: c.image.clone().unwrap_or_default(),
        is_init,
        cpu_request_m: c.resources.as_ref().and_then(|r| r.requests.as_ref()).and_then(|r| r.get("cpu")).and_then(|q| parse_cpu_millis(&q.0)),
        mem_request_mi: c.resources.as_ref().and_then(|r| r.requests.as_ref()).and_then(|r| r.get("memory")).and_then(|q| parse_mem_mib(&q.0)),
        cpu_limit_m: c.resources.as_ref().and_then(|r| r.limits.as_ref()).and_then(|r| r.get("cpu")).and_then(|q| parse_cpu_millis(&q.0)),
        mem_limit_mi: c.resources.as_ref().and_then(|r| r.limits.as_ref()).and_then(|r| r.get("memory")).and_then(|q| parse_mem_mib(&q.0)),
    }
}

pub(crate) fn build_pod_template(
    template: Option<&k8s_openapi::api::core::v1::PodTemplateSpec>,
) -> Option<PodTemplateSpec> {
    let spec = template?.spec.as_ref()?;

    let mut containers: Vec<PodTemplateContainer> = spec.containers.iter()
        .map(|c| container_to_template(c, false))
        .collect();

    let init_containers: Vec<PodTemplateContainer> = spec.init_containers.iter()
        .flatten()
        .map(|c| container_to_template(c, true))
        .collect();
    containers.extend(init_containers);

    let image_pull_policy = spec.containers.first().and_then(|c| c.image_pull_policy.clone());

    Some(PodTemplateSpec {
        containers,
        image_pull_policy,
        service_account_name: spec.service_account_name.clone(),
        restart_policy: spec.restart_policy.clone(),
    })
}

// ─── ReplicaSet ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReplicaSetRow {
    pub name: String,
    pub namespace: String,
    pub desired: i32,
    pub current: i32,
    pub ready: i32,
    pub owner: String,  // ownerReferences[0] as "Kind/name", "" when none
    pub images: String, // comma-joined container images
    pub age: String,
}

#[tauri::command]
pub async fn list_replicasets(context: String, namespace: String) -> Result<Vec<ReplicaSetRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sReplicaSet> = namespaced_or_all!(client, K8sReplicaSet, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list replicasets: {}", e))?;
    Ok(list.items.into_iter().map(|rs| {
        let desired = rs.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        let current = rs.status.as_ref().map(|s| s.replicas).unwrap_or(0);
        let ready = rs.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
        let owner = rs.metadata.owner_references.as_ref()
            .and_then(|refs| refs.first())
            .map(|o| format!("{}/{}", o.kind, o.name))
            .unwrap_or_default();
        let images = rs.spec.as_ref()
            .and_then(|s| s.template.as_ref())
            .and_then(|t| t.spec.as_ref())
            .map(|spec| spec.containers.iter().filter_map(|c| c.image.clone()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        ReplicaSetRow {
            name: rs.metadata.name.unwrap_or_default(),
            namespace: rs.metadata.namespace.unwrap_or_default(),
            desired,
            current,
            ready,
            owner,
            images,
            age: age_from_timestamp(rs.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── StatefulSet ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StatefulSet {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub replicas: i32,
    pub age: String,
    pub image: String,
    pub pod_template: Option<PodTemplateSpec>,
}

#[tauri::command]
pub async fn list_statefulsets(context: String, namespace: String) -> Result<Vec<StatefulSet>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sSts> = namespaced_or_all!(client, K8sSts, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list statefulsets: {}", e))?;
    Ok(list.items.into_iter().map(|s| {
        let desired = s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(1);
        let ready = s.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0);
        let image = s.spec.as_ref()
            .and_then(|sp| sp.template.spec.as_ref())
            .and_then(|spec| spec.containers.first())
            .and_then(|c| c.image.as_deref())
            .unwrap_or("—")
            .to_string();
        StatefulSet {
            name: s.metadata.name.unwrap_or_default(),
            namespace: s.metadata.namespace.unwrap_or_default(),
            ready: format!("{}/{}", ready, desired),
            replicas: desired,
            age: age_from_timestamp(s.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            image,
            pod_template: build_pod_template(s.spec.as_ref().map(|sp| &sp.template)),
        }
    }).collect())
}

// ─── DaemonSet ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DaemonSet {
    pub name: String,
    pub namespace: String,
    pub desired: i32,
    pub current: i32,
    pub ready: i32,
    pub up_to_date: i32,
    pub available: i32,
    pub age: String,
    pub image: String,
    pub pod_template: Option<PodTemplateSpec>,
}

#[tauri::command]
pub async fn list_daemonsets(context: String, namespace: String) -> Result<Vec<DaemonSet>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sDaemonSet> = namespaced_or_all!(client, K8sDaemonSet, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list daemonsets: {}", e))?;
    Ok(list.items.into_iter().map(|d| {
        let st = d.status.as_ref();
        let image = d.spec.as_ref()
            .and_then(|sp| sp.template.spec.as_ref())
            .and_then(|spec| spec.containers.first())
            .and_then(|c| c.image.as_deref())
            .unwrap_or("—")
            .to_string();
        DaemonSet {
            name: d.metadata.name.unwrap_or_default(),
            namespace: d.metadata.namespace.unwrap_or_default(),
            desired:     st.map(|s| s.desired_number_scheduled).unwrap_or(0),
            current:     st.map(|s| s.current_number_scheduled).unwrap_or(0),
            ready:       st.and_then(|s| s.number_ready.into()).unwrap_or(0),
            up_to_date:  st.and_then(|s| s.updated_number_scheduled).unwrap_or(0),
            available:   st.and_then(|s| s.number_available).unwrap_or(0),
            age: age_from_timestamp(d.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            image,
            pod_template: build_pod_template(d.spec.as_ref().map(|sp| &sp.template)),
        }
    }).collect())
}

// ─── Job ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Job {
    pub name: String,
    pub namespace: String,
    pub completions: String,
    pub duration: String,
    pub age: String,
    pub status: String,
    pub image: String,
    pub pod_template: Option<PodTemplateSpec>,
}

#[tauri::command]
pub async fn list_jobs(context: String, namespace: String) -> Result<Vec<Job>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sJob> = namespaced_or_all!(client, K8sJob, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list jobs: {}", e))?;
    Ok(list.items.into_iter().map(|j| {
        let desired = j.spec.as_ref().and_then(|s| s.completions).unwrap_or(1);
        let succeeded = j.status.as_ref().and_then(|s| s.succeeded).unwrap_or(0);
        let failed = j.status.as_ref().and_then(|s| s.failed).unwrap_or(0);
        let status = if succeeded >= desired { "Complete".to_string() }
                     else if failed > 0 { "Failed".to_string() }
                     else { "Running".to_string() };

        let start = j.status.as_ref().and_then(|s| s.start_time.as_ref()).map(|t| t.0);
        let end = j.status.as_ref().and_then(|s| s.completion_time.as_ref()).map(|t| t.0);
        let duration = match (start, end) {
            (Some(s), Some(e)) => {
                let d = (e - s).num_seconds().max(0) as u64;
                super::utils::format_age(d)
            }
            _ => "—".to_string(),
        };

        let image = j.spec.as_ref()
            .and_then(|sp| sp.template.spec.as_ref())
            .and_then(|spec| spec.containers.first())
            .and_then(|c| c.image.as_deref())
            .unwrap_or("—")
            .to_string();

        Job {
            name: j.metadata.name.unwrap_or_default(),
            namespace: j.metadata.namespace.unwrap_or_default(),
            completions: format!("{}/{}", succeeded, desired),
            duration,
            age: age_from_timestamp(j.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            status,
            image,
            pod_template: j.spec.as_ref().map(|sp| build_pod_template(Some(&sp.template))).flatten(),
        }
    }).collect())
}

// ─── CronJob ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CronJob {
    pub name: String,
    pub namespace: String,
    pub schedule: String,
    pub suspend: bool,
    pub active: i32,
    pub last_schedule: String,
    pub age: String,
    pub pod_template: Option<PodTemplateSpec>,
}

#[tauri::command]
pub async fn list_cronjobs(context: String, namespace: String) -> Result<Vec<CronJob>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sCron> = namespaced_or_all!(client, K8sCron, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list cronjobs: {}", e))?;
    Ok(list.items.into_iter().map(|c| {
        let last = c.status.as_ref()
            .and_then(|s| s.last_schedule_time.as_ref())
            .map(|t| age_from_timestamp(Some(&t.0)))
            .unwrap_or_else(|| "never".to_string());
        CronJob {
            name: c.metadata.name.unwrap_or_default(),
            namespace: c.metadata.namespace.unwrap_or_default(),
            schedule: c.spec.as_ref().map(|s| s.schedule.clone()).unwrap_or_default(),
            suspend: c.spec.as_ref().and_then(|s| s.suspend).unwrap_or(false),
            active: c.status.as_ref().map(|s| s.active.as_ref().map(|a| a.len()).unwrap_or(0) as i32).unwrap_or(0),
            last_schedule: last,
            age: age_from_timestamp(c.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            pod_template: c.spec.as_ref().and_then(|sp| {
                sp.job_template.spec.as_ref().map(|js| build_pod_template(Some(&js.template)))
            }).flatten(),
        }
    }).collect())
}
