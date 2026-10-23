use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet},
    batch::v1::{CronJob, Job},
    core::v1::Pod,
};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GraphNode {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub uid: String,
    pub status: String,
    pub children: Vec<GraphNode>,
}

fn pod_status(pod: &Pod) -> String {
    pod.status
        .as_ref()
        .and_then(|s| s.phase.as_deref())
        .unwrap_or("Unknown")
        .to_string()
}

#[tauri::command]
pub async fn get_resource_graph(
    context: String,
    namespace: String,
    kind: String,
    name: String,
) -> Result<Vec<GraphNode>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let lp = ListParams::default();

    match kind.as_str() {
        "deploy" => {
            let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), &namespace);
            let deploy = deploy_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get deployment: {}", e))?;
            let deploy_uid = deploy
                .metadata
                .uid
                .as_deref()
                .unwrap_or("")
                .to_string();

            let rs_api: Api<ReplicaSet> = Api::namespaced(client.clone(), &namespace);
            let rs_list = rs_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list replicasets: {}", e))?;

            let pod_api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            let pod_list = pod_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list pods: {}", e))?;

            let rs_nodes: Vec<GraphNode> = rs_list
                .items
                .into_iter()
                .filter(|rs| {
                    rs.metadata
                        .owner_references
                        .as_ref()
                        .map(|refs| refs.iter().any(|r| r.uid == deploy_uid))
                        .unwrap_or(false)
                })
                .map(|rs| {
                    let rs_uid = rs.metadata.uid.as_deref().unwrap_or("").to_string();
                    let rs_name = rs.metadata.name.clone().unwrap_or_default();
                    let desired = rs.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
                    let ready = rs
                        .status
                        .as_ref()
                        .and_then(|s| s.ready_replicas)
                        .unwrap_or(0);
                    let rs_status = if desired == 0 {
                        "Scaled Down"
                    } else if ready >= desired {
                        "Ready"
                    } else {
                        "Not Ready"
                    };
                    let pod_children: Vec<GraphNode> = pod_list
                        .items
                        .iter()
                        .filter(|p| {
                            p.metadata
                                .owner_references
                                .as_ref()
                                .map(|refs| refs.iter().any(|r| r.uid == rs_uid))
                                .unwrap_or(false)
                        })
                        .map(|p| GraphNode {
                            kind: "Pod".to_string(),
                            name: p.metadata.name.clone().unwrap_or_default(),
                            namespace: p.metadata.namespace.clone().unwrap_or_default(),
                            uid: p.metadata.uid.clone().unwrap_or_default(),
                            status: pod_status(p),
                            children: vec![],
                        })
                        .collect();
                    GraphNode {
                        kind: "ReplicaSet".to_string(),
                        name: rs_name,
                        namespace: rs.metadata.namespace.clone().unwrap_or_default(),
                        uid: rs_uid,
                        status: rs_status.to_string(),
                        children: pod_children,
                    }
                })
                .collect();

            Ok(rs_nodes)
        }
        "sts" => {
            let sts_api: Api<StatefulSet> = Api::namespaced(client.clone(), &namespace);
            let sts = sts_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get statefulset: {}", e))?;
            let sts_uid = sts.metadata.uid.as_deref().unwrap_or("").to_string();

            let pod_api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            let pod_list = pod_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list pods: {}", e))?;

            let pods: Vec<GraphNode> = pod_list
                .items
                .into_iter()
                .filter(|p| {
                    p.metadata
                        .owner_references
                        .as_ref()
                        .map(|refs| refs.iter().any(|r| r.uid == sts_uid))
                        .unwrap_or(false)
                })
                .map(|p| {
                    let status = pod_status(&p);
                    GraphNode {
                        kind: "Pod".to_string(),
                        name: p.metadata.name.unwrap_or_default(),
                        namespace: p.metadata.namespace.unwrap_or_default(),
                        uid: p.metadata.uid.unwrap_or_default(),
                        status,
                        children: vec![],
                    }
                })
                .collect();
            Ok(pods)
        }
        "ds" => {
            let ds_api: Api<DaemonSet> = Api::namespaced(client.clone(), &namespace);
            let ds = ds_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get daemonset: {}", e))?;
            let ds_uid = ds.metadata.uid.as_deref().unwrap_or("").to_string();

            let pod_api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            let pod_list = pod_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list pods: {}", e))?;

            let pods: Vec<GraphNode> = pod_list
                .items
                .into_iter()
                .filter(|p| {
                    p.metadata
                        .owner_references
                        .as_ref()
                        .map(|refs| refs.iter().any(|r| r.uid == ds_uid))
                        .unwrap_or(false)
                })
                .map(|p| {
                    let status = pod_status(&p);
                    GraphNode {
                        kind: "Pod".to_string(),
                        name: p.metadata.name.unwrap_or_default(),
                        namespace: p.metadata.namespace.unwrap_or_default(),
                        uid: p.metadata.uid.unwrap_or_default(),
                        status,
                        children: vec![],
                    }
                })
                .collect();
            Ok(pods)
        }
        "jobs" => {
            let job_api: Api<Job> = Api::namespaced(client.clone(), &namespace);
            let job = job_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get job: {}", e))?;
            let job_uid = job.metadata.uid.as_deref().unwrap_or("").to_string();

            let pod_api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            let pod_list = pod_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list pods: {}", e))?;

            let pods: Vec<GraphNode> = pod_list
                .items
                .into_iter()
                .filter(|p| {
                    p.metadata
                        .owner_references
                        .as_ref()
                        .map(|refs| refs.iter().any(|r| r.uid == job_uid))
                        .unwrap_or(false)
                })
                .map(|p| {
                    let status = pod_status(&p);
                    GraphNode {
                        kind: "Pod".to_string(),
                        name: p.metadata.name.unwrap_or_default(),
                        namespace: p.metadata.namespace.unwrap_or_default(),
                        uid: p.metadata.uid.unwrap_or_default(),
                        status,
                        children: vec![],
                    }
                })
                .collect();
            Ok(pods)
        }
        "cron" => {
            let cj_api: Api<CronJob> = Api::namespaced(client.clone(), &namespace);
            let cj = cj_api
                .get(&name)
                .await
                .map_err(|e| format!("Failed to get cronjob: {}", e))?;
            let cj_uid = cj.metadata.uid.as_deref().unwrap_or("").to_string();

            let job_api: Api<Job> = Api::namespaced(client.clone(), &namespace);
            let job_list = job_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list jobs: {}", e))?;

            let pod_api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            let pod_list = pod_api
                .list(&lp)
                .await
                .map_err(|e| format!("Failed to list pods: {}", e))?;

            let job_nodes: Vec<GraphNode> = job_list
                .items
                .into_iter()
                .filter(|j| {
                    j.metadata
                        .owner_references
                        .as_ref()
                        .map(|refs| refs.iter().any(|r| r.uid == cj_uid))
                        .unwrap_or(false)
                })
                .map(|j| {
                    let j_uid = j.metadata.uid.as_deref().unwrap_or("").to_string();
                    let j_name = j.metadata.name.clone().unwrap_or_default();
                    let complete = j
                        .status
                        .as_ref()
                        .and_then(|s| s.conditions.as_ref())
                        .and_then(|c| c.iter().find(|c| c.type_ == "Complete"))
                        .map(|c| c.status == "True")
                        .unwrap_or(false);
                    let failed = j
                        .status
                        .as_ref()
                        .and_then(|s| s.conditions.as_ref())
                        .and_then(|c| c.iter().find(|c| c.type_ == "Failed"))
                        .map(|c| c.status == "True")
                        .unwrap_or(false);
                    let j_status = if complete {
                        "Complete"
                    } else if failed {
                        "Failed"
                    } else {
                        "Running"
                    };
                    let pod_children: Vec<GraphNode> = pod_list
                        .items
                        .iter()
                        .filter(|p| {
                            p.metadata
                                .owner_references
                                .as_ref()
                                .map(|refs| refs.iter().any(|r| r.uid == j_uid))
                                .unwrap_or(false)
                        })
                        .map(|p| GraphNode {
                            kind: "Pod".to_string(),
                            name: p.metadata.name.clone().unwrap_or_default(),
                            namespace: p.metadata.namespace.clone().unwrap_or_default(),
                            uid: p.metadata.uid.clone().unwrap_or_default(),
                            status: pod_status(p),
                            children: vec![],
                        })
                        .collect();
                    GraphNode {
                        kind: "Job".to_string(),
                        name: j_name,
                        namespace: j.metadata.namespace.clone().unwrap_or_default(),
                        uid: j_uid,
                        status: j_status.to_string(),
                        children: pod_children,
                    }
                })
                .collect();
            Ok(job_nodes)
        }
        _ => Err(format!("Unsupported kind for relationship graph: {}", kind)),
    }
}
