use kube::{
    api::{ApiResource, DeleteParams, DynamicObject, ListParams, Patch, PatchParams},
    discovery, error::DiscoveryError, Api, Error as KubeError,
};
use serde_json::json;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use super::utils::{age_from_timestamp, client_for_context, kind_to_plural, PRODUCT_NAME};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdCommitInfo {
    pub message: String,
    pub author: String,
}

fn extract_commit_info(status: &serde_json::Value) -> Option<ArgoCdCommitInfo> {
    let msg_from = |node: &serde_json::Value| -> Option<String> {
        node["message"].as_str()
            .and_then(|s| s.lines().next())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };
    let author_from = |node: &serde_json::Value| -> Option<String> {
        node["author"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
    };

    let op = &status["operationState"]["syncResult"]["revisionMetadata"];
    let sy = &status["sync"]["revisionMetadata"];

    let message = msg_from(op)
        .or_else(|| msg_from(sy))
        .or_else(|| {
            status["history"].as_array()?.iter().rev()
                .find_map(|e| msg_from(&e["revisionMetadata"]))
        })?;

    let author = author_from(op)
        .or_else(|| author_from(sy))
        .or_else(|| {
            status["history"].as_array()?.iter().rev()
                .find_map(|e| author_from(&e["revisionMetadata"]))
        })
        .unwrap_or_default();

    Some(ArgoCdCommitInfo { message, author })
}

/// Fetch commit metadata directly from the ArgoCD REST API.
///
/// Strategy:
/// 1. Resolve the current revision from the Application CRD, then port-forward
///    to an argocd-server pod (port 8080, plain HTTP) and call
///    `/api/v1/applications/{name}/revisions/{rev}/metadata`.
///    - First attempt is unauthenticated (works when anonymous access is enabled).
///    - If that returns an error, read the admin password from
///      `argocd-initial-admin-secret`, login via `/api/v1/session`, and retry
///      with the returned JWT Bearer token.
/// 2. K8s API-server proxy → `/revisions/{rev}/metadata` (TLS handled by
///    apiserver). Tries anonymous first, then authenticates with
///    `argocd-initial-admin-secret` and retries with the JWT.
///    Note: some clusters strip the `Authorization` header in the proxy path;
///    on those clusters the anonymous attempt falls through silently to Strategy 3.
/// 3. K8s API-server proxy — full Application object (anonymous, last resort).
///    Falls back to `extract_commit_info` over the embedded revisionMetadata
///    fields in the CRD status.
#[tauri::command]
pub async fn get_argocd_commit_info(
    context: String,
    app_namespace: String,
    name: String,
) -> Result<ArgoCdCommitInfo, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("connect: {}", e))?;

    // Resolve current revision from the Application CRD.
    let ns_candidates: Vec<String> = {
        let mut v = vec!["argocd".to_string()];
        if !app_namespace.is_empty() && app_namespace != "argocd" {
            v.push(app_namespace.clone());
        }
        v
    };

    let revision = resolve_app_revision(&client, &ns_candidates, &name).await;

    // Strategy 1: portforward to argocd-server pod (supports ArgoCD auth).
    if let Some(rev) = &revision {
        for ns in &ns_candidates {
            if let Some(info) = argocd_commit_via_pf(&client, ns, &name, rev).await {
                return Ok(info);
            }
        }
    }

    // Strategy 2: K8s API proxy → /revisions/{rev}/metadata (proxy handles TLS automatically).
    // Anonymous first; if that fails, login with argocd-initial-admin-secret and retry.
    if let Some(rev) = &revision {
        for ns in &ns_candidates {
            for (scheme, port) in [("https", "443"), ("http", "80")] {
                let proxy_base = format!(
                    "/api/v1/namespaces/{ns}/services/{scheme}:argocd-server:{port}/proxy"
                );
                let meta_path = format!("{proxy_base}/api/v1/applications/{name}/revisions/{rev}/metadata");

                if let Some(info) = proxy_revision_metadata(&client, &meta_path, None).await {
                    return Ok(info);
                }
                if let Some(token) = proxy_argocd_login(&client, &proxy_base, ns).await {
                    if let Some(info) = proxy_revision_metadata(&client, &meta_path, Some(&token)).await {
                        return Ok(info);
                    }
                }
            }
        }
    }

    // Strategy 3: K8s API proxy — full app object (anonymous, last resort).
    for ns in &ns_candidates {
        for (scheme, port) in [("https", "443"), ("http", "80")] {
            let path = format!(
                "/api/v1/namespaces/{ns}/services/{scheme}:argocd-server:{port}/proxy/api/v1/applications/{name}"
            );
            let body: Vec<u8> = vec![];
            let Ok(req) = http::Request::get(path.as_str())
                .header("Accept", "application/json")
                .body(body) else { continue };
            let Ok(v) = client.request::<serde_json::Value>(req).await else { continue };
            if let Some(info) = extract_commit_info(&v["status"]) {
                return Ok(info);
            }
        }
    }

    Err("commit metadata not available via ArgoCD API".to_string())
}

/// Discovers the `ApiResource` for a given `argoproj.io` kind at whatever
/// version the cluster actually serves — never hardcode a version, since it
/// varies by ArgoCD release and installation method (and can't be verified
/// against an unauthenticated local cluster anyway).
///
/// Returns `Ok(None)` when the `argoproj.io` group isn't registered at all
/// (ArgoCD isn't installed) so callers can gracefully return an empty result
/// instead of erroring. Any other discovery failure — e.g. RBAC denying
/// `list_api_groups` — is propagated as a real error instead of being
/// silently swallowed.
async fn argo_api_resource(
    client: &kube::Client,
    kind: &str,
    plural: &str,
) -> Result<Option<ApiResource>, String> {
    let group = match discovery::group(client, "argoproj.io").await {
        Ok(g) => g,
        Err(KubeError::Discovery(DiscoveryError::MissingApiGroup(_))) => return Ok(None),
        Err(e) => return Err(format!("Failed to discover argoproj.io API group: {}", e)),
    };

    if let Some((ar, _caps)) = group.recommended_kind(kind) {
        return Ok(Some(ar));
    }

    // Group is served but this kind wasn't found under its recommended
    // version (unusual). Fall back to a manually built ApiResource at the
    // group's preferred version so callers keep working.
    let version = group.preferred_version_or_latest().to_string();
    Ok(Some(ApiResource {
        group: "argoproj.io".to_string(),
        api_version: format!("argoproj.io/{}", version),
        version,
        kind: kind.to_string(),
        plural: plural.to_string(),
    }))
}

// ─── portforward-based ArgoCD API helpers ────────────────────────────────────

async fn resolve_app_revision(
    client: &kube::Client,
    ns_candidates: &[String],
    name: &str,
) -> Option<String> {
    let ar = argo_api_resource(client, "Application", "applications").await.ok()??;
    for ns in ns_candidates {
        let api: Api<DynamicObject> = Api::namespaced_with(client.clone(), ns, &ar);
        if let Ok(app) = api.get(name).await {
            let s = &app.data["status"];
            let rev = s["operationState"]["syncResult"]["revision"].as_str()
                .or_else(|| s["sync"]["revision"].as_str())
                .unwrap_or("")
                .to_string();
            if !rev.is_empty() {
                return Some(rev);
            }
        }
    }
    None
}

async fn argocd_commit_via_pf(
    client: &kube::Client,
    argocd_ns: &str,
    app_name: &str,
    revision: &str,
) -> Option<ArgoCdCommitInfo> {
    use k8s_openapi::api::core::v1::{Pod, Secret};

    let pod_api: Api<Pod> = Api::namespaced(client.clone(), argocd_ns);
    let pod_name = find_argocd_server_pod(&pod_api).await?;
    let meta_path = format!("/api/v1/applications/{}/revisions/{}/metadata", app_name, revision);

    // Try without auth first (anonymous access enabled clusters).
    if let Some(v) = argocd_pf_request(&pod_api, &pod_name, "GET", &meta_path, None, None).await {
        if let Some(info) = parse_revision_metadata(&v) {
            return Some(info);
        }
    }

    // Authenticate with admin credentials from argocd-initial-admin-secret.
    let secret_api: Api<Secret> = Api::namespaced(client.clone(), argocd_ns);
    let mut password = secret_api.get("argocd-initial-admin-secret").await.ok()
        .and_then(|s| s.data)
        .and_then(|mut d| d.remove("password"))
        .and_then(|b| String::from_utf8(b.0).ok())
        .map(|s| s.trim().to_string())?;

    let login_body = format!(
        r#"{{"username":"admin","password":"{}"}}"#,
        password.replace('"', r#"\""#)
    );
    let jwt_resp = argocd_pf_request(
        &pod_api, &pod_name, "POST", "/api/v1/session",
        Some(&login_body), None,
    ).await;
    // Zero password from memory immediately after the login request completes.
    password.zeroize();
    let jwt_resp = jwt_resp?;
    let token = jwt_resp["token"].as_str()?.to_string();

    let meta = argocd_pf_request(
        &pod_api, &pod_name, "GET", &meta_path,
        None, Some(&token),
    ).await?;
    parse_revision_metadata(&meta)
}

async fn find_argocd_server_pod(
    pod_api: &Api<k8s_openapi::api::core::v1::Pod>,
) -> Option<String> {
    for selector in &["app.kubernetes.io/name=argocd-server", "app=argocd-server"] {
        let lp = ListParams::default().labels(selector);
        if let Ok(pods) = pod_api.list(&lp).await {
            if let Some(pod) = pods.items.into_iter().find(|p| {
                p.status.as_ref()
                    .and_then(|s| s.phase.as_deref())
                    .map(|ph| ph == "Running")
                    .unwrap_or(false)
            }) {
                return pod.metadata.name;
            }
        }
    }
    None
}

/// Compute the ArgoCD-compatible health status of a Kubernetes resource directly.
/// Used when `resourceHealthSource: appTree` so health is not stored in the Application CRD.
/// Returns empty string for resource types that have no health semantics (ConfigMap, Service…).
async fn k8s_resource_health(
    client: &kube::Client,
    group: &str,
    version: &str,
    kind: &str,
    namespace: &str,
    name: &str,
) -> String {
    // Types that need a K8s fetch to compute meaningful runtime health.
    // Anything not in this list (ConfigMap, Secret, ServiceAccount, RBAC, NetworkPolicy,
    // PodDisruptionBudget, CRDs…) has no K8s runtime status — if ArgoCD reports it Synced
    // the resource exists, and Sync == OutOfSync / Missing is the channel that signals
    // drift or deletion for those types.
    let needs_fetch = matches!(
        (group, kind),
        ("apps", "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet")
        | ("autoscaling", "HorizontalPodAutoscaler")
        | ("networking.k8s.io", "Ingress")
        | ("batch", "Job")
        | ("", "Pod" | "PersistentVolumeClaim" | "Service")
    );
    if !needs_fetch {
        return "Healthy".to_string();
    }

    let ver = if version.is_empty() { "v1" } else { version };
    let api_version = if group.is_empty() {
        ver.to_string()
    } else {
        format!("{}/{}", group, ver)
    };
    let ar = ApiResource {
        group: group.to_string(),
        version: ver.to_string(),
        api_version,
        kind: kind.to_string(),
        plural: kind_to_plural(kind),
    };
    let api: Api<DynamicObject> = Api::namespaced_with(client.clone(), namespace, &ar);
    let Ok(obj) = api.get(name).await else { return "Missing".to_string() };
    let spec   = &obj.data["spec"];
    let status = &obj.data["status"];

    let conditions_has = |type_: &str, val: &str| -> bool {
        status["conditions"].as_array()
            .and_then(|cs| cs.iter().find(|c| c["type"].as_str() == Some(type_)))
            .and_then(|c| c["status"].as_str())
            .map(|s| s == val)
            .unwrap_or(false)
    };

    match (group, kind) {
        ("apps", "Deployment") => {
            // Desired comes from spec (the source of truth), not status.
            let desired   = spec["replicas"].as_i64().unwrap_or(1);
            let available = status["availableReplicas"].as_i64().unwrap_or(0);
            if desired == 0 { return "Suspended".to_string(); }
            if conditions_has("Available", "True") && available >= desired {
                "Healthy".to_string()
            } else if conditions_has("Progressing", "True") {
                "Progressing".to_string()
            } else {
                "Degraded".to_string()
            }
        }
        ("apps", "StatefulSet") => {
            let desired = spec["replicas"].as_i64().unwrap_or(1);
            let ready   = status["readyReplicas"].as_i64().unwrap_or(0);
            if desired == 0 { "Suspended".to_string() }
            else if ready >= desired { "Healthy".to_string() }
            else { "Progressing".to_string() }
        }
        ("apps", "DaemonSet") => {
            let desired = status["desiredNumberScheduled"].as_i64().unwrap_or(0);
            let ready   = status["numberReady"].as_i64().unwrap_or(0);
            let misscheduled = status["numberMisscheduled"].as_i64().unwrap_or(0);
            if misscheduled > 0 { "Degraded".to_string() }
            else if desired == 0 || ready >= desired { "Healthy".to_string() }
            else { "Progressing".to_string() }
        }
        ("apps", "ReplicaSet") => {
            let desired = spec["replicas"].as_i64().unwrap_or(1);
            let ready   = status["readyReplicas"].as_i64().unwrap_or(0);
            if desired == 0 || ready >= desired { "Healthy".to_string() }
            else { "Progressing".to_string() }
        }
        ("networking.k8s.io", "Ingress") => {
            // LoadBalancer Ingresses populate status.loadBalancer.ingress when ready.
            // Non-LoadBalancer Ingresses (e.g. ingressClass-only) may legitimately have
            // empty status — treat empty as Progressing so the user can still spot a
            // truly stuck Ingress instead of seeing a false Healthy.
            let has_lb = status["loadBalancer"]["ingress"].as_array()
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            if has_lb { "Healthy".to_string() } else { "Progressing".to_string() }
        }
        ("autoscaling", "HorizontalPodAutoscaler") => {
            // AbleToScale=False → Degraded (controller can't scale)
            // ScalingActive=False → Degraded (metrics unavailable, scaling broken)
            // ScalingActive=True → Healthy
            let able_to_scale_ok    = conditions_has("AbleToScale", "True");
            let scaling_active_true = conditions_has("ScalingActive", "True");
            if !able_to_scale_ok { "Degraded".to_string() }
            else if scaling_active_true { "Healthy".to_string() }
            else { "Progressing".to_string() }
        }
        ("batch", "Job") => {
            if conditions_has("Complete", "True") { "Healthy".to_string() }
            else if conditions_has("Failed", "True") { "Degraded".to_string() }
            else { "Progressing".to_string() }
        }
        ("", "Pod") => {
            let phase = status["phase"].as_str().unwrap_or("");
            match phase {
                "Succeeded" => "Healthy".to_string(),
                "Running" => {
                    if conditions_has("Ready", "True") { "Healthy".to_string() }
                    else { "Progressing".to_string() }
                }
                "Pending"   => "Progressing".to_string(),
                "Failed"    => "Degraded".to_string(),
                _           => "Unknown".to_string(),
            }
        }
        ("", "PersistentVolumeClaim") => {
            match status["phase"].as_str().unwrap_or("") {
                "Bound"   => "Healthy".to_string(),
                "Pending" => "Progressing".to_string(),
                "Lost"    => "Degraded".to_string(),
                _         => "Unknown".to_string(),
            }
        }
        ("", "Service") => {
            // Only LoadBalancer-typed Services have meaningful runtime status.
            // ClusterIP / NodePort / ExternalName are Healthy by virtue of existing.
            if spec["type"].as_str() == Some("LoadBalancer") {
                let has_lb = status["loadBalancer"]["ingress"].as_array()
                    .map(|a| !a.is_empty())
                    .unwrap_or(false);
                if has_lb { "Healthy".to_string() } else { "Progressing".to_string() }
            } else {
                "Healthy".to_string()
            }
        }
        _ => "Healthy".to_string(),
    }
}

/// Send one HTTP/1.1 request over a kube portforward stream to argocd-server:8080.
/// Uses `Connection: close` so we read until EOF for the response body.
async fn argocd_pf_request(
    pod_api: &Api<k8s_openapi::api::core::v1::Pod>,
    pod_name: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
    bearer: Option<&str>,
) -> Option<serde_json::Value> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut pf = pod_api.portforward(pod_name, &[8080]).await.ok()?;
    let mut stream = pf.take_stream(8080)?;

    let body_bytes = body.unwrap_or("").as_bytes();
    let mut req_str = format!(
        "{} {} HTTP/1.1\r\nHost: argocd-server\r\nAccept: application/json\r\nConnection: close\r\n",
        method, path
    );
    if let Some(t) = bearer {
        req_str.push_str(&format!("Authorization: Bearer {}\r\n", t));
    }
    if !body_bytes.is_empty() {
        req_str.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body_bytes.len()
        ));
    }
    req_str.push_str("\r\n");

    stream.write_all(req_str.as_bytes()).await.ok()?;
    if !body_bytes.is_empty() {
        stream.write_all(body_bytes).await.ok()?;
    }

    // Read until EOF — server closes after `Connection: close` response.
    let mut raw: Vec<u8> = Vec::new();
    let _ = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => raw.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;

    // Find the HTTP header / body boundary and deserialise the JSON body.
    let sep = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    serde_json::from_slice(&raw[sep + 4..]).ok()
}

fn parse_revision_metadata(v: &serde_json::Value) -> Option<ArgoCdCommitInfo> {
    // ArgoCD error envelopes (gRPC-gateway) carry "error" and/or "code" keys.
    // e.g. {"error":"no session information","code":16,"message":"no session information"}
    // Reject them so the caller falls through to the authenticated retry.
    if v.get("error").is_some() || v.get("code").is_some() {
        return None;
    }
    let message = v["message"].as_str()
        .and_then(|s| s.lines().next())
        .filter(|s| !s.is_empty())?;
    Some(ArgoCdCommitInfo {
        message: message.to_string(),
        author: v["author"].as_str().unwrap_or("").to_string(),
    })
}

// ─── K8s API-server proxy helpers (Strategy 2) ───────────────────────────────

async fn proxy_revision_metadata(
    client: &kube::Client,
    path: &str,
    bearer: Option<&str>,
) -> Option<ArgoCdCommitInfo> {
    let body: Vec<u8> = vec![];
    let mut builder = http::Request::get(path).header("Accept", "application/json");
    if let Some(t) = bearer {
        builder = builder.header("Authorization", format!("Bearer {}", t));
    }
    let Ok(req) = builder.body(body) else { return None };
    let Ok(v) = client.request::<serde_json::Value>(req).await else { return None };
    parse_revision_metadata(&v)
}

async fn proxy_argocd_login(
    client: &kube::Client,
    proxy_base: &str,
    argocd_ns: &str,
) -> Option<String> {
    use k8s_openapi::api::core::v1::Secret;
    let secret_api: Api<Secret> = Api::namespaced(client.clone(), argocd_ns);
    let mut password = secret_api.get("argocd-initial-admin-secret").await.ok()
        .and_then(|s| s.data)
        .and_then(|mut d| d.remove("password"))
        .and_then(|b| String::from_utf8(b.0).ok())
        .map(|s| s.trim().to_string())?;

    let login_body = format!(
        r#"{{"username":"admin","password":"{}"}}"#,
        password.replace('"', r#"\""#)
    );
    password.zeroize();

    let login_path = format!("{}/api/v1/session", proxy_base);
    let Ok(req) = http::Request::builder()
        .method("POST")
        .uri(login_path.as_str())
        .header("Content-Type", "application/json")
        .body(login_body.into_bytes()) else { return None };
    let Ok(v) = client.request::<serde_json::Value>(req).await else { return None };
    v["token"].as_str().map(|s| s.to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdResource {
    pub group: String,
    pub version: String,
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub sync_status: String,
    pub health_status: String,
    pub health_message: String,
    pub requires_pruning: bool,
}

#[tauri::command]
pub async fn get_argocd_app_resources(
    context: String,
    namespace: String,
    name: String,
) -> Result<Vec<ArgoCdResource>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = match argo_api_resource(&client, "Application", "applications").await? {
        Some(ar) => ar,
        None => return Err(format!(
            "Failed to get resources for app: {} (ArgoCD not installed on this cluster)", name
        )),
    };

    let mut ns_candidates = vec!["argocd".to_string()];
    if !namespace.is_empty() && namespace != "argocd" {
        ns_candidates.insert(0, namespace.clone());
    }

    for ns in &ns_candidates {
        let api: Api<DynamicObject> = Api::namespaced_with(client.clone(), ns, &ar);
        if let Ok(app) = api.get(&name).await {
            let resources = app.data["status"]["resources"]
                .as_array()
                .cloned()
                .unwrap_or_default();

            let resource_health_source = app.data["status"]["resourceHealthSource"]
                .as_str()
                .unwrap_or("");

            let result: Vec<ArgoCdResource> = if resource_health_source == "appTree" {
                // ArgoCD v2.8+: health not in CRD — derive it directly from each K8s resource.
                let mut out = Vec::with_capacity(resources.len());
                for r in resources {
                    let s = |key: &str| r[key].as_str().unwrap_or("").to_string();
                    let group   = s("group");
                    let version = s("version");
                    let kind    = s("kind");
                    let ns_val  = s("namespace");
                    let name_v  = s("name");
                    let health_status = k8s_resource_health(
                        &client, &group, &version, &kind, &ns_val, &name_v,
                    ).await;
                    let requires_pruning = r["requiresPruning"].as_bool().unwrap_or(false);
                    out.push(ArgoCdResource {
                        group,
                        version,
                        kind,
                        namespace: ns_val,
                        name: name_v,
                        sync_status: s("status"),
                        health_status,
                        health_message: String::new(),
                        requires_pruning,
                    });
                }
                out
            } else {
                resources.into_iter().map(|r| {
                    let s = |key: &str| r[key].as_str().unwrap_or("").to_string();
                    ArgoCdResource {
                        group: s("group"),
                        version: s("version"),
                        kind: s("kind"),
                        namespace: s("namespace"),
                        name: s("name"),
                        sync_status: s("status"),
                        health_status: r["health"]["status"].as_str().unwrap_or("").to_string(),
                        health_message: r["health"]["message"].as_str().unwrap_or("").to_string(),
                        requires_pruning: r["requiresPruning"].as_bool().unwrap_or(false),
                    }
                }).collect()
            };

            return Ok(result);
        }
    }

    Err(format!("Failed to get resources for app: {}", name))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdHistoryEntry {
    /// `status.history[].id` (0 if absent). The rollback command is keyed by this, never by
    /// the (display-only) `revision` below.
    pub id: i64,
    /// Display form of the revision. Only a full 40-hex SHA is shortened (see `short_revision`).
    pub revision: String,
    pub deployed_at: String,
    pub deployed_at_iso: String,
    pub message: String,
    pub author: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdApp {
    pub name: String,
    pub namespace: String,
    pub project: String,
    pub repo_url: String,
    pub path: String,
    pub target_revision: String,
    pub dest_server: String,
    pub dest_namespace: String,
    pub health_status: String,
    pub sync_status: String,
    pub age: String,
    pub last_commit: String,
    pub last_synced_at: String,
    pub operation_phase: String,
    pub commit_message: String,
    pub commit_author: String,
    pub history: Vec<ArgoCdHistoryEntry>,
    pub owner_appset: String,
    /// `spec.syncPolicy.automated` is set and not explicitly disabled. Upstream refuses
    /// a rollback while this is true, so the frontend disables the button with a reason.
    pub auto_sync: bool,
}

/// True when `spec.syncPolicy.automated` is a JSON object and `automated.enabled` is not
/// `false`. `{automated: {}}` is enabled (the `enabled` key defaults to true upstream);
/// `{automated: null}` and a missing key are not. Takes the Application's `spec` value.
pub(crate) fn auto_sync_enabled(spec: &serde_json::Value) -> bool {
    let automated = &spec["syncPolicy"]["automated"];
    automated.is_object() && automated["enabled"].as_bool() != Some(false)
}

/// Display form of a history revision. Only a full 40-char hex SHA is shortened to 7 chars;
/// anything else (a Helm chart version like `10.11.12`, `HEAD`, a tag) is returned unchanged,
/// because truncating it produces a different, wrong version. Never byte-slices.
pub(crate) fn short_revision(rev: &str) -> String {
    if rev.len() == 40 && rev.chars().all(|c| c.is_ascii_hexdigit()) {
        rev.chars().take(7).collect()
    } else {
        rev.to_string()
    }
}

fn time_ago(iso: &str) -> String {
    use chrono::{DateTime, Utc};
    if iso.is_empty() { return "\u{2014}".to_string(); }
    if let Ok(dt) = DateTime::parse_from_rfc3339(iso) {
        let secs = (Utc::now() - dt.with_timezone(&Utc)).num_seconds().max(0) as u64;
        super::utils::format_age(secs) + " ago"
    } else {
        "\u{2014}".to_string()
    }
}

#[tauri::command]
pub async fn list_argocd_apps(context: String) -> Result<Vec<ArgoCdApp>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = match argo_api_resource(&client, "Application", "applications").await? {
        Some(ar) => ar,
        None => return Ok(Vec::new()),
    };

    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list ArgoCD apps: {}", e))?;

    let rows = list.items.into_iter().map(|obj| {
        let spec = &obj.data["spec"];
        let source = &spec["source"];
        let destination = &spec["destination"];
        let status = &obj.data["status"];

        let str_or_dash = |v: &serde_json::Value| -> String {
            let s = v.as_str().unwrap_or("").to_string();
            if s.is_empty() { "\u{2014}".to_string() } else { s }
        };

        let revision = status["sync"]["revision"].as_str().unwrap_or("");
        let last_commit = if revision.len() >= 7 {
            revision[..7].to_string()
        } else if revision.is_empty() {
            "\u{2014}".to_string()
        } else {
            revision.to_string()
        };
        let last_synced_at = time_ago(status["operationState"]["finishedAt"].as_str().unwrap_or(""));
        let operation_phase = str_or_dash(&status["operationState"]["phase"]);
        // ArgoCD stores revisionMetadata in multiple places depending on version/state.
        // Try all three paths: last operation result, current sync state, last history entry.
        let history_message = status["history"].as_array()
            .and_then(|h| h.last())
            .and_then(|e| e["revisionMetadata"]["message"].as_str())
            .and_then(|s| s.lines().next())
            .unwrap_or("")
            .to_string();
        let history_author = status["history"].as_array()
            .and_then(|h| h.last())
            .and_then(|e| e["revisionMetadata"]["author"].as_str())
            .unwrap_or("")
            .to_string();

        let commit_message = {
            let m1 = status["operationState"]["syncResult"]["revisionMetadata"]["message"]
                .as_str().and_then(|s| s.lines().next()).unwrap_or("").to_string();
            let m2 = status["sync"]["revisionMetadata"]["message"]
                .as_str().and_then(|s| s.lines().next()).unwrap_or("").to_string();
            if !m1.is_empty() { m1 } else if !m2.is_empty() { m2 } else { history_message }
        };
        let commit_author = {
            let a1 = status["operationState"]["syncResult"]["revisionMetadata"]["author"]
                .as_str().unwrap_or("").to_string();
            let a2 = status["sync"]["revisionMetadata"]["author"]
                .as_str().unwrap_or("").to_string();
            let a = if !a1.is_empty() { a1 } else if !a2.is_empty() { a2 } else { history_author };
            if a.is_empty() { "\u{2014}".to_string() } else { a }
        };

        // Build history entries — newest first, capped at 20.
        let history: Vec<ArgoCdHistoryEntry> = status["history"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(20)
            .map(|h| {
                // Multi-source entries carry `revisions[]` instead of a scalar `revision`.
                let revision = match h["revision"].as_str() {
                    Some(r) => short_revision(r),
                    None => h["revisions"]
                        .as_array()
                        .map(|rs| {
                            rs.iter()
                                .filter_map(|r| r.as_str())
                                .map(short_revision)
                                .collect::<Vec<_>>()
                                .join(", ")
                        })
                        .unwrap_or_default(),
                };
                let deployed_at_iso = h["deployedAt"].as_str().unwrap_or("").to_string();
                ArgoCdHistoryEntry {
                    id: h["id"].as_i64().unwrap_or(0),
                    revision,
                    deployed_at: time_ago(&deployed_at_iso),
                    deployed_at_iso,
                    message: h["revisionMetadata"]["message"]
                        .as_str()
                        .and_then(|s| s.lines().next())
                        .unwrap_or("")
                        .to_string(),
                    author: h["revisionMetadata"]["author"]
                        .as_str()
                        .unwrap_or("")
                        .to_string(),
                }
            })
            .collect();

        let owner_appset = obj.metadata.owner_references.as_ref()
            .and_then(|refs| refs.iter().find(|r| r.kind == "ApplicationSet"))
            .map(|r| r.name.clone())
            .unwrap_or_default();

        ArgoCdApp {
            name: obj.metadata.name.unwrap_or_default(),
            namespace: obj.metadata.namespace.unwrap_or_default(),
            project: str_or_dash(&spec["project"]),
            repo_url: str_or_dash(&source["repoURL"]),
            path: str_or_dash(&source["path"]),
            target_revision: str_or_dash(&source["targetRevision"]),
            dest_server: str_or_dash(&destination["server"]),
            dest_namespace: str_or_dash(&destination["namespace"]),
            health_status: str_or_dash(&status["health"]["status"]),
            sync_status: str_or_dash(&status["sync"]["status"]),
            age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
            last_commit,
            last_synced_at,
            operation_phase,
            commit_message,
            commit_author,
            history,
            owner_appset,
            auto_sync: auto_sync_enabled(&obj.data["spec"]),
        }
    }).collect();

    Ok(rows)
}

#[tauri::command]
pub async fn sync_argocd_app(
    context: String,
    namespace: String,
    name: String,
    prune: bool,
    dry_run: bool,
    force: bool,
    revision: Option<String>,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let ar = match argo_api_resource(&client, "Application", "applications").await? {
            Some(ar) => ar,
            None => return Err("Failed to sync: ArgoCD is not installed on this cluster".to_string()),
        };
        let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);

        let existing = api.get(&name).await
            .map_err(|e| format!("Failed to sync: {}", e))?;
        if !existing.data["operation"].is_null() {
            return Err("Failed to sync: another operation is already in progress".to_string());
        }

        let mut sync = json!({
            "prune": prune,
            "dryRun": dry_run,
            "syncStrategy": { "hook": { "force": force } }
        });
        if let Some(rev) = revision.filter(|r| !r.is_empty()) {
            sync["revision"] = json!(rev);
        }
        let patch = json!({
            "operation": {
                "sync": sync,
                "initiatedBy": { "username": PRODUCT_NAME.to_lowercase() }
            }
        });
        api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch)).await
            .map_err(|e| format!("Failed to sync: {}", e))?;
        Ok(if dry_run {
            format!("Dry-run sync initiated for {} — no changes will be applied", name)
        } else {
            format!("Sync initiated for {}", name)
        })
    }
    .await;
    crate::app_log::log_write(&context, "sync", "argocd", &namespace, &name, None, &result);
    result
}

#[tauri::command]
pub async fn delete_argocd_app(
    context: String,
    namespace: String,
    name: String,
    cascade: bool,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let ar = match argo_api_resource(&client, "Application", "applications").await? {
            Some(ar) => ar,
            None => return Err("Failed to delete app: ArgoCD is not installed on this cluster".to_string()),
        };
        let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);

        if !cascade {
            // Remove the ArgoCD finalizer first so deletion orphans managed resources.
            let patch = json!({
                "metadata": { "finalizers": [] }
            });
            api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch)).await
                .map_err(|e| format!("Failed to remove finalizer: {}", e))?;
        }

        api.delete(&name, &DeleteParams::default()).await
            .map_err(|e| format!("Failed to delete app: {}", e))?;
        Ok(format!("Application {} deleted", name))
    }
    .await;
    crate::app_log::log_write(&context, "delete", "argocd", &namespace, &name, None, &result);
    result
}

#[tauri::command]
pub async fn refresh_argocd_app(
    context: String,
    namespace: String,
    name: String,
    hard: bool,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let ar = match argo_api_resource(&client, "Application", "applications").await? {
            Some(ar) => ar,
            None => return Err("Failed to refresh: ArgoCD is not installed on this cluster".to_string()),
        };
        let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);
        let refresh_type = if hard { "hard" } else { "normal" };
        let patch = json!({
            "metadata": {
                "annotations": {
                    "argocd.argoproj.io/refresh": refresh_type
                }
            }
        });
        api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch)).await
            .map_err(|e| format!("Failed to refresh: {}", e))?;
        Ok(format!("{}Refresh triggered for {}", if hard { "Hard " } else { "" }, name))
    }
    .await;
    crate::app_log::log_write(&context, "refresh", "argocd", &namespace, &name, None, &result);
    result
}

// ─── ApplicationSets ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdAppSet {
    pub name: String,
    pub namespace: String,
    pub generators: Vec<String>,
    pub project: String,
    pub status: String,
    pub message: String,
    pub generated_apps: i64,
    pub age: String,
}

#[tauri::command]
pub async fn list_argocd_appsets(context: String) -> Result<Vec<ArgoCdAppSet>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = match argo_api_resource(&client, "ApplicationSet", "applicationsets").await? {
        Some(ar) => ar,
        None => return Ok(Vec::new()),
    };

    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list ArgoCD ApplicationSets: {}", e))?;

    let rows = list.items.into_iter().map(|obj| {
        let spec = &obj.data["spec"];
        let status = &obj.data["status"];

        let generators: Vec<String> = spec["generators"].as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|g| g.as_object())
            .flat_map(|o| o.keys().cloned())
            .collect();

        let conditions = status["conditions"].as_array().cloned().unwrap_or_default();
        let find_cond = |t: &str| conditions.iter().find(|c| c["type"].as_str() == Some(t)).cloned();

        let (status_str, message) = if let Some(c) = find_cond("ErrorOccurred")
            .filter(|c| c["status"].as_str() == Some("True"))
        {
            ("Degraded".to_string(), c["message"].as_str().unwrap_or("").to_string())
        } else if let Some(c) = find_cond("ResourcesUpToDate") {
            let msg = c["message"].as_str().unwrap_or("").to_string();
            if c["status"].as_str() == Some("True") {
                ("Healthy".to_string(), msg)
            } else {
                ("Progressing".to_string(), msg)
            }
        } else {
            ("Progressing".to_string(), String::new())
        };

        ArgoCdAppSet {
            name: obj.metadata.name.unwrap_or_default(),
            namespace: obj.metadata.namespace.unwrap_or_default(),
            generators,
            project: spec["template"]["spec"]["project"].as_str().unwrap_or("").to_string(),
            status: status_str,
            message,
            generated_apps: status["resources"].as_array().map(|a| a.len() as i64).unwrap_or(0),
            age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect();

    Ok(rows)
}

// ─── AppProjects ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdProject {
    pub name: String,
    pub namespace: String,
    pub description: String,
    pub source_repos: Vec<String>,
    pub destinations: Vec<String>,
    pub cluster_resource_allowed: bool,
    pub orphaned_warn: bool,
    pub age: String,
}

#[tauri::command]
pub async fn list_argocd_projects(context: String) -> Result<Vec<ArgoCdProject>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = match argo_api_resource(&client, "AppProject", "appprojects").await? {
        Some(ar) => ar,
        None => return Ok(Vec::new()),
    };

    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list ArgoCD AppProjects: {}", e))?;

    let rows = list.items.into_iter().map(|obj| {
        let spec = &obj.data["spec"];

        let source_repos: Vec<String> = spec["sourceRepos"].as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();

        let destinations: Vec<String> = spec["destinations"].as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|d| format!(
                "{}/{}",
                d["server"].as_str().unwrap_or(""),
                d["namespace"].as_str().unwrap_or(""),
            ))
            .collect();

        let cluster_resource_allowed = spec["clusterResourceWhitelist"].as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false);

        ArgoCdProject {
            name: obj.metadata.name.unwrap_or_default(),
            namespace: obj.metadata.namespace.unwrap_or_default(),
            description: spec["description"].as_str().unwrap_or("").to_string(),
            source_repos,
            destinations,
            cluster_resource_allowed,
            orphaned_warn: spec["orphanedResources"]["warn"].as_bool().unwrap_or(false),
            age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect();

    Ok(rows)
}

// ─── Repositories ─────────────────────────────────────────────────────────────
//
// SECURITY: this path is a trust boundary. Only the allowlisted fields on
// ArgoCdRepository ever leave this function — no secret value (password,
// sshPrivateKey, githubAppPrivateKey, TLS material, etc.) is ever read into a
// struct field, a log line, or an error message. `auth_method` is derived
// purely from *which* keys are present on the secret/config entry, never from
// their values.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgoCdRepository {
    pub name: String,
    pub url: String,
    pub repo_type: String,
    pub project: String,
    pub insecure: bool,
    pub enable_oci: bool,
    pub auth_method: String,
    pub source: String,
    pub age: String,
}

/// Namespaces worth searching for ArgoCD's control-plane objects (repo
/// secrets, `argocd-cm`): `"argocd"` first, then any namespace that actually
/// has Application objects — covers non-default / multi-tenant installs.
async fn argocd_namespace_candidates(client: &kube::Client) -> Vec<String> {
    let mut ns = vec!["argocd".to_string()];
    if let Ok(Some(ar)) = argo_api_resource(client, "Application", "applications").await {
        let api: Api<DynamicObject> = Api::all_with(client.clone(), &ar);
        if let Ok(list) = api.list(&ListParams::default()).await {
            for obj in list.items {
                if let Some(n) = obj.metadata.namespace {
                    if !ns.contains(&n) {
                        ns.push(n);
                    }
                }
            }
        }
    }
    ns
}

/// Declarative repo/repo-creds Secrets — the default source since ArgoCD 1.8.
/// Never reads the value of a credential key, only whether it is present.
async fn repos_from_secrets(client: &kube::Client, ns: &str) -> Vec<ArgoCdRepository> {
    use k8s_openapi::api::core::v1::Secret;

    let api: Api<Secret> = Api::namespaced(client.clone(), ns);
    let lp = ListParams::default()
        .labels("argocd.argoproj.io/secret-type in (repository,repo-creds)");
    let Ok(list) = api.list(&lp).await else { return Vec::new() };

    list.items.into_iter().map(|secret| {
        let get_str = |key: &str| -> Option<String> {
            secret.data.as_ref()?.get(key).and_then(|b| String::from_utf8(b.0.clone()).ok())
        };
        let has_key = |key: &str| secret.data.as_ref().map(|d| d.contains_key(key)).unwrap_or(false);

        let url = get_str("url").unwrap_or_default();
        let name = get_str("name")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| secret.metadata.name.clone().unwrap_or_default());
        let repo_type = get_str("type").filter(|s| !s.is_empty()).unwrap_or_else(|| "git".to_string());
        let auth_method = if has_key("sshPrivateKey") {
            "ssh"
        } else if has_key("password") {
            "https"
        } else if has_key("githubAppPrivateKey") {
            "github-app"
        } else {
            "none"
        }.to_string();

        ArgoCdRepository {
            name,
            url,
            repo_type,
            project: get_str("project").unwrap_or_default(),
            insecure: get_str("insecure").map(|s| s == "true").unwrap_or(false),
            enable_oci: get_str("enableOCI").map(|s| s == "true").unwrap_or(false),
            auth_method,
            source: "secret".to_string(),
            age: age_from_timestamp(secret.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect()
}

#[tauri::command]
pub async fn list_argocd_repositories(context: String) -> Result<Vec<ArgoCdRepository>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ns_candidates = argocd_namespace_candidates(&client).await;

    for ns in &ns_candidates {
        let repos = repos_from_secrets(&client, ns).await;
        if !repos.is_empty() {
            return Ok(repos);
        }
    }

    // Fallback: legacy declarative `repositories` key in argocd-cm (pre-1.8
    // style config, still present in some older installs). Entries only ever
    // carry *references* to credential secrets (name+key), never values.
    use k8s_openapi::api::core::v1::ConfigMap;
    for ns in &ns_candidates {
        let cm_api: Api<ConfigMap> = Api::namespaced(client.clone(), ns);
        let Ok(cm) = cm_api.get("argocd-cm").await else { continue };
        let Some(repos_yaml) = cm.data.as_ref().and_then(|d| d.get("repositories")) else { continue };
        let Ok(entries) = serde_yaml::from_str::<Vec<serde_yaml::Value>>(repos_yaml) else { continue };
        if entries.is_empty() {
            continue;
        }

        let cm_age = age_from_timestamp(cm.metadata.creation_timestamp.as_ref().map(|t| &t.0));
        let rows = entries.into_iter().map(|e| {
            let get = |k: &str| e.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let has = |k: &str| e.get(k).is_some();
            let url = get("url");
            let name = { let n = get("name"); if n.is_empty() { url.clone() } else { n } };
            let repo_type = { let t = get("type"); if t.is_empty() { "git".to_string() } else { t } };
            let auth_method = if has("sshPrivateKeySecret") {
                "ssh"
            } else if has("passwordSecret") {
                "https"
            } else if has("githubAppPrivateKeySecret") {
                "github-app"
            } else {
                "none"
            }.to_string();

            ArgoCdRepository {
                name,
                url,
                repo_type,
                project: get("project"),
                insecure: e.get("insecure").and_then(|v| v.as_bool()).unwrap_or(false),
                enable_oci: e.get("enableOCI").and_then(|v| v.as_bool()).unwrap_or(false),
                auth_method,
                source: "configmap".to_string(),
                age: cm_age.clone(),
            }
        }).collect();
        return Ok(rows);
    }

    Ok(Vec::new())
}

/// Build the merge patch for an upstream-parity ArgoCD rollback to `history_id`.
///
/// Mirrors `server/application.Rollback`: refuses while an operation is in flight or auto-sync
/// is enabled, resolves the history entry by `id`, and re-syncs the *full* revision and the
/// source(s) the entry was deployed from. Pure, so the guards are unit-tested without a cluster.
///
/// `syncStrategy.apply` is deliberate here and only here: upstream `Rollback` sets
/// `SyncStrategy{Apply: {}}` (which skips hooks). `sync_argocd_app` keeps `hook.force`. Do not
/// "align" either to the other. There is never a `force` key.
pub(crate) fn build_rollback_patch(
    app: &serde_json::Value,
    history_id: i64,
) -> Result<serde_json::Value, String> {
    if !app["operation"].is_null() {
        return Err("Failed to roll back: another operation is already in progress".to_string());
    }
    if auto_sync_enabled(&app["spec"]) {
        return Err(
            "Failed to roll back: rollback cannot be initiated when auto-sync is enabled".to_string(),
        );
    }
    let entry = app["status"]["history"]
        .as_array()
        .and_then(|hs| hs.iter().find(|h| h["id"].as_i64() == Some(history_id)))
        .ok_or_else(|| {
            format!(
                "Failed to roll back: application {} does not have deployment with id {}",
                app["metadata"]["name"].as_str().unwrap_or(""),
                history_id
            )
        })?;

    let multi = entry["sources"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
    let single = entry["source"].as_object().map(|o| !o.is_empty()).unwrap_or(false);
    if !multi && !single {
        return Err(
            "Failed to roll back: cannot rollback to revision deployed with Argo CD v1.4 or older"
                .to_string(),
        );
    }

    let mut sync = json!({
        "prune": false,
        "dryRun": false,
        "syncStrategy": { "apply": {} }
    });
    if multi {
        sync["sources"] = entry["sources"].clone();
        if !entry["revisions"].is_null() {
            sync["revisions"] = entry["revisions"].clone();
        }
    } else {
        sync["source"] = entry["source"].clone();
        if !entry["revision"].is_null() {
            sync["revision"] = entry["revision"].clone();
        }
    }
    if let Some(opts) = app["spec"]["syncPolicy"]["syncOptions"].as_array() {
        if !opts.is_empty() {
            sync["syncOptions"] = json!(opts);
        }
    }
    Ok(json!({
        "operation": {
            "sync": sync,
            "initiatedBy": { "username": PRODUCT_NAME.to_lowercase() }
        }
    }))
}

/// Roll an Application back to a `status.history[]` entry, keyed by its `id`.
/// The revision and source are read server-side from the live object, so a truncated display
/// revision can never be sent. See `build_rollback_patch` for the guards.
#[tauri::command]
pub async fn rollback_argocd_app(
    context: String,
    namespace: String,
    name: String,
    history_id: i64,
) -> Result<String, String> {
    let result: Result<String, String> = async {
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let ar = match argo_api_resource(&client, "Application", "applications").await? {
            Some(ar) => ar,
            None => return Err("Failed to roll back: ArgoCD is not installed on this cluster".to_string()),
        };
        let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &ar);

        let existing = api.get(&name).await
            .map_err(|e| format!("Failed to roll back: {}", e))?;
        let app_json = serde_json::to_value(&existing)
            .map_err(|e| format!("Failed to roll back: {}", e))?;
        let patch = build_rollback_patch(&app_json, history_id)?;
        api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch)).await
            .map_err(|e| format!("Failed to roll back: {}", e))?;
        Ok(format!("Rollback to history id {} initiated for {}", history_id, name))
    }
    .await;
    crate::app_log::log_write(&context, "rollback", "argocd", &namespace, &name, None, &result);
    result
}

#[cfg(test)]
mod rollback_tests {
    use super::*;

    fn has_key(v: &serde_json::Value, key: &str) -> bool {
        match v {
            serde_json::Value::Object(m) => m.contains_key(key) || m.values().any(|c| has_key(c, key)),
            serde_json::Value::Array(a) => a.iter().any(|c| has_key(c, key)),
            _ => false,
        }
    }

    fn app() -> serde_json::Value {
        json!({
            "metadata": { "name": "web" },
            "spec": { "syncPolicy": { "syncOptions": ["CreateNamespace=true"] } },
            "status": { "history": [
                { "id": 1, "revision": "10.11.12",
                  "source": { "repoURL": "https://charts", "chart": "x", "targetRevision": "10.11.12" } },
                { "id": 2, "revisions": ["aaa", "bbb"],
                  "sources": [ { "repoURL": "r1" }, { "repoURL": "r2" } ] },
                { "id": 3, "revision": "abc" }
            ] }
        })
    }

    #[test]
    fn guard_operation_in_progress() {
        let mut a = app();
        a["operation"] = json!({ "sync": {} });
        assert_eq!(
            build_rollback_patch(&a, 1).unwrap_err(),
            "Failed to roll back: another operation is already in progress"
        );
    }

    #[test]
    fn guard_auto_sync() {
        let mut a = app();
        a["spec"]["syncPolicy"]["automated"] = json!({});
        assert_eq!(
            build_rollback_patch(&a, 1).unwrap_err(),
            "Failed to roll back: rollback cannot be initiated when auto-sync is enabled"
        );
    }

    #[test]
    fn guard_order_operation_before_auto_sync() {
        let mut a = app();
        a["operation"] = json!({ "sync": {} });
        a["spec"]["syncPolicy"]["automated"] = json!({});
        assert!(build_rollback_patch(&a, 1).unwrap_err().contains("another operation"));
    }

    #[test]
    fn guard_unknown_id() {
        assert_eq!(
            build_rollback_patch(&app(), 99).unwrap_err(),
            "Failed to roll back: application web does not have deployment with id 99"
        );
        assert_eq!(
            build_rollback_patch(&json!({}), 1).unwrap_err(),
            "Failed to roll back: application  does not have deployment with id 1"
        );
    }

    #[test]
    fn guard_no_source() {
        assert_eq!(
            build_rollback_patch(&app(), 3).unwrap_err(),
            "Failed to roll back: cannot rollback to revision deployed with Argo CD v1.4 or older"
        );
    }

    #[test]
    fn single_source_shape() {
        let p = build_rollback_patch(&app(), 1).unwrap();
        let s = &p["operation"]["sync"];
        assert_eq!(s["revision"], "10.11.12");
        assert_eq!(s["source"]["chart"], "x");
        assert!(s.get("revisions").is_none() && s.get("sources").is_none());
        assert_eq!(s["syncStrategy"], json!({ "apply": {} }));
        assert_eq!(s["prune"], false);
        assert_eq!(s["dryRun"], false);
        assert_eq!(s["syncOptions"], json!(["CreateNamespace=true"]));
        assert_eq!(p["operation"]["initiatedBy"]["username"], PRODUCT_NAME.to_lowercase());
    }

    #[test]
    fn multi_source_shape() {
        let p = build_rollback_patch(&app(), 2).unwrap();
        let s = &p["operation"]["sync"];
        assert_eq!(s["revisions"], json!(["aaa", "bbb"]));
        assert_eq!(s["sources"].as_array().map(|a| a.len()), Some(2));
        assert!(s.get("revision").is_none() && s.get("source").is_none());
    }

    #[test]
    fn never_force_or_hook() {
        for id in [1, 2] {
            let p = build_rollback_patch(&app(), id).unwrap();
            assert!(!has_key(&p, "force"));
            assert!(!has_key(&p, "hook"));
        }
    }

    #[test]
    fn sync_options_only_when_non_empty() {
        let mut a = app();
        a["spec"]["syncPolicy"]["syncOptions"] = json!([]);
        assert!(build_rollback_patch(&a, 1).unwrap()["operation"]["sync"].get("syncOptions").is_none());
        a["spec"] = json!({});
        assert!(build_rollback_patch(&a, 1).unwrap()["operation"]["sync"].get("syncOptions").is_none());
    }

    #[test]
    fn short_revision_rules() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(short_revision(sha), "0123456");
        assert_eq!(short_revision("10.11.12"), "10.11.12");
        assert_eq!(short_revision("HEAD"), "HEAD");
        assert_eq!(short_revision("h\u{e9}llo w\u{f6}rld"), "h\u{e9}llo w\u{f6}rld");
        // 40 bytes, not ASCII hex: must not be shortened and must not panic.
        assert_eq!(short_revision(&"\u{e9}".repeat(20)), "\u{e9}".repeat(20));
    }

    #[test]
    fn auto_sync_enabled_cases() {
        assert!(!auto_sync_enabled(&json!({})));
        assert!(auto_sync_enabled(&json!({ "syncPolicy": { "automated": {} } })));
        assert!(!auto_sync_enabled(&json!({ "syncPolicy": { "automated": { "enabled": false } } })));
        assert!(auto_sync_enabled(&json!({ "syncPolicy": { "automated": { "enabled": true } } })));
        assert!(!auto_sync_enabled(&json!({ "syncPolicy": { "automated": null } })));
    }
}
