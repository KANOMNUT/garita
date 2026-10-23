use k8s_openapi::api::core::v1::{Pod as K8sPod, Service as K8sService};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortForwardEntry {
    pub id: String,
    pub target_type: String,
    pub namespace: String,
    pub name: String,
    pub pod_port: u16,
    pub local_port: u16,
}

pub struct PortForwardState {
    pub entries: Arc<Mutex<HashMap<String, PortForwardEntry>>>,
    pub handles: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>,
}

impl Default for PortForwardState {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

async fn run_pod_forwarder(
    context: String,
    namespace: String,
    pod: String,
    pod_port: u16,
    local_port: u16,
) -> Result<tokio::task::AbortHandle, String> {
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", local_port)).await
        .map_err(|e| format!("Cannot bind port {}: {}", local_port, e))?;

    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut tcp_conn, _)) = listener.accept().await else { break; };
            let ctx = context.clone();
            let ns = namespace.clone();
            let pod_name = pod.clone();
            tokio::spawn(async move {
                let Ok(client) = client_for_context(&ctx).await else { return; };
                let api: Api<K8sPod> = Api::namespaced(client, &ns);
                let Ok(mut pf) = api.portforward(&pod_name, &[pod_port]).await else { return; };
                let Some(mut stream) = pf.take_stream(pod_port) else { return; };
                let (mut s_read, mut s_write) = tokio::io::split(&mut stream);
                let (mut t_read, mut t_write) = tcp_conn.split();
                let _ = tokio::join!(
                    tokio::io::copy(&mut t_read, &mut s_write),
                    tokio::io::copy(&mut s_read, &mut t_write),
                );
                let _ = pf.join().await;
            });
        }
    })
    .abort_handle();

    Ok(handle)
}

#[tauri::command]
pub async fn start_pod_port_forward(
    state: State<'_, PortForwardState>,
    context: String,
    namespace: String,
    pod: String,
    pod_port: u16,
    local_port: u16,
) -> Result<String, String> {
    let id = format!("pod/{}/{}/{}->{}", namespace, pod, pod_port, local_port);

    // Stop existing forward with same id if any
    if let Some(h) = state.handles.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        h.abort();
    }

    let started = run_pod_forwarder(context.clone(), namespace.clone(), pod.clone(), pod_port, local_port).await;
    crate::app_log::log_write(&context, "port-forward-start", "pod", &namespace, &pod, None, &started);
    let handle = started?;

    let entry = PortForwardEntry {
        id: id.clone(),
        target_type: "pod".to_string(),
        namespace,
        name: pod,
        pod_port,
        local_port,
    };

    state.entries.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), entry);
    state.handles.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub async fn start_service_port_forward(
    state: State<'_, PortForwardState>,
    context: String,
    namespace: String,
    service: String,
    service_port: u16,
    local_port: u16,
) -> Result<String, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    // Get service selector
    let svc_api: Api<K8sService> = Api::namespaced(client.clone(), &namespace);
    let svc = svc_api.get(&service).await
        .map_err(|e| format!("Service not found: {}", e))?;

    let selector = svc.spec.as_ref()
        .and_then(|s| s.selector.as_ref())
        .cloned()
        .unwrap_or_default();

    if selector.is_empty() {
        return Err("Service has no selector (headless or external)".to_string());
    }

    // Find target port
    let target_port = svc.spec.as_ref()
        .and_then(|s| s.ports.as_ref())
        .and_then(|ports| {
            ports.iter().find(|p| p.port == service_port as i32)
                .and_then(|p| p.target_port.as_ref())
                .and_then(|tp| match tp {
                    k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::Int(n) => Some(*n as u16),
                    k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::String(_) => Some(service_port),
                })
        })
        .unwrap_or(service_port);

    // List pods matching selector
    let label_sel = selector.iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join(",");
    let pod_api: Api<K8sPod> = Api::namespaced(client, &namespace);
    let pods = pod_api.list(&ListParams::default().labels(&label_sel)).await
        .map_err(|e| format!("Failed to list pods: {}", e))?;

    let pod = pods.items.iter()
        .find(|p| {
            p.status.as_ref()
                .and_then(|s| s.phase.as_deref())
                .map(|ph| ph == "Running")
                .unwrap_or(false)
        })
        .and_then(|p| p.metadata.name.clone())
        .ok_or_else(|| "No running pods found for this service".to_string())?;

    let id = format!("svc/{}/{}/{}->{}", namespace, service, service_port, local_port);

    if let Some(h) = state.handles.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        h.abort();
    }

    let started = run_pod_forwarder(context.clone(), namespace.clone(), pod.clone(), target_port, local_port).await;
    crate::app_log::log_write(&context, "port-forward-start", "service", &namespace, &service, None, &started);
    let handle = started?;

    let entry = PortForwardEntry {
        id: id.clone(),
        target_type: "service".to_string(),
        namespace,
        name: service,
        pod_port: target_port,
        local_port,
    };

    state.entries.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), entry);
    state.handles.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub async fn stop_port_forward(
    state: State<'_, PortForwardState>,
    forward_id: String,
) -> Result<(), String> {
    if let Some(h) = state.handles.lock().unwrap_or_else(|e| e.into_inner()).remove(&forward_id) {
        h.abort();
    }
    state.entries.lock().unwrap_or_else(|e| e.into_inner()).remove(&forward_id);
    crate::app_log::log_write("", "port-forward-stop", "portforward", "", &forward_id, None, &Ok::<(), String>(()));
    Ok(())
}

#[tauri::command]
pub async fn list_port_forwards(
    state: State<'_, PortForwardState>,
) -> Result<Vec<PortForwardEntry>, String> {
    let entries = state.entries.lock().unwrap_or_else(|e| e.into_inner()).values().cloned().collect();
    Ok(entries)
}
