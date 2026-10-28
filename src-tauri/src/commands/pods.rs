use futures::AsyncBufReadExt;
use k8s_openapi::api::admissionregistration::v1::{
    MutatingWebhookConfiguration as K8sMWC, ValidatingWebhookConfiguration as K8sVWC,
};
use k8s_openapi::api::apps::v1::{
    DaemonSet as K8sDaemonSet, Deployment as K8sDeployment, ReplicaSet as K8sReplicaSet,
    StatefulSet as K8sStatefulSet,
};
use k8s_openapi::api::batch::v1::{CronJob as K8sCronJob, Job as K8sJob};
use k8s_openapi::api::core::v1::{
    ConfigMap as K8sConfigMap, ContainerStatus as K8sContainerStatus,
    Endpoints as K8sEndpoints, LimitRange as K8sLR, Namespace as K8sNamespace,
    Node as K8sNodeType,
    PersistentVolume as K8sPV, PersistentVolumeClaim as K8sPVC, Pod as K8sPod,
    ResourceQuota as K8sRQ, Secret as K8sSecret, Service as K8sService,
    ServiceAccount as K8sServiceAccount,
};
use k8s_openapi::api::discovery::v1::EndpointSlice as K8sEndpointSlice;
use k8s_openapi::api::scheduling::v1::PriorityClass as K8sPC;
use k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler as K8sHPA;
use k8s_openapi::api::networking::v1::{Ingress as K8sIngress, NetworkPolicy as K8sNetworkPolicy};
use k8s_openapi::api::rbac::v1::{
    ClusterRole as K8sClusterRole, ClusterRoleBinding as K8sClusterRoleBinding,
    Role as K8sRole, RoleBinding as K8sRoleBinding,
};
use k8s_openapi::api::policy::v1::PodDisruptionBudget as K8sPDB;
use k8s_openapi::api::storage::v1::StorageClass as K8sStorageClass;
use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition as K8sCRD;
use kube::{api::{ApiResource, AttachParams, DeleteParams, DynamicObject, ListParams, LogParams, Patch, PatchParams, PostParams}, Api};
use tokio::io::AsyncReadExt as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::ipc::Channel;

use super::extras::ResourceCondition;
use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all, parse_cpu_millis, parse_mem_mib};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerEnvVarSource {
    pub source_type: String, // "configmap" | "secret" | "fieldRef" | "resourceField"
    pub name: Option<String>,
    pub key: Option<String>,
    pub field_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerEnvVar {
    pub name: String,
    pub value: Option<String>,
    pub value_from: Option<ContainerEnvVarSource>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerEnvFrom {
    pub source_type: String, // "configmap" | "secret"
    pub name: String,
    pub prefix: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerVolumeMount {
    pub name: String,
    pub mount_path: String,
    pub read_only: bool,
    pub sub_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerProbe {
    pub probe_type: String, // "httpGet" | "tcpSocket" | "exec" | "grpc"
    pub path: Option<String>,
    pub port: Option<String>, // stringify port (can be int or named)
    pub host: Option<String>,
    pub command: Option<Vec<String>>,
    pub grpc_service: Option<String>,
    pub initial_delay_seconds: Option<i32>,
    pub period_seconds: Option<i32>,
    pub failure_threshold: Option<i32>,
    pub success_threshold: Option<i32>,
    pub timeout_seconds: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerProbes {
    pub liveness: Option<ContainerProbe>,
    pub readiness: Option<ContainerProbe>,
    pub startup: Option<ContainerProbe>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Container {
    pub name: String,
    pub image: String,
    pub status: String,
    pub ready: bool,
    pub restart_count: i32,
    pub is_init: bool,
    pub ports: Vec<i32>,
    pub env: Vec<ContainerEnvVar>,
    pub env_from: Vec<ContainerEnvFrom>,
    pub volume_mounts: Vec<ContainerVolumeMount>,
    pub probes: ContainerProbes,
    pub cpu_request_m: Option<i64>,
    pub mem_request_mi: Option<i64>,
    pub cpu_limit_m: Option<i64>,
    pub mem_limit_mi: Option<i64>,
}

/// Per-container restart history and last/current state details.
/// Names of init containers are prefixed with "init:" for clarity.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ContainerStatus {
    pub name: String,
    pub restart_count: i32,
    pub current_state: String,              // "running" / "waiting" / "terminated" / "unknown"
    pub current_started_at: Option<String>, // ISO 8601 — set when running
    pub current_reason: Option<String>,     // waiting/terminated reason
    pub last_state: Option<String>,         // "terminated" if a previous run exists
    pub last_reason: Option<String>,        // OOMKilled / Error / etc.
    pub last_exit_code: Option<i32>,
    pub last_signal: Option<i32>,
    pub last_started_at: Option<String>,
    pub last_finished_at: Option<String>,
}

/// An ephemeral (debug) container. Kept apart from `containers` on purpose: it never appears
/// there, so it needs no `init:`-style name prefix bridge.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EphemeralContainerInfo {
    pub name: String,
    pub image: String,
    pub target_container: Option<String>, // spec.ephemeralContainers[].targetContainerName
    pub state: String,                    // "running" | "waiting" | "terminated" | "pending"
                                          // "pending" = in spec, no status entry yet
    pub reason: Option<String>,           // waiting.reason or terminated.reason
    pub message: Option<String>,          // waiting.message or terminated.message, verbatim
    pub exit_code: Option<i32>,           // terminated.exitCode
    pub started_at: Option<String>,       // running.startedAt, RFC3339
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Pod {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub ready: String,
    pub restarts: i32,
    pub age: String,
    pub node: String,
    pub cpu_request: String,
    pub memory_request: String,
    pub containers: Vec<Container>,
    pub labels: HashMap<String, String>,
    pub cpu_m: Option<i64>,
    pub cpu_lim: Option<i64>,
    pub mem_mi: Option<i64>,
    pub mem_lim: Option<i64>,
    pub owner: Option<String>,
    pub image: Option<String>,
    pub containers_status: Vec<ContainerStatus>,
    pub default_container: Option<String>,
    pub ephemeral_containers: Vec<EphemeralContainerInfo>,
    pub priority_class: Option<String>, // spec.priorityClassName
    pub service_account: Option<String>, // spec.serviceAccountName; None when absent
    pub conditions: Vec<ResourceCondition>, // status.conditions in API order; [] when absent
}

/// `status.conditions` in API order, mapped like `get_workload_conditions` (`reason` and
/// `message` default to `""`, `last_transition` is RFC 3339 or `""`). Pure so it is testable
/// without a cluster.
fn pod_conditions(pod: &K8sPod) -> Vec<ResourceCondition> {
    pod.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|list| {
            list.iter()
                .map(|c| ResourceCondition {
                    type_: c.type_.clone(),
                    status: c.status.clone(),
                    reason: c.reason.clone().unwrap_or_default(),
                    message: c.message.clone().unwrap_or_default(),
                    last_transition: c
                        .last_transition_time
                        .as_ref()
                        .map(|t| t.0.to_rfc3339())
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Ephemeral containers in `spec.ephemeralContainers` order, each matched by name to its entry in
/// `status.ephemeralContainerStatuses`. A spec entry with no status (or a status with no state
/// yet) is `"pending"`.
fn build_ephemeral_containers(pod: &K8sPod) -> Vec<EphemeralContainerInfo> {
    let Some(specs) = pod.spec.as_ref().and_then(|s| s.ephemeral_containers.as_ref()) else {
        return Vec::new();
    };
    let statuses = pod.status.as_ref().and_then(|s| s.ephemeral_container_statuses.as_ref());
    specs
        .iter()
        .map(|ec| {
            let state = statuses
                .and_then(|list| list.iter().find(|s| s.name == ec.name))
                .and_then(|s| s.state.as_ref());
            let mut info = EphemeralContainerInfo {
                name: ec.name.clone(),
                image: ec.image.clone().unwrap_or_default(),
                target_container: ec.target_container_name.clone(),
                state: "pending".to_string(),
                reason: None,
                message: None,
                exit_code: None,
                started_at: None,
            };
            if let Some(st) = state {
                if let Some(r) = &st.running {
                    info.state = "running".to_string();
                    info.started_at = r.started_at.as_ref().map(|t| t.0.to_rfc3339());
                } else if let Some(w) = &st.waiting {
                    info.state = "waiting".to_string();
                    info.reason = w.reason.clone();
                    info.message = w.message.clone();
                } else if let Some(t) = &st.terminated {
                    info.state = "terminated".to_string();
                    info.reason = t.reason.clone();
                    info.message = t.message.clone();
                    info.exit_code = Some(t.exit_code);
                }
            }
            info
        })
        .collect()
}

fn pod_status(pod: &K8sPod) -> String {
    if pod.metadata.deletion_timestamp.is_some() {
        return "Terminating".to_string();
    }
    let phase = pod.status.as_ref().and_then(|s| s.phase.as_deref()).unwrap_or("Unknown");
    if let Some(css) = pod.status.as_ref().and_then(|s| s.container_statuses.as_ref()) {
        for cs in css {
            if let Some(reason) = cs.state.as_ref()
                .and_then(|st| st.waiting.as_ref())
                .and_then(|w| w.reason.as_deref())
            {
                match reason {
                    "CrashLoopBackOff" => return "CrashLoopBackOff".to_string(),
                    "ImagePullBackOff" | "ErrImagePull" => return "ImagePullBackOff".to_string(),
                    "ContainerCreating" => return "Pending".to_string(),
                    _ => {}
                }
            }
        }
    }
    phase.to_string()
}

fn ready_count(pod: &K8sPod) -> String {
    let total = pod.spec.as_ref().map(|s| s.containers.len()).unwrap_or(0);
    let ready = pod.status.as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .map(|cs| cs.iter().filter(|c| c.ready).count())
        .unwrap_or(0);
    format!("{}/{}", ready, total)
}

fn parse_resources(pod: &K8sPod) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    if let Some(c) = pod.spec.as_ref().and_then(|s| s.containers.first()) {
        if let Some(res) = &c.resources {
            let cpu_req = res.requests.as_ref().and_then(|r| r.get("cpu")).and_then(|q| parse_cpu_millis(&q.0));
            let cpu_lim = res.limits.as_ref().and_then(|r| r.get("cpu")).and_then(|q| parse_cpu_millis(&q.0));
            let mem_req = res.requests.as_ref().and_then(|r| r.get("memory")).and_then(|q| parse_mem_mib(&q.0));
            let mem_lim = res.limits.as_ref().and_then(|r| r.get("memory")).and_then(|q| parse_mem_mib(&q.0));
            return (cpu_req, cpu_lim, mem_req, mem_lim);
        }
    }
    (None, None, None, None)
}

fn parse_probe(probe: &k8s_openapi::api::core::v1::Probe) -> ContainerProbe {
    use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;

    let grpc_service = probe.grpc.as_ref().and_then(|g| g.service.clone());

    let (probe_type, path, port, host, command) = if let Some(h) = &probe.http_get {
        let port_str = match &h.port {
            IntOrString::Int(n) => n.to_string(),
            IntOrString::String(s) => s.clone(),
        };
        ("httpGet".to_string(), h.path.clone(), Some(port_str), h.host.clone(), None)
    } else if let Some(t) = &probe.tcp_socket {
        let port_str = match &t.port {
            IntOrString::Int(n) => n.to_string(),
            IntOrString::String(s) => s.clone(),
        };
        ("tcpSocket".to_string(), None, Some(port_str), t.host.clone(), None)
    } else if let Some(e) = &probe.exec {
        let cmd = e.command.clone().unwrap_or_default();
        ("exec".to_string(), None, None, None, Some(cmd))
    } else if let Some(g) = &probe.grpc {
        (
            "grpc".to_string(),
            None,
            Some(g.port.to_string()),
            None,
            None,
        )
    } else {
        ("unknown".to_string(), None, None, None, None)
    };

    ContainerProbe {
        probe_type,
        path,
        port,
        host,
        command,
        grpc_service,
        initial_delay_seconds: probe.initial_delay_seconds,
        period_seconds: probe.period_seconds,
        failure_threshold: probe.failure_threshold,
        success_threshold: probe.success_threshold,
        timeout_seconds: probe.timeout_seconds,
    }
}

fn parse_container_extras(
    c: &k8s_openapi::api::core::v1::Container,
) -> (Vec<ContainerEnvVar>, Vec<ContainerEnvFrom>, Vec<ContainerVolumeMount>, ContainerProbes, Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    // ENV vars
    let env: Vec<ContainerEnvVar> = c.env.iter().flatten().map(|e| {
        let value_from = e.value_from.as_ref().map(|vf| {
            if let Some(cm) = &vf.config_map_key_ref {
                ContainerEnvVarSource {
                    source_type: "configmap".to_string(),
                    name: Some(cm.name.clone()),
                    key: Some(cm.key.clone()),
                    field_path: None,
                }
            } else if let Some(sec) = &vf.secret_key_ref {
                ContainerEnvVarSource {
                    source_type: "secret".to_string(),
                    name: Some(sec.name.clone()),
                    key: Some(sec.key.clone()),
                    field_path: None,
                }
            } else if let Some(fr) = &vf.field_ref {
                ContainerEnvVarSource {
                    source_type: "fieldRef".to_string(),
                    name: None,
                    key: None,
                    field_path: Some(fr.field_path.clone()),
                }
            } else if let Some(rr) = &vf.resource_field_ref {
                ContainerEnvVarSource {
                    source_type: "resourceField".to_string(),
                    name: None,
                    key: Some(rr.resource.clone()),
                    field_path: None,
                }
            } else {
                ContainerEnvVarSource {
                    source_type: "unknown".to_string(),
                    name: None,
                    key: None,
                    field_path: None,
                }
            }
        });
        ContainerEnvVar {
            name: e.name.clone(),
            value: e.value.clone(),
            value_from,
        }
    }).collect();

    // ENV FROM
    let env_from: Vec<ContainerEnvFrom> = c.env_from.iter().flatten().map(|ef| {
        if let Some(cm) = &ef.config_map_ref {
            ContainerEnvFrom {
                source_type: "configmap".to_string(),
                name: cm.name.clone(),
                prefix: ef.prefix.clone(),
            }
        } else if let Some(sec) = &ef.secret_ref {
            ContainerEnvFrom {
                source_type: "secret".to_string(),
                name: sec.name.clone(),
                prefix: ef.prefix.clone(),
            }
        } else {
            ContainerEnvFrom {
                source_type: "unknown".to_string(),
                name: String::new(),
                prefix: ef.prefix.clone(),
            }
        }
    }).collect();

    // VOLUME MOUNTS
    let volume_mounts: Vec<ContainerVolumeMount> = c.volume_mounts.iter().flatten().map(|vm| {
        ContainerVolumeMount {
            name: vm.name.clone(),
            mount_path: vm.mount_path.clone(),
            read_only: vm.read_only.unwrap_or(false),
            sub_path: vm.sub_path.clone(),
        }
    }).collect();

    // PROBES
    let probes = ContainerProbes {
        liveness: c.liveness_probe.as_ref().map(parse_probe),
        readiness: c.readiness_probe.as_ref().map(parse_probe),
        startup: c.startup_probe.as_ref().map(parse_probe),
    };

    // RESOURCES
    let cpu_request_m = c.resources.as_ref()
        .and_then(|r| r.requests.as_ref())
        .and_then(|r| r.get("cpu"))
        .and_then(|q| parse_cpu_millis(&q.0));
    let mem_request_mi = c.resources.as_ref()
        .and_then(|r| r.requests.as_ref())
        .and_then(|r| r.get("memory"))
        .and_then(|q| parse_mem_mib(&q.0));
    let cpu_limit_m = c.resources.as_ref()
        .and_then(|r| r.limits.as_ref())
        .and_then(|r| r.get("cpu"))
        .and_then(|q| parse_cpu_millis(&q.0));
    let mem_limit_mi = c.resources.as_ref()
        .and_then(|r| r.limits.as_ref())
        .and_then(|r| r.get("memory"))
        .and_then(|q| parse_mem_mib(&q.0));

    (env, env_from, volume_mounts, probes, cpu_request_m, mem_request_mi, cpu_limit_m, mem_limit_mi)
}

/// Build a `Container` from a spec container and its matching status entry.
/// The container `name` is kept raw (unprefixed) so the Kubernetes log/exec
/// APIs receive the actual container name; init containers are distinguished
/// via the `is_init` flag instead.
fn build_container(
    c: &k8s_openapi::api::core::v1::Container,
    css: Option<&Vec<K8sContainerStatus>>,
    is_init: bool,
) -> Container {
    let cs = css.and_then(|list| list.iter().find(|s| s.name == c.name));
    let (env, env_from, volume_mounts, probes, cpu_request_m, mem_request_mi, cpu_limit_m, mem_limit_mi) =
        parse_container_extras(c);
    Container {
        name: c.name.clone(),
        image: c.image.clone().unwrap_or_default(),
        status: cs.and_then(|s| s.state.as_ref()).map(|st| {
            if st.running.is_some() { "Running" }
            else if st.waiting.is_some() { "Waiting" }
            else if st.terminated.is_some() { "Terminated" }
            else { "Unknown" }
        }).unwrap_or("Unknown").to_string(),
        ready: cs.map(|s| s.ready).unwrap_or(false),
        restart_count: cs.map(|s| s.restart_count).unwrap_or(0),
        is_init,
        ports: c.ports.as_ref().map(|ps| ps.iter().map(|p| p.container_port).collect()).unwrap_or_default(),
        env,
        env_from,
        volume_mounts,
        probes,
        cpu_request_m,
        mem_request_mi,
        cpu_limit_m,
        mem_limit_mi,
    }
}

fn build_containers(pod: &K8sPod) -> Vec<Container> {
    let Some(spec) = pod.spec.as_ref() else { return Vec::new() };
    let css = pod.status.as_ref().and_then(|s| s.container_statuses.as_ref());
    let init_css = pod.status.as_ref().and_then(|s| s.init_container_statuses.as_ref());

    let mut result: Vec<Container> = Vec::new();

    // Init containers first — status sourced from init_container_statuses.
    for c in spec.init_containers.iter().flatten() {
        result.push(build_container(c, init_css, true));
    }

    // Regular containers — status sourced from container_statuses.
    for c in &spec.containers {
        result.push(build_container(c, css, false));
    }

    result
}

fn map_container_status(cs: &K8sContainerStatus, name_prefix: &str) -> ContainerStatus {
    let name = format!("{}{}", name_prefix, cs.name);

    // Current state
    let (current_state, current_started_at, current_reason) = if let Some(st) = &cs.state {
        if let Some(r) = &st.running {
            let started = r.started_at.as_ref().map(|t| t.0.to_rfc3339());
            ("running".to_string(), started, None)
        } else if let Some(w) = &st.waiting {
            ("waiting".to_string(), None, w.reason.clone())
        } else if let Some(t) = &st.terminated {
            ("terminated".to_string(), None, t.reason.clone())
        } else {
            ("unknown".to_string(), None, None)
        }
    } else {
        ("unknown".to_string(), None, None)
    };

    // Last state — only terminated is meaningful
    let (last_state, last_reason, last_exit_code, last_signal, last_started_at, last_finished_at) =
        if let Some(lt) = cs.last_state.as_ref().and_then(|ls| ls.terminated.as_ref()) {
            (
                Some("terminated".to_string()),
                lt.reason.clone(),
                Some(lt.exit_code),
                lt.signal,
                lt.started_at.as_ref().map(|t| t.0.to_rfc3339()),
                lt.finished_at.as_ref().map(|t| t.0.to_rfc3339()),
            )
        } else {
            (None, None, None, None, None, None)
        };

    ContainerStatus {
        name,
        restart_count: cs.restart_count,
        current_state,
        current_started_at,
        current_reason,
        last_state,
        last_reason,
        last_exit_code,
        last_signal,
        last_started_at,
        last_finished_at,
    }
}

fn build_containers_status(pod: &K8sPod) -> Vec<ContainerStatus> {
    let mut result = Vec::new();

    // Init containers (prefixed with "init:")
    if let Some(ics) = pod.status.as_ref().and_then(|s| s.init_container_statuses.as_ref()) {
        for cs in ics {
            result.push(map_container_status(cs, "init:"));
        }
    }

    // Regular containers (no prefix)
    if let Some(cs) = pod.status.as_ref().and_then(|s| s.container_statuses.as_ref()) {
        for c in cs {
            result.push(map_container_status(c, ""));
        }
    }

    result
}

pub(crate) fn convert_pod(pod: K8sPod) -> Pod {
    let status = pod_status(&pod);
    let ready = ready_count(&pod);
    let restarts = pod.status.as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .map(|cs| cs.iter().map(|c| c.restart_count).sum())
        .unwrap_or(0);
    let age = age_from_timestamp(pod.metadata.creation_timestamp.as_ref().map(|t| &t.0));
    let (cpu_m, cpu_lim, mem_mi, mem_lim) = parse_resources(&pod);
    let containers = build_containers(&pod);
    let containers_status = build_containers_status(&pod);
    let owner = pod.metadata.owner_references.as_ref()
        .and_then(|r| r.first())
        .map(|r| format!("{}/{}", r.kind, r.name));
    let image = pod.spec.as_ref().and_then(|s| s.containers.first()).and_then(|c| c.image.clone());
    let default_container = default_container_from(pod.metadata.annotations.as_ref());
    let ephemeral_containers = build_ephemeral_containers(&pod);
    let priority_class = pod.spec.as_ref().and_then(|s| s.priority_class_name.clone());
    let service_account = pod.spec.as_ref().and_then(|s| s.service_account_name.clone());
    let conditions = pod_conditions(&pod);
    let labels: HashMap<String, String> = pod.metadata.labels.unwrap_or_default().into_iter().collect();

    Pod {
        name: pod.metadata.name.unwrap_or_default(),
        namespace: pod.metadata.namespace.unwrap_or_default(),
        status,
        ready,
        restarts,
        age,
        node: pod.spec.as_ref().and_then(|s| s.node_name.clone()).unwrap_or_else(|| "—".to_string()),
        cpu_request: cpu_m.map(|v| format!("{}m", v)).unwrap_or_else(|| "—".to_string()),
        memory_request: mem_mi.map(|v| format!("{}Mi", v)).unwrap_or_else(|| "—".to_string()),
        containers,
        labels,
        cpu_m,
        cpu_lim,
        mem_mi,
        mem_lim,
        owner,
        image,
        containers_status,
        default_container,
        ephemeral_containers,
        priority_class,
        service_account,
        conditions,
    }
}

#[tauri::command]
pub async fn list_pods(context: String, namespace: String) -> Result<Vec<Pod>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = namespaced_or_all!(client, K8sPod, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list pods: {}", e))?;
    Ok(list.items.into_iter().map(convert_pod).collect())
}

#[tauri::command]
pub async fn list_pods_on_node(context: String, node: String) -> Result<Vec<Pod>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::all(client);
    let lp = ListParams::default().fields(&format!("spec.nodeName={}", node));
    let list = api.list(&lp).await
        .map_err(|e| format!("Failed to list pods on node: {}", e))?;
    Ok(list.items.into_iter().map(convert_pod).collect())
}

/// One pod, or `None` when it does not exist (404). The debug-container flow polls this to
/// watch the ephemeral container come up, and a pod deleted mid-poll is a normal outcome.
#[tauri::command]
pub async fn get_pod(context: String, namespace: String, name: String) -> Result<Option<Pod>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);
    api.get_opt(&name).await
        .map(|opt| opt.map(convert_pod))
        .map_err(|e| format!("Failed to get pod: {}", e))
}

/// `[a-z0-9]([-a-z0-9]*[a-z0-9])?`, at most 63 characters.
fn is_dns1123_label(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 63 {
        return false;
    }
    let alnum = |c: &u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    b.iter().all(|c| alnum(c) || *c == b'-')
        && b.first().map(alnum).unwrap_or(false)
        && b.last().map(alnum).unwrap_or(false)
}

/// The strategic-merge body for `pods/ephemeralcontainers`. Always `stdin` + `tty` and never a
/// command: the image's default entrypoint runs, as with `kubectl debug -it`. Pure so the
/// validation and the exact shape are testable without a cluster.
fn build_debug_container_patch(name: &str, image: &str, target: Option<&str>) -> Result<serde_json::Value, String> {
    if !is_dns1123_label(name) {
        return Err("Failed to start debug container: name must be a DNS-1123 label (lowercase letters, digits and '-', at most 63 characters)".to_string());
    }
    if image.trim().is_empty() || image.chars().any(char::is_whitespace) {
        return Err("Failed to start debug container: image must not be empty or contain whitespace".to_string());
    }
    let mut container = serde_json::json!({
        "name": name,
        "image": image,
        "stdin": true,
        "tty": true,
        "terminationMessagePolicy": "File",
    });
    if let Some(t) = target.map(str::trim).filter(|t| !t.is_empty()) {
        container["targetContainerName"] = serde_json::json!(t);
    }
    Ok(serde_json::json!({ "spec": { "ephemeralContainers": [container] } }))
}

/// Add an ephemeral debug container to a running pod and return its name. The frontend generates
/// the name so it can show it before confirming.
///
/// **Strategic merge patch: a narrowly sanctioned exception.** SMP stays rejected for every
/// general write path (CRDs cannot take it). This is the only sanctioned use: on a built-in
/// `Pod`'s `ephemeralcontainers` subresource, for `kubectl debug` parity. SMP merges the array by
/// `name`, so existing debug containers are untouched; a JSON merge patch would need a
/// get-then-append race. Never generalise this to another write path.
#[tauri::command]
pub async fn start_debug_container(
    context: String,
    namespace: String,
    pod: String,
    name: String,
    image: String,
    target_container: Option<String>,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let body = build_debug_container_patch(&name, &image, target_container.as_deref())?;
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sPod> = Api::namespaced(client, &namespace);
        api.patch_ephemeral_containers(&pod, &PatchParams::default(), &Patch::Strategic(body))
            .await
            .map_err(|e| format!("Failed to start debug container: {}", kube_error_message(&e)))?;
        Ok(name.clone())
    }
    .await;
    crate::app_log::log_write(&context, "debug", "pod", &namespace, &pod, None, &result);
    result
}

/// Server-side ceiling for any log request; equal to the viewers' ring buffer.
const MAX_LOG_TAIL: i64 = 5000;
/// Tail used by `stream_pod_logs` when the caller does not pass one.
const DEFAULT_STREAM_TAIL: i64 = 200;

/// Channel payload of `stream_pod_logs`. Tag and variant spellings are frozen
/// (docs/impl/v1.3.0-tasks.md §2.1).
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogStreamEvent {
    Line { line: String },
    End,
    Error { message: String },
}

/// Build the `LogParams` for a follow stream. Pure so it is testable without a cluster.
fn stream_log_params(
    container: String,
    tail_lines: Option<i64>,
    since_seconds: Option<i64>,
    timestamps: Option<bool>,
) -> Result<LogParams, String> {
    let tail = match tail_lines {
        None => DEFAULT_STREAM_TAIL,
        Some(n) if n < 1 => {
            return Err("Failed to stream logs: tail_lines must be at least 1".to_string())
        }
        Some(n) => n.min(MAX_LOG_TAIL),
    };
    if matches!(since_seconds, Some(s) if s < 1) {
        return Err("Failed to stream logs: since_seconds must be at least 1".to_string());
    }
    Ok(LogParams {
        container: Some(container),
        follow: true,
        tail_lines: Some(tail),
        since_seconds,
        timestamps: timestamps.unwrap_or(false),
        ..Default::default()
    })
}

/// Build the `LogParams` for a one-shot fetch. `tail_lines: None` keeps its
/// meaning here (no limit).
fn get_log_params(
    container: String,
    tail_lines: Option<i64>,
    previous: Option<bool>,
    since_seconds: Option<i64>,
    timestamps: Option<bool>,
) -> Result<LogParams, String> {
    if matches!(since_seconds, Some(s) if s < 1) {
        return Err("Failed to get logs: since_seconds must be at least 1".to_string());
    }
    Ok(LogParams {
        container: Some(container),
        tail_lines,
        previous: previous.unwrap_or(false),
        since_seconds,
        timestamps: timestamps.unwrap_or(false),
        ..Default::default()
    })
}

/// The server's own message for an API error, else the error's display text.
fn kube_error_message(e: &kube::Error) -> String {
    match e {
        kube::Error::Api(ae) => ae.message.clone(),
        other => other.to_string(),
    }
}

/// `kubectl.kubernetes.io/default-container`, verbatim; empty or absent -> None.
fn default_container_from(annotations: Option<&std::collections::BTreeMap<String, String>>) -> Option<String> {
    annotations
        .and_then(|a| a.get("kubectl.kubernetes.io/default-container"))
        .filter(|v| !v.is_empty())
        .cloned()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // frozen IPC signature (v1.3.0 §2.2)
pub async fn get_pod_logs(
    context: String, namespace: String, pod: String,
    container: String, tail_lines: Option<i64>, previous: Option<bool>,
    since_seconds: Option<i64>, timestamps: Option<bool>,
) -> Result<String, String> {
    let params = get_log_params(container, tail_lines, previous, since_seconds, timestamps)?;
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);
    api.logs(&pod, &params)
        .await
        .map_err(|e| format!("Failed to get logs: {}", e))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // frozen IPC signature (v1.3.0 §2.1)
pub async fn stream_pod_logs(
    on_log: Channel<LogStreamEvent>, context: String, namespace: String, pod: String, container: String,
    tail_lines: Option<i64>, since_seconds: Option<i64>, timestamps: Option<bool>,
) -> Result<(), String> {
    let params = stream_log_params(container, tail_lines, since_seconds, timestamps)?;
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);
    let stream = api.log_stream(&pod, &params).await
        .map_err(|e| format!("Failed to stream logs: {}", kube_error_message(&e)))?;

    tokio::spawn(async move {
        use futures::StreamExt as _;
        let mut lines = stream.lines();
        loop {
            // End/Error are sent at most once and nothing follows them. A failed
            // send means the frontend dropped the channel: exit silently.
            let event = match lines.next().await {
                Some(Ok(line)) => LogStreamEvent::Line { line },
                Some(Err(e)) => {
                    let _ = on_log.send(LogStreamEvent::Error { message: e.to_string() });
                    break;
                }
                None => {
                    let _ = on_log.send(LogStreamEvent::End);
                    break;
                }
            };
            if on_log.send(event).is_err() {
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn delete_pod(context: String, namespace: String, pod_name: String) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let api: Api<K8sPod> = Api::namespaced(client, &namespace);
        api.delete(&pod_name, &kube::api::DeleteParams::default()).await
            .map_err(|e| format!("Failed to delete pod: {}", e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "delete", "pod", &namespace, &pod_name, None, &result);
    result
}

/// Map the caller's propagation choice to `DeleteParams`.
///
/// An absent policy must NOT fall through to the library default: that sends no
/// `propagationPolicy`, and for `batch/v1` Jobs the API server then orphans the
/// dependents, leaving the pods running. Background is sent explicitly, as kubectl does.
pub(crate) fn delete_params_for(p: Option<&str>) -> Result<DeleteParams, String> {
    match p {
        None | Some("") | Some("background") => Ok(DeleteParams::background()),
        Some("foreground") => Ok(DeleteParams::foreground()),
        Some("orphan") => Ok(DeleteParams::orphan()),
        Some(other) => Err(format!("Failed to delete: unknown propagation policy '{}'", other)),
    }
}

#[tauri::command]
pub async fn delete_resource(
    context: String,
    namespace: String,
    resource_type: String,
    name: String,
    propagation: Option<String>,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        // Validate the policy before connecting so a bad value never reaches the cluster.
        let dp = delete_params_for(propagation.as_deref())?;
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        macro_rules! delete_namespaced {
            ($T:ty, $label:literal) => {{
                let api: Api<$T> = Api::namespaced(client, &namespace);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete {}: {}", $label, e))?;
                Ok(())
            }};
        }

        macro_rules! delete_all {
            ($T:ty, $label:literal) => {{
                let api: Api<$T> = Api::all(client);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete {}: {}", $label, e))?;
                Ok(())
            }};
        }

        match resource_type.as_str() {
            "deploy" | "deployment" | "deployments" => delete_namespaced!(K8sDeployment, "deployment"),
            "sts" | "statefulset" | "statefulsets" => delete_namespaced!(K8sStatefulSet, "statefulset"),
            "ds" | "daemonset" | "daemonsets" => delete_namespaced!(K8sDaemonSet, "daemonset"),
            "jobs" | "job" => delete_namespaced!(K8sJob, "job"),
            "cron" | "cronjob" | "cronjobs" => delete_namespaced!(K8sCronJob, "cronjob"),
            "svc" | "service" | "services" => delete_namespaced!(K8sService, "service"),
            "ing" | "ingress" | "ingresses" => delete_namespaced!(K8sIngress, "ingress"),
            "cm" | "configmap" | "configmaps" => delete_namespaced!(K8sConfigMap, "configmap"),
            "sec" | "secret" | "secrets" => delete_namespaced!(K8sSecret, "secret"),
            "pvc" | "persistentvolumeclaim" | "pvcs" => delete_namespaced!(K8sPVC, "pvc"),
            "pv" | "persistentvolume" | "pvs" => delete_all!(K8sPV, "pv"),
            "nodes" | "node" => delete_all!(K8sNodeType, "node"),
            "hpa" | "horizontalpodautoscaler" => delete_namespaced!(K8sHPA, "hpa"),
            "crd" | "customresourcedefinition" => delete_all!(K8sCRD, "crd"),
            "netpol" | "networkpolicy" => delete_namespaced!(K8sNetworkPolicy, "networkpolicy"),
            "sa" | "serviceaccount" => delete_namespaced!(K8sServiceAccount, "serviceaccount"),
            "roles" | "role" => delete_namespaced!(K8sRole, "role"),
            "croles" | "clusterrole" => delete_all!(K8sClusterRole, "clusterrole"),
            "rbindings" | "rolebinding" => delete_namespaced!(K8sRoleBinding, "rolebinding"),
            "crbindings" | "clusterrolebinding" => delete_all!(K8sClusterRoleBinding, "clusterrolebinding"),
            "sc" | "storageclass" => delete_all!(K8sStorageClass, "storageclass"),
            "pdb" | "poddisruptionbudget" => delete_namespaced!(K8sPDB, "pdb"),
            "rq" | "resourcequota" => delete_namespaced!(K8sRQ, "resourcequota"),
            "lr" | "limitrange" => delete_namespaced!(K8sLR, "limitrange"),
            "pc" | "priorityclass" => delete_all!(K8sPC, "priorityclass"),
            "rs" | "replicaset" | "replicasets" => delete_namespaced!(K8sReplicaSet, "replicaset"),
            "mwc" | "mutatingwebhookconfiguration" => delete_all!(K8sMWC, "mutatingwebhookconfiguration"),
            "vwc" | "validatingwebhookconfiguration" => delete_all!(K8sVWC, "validatingwebhookconfiguration"),
            "vs" | "volumesnapshot" | "volumesnapshots" => {
                let ar = ApiResource {
                    group: "snapshot.storage.k8s.io".to_string(),
                    version: "v1".to_string(),
                    api_version: "snapshot.storage.k8s.io/v1".to_string(),
                    kind: "VolumeSnapshot".to_string(),
                    plural: "volumesnapshots".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete volumesnapshot: {}", e))?;
                Ok(())
            }
            "cert" | "certificate" | "certificates" => {
                let ar = ApiResource {
                    group: "cert-manager.io".to_string(),
                    version: "v1".to_string(),
                    api_version: "cert-manager.io/v1".to_string(),
                    kind: "Certificate".to_string(),
                    plural: "certificates".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete certificate: {}", e))?;
                Ok(())
            }
            "flux-ks" | "kustomization" => {
                let ar = ApiResource {
                    group: "kustomize.toolkit.fluxcd.io".to_string(),
                    version: "v1".to_string(),
                    api_version: "kustomize.toolkit.fluxcd.io/v1".to_string(),
                    kind: "Kustomization".to_string(),
                    plural: "kustomizations".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete flux kustomization: {}", e))?;
                Ok(())
            }
            "flux-hr" | "helmrelease" => {
                let ar = ApiResource {
                    group: "helm.toolkit.fluxcd.io".to_string(),
                    version: "v2".to_string(),
                    api_version: "helm.toolkit.fluxcd.io/v2".to_string(),
                    kind: "HelmRelease".to_string(),
                    plural: "helmreleases".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete flux helmrelease: {}", e))?;
                Ok(())
            }
            "gw" | "gateway" => {
                let ar = ApiResource {
                    group: "gateway.networking.k8s.io".to_string(),
                    version: "v1".to_string(),
                    api_version: "gateway.networking.k8s.io/v1".to_string(),
                    kind: "Gateway".to_string(),
                    plural: "gateways".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete gateway: {}", e))?;
                Ok(())
            }
            "httproute" => {
                let ar = ApiResource {
                    group: "gateway.networking.k8s.io".to_string(),
                    version: "v1".to_string(),
                    api_version: "gateway.networking.k8s.io/v1".to_string(),
                    kind: "HTTPRoute".to_string(),
                    plural: "httproutes".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete httproute: {}", e))?;
                Ok(())
            }
            "argo-appsets" | "applicationset" => {
                let ar = ApiResource {
                    group: "argoproj.io".to_string(),
                    version: "v1alpha1".to_string(),
                    api_version: "argoproj.io/v1alpha1".to_string(),
                    kind: "ApplicationSet".to_string(),
                    plural: "applicationsets".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete argocd applicationset: {}", e))?;
                Ok(())
            }
            "argo-projects" | "appproject" => {
                let ar = ApiResource {
                    group: "argoproj.io".to_string(),
                    version: "v1alpha1".to_string(),
                    api_version: "argoproj.io/v1alpha1".to_string(),
                    kind: "AppProject".to_string(),
                    plural: "appprojects".to_string(),
                };
                let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
                api.delete(&name, &dp).await
                    .map_err(|e| format!("Failed to delete argocd appproject: {}", e))?;
                Ok(())
            }
            k => Err(format!("delete_resource: unsupported resource type '{}'", k)),
        }
    }
    .await;
    crate::app_log::log_write(&context, "delete", &resource_type, &namespace, &name,
        Some(&serde_json::json!({ "propagation": propagation.as_deref().filter(|p| !p.is_empty()).unwrap_or("background") })), &result);
    result
}

/// Display-only YAML plus the dotted paths that were hidden from it.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NeatYaml {
    pub yaml: String,
    pub hidden: Vec<String>,
}

/// Remove noise from a raw API object for display. Returns the dotted paths
/// actually removed, in the order of the closed list. Never touches `spec`.
fn neat_value(v: &mut serde_json::Value) -> Vec<String> {
    let mut hidden: Vec<String> = Vec::new();
    let Some(root) = v.as_object_mut() else { return hidden };

    if let Some(meta) = root.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        if meta.remove("managedFields").is_some() {
            hidden.push("metadata.managedFields".to_string());
        }
        const LAST_APPLIED: &str = "kubectl.kubernetes.io/last-applied-configuration";
        let mut drop_annotations = false;
        if let Some(ann) = meta.get_mut("annotations").and_then(|a| a.as_object_mut()) {
            if ann.remove(LAST_APPLIED).is_some() {
                hidden.push(format!("metadata.annotations.{}", LAST_APPLIED));
                drop_annotations = ann.is_empty();
            }
        }
        if drop_annotations {
            meta.remove("annotations");
        }
    }
    if root.remove("status").is_some() {
        hidden.push("status".to_string());
    }
    if let Some(meta) = root.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        for key in ["uid", "resourceVersion", "generation", "creationTimestamp"] {
            if meta.remove(key).is_some() {
                hidden.push(format!("metadata.{}", key));
            }
        }
    }
    hidden
}

/// Serialise a fetched object. `neat == false` is byte-identical to the
/// original `get_resource_yaml` output (typed field order preserved).
fn render_obj<T: Serialize>(obj: &T, neat: bool) -> Result<(String, Vec<String>), String> {
    if !neat {
        let yaml = serde_yaml::to_string(obj).map_err(|e| e.to_string())?;
        return Ok((yaml, Vec::new()));
    }
    let mut value = serde_json::to_value(obj).map_err(|e| e.to_string())?;
    let hidden = neat_value(&mut value);
    let yaml = serde_yaml::to_string(&value).map_err(|e| e.to_string())?;
    Ok((yaml, hidden))
}

#[tauri::command]
pub async fn get_resource_yaml(
    context: String, namespace: String, resource_type: String, name: String,
) -> Result<String, String> {
    fetch_resource_yaml(context, namespace, resource_type, name, false)
        .await
        .map(|(yaml, _)| yaml)
}

/// Same fetch path as `get_resource_yaml`, with display-only noise removed.
/// Never feed the result to `apply_resource_yaml`.
#[tauri::command]
pub async fn get_resource_yaml_neat(
    context: String, namespace: String, resource_type: String, name: String,
) -> Result<NeatYaml, String> {
    fetch_resource_yaml(context, namespace, resource_type, name, true)
        .await
        .map(|(yaml, hidden)| NeatYaml { yaml, hidden })
}

async fn fetch_resource_yaml(
    context: String, namespace: String, resource_type: String, name: String, neat: bool,
) -> Result<(String, Vec<String>), String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    macro_rules! fetch_namespaced {
        ($T:ty, $label:literal) => {{
            let api: Api<$T> = Api::namespaced(client, &namespace);
            let obj = api.get(&name).await.map_err(|e| format!("Failed to get {}: {}", $label, e))?;
            render_obj(&obj, neat)
        }};
    }

    macro_rules! fetch_all {
        ($T:ty, $label:literal) => {{
            let api: Api<$T> = Api::all(client);
            let obj = api.get(&name).await.map_err(|e| format!("Failed to get {}: {}", $label, e))?;
            render_obj(&obj, neat)
        }};
    }

    match resource_type.as_str() {
        "pods" | "pod" => fetch_namespaced!(K8sPod, "pod"),
        "deploy" | "deployment" | "deployments" => fetch_namespaced!(K8sDeployment, "deployment"),
        "sts" | "statefulset" | "statefulsets" => fetch_namespaced!(K8sStatefulSet, "statefulset"),
        "ds" | "daemonset" | "daemonsets" => fetch_namespaced!(K8sDaemonSet, "daemonset"),
        "jobs" | "job" => fetch_namespaced!(K8sJob, "job"),
        "cron" | "cronjob" | "cronjobs" => fetch_namespaced!(K8sCronJob, "cronjob"),
        "svc" | "service" | "services" => fetch_namespaced!(K8sService, "service"),
        "ing" | "ingress" | "ingresses" => fetch_namespaced!(K8sIngress, "ingress"),
        "cm" | "configmap" | "configmaps" => fetch_namespaced!(K8sConfigMap, "configmap"),
        "sec" | "secret" | "secrets" => fetch_namespaced!(K8sSecret, "secret"),
        "pvc" | "persistentvolumeclaim" | "pvcs" => fetch_namespaced!(K8sPVC, "pvc"),
        "pv" | "persistentvolume" | "pvs" => fetch_all!(K8sPV, "pv"),
        "ns" | "namespace" | "namespaces" => fetch_all!(K8sNamespace, "namespace"),
        "nodes" | "node" => fetch_all!(K8sNodeType, "node"),
        "hpa" | "horizontalpodautoscaler" => fetch_namespaced!(K8sHPA, "hpa"),
        "crd" | "customresourcedefinition" => fetch_all!(K8sCRD, "crd"),
        "netpol" | "networkpolicy" => fetch_namespaced!(K8sNetworkPolicy, "networkpolicy"),
        "sa" | "serviceaccount" => fetch_namespaced!(K8sServiceAccount, "serviceaccount"),
        "roles" | "role" => fetch_namespaced!(K8sRole, "role"),
        "croles" | "clusterrole" => fetch_all!(K8sClusterRole, "clusterrole"),
        "rbindings" | "rolebinding" => fetch_namespaced!(K8sRoleBinding, "rolebinding"),
        "crbindings" | "clusterrolebinding" => fetch_all!(K8sClusterRoleBinding, "clusterrolebinding"),
        "sc" | "storageclass" => fetch_all!(K8sStorageClass, "storageclass"),
        "pdb" | "poddisruptionbudget" => fetch_namespaced!(K8sPDB, "pdb"),
        "ep" | "endpoints" => fetch_namespaced!(K8sEndpoints, "endpoints"),
        "eps" | "endpointslice" | "endpointslices" => fetch_namespaced!(K8sEndpointSlice, "endpointslice"),
        "rs" | "replicaset" | "replicasets" => fetch_namespaced!(K8sReplicaSet, "replicaset"),
        "mwc" | "mutatingwebhookconfiguration" => fetch_all!(K8sMWC, "mutatingwebhookconfiguration"),
        "vwc" | "validatingwebhookconfiguration" => fetch_all!(K8sVWC, "validatingwebhookconfiguration"),
        "vs" | "volumesnapshot" | "volumesnapshots" => {
            let ar = ApiResource {
                group: "snapshot.storage.k8s.io".to_string(),
                version: "v1".to_string(),
                api_version: "snapshot.storage.k8s.io/v1".to_string(),
                kind: "VolumeSnapshot".to_string(),
                plural: "volumesnapshots".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get volumesnapshot: {}", e))?;
            render_obj(&obj, neat)
        }
        "cert" | "certificate" | "certificates" => {
            let ar = ApiResource {
                group: "cert-manager.io".to_string(),
                version: "v1".to_string(),
                api_version: "cert-manager.io/v1".to_string(),
                kind: "Certificate".to_string(),
                plural: "certificates".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get certificate: {}", e))?;
            render_obj(&obj, neat)
        }
        "flux-ks" | "kustomization" => {
            let ar = ApiResource {
                group: "kustomize.toolkit.fluxcd.io".to_string(),
                version: "v1".to_string(),
                api_version: "kustomize.toolkit.fluxcd.io/v1".to_string(),
                kind: "Kustomization".to_string(),
                plural: "kustomizations".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get flux kustomization: {}", e))?;
            render_obj(&obj, neat)
        }
        "flux-hr" | "helmrelease" => {
            let ar = ApiResource {
                group: "helm.toolkit.fluxcd.io".to_string(),
                version: "v2".to_string(),
                api_version: "helm.toolkit.fluxcd.io/v2".to_string(),
                kind: "HelmRelease".to_string(),
                plural: "helmreleases".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get flux helmrelease: {}", e))?;
            render_obj(&obj, neat)
        }
        "gw" | "gateway" => {
            let ar = ApiResource {
                group: "gateway.networking.k8s.io".to_string(),
                version: "v1".to_string(),
                api_version: "gateway.networking.k8s.io/v1".to_string(),
                kind: "Gateway".to_string(),
                plural: "gateways".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get gateway: {}", e))?;
            render_obj(&obj, neat)
        }
        "httproute" => {
            let ar = ApiResource {
                group: "gateway.networking.k8s.io".to_string(),
                version: "v1".to_string(),
                api_version: "gateway.networking.k8s.io/v1".to_string(),
                kind: "HTTPRoute".to_string(),
                plural: "httproutes".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get httproute: {}", e))?;
            render_obj(&obj, neat)
        }
        "argo-appsets" | "applicationset" => {
            let ar = ApiResource {
                group: "argoproj.io".to_string(),
                version: "v1alpha1".to_string(),
                api_version: "argoproj.io/v1alpha1".to_string(),
                kind: "ApplicationSet".to_string(),
                plural: "applicationsets".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get argocd applicationset: {}", e))?;
            render_obj(&obj, neat)
        }
        "argo-projects" | "appproject" => {
            let ar = ApiResource {
                group: "argoproj.io".to_string(),
                version: "v1alpha1".to_string(),
                api_version: "argoproj.io/v1alpha1".to_string(),
                kind: "AppProject".to_string(),
                plural: "appprojects".to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
            let obj = api.get(&name).await
                .map_err(|e| format!("Failed to get argocd appproject: {}", e))?;
            render_obj(&obj, neat)
        }
        "rq" | "resourcequota" => fetch_namespaced!(K8sRQ, "resourcequota"),
        "lr" | "limitrange" => fetch_namespaced!(K8sLR, "limitrange"),
        "pc" | "priorityclass" => fetch_all!(K8sPC, "priorityclass"),
        _ => Err(format!("Unsupported resource type: {}", resource_type)),
    }
}

#[tauri::command]
pub async fn exec_pod_command(
    context: String, namespace: String, pod: String,
    container: String, command: String,
) -> Result<String, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);
    let cmd = vec!["sh".to_string(), "-c".to_string(), command];
    let ap = AttachParams::default()
        .container(container)
        .stdout(true)
        .stderr(true)
        .stdin(false)
        .tty(false);
    let mut attached = api.exec(&pod, cmd, &ap).await
        .map_err(|e| format!("Failed to exec: {}", e))?;
    let mut out = String::new();
    let mut err = String::new();
    if let Some(mut s) = attached.stdout() {
        s.read_to_string(&mut out).await.ok();
    }
    if let Some(mut s) = attached.stderr() {
        s.read_to_string(&mut err).await.ok();
    }
    if err.is_empty() {
        Ok(out)
    } else if out.is_empty() {
        Ok(err)
    } else {
        Ok(format!("{}\n[stderr]\n{}", out, err))
    }
}

// ─── Container metrics from metrics.k8s.io ────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ContainerUsage {
    pub name: String,
    pub cpu_usage: String,
    pub memory_usage: String,
    pub cpu_millicores: i64,
    pub memory_mib: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PodMetricsResult {
    pub containers: Vec<ContainerUsage>,
}

fn parse_cpu_millis_usage(s: &str) -> i64 {
    if let Some(v) = s.strip_suffix('n') {
        v.parse::<i64>().unwrap_or(0) / 1_000_000
    } else if let Some(v) = s.strip_suffix('u') {
        v.parse::<i64>().unwrap_or(0) / 1_000
    } else if let Some(v) = s.strip_suffix('m') {
        v.parse().unwrap_or(0)
    } else {
        s.parse::<f64>().unwrap_or(0.0) as i64 * 1000
    }
}

#[tauri::command]
pub async fn get_pod_metrics(
    context: String, namespace: String, pod: String,
) -> Result<PodMetricsResult, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = ApiResource {
        group: "metrics.k8s.io".to_string(),
        version: "v1beta1".to_string(),
        api_version: "metrics.k8s.io/v1beta1".to_string(),
        kind: "PodMetrics".to_string(),
        plural: "pods".to_string(),
    };
    let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
    let metric = api.get(&pod).await
        .map_err(|_| "Metrics server not available or pod not yet scraped".to_string())?;

    let containers = metric.data.get("containers")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(|c| {
            let cpu_str = c["usage"]["cpu"].as_str().unwrap_or("0");
            let mem_str = c["usage"]["memory"].as_str().unwrap_or("0");
            ContainerUsage {
                name: c["name"].as_str().unwrap_or("").to_string(),
                cpu_usage: cpu_str.to_string(),
                memory_usage: mem_str.to_string(),
                cpu_millicores: parse_cpu_millis_usage(cpu_str),
                memory_mib: parse_mem_mib(mem_str).unwrap_or(0),
            }
        }).collect())
        .unwrap_or_default();

    Ok(PodMetricsResult { containers })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PodUsage {
    pub name: String,
    pub namespace: String,
    pub cpu_m: i64,
    pub mem_mi: i64,
    pub containers: Vec<PodContainerUsage>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PodContainerUsage {
    pub name: String,
    pub cpu_m: i64,
    pub mem_mi: i64,
}

/// Per-container usage from a PodMetrics `containers` array. Pod totals are the sums of these.
fn container_usages(containers: &[serde_json::Value]) -> Vec<PodContainerUsage> {
    containers
        .iter()
        .map(|c| PodContainerUsage {
            name: c["name"].as_str().unwrap_or("").to_string(),
            cpu_m: parse_cpu_millis_usage(c["usage"]["cpu"].as_str().unwrap_or("0")),
            mem_mi: parse_mem_mib(c["usage"]["memory"].as_str().unwrap_or("0")).unwrap_or(0),
        })
        .collect()
}

#[tauri::command]
pub async fn list_pod_metrics(
    context: String,
    namespace: String,
) -> Result<Vec<PodUsage>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = ApiResource {
        group: "metrics.k8s.io".to_string(),
        version: "v1beta1".to_string(),
        api_version: "metrics.k8s.io/v1beta1".to_string(),
        kind: "PodMetrics".to_string(),
        plural: "pods".to_string(),
    };
    let api: Api<DynamicObject> = if namespace == "all" || namespace.is_empty() {
        Api::all_with(client, &ar)
    } else {
        Api::namespaced_with(client, &namespace, &ar)
    };

    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(_) => return Ok(Vec::new()),
    };

    let rows = list
        .items
        .into_iter()
        .map(|item| {
            let empty_vec = vec![];
            let containers = item.data["containers"]
                .as_array()
                .unwrap_or(&empty_vec);
            let containers = container_usages(containers);
            let cpu_m = containers.iter().map(|c| c.cpu_m).sum::<i64>();
            let mem_mi = containers.iter().map(|c| c.mem_mi).sum::<i64>();
            PodUsage {
                name: item.metadata.name.unwrap_or_default(),
                namespace: item.metadata.namespace.unwrap_or_default(),
                cpu_m,
                mem_mi,
                containers,
            }
        })
        .collect();

    Ok(rows)
}

// ─── Apply (replace) resource YAML + the save preview ─────────────────────────

/// Why `replace_resource_yaml` failed. Kept structured so the apply path can reproduce its
/// historical error text exactly while the preview path classifies by API status code.
enum ReplaceError {
    /// The YAML did not deserialise into the kind (serde error text only).
    Invalid(String),
    Kube { label: &'static str, source: kube::Error },
    Unsupported(String),
}

impl ReplaceError {
    /// The text `apply_resource_yaml` has always returned.
    fn apply_message(&self) -> String {
        match self {
            ReplaceError::Invalid(e) => format!("Invalid YAML: {}", e),
            ReplaceError::Kube { label, source } => format!("Failed to apply {}: {}", label, source),
            ReplaceError::Unsupported(rt) => format!("Unsupported resource type: {}", rt),
        }
    }
}

struct ReplaceOutput {
    /// The server's response to the replace, as JSON.
    result: serde_json::Value,
    /// `live_raw` pushed through the kind's typed struct and back, for `dropped_paths`. `None`
    /// for `DynamicObject` kinds, or when no raw object was supplied or the round-trip failed.
    typed_live: Option<serde_json::Value>,
}

/// `"conflict"` for 409 (a stale `resourceVersion`), `"rejected"` for any other API status.
fn classify_replace_error(code: u16) -> &'static str {
    if code == 409 {
        "conflict"
    } else {
        "rejected"
    }
}

/// The ONE replace path. `apply_resource_yaml` (real) and `preview_resource_yaml` (`dry_run`) both
/// call this, so the per-kind arms exist exactly once and a preview can never validate something
/// the save would not do.
async fn replace_resource_yaml(
    client: kube::Client,
    namespace: &str,
    resource_type: &str,
    name: &str,
    yaml: &str,
    dry_run: bool,
    live_raw: Option<&serde_json::Value>,
) -> Result<ReplaceOutput, ReplaceError> {
    let pp = PostParams { dry_run, ..Default::default() };

    macro_rules! finish_typed {
        ($T:ty, $replaced:expr) => {{
            let typed_live = live_raw
                .and_then(|raw| serde_json::from_value::<$T>(raw.clone()).ok())
                .and_then(|t| serde_json::to_value(&t).ok());
            Ok(ReplaceOutput {
                result: serde_json::to_value(&$replaced).unwrap_or(serde_json::Value::Null),
                typed_live,
            })
        }};
    }
    macro_rules! replace_ns {
        ($T:ty, $label:literal) => {{
            let api: Api<$T> = Api::namespaced(client, namespace);
            let obj: $T = serde_yaml::from_str(yaml).map_err(|e| ReplaceError::Invalid(e.to_string()))?;
            let replaced = api.replace(name, &pp, &obj).await
                .map_err(|source| ReplaceError::Kube { label: $label, source })?;
            finish_typed!($T, replaced)
        }};
    }
    macro_rules! replace_all {
        ($T:ty, $label:literal) => {{
            let api: Api<$T> = Api::all(client);
            let obj: $T = serde_yaml::from_str(yaml).map_err(|e| ReplaceError::Invalid(e.to_string()))?;
            let replaced = api.replace(name, &pp, &obj).await
                .map_err(|source| ReplaceError::Kube { label: $label, source })?;
            finish_typed!($T, replaced)
        }};
    }
    macro_rules! replace_dyn {
        ($group:literal, $version:literal, $kind:literal, $plural:literal, $label:literal) => {{
            let ar = ApiResource {
                group: $group.to_string(),
                version: $version.to_string(),
                api_version: format!("{}/{}", $group, $version),
                kind: $kind.to_string(),
                plural: $plural.to_string(),
            };
            let api: Api<DynamicObject> = Api::namespaced_with(client, namespace, &ar);
            let obj: DynamicObject = serde_yaml::from_str(yaml).map_err(|e| ReplaceError::Invalid(e.to_string()))?;
            let replaced = api.replace(name, &pp, &obj).await
                .map_err(|source| ReplaceError::Kube { label: $label, source })?;
            Ok(ReplaceOutput {
                result: serde_json::to_value(&replaced).unwrap_or(serde_json::Value::Null),
                typed_live: None,
            })
        }};
    }

    match resource_type {
        "pods" | "pod" => replace_ns!(K8sPod, "pod"),
        "deploy" | "deployment" => replace_ns!(K8sDeployment, "deployment"),
        "sts" | "statefulset" => replace_ns!(K8sStatefulSet, "statefulset"),
        "ds" | "daemonset" => replace_ns!(K8sDaemonSet, "daemonset"),
        "jobs" | "job" => replace_ns!(K8sJob, "job"),
        "cron" | "cronjob" => replace_ns!(K8sCronJob, "cronjob"),
        "svc" | "service" => replace_ns!(K8sService, "service"),
        "ing" | "ingress" => replace_ns!(K8sIngress, "ingress"),
        "cm" | "configmap" => replace_ns!(K8sConfigMap, "configmap"),
        "sec" | "secret" => replace_ns!(K8sSecret, "secret"),
        "pvc" => replace_ns!(K8sPVC, "pvc"),
        "pv" => replace_all!(K8sPV, "pv"),
        "ns" | "namespace" | "namespaces" => replace_all!(K8sNamespace, "namespace"),
        "nodes" | "node" => replace_all!(K8sNodeType, "node"),
        "hpa" | "horizontalpodautoscaler" => replace_ns!(K8sHPA, "hpa"),
        "crd" | "customresourcedefinition" => replace_all!(K8sCRD, "crd"),
        "netpol" | "networkpolicy" => replace_ns!(K8sNetworkPolicy, "networkpolicy"),
        "sa" | "serviceaccount" => replace_ns!(K8sServiceAccount, "serviceaccount"),
        "roles" | "role" => replace_ns!(K8sRole, "role"),
        "croles" | "clusterrole" => replace_all!(K8sClusterRole, "clusterrole"),
        "rbindings" | "rolebinding" => replace_ns!(K8sRoleBinding, "rolebinding"),
        "crbindings" | "clusterrolebinding" => replace_all!(K8sClusterRoleBinding, "clusterrolebinding"),
        "sc" | "storageclass" => replace_all!(K8sStorageClass, "storageclass"),
        "pdb" | "poddisruptionbudget" => replace_ns!(K8sPDB, "pdb"),
        "ep" | "endpoints" => replace_ns!(K8sEndpoints, "endpoints"),
        "eps" | "endpointslice" | "endpointslices" => replace_ns!(K8sEndpointSlice, "endpointslice"),
        "rs" | "replicaset" | "replicasets" => replace_ns!(K8sReplicaSet, "replicaset"),
        "mwc" | "mutatingwebhookconfiguration" => replace_all!(K8sMWC, "mutatingwebhookconfiguration"),
        "vwc" | "validatingwebhookconfiguration" => replace_all!(K8sVWC, "validatingwebhookconfiguration"),
        "vs" | "volumesnapshot" | "volumesnapshots" => {
            replace_dyn!("snapshot.storage.k8s.io", "v1", "VolumeSnapshot", "volumesnapshots", "volumesnapshot")
        }
        "cert" | "certificate" | "certificates" => {
            replace_dyn!("cert-manager.io", "v1", "Certificate", "certificates", "certificate")
        }
        "flux-ks" | "kustomization" => {
            replace_dyn!("kustomize.toolkit.fluxcd.io", "v1", "Kustomization", "kustomizations", "flux kustomization")
        }
        "flux-hr" | "helmrelease" => {
            replace_dyn!("helm.toolkit.fluxcd.io", "v2", "HelmRelease", "helmreleases", "flux helmrelease")
        }
        "gw" | "gateway" => {
            replace_dyn!("gateway.networking.k8s.io", "v1", "Gateway", "gateways", "gateway")
        }
        "httproute" => {
            replace_dyn!("gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes", "httproute")
        }
        "argo-appsets" | "applicationset" => {
            replace_dyn!("argoproj.io", "v1alpha1", "ApplicationSet", "applicationsets", "argocd applicationset")
        }
        "argo-projects" | "appproject" => {
            replace_dyn!("argoproj.io", "v1alpha1", "AppProject", "appprojects", "argocd appproject")
        }
        "rq" | "resourcequota" => replace_ns!(K8sRQ, "resourcequota"),
        "lr" | "limitrange" => replace_ns!(K8sLR, "limitrange"),
        "pc" | "priorityclass" => replace_all!(K8sPC, "priorityclass"),
        other => Err(ReplaceError::Unsupported(other.to_string())),
    }
}

#[tauri::command]
pub async fn apply_resource_yaml(
    context: String, namespace: String, resource_type: String, name: String, yaml: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        replace_resource_yaml(client, &namespace, &resource_type, &name, &yaml, false, None)
            .await
            .map(|_| ())
            .map_err(|e| e.apply_message())
    }
    .await;
    crate::app_log::log_write(&context, "apply", &resource_type, &namespace, &name,
        serde_yaml::from_str::<serde_json::Value>(&yaml).ok().as_ref(), &result);
    result
}

/// Result of a server-side dry-run of a YAML save. Frozen IPC shape (v1.3.1 §2.6).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YamlSavePreview {
    pub outcome: String, // "ok" | "invalid" | "rejected" | "conflict"
    pub message: String, // "" for ok; "Invalid YAML: {e}"; server ae.message verbatim for rejected/conflict
    pub live: serde_json::Value, // RAW live object; Null on invalid
    pub result: serde_json::Value, // the dry-run replace response; Null unless ok
    pub dropped_paths: Vec<String>, // [] unless ok
}

fn invalid_preview(message: String) -> YamlSavePreview {
    YamlSavePreview {
        outcome: "invalid".to_string(),
        message,
        live: serde_json::Value::Null,
        result: serde_json::Value::Null,
        dropped_paths: Vec::new(),
    }
}

/// True for an absent value: null, `{}` or `[]`. Such a field vanishing in a typed round-trip is
/// not a loss.
fn is_empty_json(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => true,
        serde_json::Value::Object(m) => m.is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        _ => false,
    }
}

fn join_path(parent: &str, key: &str) -> String {
    if parent.is_empty() {
        key.to_string()
    } else {
        format!("{}.{}", parent, key)
    }
}

fn collect_dropped(raw: &serde_json::Value, typed: &serde_json::Value, path: &str, out: &mut Vec<String>) {
    use serde_json::Value;
    match (raw, typed) {
        (Value::Object(r), Value::Object(t)) => {
            for (k, rv) in r {
                // The top-level `status` is never part of a save, so it is not "dropped".
                if path.is_empty() && k == "status" {
                    continue;
                }
                let child = join_path(path, k);
                match t.get(k) {
                    Some(tv) => collect_dropped(rv, tv, &child, out),
                    None if !is_empty_json(rv) => out.push(child),
                    None => {}
                }
            }
        }
        (Value::Array(r), Value::Array(t)) => {
            for (i, rv) in r.iter().enumerate() {
                let child = format!("{}[{}]", path, i);
                match t.get(i) {
                    Some(tv) => collect_dropped(rv, tv, &child, out),
                    None if !is_empty_json(rv) => out.push(child),
                    None => {}
                }
            }
        }
        _ => {}
    }
}

/// The dotted paths (`[i]` for array indices, sorted) present and non-empty in the `raw` live
/// object but absent from its own typed round-trip, i.e. fields the typed `k8s-openapi` struct
/// does not know. Because the editor is seeded from the typed fetch, such a field can never be
/// something the user edited: every dropped path is by construction one they did not touch.
/// Scalars are never compared, so normalisation of a value is not reported.
fn dropped_paths(raw: &serde_json::Value, typed: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_dropped(raw, typed, "", &mut out);
    out.sort();
    out.dedup();
    out
}

/// `(ApiResource, namespaced)` for the raw live GET. Normally from `gvk_for`; the two ArgoCD
/// kinds `gvk_for` deliberately lacks use the same hardcoded version the replace arm uses.
fn live_api_resource(resource_type: &str) -> Result<(ApiResource, bool), String> {
    use super::resource_edit::{api_resource_for, gvk_for};
    if let Ok((group, version, kind, plural, namespaced)) = gvk_for(resource_type) {
        return Ok((api_resource_for(group, version, kind, plural), namespaced));
    }
    match resource_type {
        "argo-appsets" | "applicationset" => {
            Ok((api_resource_for("argoproj.io", "v1alpha1", "ApplicationSet", "applicationsets"), true))
        }
        "argo-projects" | "appproject" => {
            Ok((api_resource_for("argoproj.io", "v1alpha1", "AppProject", "appprojects"), true))
        }
        other => Err(format!("Failed to preview: unsupported resource type '{}'", other)),
    }
}

/// Dry-run a YAML save without writing anything: reads the raw live object, then runs the same
/// replace `apply_resource_yaml` does with `dryRun=All`. API refusals are outcomes
/// (`rejected` / `conflict`), not errors; `Err` is reserved for "preview unavailable" (client
/// construction, a non-API kube error, an unsupported kind).
#[tauri::command]
pub async fn preview_resource_yaml(
    context: String, namespace: String, resource_type: String, name: String, yaml: String,
) -> Result<YamlSavePreview, String> {
    crate::app_log::log_read("preview_resource_yaml", &context);
    // A YAML that does not even parse needs no cluster. Single-document parse only: the
    // multi-document iterator is the serde_yaml hang (see apply_file.rs).
    if let Err(e) = serde_yaml::from_str::<serde_json::Value>(&yaml) {
        return Ok(invalid_preview(format!("Invalid YAML: {}", e)));
    }
    let (ar, namespaced) = live_api_resource(&resource_type)?;
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api: Api<DynamicObject> = if namespaced {
        Api::namespaced_with(client.clone(), &namespace, &ar)
    } else {
        Api::all_with(client.clone(), &ar)
    };
    let live = match api.get(&name).await {
        Ok(obj) => serde_json::to_value(&obj).map_err(|e| format!("Failed to preview: {}", e))?,
        Err(kube::Error::Api(ae)) => {
            return Ok(YamlSavePreview {
                outcome: classify_replace_error(ae.code).to_string(),
                message: ae.message,
                live: serde_json::Value::Null,
                result: serde_json::Value::Null,
                dropped_paths: Vec::new(),
            });
        }
        Err(e) => return Err(format!("Failed to preview: {}", e)),
    };

    match replace_resource_yaml(client, &namespace, &resource_type, &name, &yaml, true, Some(&live)).await {
        Ok(out) => {
            let dropped = out.typed_live.as_ref().map(|t| dropped_paths(&live, t)).unwrap_or_default();
            Ok(YamlSavePreview {
                outcome: "ok".to_string(),
                message: String::new(),
                live,
                result: out.result,
                dropped_paths: dropped,
            })
        }
        Err(ReplaceError::Invalid(e)) => Ok(invalid_preview(format!("Invalid YAML: {}", e))),
        Err(ReplaceError::Kube { source: kube::Error::Api(ae), .. }) => Ok(YamlSavePreview {
            outcome: classify_replace_error(ae.code).to_string(),
            message: ae.message,
            live,
            result: serde_json::Value::Null,
            dropped_paths: Vec::new(),
        }),
        Err(ReplaceError::Kube { source, .. }) => Err(format!("Failed to preview: {}", source)),
        Err(ReplaceError::Unsupported(k)) => Err(format!("Failed to preview: unsupported resource type '{}'", k)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kube::api::PropagationPolicy;
    use serde_json::json;

    // ---- delete_params_for -------------------------------------------------

    #[test]
    fn delete_params_absent_and_background_send_background_explicitly() {
        for p in [None, Some(""), Some("background")] {
            let dp = delete_params_for(p).expect("ok");
            assert!(matches!(dp.propagation_policy, Some(PropagationPolicy::Background)), "{:?}", p);
        }
    }

    #[test]
    fn delete_params_foreground_and_orphan() {
        let fg = delete_params_for(Some("foreground")).expect("ok");
        assert!(matches!(fg.propagation_policy, Some(PropagationPolicy::Foreground)));
        let or = delete_params_for(Some("orphan")).expect("ok");
        assert!(matches!(or.propagation_policy, Some(PropagationPolicy::Orphan)));
    }

    #[test]
    fn delete_params_unknown_policy_is_rejected() {
        let err = delete_params_for(Some("Background")).expect_err("err");
        assert_eq!(err, "Failed to delete: unknown propagation policy 'Background'");
    }

    // ---- stream_log_params / get_log_params --------------------------------

    #[test]
    fn stream_params_default_tail_is_200_and_follows() {
        let p = stream_log_params("c".into(), None, None, None).expect("ok");
        assert_eq!(p.tail_lines, Some(200));
        assert!(p.follow);
        assert!(!p.timestamps);
        assert_eq!(p.since_seconds, None);
        assert_eq!(p.container.as_deref(), Some("c"));
    }

    #[test]
    fn stream_params_tail_is_capped_at_5000() {
        assert_eq!(stream_log_params("c".into(), Some(50), None, None).expect("ok").tail_lines, Some(50));
        assert_eq!(stream_log_params("c".into(), Some(5000), None, None).expect("ok").tail_lines, Some(5000));
        assert_eq!(stream_log_params("c".into(), Some(9_000_000), None, None).expect("ok").tail_lines, Some(5000));
    }

    #[test]
    fn stream_params_reject_non_positive_values() {
        assert_eq!(
            stream_log_params("c".into(), Some(0), None, None).expect_err("err"),
            "Failed to stream logs: tail_lines must be at least 1"
        );
        assert_eq!(
            stream_log_params("c".into(), Some(-3), None, None).expect_err("err"),
            "Failed to stream logs: tail_lines must be at least 1"
        );
        assert_eq!(
            stream_log_params("c".into(), None, Some(0), None).expect_err("err"),
            "Failed to stream logs: since_seconds must be at least 1"
        );
    }

    #[test]
    fn stream_params_pass_since_and_timestamps() {
        let p = stream_log_params("c".into(), Some(10), Some(300), Some(true)).expect("ok");
        assert_eq!(p.since_seconds, Some(300));
        assert!(p.timestamps);
    }

    #[test]
    fn get_params_additions() {
        let p = get_log_params("c".into(), None, Some(true), Some(60), Some(true)).expect("ok");
        assert_eq!(p.tail_lines, None);
        assert!(p.previous);
        assert!(p.timestamps);
        assert!(!p.follow);
        assert_eq!(p.since_seconds, Some(60));
        assert_eq!(
            get_log_params("c".into(), None, None, Some(0), None).expect_err("err"),
            "Failed to get logs: since_seconds must be at least 1"
        );
    }

    // ---- LogStreamEvent wire format ----------------------------------------

    #[test]
    fn log_stream_event_json_is_frozen() {
        assert_eq!(
            serde_json::to_value(LogStreamEvent::Line { line: "hi".into() }).expect("json"),
            json!({"type": "line", "line": "hi"})
        );
        assert_eq!(serde_json::to_value(LogStreamEvent::End).expect("json"), json!({"type": "end"}));
        assert_eq!(
            serde_json::to_value(LogStreamEvent::Error { message: "boom".into() }).expect("json"),
            json!({"type": "error", "message": "boom"})
        );
    }

    // ---- default_container_from --------------------------------------------

    #[test]
    fn default_container_present_absent_empty() {
        use std::collections::BTreeMap;
        let mut m = BTreeMap::new();
        assert_eq!(default_container_from(None), None);
        assert_eq!(default_container_from(Some(&m)), None);
        m.insert("kubectl.kubernetes.io/default-container".to_string(), String::new());
        assert_eq!(default_container_from(Some(&m)), None);
        m.insert("kubectl.kubernetes.io/default-container".to_string(), "app".to_string());
        assert_eq!(default_container_from(Some(&m)), Some("app".to_string()));
    }

    // ---- neat_value ---------------------------------------------------------

    fn full_object() -> serde_json::Value {
        json!({
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {
                "name": "web",
                "uid": "abc",
                "resourceVersion": "42",
                "generation": 3,
                "creationTimestamp": "2026-01-01T00:00:00Z",
                "managedFields": [{"manager": "kubectl"}],
                "annotations": {
                    "kubectl.kubernetes.io/last-applied-configuration": "{}",
                    "keep": "me"
                }
            },
            "spec": {"replicas": 2},
            "status": {"readyReplicas": 2}
        })
    }

    #[test]
    fn neat_removes_closed_list_in_order() {
        let mut v = full_object();
        let hidden = neat_value(&mut v);
        assert_eq!(
            hidden,
            vec![
                "metadata.managedFields",
                "metadata.annotations.kubectl.kubernetes.io/last-applied-configuration",
                "status",
                "metadata.uid",
                "metadata.resourceVersion",
                "metadata.generation",
                "metadata.creationTimestamp",
            ]
        );
        assert_eq!(
            v,
            json!({
                "apiVersion": "apps/v1",
                "kind": "Deployment",
                "metadata": {"name": "web", "annotations": {"keep": "me"}},
                "spec": {"replicas": 2}
            })
        );
    }

    #[test]
    fn neat_drops_annotations_left_empty_without_listing_it() {
        let mut v = json!({
            "metadata": {"name": "x", "annotations": {"kubectl.kubernetes.io/last-applied-configuration": "{}"}}
        });
        let hidden = neat_value(&mut v);
        assert_eq!(hidden, vec!["metadata.annotations.kubectl.kubernetes.io/last-applied-configuration"]);
        assert_eq!(v, json!({"metadata": {"name": "x"}}));
    }

    #[test]
    fn neat_leaves_empty_preexisting_annotations_alone() {
        let mut v = json!({"metadata": {"name": "x", "annotations": {}}});
        assert!(neat_value(&mut v).is_empty());
        assert_eq!(v, json!({"metadata": {"name": "x", "annotations": {}}}));
    }

    #[test]
    fn neat_object_without_listed_paths_is_untouched() {
        let mut v = json!({"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "c"}, "data": {"a": "b"}});
        let before = v.clone();
        assert!(neat_value(&mut v).is_empty());
        assert_eq!(v, before);
    }

    #[test]
    fn neat_never_touches_spec_and_tolerates_non_objects() {
        let mut v = json!({"spec": {"status": {"x": 1}, "metadata": {"uid": "keep"}}});
        let before = v.clone();
        assert!(neat_value(&mut v).is_empty());
        assert_eq!(v, before);
        let mut n = serde_json::Value::Null;
        assert!(neat_value(&mut n).is_empty());
    }

    #[test]
    fn container_usage_split_sums_to_pod_value() {
        let cs = vec![
            json!({"name": "app", "usage": {"cpu": "250000000n", "memory": "128Mi"}}),
            json!({"name": "side", "usage": {"cpu": "50m", "memory": "1024Ki"}}),
        ];
        let u = container_usages(&cs);
        assert_eq!(u.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["app", "side"]);
        assert_eq!(u.iter().map(|c| c.cpu_m).sum::<i64>(), 300);
        assert_eq!(u.iter().map(|c| c.mem_mi).sum::<i64>(), 129);
        assert!(container_usages(&[]).is_empty());
    }

    #[test]
    fn pod_priority_class_passthrough() {
        let p = convert_pod(pod_from(json!({"spec": {"containers": [], "priorityClassName": "high"}})));
        assert_eq!(p.priority_class.as_deref(), Some("high"));
        assert_eq!(convert_pod(pod_from(json!({"spec": {"containers": []}}))).priority_class, None);
    }

    #[test]
    fn pod_service_account_passthrough() {
        let p = convert_pod(pod_from(json!({
            "spec": {"containers": [], "serviceAccountName": "builder"}
        })));
        assert_eq!(p.service_account.as_deref(), Some("builder"));
        let absent = convert_pod(pod_from(json!({"spec": {"containers": []}})));
        assert_eq!(absent.service_account, None);
        let no_spec = convert_pod(pod_from(json!({"metadata": {"name": "p"}})));
        assert_eq!(no_spec.service_account, None);
    }

    #[test]
    fn pod_conditions_keep_api_order_and_map_fields() {
        let p = convert_pod(pod_from(json!({
            "spec": {"containers": []},
            "status": {"conditions": [
                {"type": "PodScheduled", "status": "True",
                 "lastTransitionTime": "2026-10-28T09:00:00Z"},
                {"type": "Ready", "status": "False", "reason": "ContainersNotReady",
                 "message": "containers with unready status: [app]",
                 "lastProbeTime": "2026-10-28T09:05:00Z",
                 "lastTransitionTime": "2026-10-28T09:01:00Z"},
                {"type": "Initialized", "status": "True"}
            ]}
        })));
        let types: Vec<&str> = p.conditions.iter().map(|c| c.type_.as_str()).collect();
        assert_eq!(types, ["PodScheduled", "Ready", "Initialized"]);
        let scheduled = &p.conditions[0];
        assert_eq!(scheduled.status, "True");
        assert_eq!(scheduled.reason, "", "absent reason defaults to an empty string");
        assert_eq!(scheduled.message, "");
        assert!(scheduled.last_transition.starts_with("2026-10-28T09:00:00"));
        let ready = &p.conditions[1];
        assert_eq!(ready.status, "False");
        assert_eq!(ready.reason, "ContainersNotReady");
        assert_eq!(ready.message, "containers with unready status: [app]");
        assert!(ready.last_transition.starts_with("2026-10-28T09:01:00"), "the probe time is not the transition time");
        assert_eq!(p.conditions[2].last_transition, "", "absent transition time defaults to an empty string");
    }

    #[test]
    fn pod_without_status_has_no_conditions() {
        assert!(convert_pod(pod_from(json!({"spec": {"containers": []}}))).conditions.is_empty());
        assert!(convert_pod(pod_from(json!({"status": {"phase": "Pending"}}))).conditions.is_empty());
        assert!(convert_pod(K8sPod::default()).conditions.is_empty());
    }

    // ---- build_ephemeral_containers ------------------------------------------

    fn pod_from(v: serde_json::Value) -> K8sPod {
        serde_json::from_value(v).expect("pod json")
    }

    #[test]
    fn ephemeral_no_spec_gives_empty_list() {
        assert!(build_ephemeral_containers(&pod_from(json!({"metadata": {"name": "p"}}))).is_empty());
        assert!(build_ephemeral_containers(&pod_from(json!({"spec": {"containers": []}}))).is_empty());
        assert!(build_ephemeral_containers(&K8sPod::default()).is_empty());
    }

    #[test]
    fn ephemeral_spec_entry_without_status_is_pending() {
        let pod = pod_from(json!({
            "spec": {"containers": [], "ephemeralContainers": [
                {"name": "debugger-abcde", "image": "busybox:1.36", "targetContainerName": "app"}
            ]}
        }));
        let eph = build_ephemeral_containers(&pod);
        assert_eq!(eph.len(), 1);
        assert_eq!(eph[0].name, "debugger-abcde");
        assert_eq!(eph[0].image, "busybox:1.36");
        assert_eq!(eph[0].target_container.as_deref(), Some("app"));
        assert_eq!(eph[0].state, "pending");
        assert!(eph[0].reason.is_none() && eph[0].message.is_none());
        assert!(eph[0].exit_code.is_none() && eph[0].started_at.is_none());
    }

    #[test]
    fn ephemeral_each_state_kind_and_spec_order() {
        let pod = pod_from(json!({
            "spec": {"containers": [], "ephemeralContainers": [
                {"name": "run", "image": "a"},
                {"name": "wait", "image": "b"},
                {"name": "done", "image": "c"},
                {"name": "nostate", "image": "d"}
            ]},
            "status": {"ephemeralContainerStatuses": [
                {"name": "done", "image": "c", "imageID": "", "ready": false, "restartCount": 0,
                 "state": {"terminated": {"exitCode": 7, "reason": "Error", "message": "boom"}}},
                {"name": "run", "image": "a", "imageID": "", "ready": false, "restartCount": 0,
                 "state": {"running": {"startedAt": "2026-10-04T10:00:00Z"}}},
                {"name": "wait", "image": "b", "imageID": "", "ready": false, "restartCount": 0,
                 "state": {"waiting": {"reason": "ImagePullBackOff", "message": "Back-off pulling image"}}},
                {"name": "nostate", "image": "d", "imageID": "", "ready": false, "restartCount": 0}
            ]}
        }));
        let eph = build_ephemeral_containers(&pod);
        let names: Vec<_> = eph.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["run", "wait", "done", "nostate"], "spec order, not status order");
        assert_eq!(eph[0].state, "running");
        assert!(eph[0].started_at.as_deref().is_some_and(|t| t.starts_with("2026-10-04T10:00:00")));
        assert_eq!(eph[1].state, "waiting");
        assert_eq!(eph[1].reason.as_deref(), Some("ImagePullBackOff"));
        assert_eq!(eph[1].message.as_deref(), Some("Back-off pulling image"));
        assert_eq!(eph[2].state, "terminated");
        assert_eq!(eph[2].exit_code, Some(7));
        assert_eq!(eph[2].reason.as_deref(), Some("Error"));
        assert_eq!(eph[2].message.as_deref(), Some("boom"));
        assert_eq!(eph[3].state, "pending");
    }

    #[test]
    fn convert_pod_carries_ephemeral_containers_apart_from_containers() {
        let pod = pod_from(json!({
            "metadata": {"name": "p", "namespace": "n"},
            "spec": {"containers": [{"name": "app", "image": "x"}],
                     "ephemeralContainers": [{"name": "dbg", "image": "busybox"}]}
        }));
        let converted = convert_pod(pod);
        assert_eq!(converted.containers.len(), 1);
        assert_eq!(converted.containers[0].name, "app");
        assert_eq!(converted.ephemeral_containers.len(), 1);
        assert_eq!(converted.ephemeral_containers[0].name, "dbg");
    }

    // ---- build_debug_container_patch -------------------------------------------

    #[test]
    fn debug_patch_exact_shape_with_target() {
        let p = build_debug_container_patch("debugger-ab12c", "busybox:1.36", Some("app")).expect("ok");
        assert_eq!(
            p,
            json!({"spec": {"ephemeralContainers": [{
                "name": "debugger-ab12c", "image": "busybox:1.36",
                "stdin": true, "tty": true,
                "terminationMessagePolicy": "File",
                "targetContainerName": "app"
            }]}})
        );
    }

    #[test]
    fn debug_patch_target_absent_or_blank_is_omitted() {
        for target in [None, Some(""), Some("   ")] {
            let p = build_debug_container_patch("dbg", "alpine:3.20", target).expect("ok");
            let c = &p["spec"]["ephemeralContainers"][0];
            assert!(c.get("targetContainerName").is_none(), "target {:?}", target);
            assert_eq!(c["stdin"], true);
            assert_eq!(c["tty"], true);
            assert!(c.get("command").is_none(), "never a command");
        }
        let trimmed = build_debug_container_patch("dbg", "alpine:3.20", Some("  app ")).expect("ok");
        assert_eq!(trimmed["spec"]["ephemeralContainers"][0]["targetContainerName"], "app");
    }

    #[test]
    fn debug_patch_rejects_invalid_names() {
        const MSG: &str = "Failed to start debug container: name must be a DNS-1123 label (lowercase letters, digits and '-', at most 63 characters)";
        let too_long = "a".repeat(64);
        for bad in ["Debugger", "-dbg", "dbg-", "", "has space", "under_score", too_long.as_str()] {
            assert_eq!(build_debug_container_patch(bad, "busybox", None).expect_err(bad), MSG, "name {:?}", bad);
        }
        assert!(build_debug_container_patch(&"a".repeat(63), "busybox", None).is_ok());
        assert!(build_debug_container_patch("a", "busybox", None).is_ok());
        assert!(build_debug_container_patch("0-9", "busybox", None).is_ok());
    }

    #[test]
    fn debug_patch_rejects_bad_images() {
        const MSG: &str = "Failed to start debug container: image must not be empty or contain whitespace";
        for bad in ["", "   ", "busybox 1.36", "bus\tybox", " busybox", "busybox\n"] {
            assert_eq!(build_debug_container_patch("dbg", bad, None).expect_err(bad), MSG, "image {:?}", bad);
        }
    }

    // ---- classify_replace_error ------------------------------------------------

    #[test]
    fn replace_error_classification() {
        assert_eq!(classify_replace_error(409), "conflict");
        assert_eq!(classify_replace_error(422), "rejected");
        assert_eq!(classify_replace_error(400), "rejected");
        assert_eq!(classify_replace_error(403), "rejected");
    }

    // ---- dropped_paths -----------------------------------------------------------

    #[test]
    fn dropped_ignores_empty_map_null_and_empty_array() {
        let raw = json!({"metadata": {"name": "x"}, "spec": {"selector": {}, "tolerations": [], "note": null}});
        let typed = json!({"metadata": {"name": "x"}, "spec": {}});
        assert!(dropped_paths(&raw, &typed).is_empty());
    }

    #[test]
    fn dropped_reports_unknown_nested_key_in_container() {
        let raw = json!({"spec": {"containers": [
            {"name": "a", "image": "x"},
            {"name": "b", "image": "y", "futureField": {"on": true}}
        ]}});
        let typed = json!({"spec": {"containers": [
            {"name": "a", "image": "x"},
            {"name": "b", "image": "y"}
        ]}});
        assert_eq!(dropped_paths(&raw, &typed), vec!["spec.containers[1].futureField".to_string()]);
        // A key dropped from the first element is reported with that element's index.
        let raw0 = json!({"spec": {"containers": [{"name": "a", "extra": 1}]}});
        let typed0 = json!({"spec": {"containers": [{"name": "a"}]}});
        assert_eq!(dropped_paths(&raw0, &typed0), vec!["spec.containers[0].extra".to_string()]);
    }

    #[test]
    fn dropped_skips_top_level_status_only() {
        let raw = json!({"status": {"phase": "Running"}, "spec": {"status": {"x": 1}}});
        let typed = json!({"spec": {}});
        assert_eq!(dropped_paths(&raw, &typed), vec!["spec.status".to_string()]);
    }

    #[test]
    fn dropped_is_sorted_and_ignores_scalar_differences() {
        let raw = json!({"spec": {"b": 1, "a": {"c": 2}, "same": "raw"}});
        let typed = json!({"spec": {"same": "normalised"}});
        assert_eq!(dropped_paths(&raw, &typed), vec!["spec.a".to_string(), "spec.b".to_string()]);
    }

    #[test]
    fn dropped_reports_missing_array_elements() {
        let raw = json!({"spec": {"ports": [{"port": 1}, {"port": 2}]}});
        let typed = json!({"spec": {"ports": [{"port": 1}]}});
        assert_eq!(dropped_paths(&raw, &typed), vec!["spec.ports[1]".to_string()]);
    }

    #[test]
    fn dropped_against_a_real_typed_round_trip() {
        // A field this k8s-openapi struct does not know disappears in the round trip.
        let raw = json!({
            "apiVersion": "v1", "kind": "ConfigMap",
            "metadata": {"name": "c", "labels": {}, "annotations": {}},
            "data": {"a": "b"},
            "someFutureField": {"x": 1}
        });
        let typed = serde_json::to_value(serde_json::from_value::<K8sConfigMap>(raw.clone()).expect("typed")).expect("json");
        assert_eq!(dropped_paths(&raw, &typed), vec!["someFutureField".to_string()]);
    }

    #[test]
    fn preview_wire_shape_is_frozen() {
        let p = invalid_preview("Invalid YAML: boom".to_string());
        assert_eq!(
            serde_json::to_value(&p).expect("json"),
            json!({"outcome": "invalid", "message": "Invalid YAML: boom", "live": null, "result": null, "dropped_paths": []})
        );
    }

    #[test]
    fn live_api_resource_covers_gvk_kinds_and_the_two_argo_kinds() {
        let (ar, namespaced) = live_api_resource("deploy").expect("deploy");
        assert_eq!((ar.kind.as_str(), ar.api_version.as_str(), namespaced), ("Deployment", "apps/v1", true));
        let (ar, namespaced) = live_api_resource("pv").expect("pv");
        assert_eq!((ar.kind.as_str(), namespaced), ("PersistentVolume", false));
        let (ar, _) = live_api_resource("argo-appsets").expect("appsets");
        assert_eq!(ar.api_version, "argoproj.io/v1alpha1");
        assert_eq!(
            live_api_resource("nope").expect_err("unsupported"),
            "Failed to preview: unsupported resource type 'nope'"
        );
    }

    #[test]
    fn replace_error_apply_text_is_unchanged() {
        assert_eq!(ReplaceError::Invalid("bad".into()).apply_message(), "Invalid YAML: bad");
        assert_eq!(
            ReplaceError::Unsupported("zzz".into()).apply_message(),
            "Unsupported resource type: zzz"
        );
    }

    #[test]
    fn render_obj_without_neat_is_plain_serialisation() {
        let obj = full_object();
        let (yaml, hidden) = render_obj(&obj, false).expect("ok");
        assert!(hidden.is_empty());
        assert!(yaml.contains("managedFields"));
        let (neat_yaml, neat_hidden) = render_obj(&obj, true).expect("ok");
        assert!(!neat_yaml.contains("managedFields"));
        assert_eq!(neat_hidden.len(), 7);
    }
}
