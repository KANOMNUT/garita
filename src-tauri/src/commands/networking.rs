use k8s_openapi::api::core::v1::{Endpoints as K8sEndpoints, Namespace as K8sNamespace, Service as K8sSvc};
use k8s_openapi::api::discovery::v1::EndpointSlice as K8sEndpointSlice;
use k8s_openapi::api::networking::v1::{Ingress as K8sIngress, IngressClass, NetworkPolicy as K8sNetPol};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

// ─── Service ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Service {
    pub name: String,
    pub namespace: String,
    pub type_: String,
    pub cluster_ip: String,
    pub external_ip: String,
    pub ports: String,
    pub age: String,
}

fn convert_service(s: K8sSvc) -> Service {
    let spec = s.spec.as_ref();
    let type_ = spec.and_then(|sp| sp.type_.as_deref()).unwrap_or("ClusterIP").to_string();
    let cluster_ip = spec.and_then(|sp| sp.cluster_ip.as_deref()).unwrap_or("<none>").to_string();
    let external_ip = s.status.as_ref()
        .and_then(|st| st.load_balancer.as_ref())
        .and_then(|lb| lb.ingress.as_ref())
        .and_then(|ingress| ingress.first())
        .and_then(|i| i.ip.as_deref().or(i.hostname.as_deref()))
        .unwrap_or("<none>")
        .to_string();
    let ports = spec.and_then(|sp| sp.ports.as_ref())
        .map(|ports| {
            ports.iter().map(|p| {
                let proto = p.protocol.as_deref().unwrap_or("TCP");
                if let Some(np) = p.node_port {
                    format!("{}:{}/{}", p.port, np, proto)
                } else {
                    format!("{}/{}", p.port, proto)
                }
            }).collect::<Vec<_>>().join(", ")
        })
        .unwrap_or_else(|| "<none>".to_string());
    Service {
        name: s.metadata.name.unwrap_or_default(),
        namespace: s.metadata.namespace.unwrap_or_default(),
        type_,
        cluster_ip,
        external_ip,
        ports,
        age: age_from_timestamp(s.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
    }
}

#[tauri::command]
pub async fn list_services(context: String, namespace: String) -> Result<Vec<Service>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    // Namespace-specific path: simple direct listing
    if namespace != "all" && !namespace.is_empty() {
        let api: Api<K8sSvc> = Api::namespaced(client, &namespace);
        return api.list(&ListParams::default()).await
            .map_err(|e| format!("Failed to list services: {}", e))
            .map(|l| l.items.into_iter().map(convert_service).collect());
    }

    // All-namespaces path: try cluster-wide first, fall back to per-namespace
    let all_api: Api<K8sSvc> = Api::all(client.clone());
    if let Ok(list) = all_api.list(&ListParams::default()).await {
        return Ok(list.items.into_iter().map(convert_service).collect());
    }

    // Fallback: enumerate namespaces and list services in each one
    let ns_api: Api<K8sNamespace> = Api::all(client.clone());
    let namespaces = ns_api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list namespaces for service fallback: {}", e))?;

    let mut result: Vec<Service> = Vec::new();
    let mut attempted = 0u32;
    let mut succeeded = 0u32;
    for ns_item in namespaces.items {
        let ns_name = match ns_item.metadata.name {
            Some(ref n) if !n.is_empty() => n.clone(),
            _ => continue,
        };
        attempted += 1;
        let svc_api: Api<K8sSvc> = Api::namespaced(client.clone(), &ns_name);
        if let Ok(list) = svc_api.list(&ListParams::default()).await {
            succeeded += 1;
            result.extend(list.items.into_iter().map(convert_service));
        }
    }
    // Forbidden-in-every-namespace looks identical to "no Services exist" unless we
    // distinguish it — an empty Ok(vec![]) here would render an empty table with no
    // indication the user simply can't see anything. Partial success still returns Ok:
    // a partial list is genuinely useful. See docs/plan-kubeconfig-and-parity.md §2.2.
    if attempted > 0 && succeeded == 0 {
        return Err(format!("Failed to list services: forbidden in all {} namespaces", attempted));
    }
    Ok(result)
}

// ─── Ingress ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IngressPath {
    pub path: String,
    pub path_type: String,
    pub service: String,
    pub port: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IngressRule {
    pub host: String,
    pub tls: bool,
    pub paths: Vec<IngressPath>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Ingress {
    pub name: String,
    pub namespace: String,
    pub class: String,
    pub hosts: String,
    pub address: String,
    pub ports: String,
    pub rules: Vec<IngressRule>,
    pub age: String,
}

#[tauri::command]
pub async fn list_ingresses(context: String, namespace: String) -> Result<Vec<Ingress>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sIngress> = namespaced_or_all!(client, K8sIngress, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list ingresses: {}", e))?;
    Ok(list.items.into_iter().map(|ing| {
        let class = ing.spec.as_ref()
            .and_then(|s| s.ingress_class_name.as_deref())
            .or_else(|| ing.metadata.annotations.as_ref()
                .and_then(|a| a.get("kubernetes.io/ingress.class").map(|s| s.as_str())))
            .unwrap_or("<none>")
            .to_string();
        let hosts = ing.spec.as_ref()
            .and_then(|s| s.rules.as_ref())
            .map(|rules| rules.iter()
                .filter_map(|r| r.host.as_deref())
                .collect::<Vec<_>>().join(", "))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "*".to_string());
        let address = ing.status.as_ref()
            .and_then(|st| st.load_balancer.as_ref())
            .and_then(|lb| lb.ingress.as_ref())
            .and_then(|i| i.first())
            .and_then(|i| i.ip.as_deref().or(i.hostname.as_deref()))
            .unwrap_or("")
            .to_string();
        let tls_hosts: std::collections::HashSet<String> = ing.spec.as_ref()
            .and_then(|s| s.tls.as_ref())
            .map(|tls| tls.iter()
                .flat_map(|t| t.hosts.iter().flatten().cloned())
                .collect())
            .unwrap_or_default();
        let has_tls = !tls_hosts.is_empty()
            || ing.spec.as_ref().and_then(|s| s.tls.as_ref()).map(|t| !t.is_empty()).unwrap_or(false);
        let ports = if has_tls { "80, 443".to_string() } else { "80".to_string() };

        let rules: Vec<IngressRule> = ing.spec.as_ref()
            .and_then(|s| s.rules.as_ref())
            .map(|rs| rs.iter().map(|r| {
                let host = r.host.clone().unwrap_or_else(|| "*".to_string());
                let tls = tls_hosts.contains(&host)
                    || (tls_hosts.is_empty() && has_tls);
                let paths = r.http.as_ref()
                    .map(|http| http.paths.iter().map(|p| {
                        let path = p.path.clone().unwrap_or_else(|| "/".to_string());
                        let path_type = p.path_type.clone();
                        let (service, port) = p.backend.service.as_ref()
                            .map(|svc| {
                                let svc_name = svc.name.clone();
                                let svc_port = svc.port.as_ref().map(|po| {
                                    po.number.map(|n| n.to_string())
                                        .or_else(|| po.name.clone())
                                        .unwrap_or_default()
                                }).unwrap_or_default();
                                (svc_name, svc_port)
                            })
                            .unwrap_or_default();
                        IngressPath { path, path_type, service, port }
                    }).collect())
                    .unwrap_or_default();
                IngressRule { host, tls, paths }
            }).collect())
            .unwrap_or_default();

        Ingress {
            name: ing.metadata.name.unwrap_or_default(),
            namespace: ing.metadata.namespace.unwrap_or_default(),
            class,
            hosts,
            address,
            ports,
            rules,
            age: age_from_timestamp(ing.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── NetworkPolicy ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkPolicyRow {
    pub name: String,
    pub namespace: String,
    pub pod_selector: String,
    pub ingress_count: usize,
    pub egress_count: usize,
    pub policy_types: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_network_policies(
    context: String, namespace: String,
) -> Result<Vec<NetworkPolicyRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sNetPol> = namespaced_or_all!(client, K8sNetPol, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list network policies: {}", e))?;
    Ok(list.items.into_iter().map(|np| {
        let pod_selector = np.spec.as_ref().map(|s| {
            s.pod_selector.match_labels.as_ref()
                .map(|ml| ml.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join(", "))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "All Pods".to_string())
        }).unwrap_or_default();
        let ingress_count = np.spec.as_ref().and_then(|s| s.ingress.as_ref()).map(|v| v.len()).unwrap_or(0);
        let egress_count  = np.spec.as_ref().and_then(|s| s.egress.as_ref()).map(|v| v.len()).unwrap_or(0);
        let policy_types  = np.spec.as_ref().and_then(|s| s.policy_types.as_ref())
            .map(|pt| pt.join(", ")).unwrap_or_default();
        NetworkPolicyRow {
            name: np.metadata.name.unwrap_or_default(),
            namespace: np.metadata.namespace.unwrap_or_default(),
            pod_selector,
            ingress_count,
            egress_count,
            policy_types,
            age: age_from_timestamp(np.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EndpointsRow {
    pub name: String,
    pub namespace: String,
    pub addresses: String, // comma-joined "ip:port", truncated at 5 with "+N more"
    pub address_count: i64,
    pub ready_count: i64,
    pub age: String,
}

/// Returns (addresses string, address_count, ready_count).
/// `ready_count` is the sum of each subset's ready `addresses`; `address_count` also
/// includes `notReadyAddresses`. `addresses` is the ip:port cartesian product per subset
/// (mirroring `kubectl get endpoints`'s ENDPOINTS column), truncated at 5 entries.
fn format_endpoints_addresses(
    subsets: Vec<k8s_openapi::api::core::v1::EndpointSubset>,
) -> (String, i64, i64) {
    let mut ready_count = 0i64;
    let mut not_ready_count = 0i64;
    let mut entries: Vec<String> = Vec::new();

    for subset in subsets {
        let ports = subset.ports.unwrap_or_default();
        let addrs = subset.addresses.unwrap_or_default();
        ready_count += addrs.len() as i64;
        for addr in &addrs {
            if ports.is_empty() {
                entries.push(addr.ip.clone());
            } else {
                for p in &ports {
                    entries.push(format!("{}:{}", addr.ip, p.port));
                }
            }
        }
        not_ready_count += subset.not_ready_addresses.map(|v| v.len()).unwrap_or(0) as i64;
    }

    let addresses = if entries.len() > 5 {
        format!("{}, +{} more", entries[..5].join(", "), entries.len() - 5)
    } else {
        entries.join(", ")
    };

    (addresses, ready_count + not_ready_count, ready_count)
}

#[tauri::command]
pub async fn list_endpoints(context: String, namespace: String) -> Result<Vec<EndpointsRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sEndpoints> = namespaced_or_all!(client, K8sEndpoints, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list endpoints: {}", e))?;
    Ok(list.items.into_iter().map(|ep| {
        let age = age_from_timestamp(ep.metadata.creation_timestamp.as_ref().map(|t| &t.0));
        let (addresses, address_count, ready_count) =
            format_endpoints_addresses(ep.subsets.unwrap_or_default());
        EndpointsRow {
            name: ep.metadata.name.unwrap_or_default(),
            namespace: ep.metadata.namespace.unwrap_or_default(),
            addresses,
            address_count,
            ready_count,
            age,
        }
    }).collect())
}

// ─── EndpointSlice ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EndpointSliceRow {
    pub name: String,
    pub namespace: String,
    pub service: String,      // labels["kubernetes.io/service-name"], "" when absent
    pub address_type: String, // "IPv4" | "IPv6" | "FQDN"
    pub endpoints: i64,
    pub ready: i64,
    pub ports: String, // comma-joined "name:port/proto"
    pub age: String,
}

#[tauri::command]
pub async fn list_endpoint_slices(
    context: String, namespace: String,
) -> Result<Vec<EndpointSliceRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sEndpointSlice> = namespaced_or_all!(client, K8sEndpointSlice, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list endpoint slices: {}", e))?;
    Ok(list.items.into_iter().map(|eps| {
        let service = eps.metadata.labels.as_ref()
            .and_then(|l| l.get("kubernetes.io/service-name"))
            .cloned()
            .unwrap_or_default();
        // A nil `ready` condition means "consumers should interpret as ready" per the API docs.
        let ready = eps.endpoints.iter()
            .filter(|e| e.conditions.as_ref().and_then(|c| c.ready).unwrap_or(true))
            .count() as i64;
        let ports = eps.ports.unwrap_or_default().iter().map(|p| {
            let name = p.name.clone().unwrap_or_default();
            let port = p.port.map(|n| n.to_string()).unwrap_or_else(|| "*".to_string());
            let proto = p.protocol.clone().unwrap_or_else(|| "TCP".to_string());
            format!("{}:{}/{}", name, port, proto)
        }).collect::<Vec<_>>().join(", ");
        EndpointSliceRow {
            name: eps.metadata.name.clone().unwrap_or_default(),
            namespace: eps.metadata.namespace.clone().unwrap_or_default(),
            service,
            address_type: eps.address_type.clone(),
            endpoints: eps.endpoints.len() as i64,
            ready,
            ports,
            age: age_from_timestamp(eps.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── IngressClass ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ingress_classes(context: String) -> Result<Vec<String>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<IngressClass> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list ingress classes: {}", e))?;
    Ok(list.items.into_iter().filter_map(|ic| ic.metadata.name).collect())
}
