use chrono::SecondsFormat;
use k8s_openapi::api::core::v1::{Event as K8sEvent, Node as K8sNode, Pod as K8sPod};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::problems::event_time;
use super::utils::{age_from_timestamp, client_for_context, friendly_auth_error};

// ─── ClusterInfo ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterInfo {
    pub total_nodes: u32,
    pub ready_nodes: u32,
    pub total_pods: u32,
    pub running_pods: u32,
    pub pending_pods: u32,
    pub failed_pods: u32,
    pub terminating_pods: u32,
    pub crash_loop_pods: u32,
    pub version: String,
}

#[tauri::command]
pub async fn get_cluster_info(context: String) -> Result<ClusterInfo, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let nodes_api: Api<K8sNode> = Api::all(client.clone());
    let pods_api: Api<K8sPod> = Api::all(client);

    let lp = ListParams::default();
    let lp2 = ListParams::default();
    let (nodes_res, pods_res) = tokio::join!(
        nodes_api.list(&lp),
        pods_api.list(&lp2),
    );

    let nodes = nodes_res.map_err(|e| format!("Failed to list nodes: {}", e))?;
    let pods = pods_res.map_err(|e| format!("Failed to list pods: {}", e))?;

    let total_nodes = nodes.items.len() as u32;
    let ready_nodes = nodes.items.iter().filter(|n| {
        n.status.as_ref()
            .and_then(|s| s.conditions.as_ref())
            .and_then(|conds| conds.iter().find(|c| c.type_ == "Ready"))
            .map(|c| c.status == "True")
            .unwrap_or(false)
    }).count() as u32;

    let version = nodes.items.first()
        .and_then(|n| n.status.as_ref())
        .and_then(|s| s.node_info.as_ref())
        .map(|i| i.kubelet_version.clone())
        .unwrap_or_default();

    let mut running = 0u32;
    let mut pending = 0u32;
    let mut failed = 0u32;
    let mut terminating = 0u32;
    let mut crash_loop = 0u32;

    for pod in &pods.items {
        let is_terminating = pod.metadata.deletion_timestamp.is_some();
        let phase = pod.status.as_ref().and_then(|s| s.phase.as_deref()).unwrap_or("Unknown");

        if is_terminating {
            terminating += 1;
        } else {
            // Check container waiting reason
            let waiting_reason = pod.status.as_ref()
                .and_then(|s| s.container_statuses.as_ref())
                .and_then(|css| css.iter().find_map(|cs| {
                    cs.state.as_ref()?.waiting.as_ref()?.reason.as_deref()
                }));

            match waiting_reason {
                Some("CrashLoopBackOff") => crash_loop += 1,
                _ => match phase {
                    "Running" => running += 1,
                    "Pending" => pending += 1,
                    "Failed" => failed += 1,
                    "Succeeded" => {}
                    _ => {}
                },
            }
        }
    }

    Ok(ClusterInfo {
        total_nodes,
        ready_nodes,
        total_pods: pods.items.len() as u32,
        running_pods: running,
        pending_pods: pending,
        failed_pods: failed,
        terminating_pods: terminating,
        crash_loop_pods: crash_loop,
        version,
    })
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Event {
    pub name: String,
    pub namespace: String,
    pub type_: String,
    pub reason: String,
    pub message: String,
    pub source: String,
    pub object: String,
    pub count: i32,
    pub age: String,
    pub first_seen: String,
    /// RFC3339 of `lastTimestamp`, else `eventTime`, else "" (v2.2.0 timeline ordering key).
    pub last_timestamp: String,
}

#[tauri::command]
pub async fn list_events(context: String, namespace: String) -> Result<Vec<Event>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sEvent> = if namespace == "all" || namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, &namespace)
    };
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list events: {}", e))?;

    let mut events: Vec<Event> = list.items.into_iter().map(|e| {
        let source = e.source.as_ref()
            .and_then(|s| s.component.as_deref())
            .unwrap_or("—")
            .to_string();
        let object = format!("{}/{}",
            e.involved_object.kind.as_deref().unwrap_or(""),
            e.involved_object.name.as_deref().unwrap_or(""));
        let age = e.last_timestamp.as_ref()
            .map(|t| age_from_timestamp(Some(&t.0)))
            .or_else(|| e.event_time.as_ref().map(|t| age_from_timestamp(Some(&t.0))))
            .unwrap_or_else(|| "—".to_string());
        let first_seen = e.first_timestamp.as_ref()
            .map(|t| age_from_timestamp(Some(&t.0)))
            .unwrap_or_else(|| "—".to_string());
        let last_timestamp = event_last_timestamp(&e);
        Event {
            name: e.metadata.name.unwrap_or_default(),
            namespace: e.metadata.namespace.unwrap_or_default(),
            type_: e.type_.unwrap_or_else(|| "Normal".to_string()),
            reason: e.reason.unwrap_or_default(),
            message: e.message.unwrap_or_default(),
            source,
            object,
            count: e.count.unwrap_or(1),
            age,
            first_seen,
            last_timestamp,
        }
    }).collect();

    // Sort: Warning first, then by most recent
    events.sort_by(|a, b| {
        b.type_.cmp(&a.type_).then(b.name.cmp(&a.name))
    });

    Ok(events)
}

#[tauri::command]
pub async fn get_pod_events(
    context: String, namespace: String, pod_name: String,
) -> Result<Vec<Event>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sEvent> = Api::namespaced(client, &namespace);
    let lp = ListParams::default().fields(&format!(
        "involvedObject.name={},involvedObject.namespace={}",
        pod_name, namespace
    ));
    let list = api.list(&lp).await
        .map_err(|e| format!("Failed to get pod events: {}", e))?;
    Ok(list.items.into_iter().map(|e| {
        let source = e.source.as_ref().and_then(|s| s.component.as_deref()).unwrap_or("—").to_string();
        let object = format!("{}/{}", e.involved_object.kind.as_deref().unwrap_or(""), e.involved_object.name.as_deref().unwrap_or(""));
        let age = e.last_timestamp.as_ref().map(|t| age_from_timestamp(Some(&t.0))).unwrap_or_else(|| "—".to_string());
        let first_seen = e.first_timestamp.as_ref().map(|t| age_from_timestamp(Some(&t.0))).unwrap_or_else(|| "—".to_string());
        let last_timestamp = event_last_timestamp(&e);
        Event {
            name: e.metadata.name.unwrap_or_default(),
            namespace: e.metadata.namespace.unwrap_or_default(),
            type_: e.type_.unwrap_or_else(|| "Normal".to_string()),
            reason: e.reason.unwrap_or_default(),
            message: e.message.unwrap_or_default(),
            source, object,
            count: e.count.unwrap_or(1),
            age, first_seen, last_timestamp,
        }
    }).collect())
}

fn convert_event(e: K8sEvent) -> Event {
    let source = e.source.as_ref().and_then(|s| s.component.as_deref()).unwrap_or("—").to_string();
    let object = format!("{}/{}", e.involved_object.kind.as_deref().unwrap_or(""), e.involved_object.name.as_deref().unwrap_or(""));
    let age = e.last_timestamp.as_ref().map(|t| age_from_timestamp(Some(&t.0))).unwrap_or_else(|| "—".to_string());
    let first_seen = e.first_timestamp.as_ref().map(|t| age_from_timestamp(Some(&t.0))).unwrap_or_else(|| "—".to_string());
    let last_timestamp = event_last_timestamp(&e);
    Event {
        name: e.metadata.name.unwrap_or_default(),
        namespace: e.metadata.namespace.unwrap_or_default(),
        type_: e.type_.unwrap_or_else(|| "Normal".to_string()),
        reason: e.reason.unwrap_or_default(),
        message: e.message.unwrap_or_default(),
        source, object,
        count: e.count.unwrap_or(1),
        age, first_seen, last_timestamp,
    }
}

/// RFC3339 (UTC, seconds): the one event-time rule (`problems::event_time`: last, eventTime, creation), else "".
fn event_last_timestamp(e: &K8sEvent) -> String {
    event_time(e).map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true)).unwrap_or_default()
}

#[tauri::command]
pub async fn get_resource_events(
    context: String, namespace: String, name: String, kind: Option<String>,
) -> Result<Vec<Event>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sEvent> = if namespace == "all" || namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, &namespace)
    };
    let lp = ListParams::default().fields(&events_field_selector(&name, kind.as_deref()));
    let list = api.list(&lp).await
        .map_err(|e| format!("Failed to get resource events: {}", e))?;
    Ok(list.items.into_iter().map(convert_event).collect())
}

/// Field selector for a resource's Events. `kind` is the K8s Kind of the involved object;
/// `None` / blank means "no kind filter" (name only, the pre-v1.2.1 behaviour). Without the kind,
/// a Deployment and a Service sharing a name pollute each other's Events tab.
pub(crate) fn events_field_selector(name: &str, kind: Option<&str>) -> String {
    match kind.map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => format!("involvedObject.name={},involvedObject.kind={}", name, k),
        None => format!("involvedObject.name={}", name),
    }
}

// ─── Cluster access probe ───────────────────────────────────────────────────
// See docs/plan-kubeconfig-and-parity.md §2.1. FROZEN contract with @frontend-engineer —
// field names and `state` string values must not drift.

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ClusterAccess {
    pub state: String,                  // "ok" | "unreachable" | "auth" | "forbidden" | "unknown"
    pub message: String,                // human-readable, already formatted
    pub server_version: Option<String>, // Some only when state == "ok"
    /// v2.1.2: the context's cluster entry has a non-empty proxy-url. Env vars never count (T51-7).
    pub via_proxy: bool,
}

/// Probe whether `context` is currently reachable and usable.
///
/// **Returns `Ok` even for failures — the classified `state` is the payload, not the `Result`
/// variant.** `Err` is reserved for something structurally broken: the context name is not
/// defined in any known kubeconfig at all (default + enabled registered entries). Returning
/// `Err` for an unreachable/forbidden/misauthenticated cluster would render a red error box in
/// the frontend indistinguishable from an app bug — the exact failure this command exists to
/// remove. See classification table in the plan §2.1.
#[tauri::command]
pub async fn check_cluster_access(context: String) -> Result<ClusterAccess, String> {
    // Banner is a display surface: scrub the message on every state, `via_proxy` is set in the classifier.
    let access = classify_cluster_access(&context).await.map(|a| ClusterAccess {
        message: crate::app_log::scrub(&a.message),
        ..a
    });
    if let Ok(a) = &access {
        if a.state != "ok" {
            // The message may echo exec-plugin output; app_log scrubs every line centrally.
            crate::app_log::warn(&format!(
                "cluster access state={} context={} message={}",
                a.state, context, a.message
            ));
        }
    }
    access
}

async fn classify_cluster_access(context: &str) -> Result<ClusterAccess, String> {
    // Structurally broken: the name isn't defined in any enabled kubeconfig at all.
    let merged = super::kubeconfig::load_merged_kubeconfig()
        .map_err(|e| format!("Failed to load kubeconfig: {}", e))?;
    if !merged.contexts.iter().any(|c| c.name == context) {
        return Err(format!("Context '{}' is not defined in any kubeconfig", context));
    }
    let via_proxy = super::context::proxy_url_for_context(&merged, context).is_some();
    probe_cluster_access(context).await.map(|a| ClusterAccess { via_proxy, ..a })
}

async fn probe_cluster_access(context: &str) -> Result<ClusterAccess, String> {
    let client = match client_for_context(context).await {
        Ok(c) => c,
        Err(e) => {
            let msg = e.to_string();
            let message = friendly_auth_error(&msg).unwrap_or(msg);
            return Ok(ClusterAccess {
                state: "auth".to_string(),
                message,
                server_version: None,
                ..Default::default()
            });
        }
    };

    match client.apiserver_version().await {
        Ok(info) => Ok(ClusterAccess {
            state: "ok".to_string(),
            message: format!("Connected to Kubernetes {}", info.git_version),
            server_version: Some(info.git_version),
            ..Default::default()
        }),
        Err(kube::Error::Api(ae)) => {
            let state = match ae.code {
                401 => "auth",
                403 => "forbidden",
                _ => "unknown",
            };
            Ok(ClusterAccess {
                state: state.to_string(),
                message: ae.message,
                server_version: None,
                ..Default::default()
            })
        }
        // The exec-plugin failure this whole hint bank exists for (missing
        // gke-gcloud-auth-plugin / aws-iam-authenticator / kubelogin binary) does NOT surface
        // from `client_for_context()` above — building a `Client` only parses config. kube-rs
        // runs the exec plugin lazily on the first real request, so it lands here as
        // `kube::Error::Auth` (AuthExecStart/AuthExecRun/… in kube-client's auth module), not as
        // an `Api` HTTP error. Route it through `friendly_auth_error` before falling through to
        // the generic classification.
        Err(kube::Error::Auth(auth_err)) => {
            let msg = auth_err.to_string();
            let message = friendly_auth_error(&msg).unwrap_or(msg);
            Ok(ClusterAccess {
                state: "auth".to_string(),
                message,
                server_version: None,
                ..Default::default()
            })
        }
        Err(e) => {
            let msg = e.to_string();
            // Defense in depth: some non-`Auth` transport error still names a known auth
            // plugin (belt-and-suspenders alongside the explicit `Auth` arm above).
            if let Some(hint) = friendly_auth_error(&msg) {
                return Ok(ClusterAccess {
                    state: "auth".to_string(),
                    message: hint,
                    server_version: None,
                    ..Default::default()
                });
            }
            let lower = msg.to_lowercase();
            let unreachable = lower.contains("connect")
                || lower.contains("dns")
                || lower.contains("tls")
                || lower.contains("certificate")
                || lower.contains("timed out")
                || lower.contains("timeout")
                || lower.contains("refused")
                || lower.contains("unreachable")
                || lower.contains("no route to host");
            Ok(ClusterAccess {
                state: if unreachable { "unreachable" } else { "unknown" }.to_string(),
                message: msg,
                server_version: None,
                ..Default::default()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{event_last_timestamp, events_field_selector};
    use k8s_openapi::api::core::v1::Event as K8sEvent;

    #[test]
    fn last_timestamp_falls_back_last_then_event_time_then_creation_then_empty() {
        let ev = |v: serde_json::Value| -> K8sEvent { serde_json::from_value(v).expect("fixture") };
        let full = ev(serde_json::json!({"metadata": {"name": "e", "creationTimestamp": "2026-03-01T00:00:00Z"}, "involvedObject": {}, "lastTimestamp": "2026-01-02T03:04:05Z", "eventTime": "2026-02-03T04:05:06.000000Z"}));
        assert_eq!(event_last_timestamp(&full), "2026-01-02T03:04:05Z");
        let et = ev(serde_json::json!({"metadata": {"name": "e", "creationTimestamp": "2026-03-01T00:00:00Z"}, "involvedObject": {}, "eventTime": "2026-02-03T04:05:06.000000Z"}));
        assert_eq!(event_last_timestamp(&et), "2026-02-03T04:05:06Z");
        let created = ev(serde_json::json!({"metadata": {"name": "e", "creationTimestamp": "2026-03-01T00:00:00Z"}, "involvedObject": {}}));
        assert_eq!(event_last_timestamp(&created), "2026-03-01T00:00:00Z");
        let none = ev(serde_json::json!({"metadata": {"name": "e"}, "involvedObject": {}}));
        assert_eq!(event_last_timestamp(&none), "");
    }

    #[test]
    fn selector_without_kind_is_name_only() {
        assert_eq!(events_field_selector("web", None), "involvedObject.name=web");
        assert_eq!(events_field_selector("web", Some("")), "involvedObject.name=web");
        assert_eq!(events_field_selector("web", Some("  ")), "involvedObject.name=web");
    }

    #[test]
    fn selector_with_kind_adds_kind_clause() {
        assert_eq!(
            events_field_selector("web", Some("Deployment")),
            "involvedObject.name=web,involvedObject.kind=Deployment"
        );
    }
}
