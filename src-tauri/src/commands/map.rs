//! #18 namespace resource map (v2.2.0). Read-only; one request returns nodes + structural edges.
//! Secrets and ConfigMaps are listed as metadata only (`list_metadata`): names, never data.
//! Edge functions are pure over typed objects; `build_map` assembles them (tested without a cluster).
//! Dangling edges (target not listed, forbidden source, other namespace) are dropped in one place.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet},
    autoscaling::v2::HorizontalPodAutoscaler,
    batch::v1::{CronJob, Job},
    core::v1::{ConfigMap, Container, PersistentVolume, PersistentVolumeClaim, Pod, Secret, Service},
    discovery::v1::EndpointSlice,
    networking::v1::Ingress,
    policy::v1::PodDisruptionBudget,
};
use k8s_openapi::apimachinery::pkg::{apis::meta::v1::ObjectMeta, util::intstr::IntOrString};
use kube::{
    api::{DynamicObject, ListParams},
    core::PartialObjectMeta,
    Api,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::drain::selector_matches;
use super::gateway::{gateway_api_resource, httproute_api_resource};
use super::problems::{take, SkippedSource};
use super::utils::client_for_context;

/// Payload/fetch guard, not a readability cap: the UI applies its own 400-node draw cap after kind hiding and grouping.
// ponytail: tune here; above it the response is empty with `truncated: true`.
const NODE_CEILING: usize = 2000;

/// Injected into every namespace (each pod projects `kube-root-ca.crt`); a node for them would join every pod into one component.
const INJECTED_CONFIGMAPS: [&str; 2] = ["kube-root-ca.crt", "openshift-service-ca.crt"];

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct MapNode {
    pub id: String, // "<kind>/<namespace>/<name>"; cluster-scoped PVs use namespace ""
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub status: String, // "ok" | "warn" | "bad" | "unknown"
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct MapEdge {
    pub from: String,
    pub to: String,
    /// "owns" | "selects" | "routes-to" | "attaches-to" | "mounts" | "binds" | "uses-config" | "uses-secret" | "scales" | "protects"
    pub relation: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceMap {
    pub nodes: Vec<MapNode>,
    pub edges: Vec<MapEdge>,
    pub truncated: bool,
    pub skipped: Vec<SkippedSource>,
}

/// Everything listed for the namespace. `None` = the source was forbidden or failed (in `skipped`).
#[derive(Default)]
pub(crate) struct Sources {
    pub pods: Option<Vec<Pod>>,
    pub deploys: Option<Vec<Deployment>>,
    pub stss: Option<Vec<StatefulSet>>,
    pub dss: Option<Vec<DaemonSet>>,
    pub rss: Option<Vec<ReplicaSet>>,
    pub jobs: Option<Vec<Job>>,
    pub crons: Option<Vec<CronJob>>,
    pub svcs: Option<Vec<Service>>,
    pub slices: Option<Vec<EndpointSlice>>,
    pub ings: Option<Vec<Ingress>>,
    pub gws: Option<Vec<DynamicObject>>,
    pub routes: Option<Vec<DynamicObject>>,
    pub pvcs: Option<Vec<PersistentVolumeClaim>>,
    pub pvs: Option<Vec<PersistentVolume>>,
    pub cms: Option<Vec<String>>,
    pub secs: Option<Vec<String>>,
    pub hpas: Option<Vec<HorizontalPodAutoscaler>>,
    pub pdbs: Option<Vec<PodDisruptionBudget>>,
}

// ─── ids and small helpers ───────────────────────────────────────────────────

fn id(kind: &str, ns: &str, name: &str) -> String {
    format!("{}/{}/{}", kind, ns, name)
}

fn nm(m: &ObjectMeta) -> &str {
    m.name.as_deref().unwrap_or("")
}

fn edge(from: &str, to: &str, relation: &str, detail: impl Into<String>) -> MapEdge {
    MapEdge { from: from.into(), to: to.into(), relation: relation.into(), detail: detail.into() }
}

fn node(kind: &str, ns: &str, name: &str, status: &str) -> MapNode {
    MapNode { id: id(kind, ns, name), kind: kind.into(), namespace: ns.into(), name: name.into(), status: status.into() }
}

fn port_text(p: &IntOrString) -> String {
    match p {
        IntOrString::Int(n) => n.to_string(),
        IntOrString::String(s) => s.clone(),
    }
}

fn containers(p: &Pod) -> impl Iterator<Item = &Container> {
    p.spec.iter().flat_map(|s| s.containers.iter().chain(s.init_containers.iter().flatten()))
}

// ─── Edges (pure) ────────────────────────────────────────────────────────────

/// `owner -> owned` for every ownerReference whose uid is among `items` (kind, metadata).
pub(crate) fn owner_edges(items: &[(&str, &ObjectMeta)], ns: &str) -> Vec<MapEdge> {
    let by_uid: HashMap<&str, String> = items
        .iter()
        .filter_map(|(k, m)| Some((m.uid.as_deref()?, id(k, ns, nm(m)))))
        .collect();
    let mut out = Vec::new();
    for (k, m) in items {
        let to = id(k, ns, nm(m));
        for o in m.owner_references.iter().flatten() {
            if let Some(from) = by_uid.get(o.uid.as_str()) {
                out.push(edge(from, &to, "owns", ""));
            }
        }
    }
    out
}

/// Service (label selector) and PDB (`selector_matches`) to the pods they cover. A Service
/// without a selector selects nothing here. ponytail: label match, not EndpointSlice targetRefs;
/// add slice-only (selectorless) Services when asked.
pub(crate) fn selector_edges(svcs: &[Service], pdbs: &[PodDisruptionBudget], pods: &[Pod], ns: &str) -> Vec<MapEdge> {
    let empty = BTreeMap::new();
    let mut out = Vec::new();
    for s in svcs {
        let Some(sel) = s.spec.as_ref().and_then(|sp| sp.selector.as_ref()).filter(|m| !m.is_empty()) else { continue };
        let ports = s
            .spec
            .iter()
            .flat_map(|sp| sp.ports.iter().flatten())
            .map(|p| format!("{} → {}", p.port, port_text(p.target_port.as_ref().unwrap_or(&IntOrString::Int(p.port)))))
            .collect::<Vec<_>>()
            .join(", ");
        let from = id("svc", ns, nm(&s.metadata));
        for p in pods {
            let labels = p.metadata.labels.as_ref().unwrap_or(&empty);
            if sel.iter().all(|(k, v)| labels.get(k) == Some(v)) {
                out.push(edge(&from, &id("pods", ns, nm(&p.metadata)), "selects", ports.clone()));
            }
        }
    }
    for d in pdbs {
        let sel = d.spec.as_ref().and_then(|sp| sp.selector.as_ref());
        let from = id("pdb", ns, nm(&d.metadata));
        for p in pods {
            if selector_matches(sel, p.metadata.labels.as_ref().unwrap_or(&empty)) {
                out.push(edge(&from, &id("pods", ns, nm(&p.metadata)), "protects", ""));
            }
        }
    }
    out
}

/// Ingress -> Service, one edge per rule path plus the default backend.
pub(crate) fn ingress_edges(ings: &[Ingress], ns: &str) -> Vec<MapEdge> {
    let mut out = Vec::new();
    for ing in ings {
        let Some(spec) = ing.spec.as_ref() else { continue };
        let from = id("ing", ns, nm(&ing.metadata));
        if let Some(b) = spec.default_backend.as_ref().and_then(|b| b.service.as_ref()) {
            out.push(edge(&from, &id("svc", ns, &b.name), "routes-to", "default backend"));
        }
        for rule in spec.rules.iter().flatten() {
            let host = rule.host.as_deref().unwrap_or("");
            for p in rule.http.iter().flat_map(|h| h.paths.iter()) {
                let Some(b) = p.backend.service.as_ref() else { continue };
                let path = p.path.as_deref().unwrap_or("/");
                let detail = if host.is_empty() { format!("path {}", path) } else { format!("{} path {}", host, path) };
                out.push(edge(&from, &id("svc", ns, &b.name), "routes-to", detail));
            }
        }
    }
    out
}

/// HTTPRoute -> Gateway (`attaches-to`, one per parentRef) and HTTPRoute -> Service (`routes-to`).
pub(crate) fn route_edges(routes: &[DynamicObject], ns: &str) -> Vec<MapEdge> {
    let mut out = Vec::new();
    for r in routes {
        let from = id("httproute", ns, nm(&r.metadata));
        let spec = &r.data["spec"];
        for p in spec["parentRefs"].as_array().into_iter().flatten() {
            if p["kind"].as_str().unwrap_or("Gateway") != "Gateway" {
                continue;
            }
            let Some(name) = p["name"].as_str() else { continue };
            let pns = p["namespace"].as_str().unwrap_or(ns);
            let detail = p["sectionName"].as_str().map(|s| format!("listener {}", s)).unwrap_or_default();
            out.push(edge(&from, &id("gw", pns, name), "attaches-to", detail));
        }
        for rule in spec["rules"].as_array().into_iter().flatten() {
            let path = rule["matches"]
                .as_array()
                .into_iter()
                .flatten()
                .find_map(|m| m["path"]["value"].as_str())
                .map(|p| format!("path {}", p));
            for b in rule["backendRefs"].as_array().into_iter().flatten() {
                if b["kind"].as_str().unwrap_or("Service") != "Service" {
                    continue;
                }
                let Some(name) = b["name"].as_str() else { continue };
                let bns = b["namespace"].as_str().unwrap_or(ns);
                let detail = match (&path, b["port"].as_i64()) {
                    (Some(p), Some(n)) => format!("{}, port {}", p, n),
                    (Some(p), None) => p.clone(),
                    (None, Some(n)) => format!("port {}", n),
                    (None, None) => String::new(),
                };
                out.push(edge(&from, &id("svc", bns, name), "routes-to", detail));
            }
        }
    }
    out
}

/// Pod -> PVC (`mounts`), Pod -> ConfigMap / Secret through volumes (incl. projected sources),
/// PVC -> PV (`binds`).
pub(crate) fn volume_edges(pods: &[Pod], pvcs: &[PersistentVolumeClaim], ns: &str) -> Vec<MapEdge> {
    let mut out = Vec::new();
    for p in pods {
        let from = id("pods", ns, nm(&p.metadata));
        for v in p.spec.iter().flat_map(|s| s.volumes.iter().flatten()) {
            if let Some(c) = &v.persistent_volume_claim {
                out.push(edge(&from, &id("pvc", ns, &c.claim_name), "mounts", format!("volume {}", v.name)));
            }
            if let Some(c) = &v.config_map {
                out.push(edge(&from, &id("cm", ns, &c.name), "uses-config", format!("volume {}", v.name)));
            }
            if let Some(s) = v.secret.as_ref().and_then(|s| s.secret_name.as_deref()) {
                out.push(edge(&from, &id("sec", ns, s), "uses-secret", format!("volume {}", v.name)));
            }
            for src in v.projected.iter().flat_map(|pr| pr.sources.iter().flatten()) {
                let detail = format!("projected volume {}", v.name);
                if let Some(c) = &src.config_map {
                    out.push(edge(&from, &id("cm", ns, &c.name), "uses-config", detail.clone()));
                }
                if let Some(s) = &src.secret {
                    out.push(edge(&from, &id("sec", ns, &s.name), "uses-secret", detail));
                }
            }
        }
    }
    for c in pvcs {
        if let Some(pv) = c.spec.as_ref().and_then(|s| s.volume_name.as_deref()).filter(|v| !v.is_empty()) {
            out.push(edge(&id("pvc", ns, nm(&c.metadata)), &id("pv", "", pv), "binds", ""));
        }
    }
    out
}

/// Pod -> ConfigMap / Secret through `env.valueFrom` and `envFrom` (containers and init containers).
pub(crate) fn env_edges(pods: &[Pod], ns: &str) -> Vec<MapEdge> {
    let mut out = Vec::new();
    for p in pods {
        let from = id("pods", ns, nm(&p.metadata));
        for c in containers(p) {
            for vf in c.env.iter().flatten().filter_map(|e| e.value_from.as_ref()) {
                if let Some(k) = &vf.config_map_key_ref {
                    out.push(edge(&from, &id("cm", ns, &k.name), "uses-config", "env"));
                }
                if let Some(k) = &vf.secret_key_ref {
                    out.push(edge(&from, &id("sec", ns, &k.name), "uses-secret", "env"));
                }
            }
            for ef in c.env_from.iter().flatten() {
                if let Some(r) = &ef.config_map_ref {
                    out.push(edge(&from, &id("cm", ns, &r.name), "uses-config", "envFrom"));
                }
                if let Some(r) = &ef.secret_ref {
                    out.push(edge(&from, &id("sec", ns, &r.name), "uses-secret", "envFrom"));
                }
            }
        }
    }
    out
}

/// HPA -> its scale target (Deployment, StatefulSet, ReplicaSet).
pub(crate) fn hpa_edges(hpas: &[HorizontalPodAutoscaler], ns: &str) -> Vec<MapEdge> {
    hpas.iter()
        .filter_map(|h| {
            let sp = h.spec.as_ref()?;
            let kind = match sp.scale_target_ref.kind.as_str() {
                "Deployment" => "deploy",
                "StatefulSet" => "sts",
                "ReplicaSet" => "rs",
                _ => return None,
            };
            let detail = format!("{}–{} replicas", sp.min_replicas.unwrap_or(1), sp.max_replicas);
            Some(edge(&id("hpa", ns, nm(&h.metadata)), &id(kind, ns, &sp.scale_target_ref.name), "scales", detail))
        })
        .collect()
}

// ─── Status (pure; coarse mirror of the list-view rules) ─────────────────────

fn replicas_status(desired: i32, ready: i32) -> &'static str {
    if desired <= 0 || ready >= desired {
        "ok"
    } else if ready <= 0 {
        "bad"
    } else {
        "warn"
    }
}

fn pod_status(p: &Pod) -> &'static str {
    let Some(st) = p.status.as_ref() else { return "unknown" };
    let waiting = st
        .container_statuses
        .iter()
        .chain(st.init_container_statuses.iter())
        .flatten()
        .filter_map(|c| c.state.as_ref()?.waiting.as_ref()?.reason.as_deref());
    if waiting.into_iter().any(|r| matches!(r, "CrashLoopBackOff" | "ImagePullBackOff" | "ErrImagePull")) {
        return "bad";
    }
    if p.metadata.deletion_timestamp.is_some() {
        return "warn";
    }
    match st.phase.as_deref() {
        Some("Failed") => "bad",
        Some("Succeeded") => "ok",
        Some("Pending") => "warn",
        Some("Running") => {
            if st.container_statuses.iter().flatten().any(|c| !c.ready) { "warn" } else { "ok" }
        }
        _ => "unknown",
    }
}

fn condition_is(conds: &Value, kind: &str, status: &str) -> bool {
    conds.as_array().into_iter().flatten().any(|c| c["type"] == kind && c["status"] == status)
}

fn gateway_status(g: &DynamicObject) -> &'static str {
    let c = &g.data["status"]["conditions"];
    if condition_is(c, "Programmed", "True") {
        "ok"
    } else if condition_is(c, "Programmed", "False") || condition_is(c, "Accepted", "False") {
        "bad"
    } else {
        "warn"
    }
}

/// Same rollup as the HTTPRoute list: any parent Accepted -> ok, all rejected -> bad.
fn route_status(r: &DynamicObject) -> &'static str {
    let parents = r.data["status"]["parents"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    if parents.iter().any(|p| condition_is(&p["conditions"], "Accepted", "True")) {
        "ok"
    } else if !parents.is_empty() && parents.iter().all(|p| condition_is(&p["conditions"], "Accepted", "False")) {
        "bad"
    } else {
        "warn"
    }
}

/// Ready endpoints per Service name (an endpoint counts unless `ready == false`).
pub(crate) fn ready_endpoints(slices: &[EndpointSlice]) -> BTreeMap<String, usize> {
    let mut m = BTreeMap::new();
    for s in slices {
        let Some(svc) = s.metadata.labels.as_ref().and_then(|l| l.get("kubernetes.io/service-name")) else { continue };
        let n = s.endpoints.iter().filter(|e| !e.addresses.is_empty() && e.conditions.as_ref().and_then(|c| c.ready) != Some(false)).count();
        *m.entry(svc.clone()).or_insert(0) += n;
    }
    m
}

fn svc_status(s: &Service, ready: Option<&BTreeMap<String, usize>>) -> &'static str {
    let has_selector = s.spec.as_ref().and_then(|sp| sp.selector.as_ref()).is_some_and(|m| !m.is_empty());
    if !has_selector {
        return "ok";
    }
    match ready {
        None => "unknown",
        Some(r) if r.get(nm(&s.metadata)).copied().unwrap_or(0) > 0 => "ok",
        Some(_) => "warn",
    }
}

fn pvc_status(c: &PersistentVolumeClaim) -> &'static str {
    match c.status.as_ref().and_then(|s| s.phase.as_deref()) {
        Some("Bound") => "ok",
        Some("Pending") => "warn",
        Some("Lost") => "bad",
        _ => "unknown",
    }
}

fn pv_status(v: &PersistentVolume) -> &'static str {
    match v.status.as_ref().and_then(|s| s.phase.as_deref()) {
        Some("Bound") | Some("Available") => "ok",
        Some("Pending") | Some("Released") => "warn",
        Some("Failed") => "bad",
        _ => "unknown",
    }
}

fn job_status(j: &Job) -> &'static str {
    let st = j.status.as_ref();
    if st.and_then(|s| s.failed).unwrap_or(0) > 0 && st.and_then(|s| s.succeeded).unwrap_or(0) == 0 { "bad" } else { "ok" }
}

fn hpa_status(h: &HorizontalPodAutoscaler) -> &'static str {
    let off = h.status.iter().flat_map(|s| s.conditions.iter().flatten()).any(|c| c.type_ == "ScalingActive" && c.status == "False");
    if off { "warn" } else { "ok" }
}

fn pdb_status(d: &PodDisruptionBudget) -> &'static str {
    if d.status.as_ref().is_some_and(|s| s.disruptions_allowed <= 0) { "warn" } else { "ok" }
}

// ─── Assembly (pure) ─────────────────────────────────────────────────────────

fn map_nodes(src: &Sources, ns: &str) -> Vec<MapNode> {
    let mut n = Vec::new();
    let ready = src.slices.as_deref().map(ready_endpoints);
    macro_rules! add {
        ($list:expr, $kind:expr, $status:expr) => {
            for o in $list.iter().flatten() {
                n.push(node($kind, ns, nm(&o.metadata), $status(o)));
            }
        };
    }
    add!(src.pods, "pods", pod_status);
    add!(src.deploys, "deploy", |d: &Deployment| {
        let want = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        replicas_status(want, d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0))
    });
    add!(src.stss, "sts", |d: &StatefulSet| {
        let want = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        replicas_status(want, d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0))
    });
    add!(src.dss, "ds", |d: &DaemonSet| {
        let st = d.status.as_ref();
        replicas_status(st.map_or(0, |s| s.desired_number_scheduled), st.map_or(0, |s| s.number_ready))
    });
    add!(src.rss, "rs", |d: &ReplicaSet| {
        let want = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        replicas_status(want, d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0))
    });
    add!(src.jobs, "jobs", job_status);
    add!(src.crons, "cron", |c: &CronJob| {
        if c.spec.as_ref().and_then(|s| s.suspend) == Some(true) { "warn" } else { "ok" }
    });
    add!(src.svcs, "svc", |s: &Service| svc_status(s, ready.as_ref()));
    add!(src.ings, "ing", |_: &Ingress| "ok");
    add!(src.pvcs, "pvc", pvc_status);
    add!(src.hpas, "hpa", hpa_status);
    add!(src.pdbs, "pdb", pdb_status);
    for g in src.gws.iter().flatten() {
        n.push(node("gw", ns, nm(&g.metadata), gateway_status(g)));
    }
    for r in src.routes.iter().flatten() {
        n.push(node("httproute", ns, nm(&r.metadata), route_status(r)));
    }
    for c in src.cms.iter().flatten().filter(|c| !INJECTED_CONFIGMAPS.contains(&c.as_str())) {
        n.push(node("cm", ns, c, "unknown"));
    }
    for s in src.secs.iter().flatten() {
        n.push(node("sec", ns, s, "unknown"));
    }
    // Only the PVs a listed PVC is bound to; the rest of the cluster's PVs are not this map's business.
    let bound: HashSet<&str> = src.pvcs.iter().flatten().filter_map(|c| c.spec.as_ref()?.volume_name.as_deref()).collect();
    for v in src.pvs.iter().flatten().filter(|v| bound.contains(nm(&v.metadata))) {
        n.push(node("pv", "", nm(&v.metadata), pv_status(v)));
    }
    n
}

/// With a focus: only its connected component (unknown focus: empty, not truncated). Without: all.
/// Over `ceiling` nodes: empty nodes and edges with `truncated: true`; never a partial graph.
pub(crate) fn limit_component(
    nodes: Vec<MapNode>,
    edges: Vec<MapEdge>,
    focus: Option<&str>,
    ceiling: usize,
) -> (Vec<MapNode>, Vec<MapEdge>, bool) {
    let keep: Option<HashSet<String>> = focus.map(|f| {
        let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
        for e in &edges {
            adj.entry(e.from.as_str()).or_default().push(e.to.as_str());
            adj.entry(e.to.as_str()).or_default().push(e.from.as_str());
        }
        let mut seen: HashSet<&str> = HashSet::new();
        if nodes.iter().any(|n| n.id == f) {
            let mut q = VecDeque::from([f]);
            seen.insert(f);
            while let Some(i) = q.pop_front() {
                for &j in adj.get(i).into_iter().flatten() {
                    if seen.insert(j) {
                        q.push_back(j);
                    }
                }
            }
        }
        seen.into_iter().map(String::from).collect()
    });
    let nodes: Vec<MapNode> = match &keep {
        Some(k) => nodes.into_iter().filter(|n| k.contains(&n.id)).collect(),
        None => nodes,
    };
    if nodes.len() > ceiling {
        return (Vec::new(), Vec::new(), true);
    }
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let edges = edges.into_iter().filter(|e| ids.contains(e.from.as_str()) && ids.contains(e.to.as_str())).collect();
    (nodes, edges, false)
}

pub(crate) fn build_map(src: &Sources, ns: &str, focus: Option<&str>, ceiling: usize, skipped: Vec<SkippedSource>) -> ResourceMap {
    let nodes = map_nodes(src, ns);
    let (pods, pvcs): (&[Pod], &[PersistentVolumeClaim]) =
        (src.pods.as_deref().unwrap_or(&[]), src.pvcs.as_deref().unwrap_or(&[]));

    let mut owners: Vec<(&str, &ObjectMeta)> = Vec::new();
    macro_rules! own {
        ($list:expr, $kind:expr) => {
            owners.extend($list.iter().flatten().map(|o| ($kind, &o.metadata)));
        };
    }
    own!(src.pods, "pods");
    own!(src.deploys, "deploy");
    own!(src.stss, "sts");
    own!(src.dss, "ds");
    own!(src.rss, "rs");
    own!(src.jobs, "jobs");
    own!(src.crons, "cron");

    let mut all = owner_edges(&owners, ns);
    all.extend(selector_edges(src.svcs.as_deref().unwrap_or(&[]), src.pdbs.as_deref().unwrap_or(&[]), pods, ns));
    all.extend(ingress_edges(src.ings.as_deref().unwrap_or(&[]), ns));
    all.extend(route_edges(src.routes.as_deref().unwrap_or(&[]), ns));
    all.extend(volume_edges(pods, pvcs, ns));
    all.extend(env_edges(pods, ns));
    all.extend(hpa_edges(src.hpas.as_deref().unwrap_or(&[]), ns));

    // One place drops dangling edges (forbidden source, other namespace, object gone) and exact duplicates.
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let mut seen = BTreeSet::new();
    all.retain(|e| {
        ids.contains(e.from.as_str())
            && ids.contains(e.to.as_str())
            && seen.insert((e.from.clone(), e.to.clone(), e.relation.clone(), e.detail.clone()))
    });

    let (nodes, edges, truncated) = limit_component(nodes, all, focus, ceiling);
    ResourceMap { nodes, edges, truncated, skipped }
}

/// `"<kind>/<name>"` -> node id. PVs are cluster-scoped (namespace "").
pub(crate) fn focus_id(focus: &str, ns: &str) -> Option<String> {
    let (kind, name) = focus.split_once('/').filter(|(k, n)| !k.is_empty() && !n.is_empty())?;
    Some(id(kind, if kind == "pv" { "" } else { ns }, name))
}

/// A map is per namespace; "" and "all" would turn the namespaced lists into cluster-wide ones.
pub(crate) fn map_namespace(ns: &str) -> Result<&str, String> {
    match ns.trim() {
        "" | "all" => Err("Failed to build resource map: pick a namespace".to_string()),
        n => Ok(n),
    }
}

fn names(l: Vec<PartialObjectMeta<impl Clone>>) -> Vec<String> {
    l.into_iter().map(|o| o.metadata.name.unwrap_or_default()).collect()
}

#[tauri::command]
pub async fn get_resource_map(context: String, namespace: String, focus: Option<String>) -> Result<ResourceMap, String> {
    let ns = map_namespace(&namespace)?.to_string();
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let lp = ListParams::default();
    // Helm release storage and legacy token Secrets stay out of the map (same selector as unused.rs).
    let secret_lp = ListParams::default().fields("type!=kubernetes.io/service-account-token,type!=helm.sh/release.v1");
    macro_rules! api {
        ($ty:ty) => {
            Api::<$ty>::namespaced(client.clone(), &ns)
        };
    }
    let (gw_ar, rt_ar) = (gateway_api_resource(), httproute_api_resource());
    let gws_api: Api<DynamicObject> = Api::namespaced_with(client.clone(), &ns, &gw_ar);
    let routes_api: Api<DynamicObject> = Api::namespaced_with(client.clone(), &ns, &rt_ar);
    let pvs_api: Api<PersistentVolume> = Api::all(client.clone());
    let (pods_a, deploys_a, stss_a, dss_a, rss_a) =
        (api!(Pod), api!(Deployment), api!(StatefulSet), api!(DaemonSet), api!(ReplicaSet));
    let (jobs_a, crons_a, svcs_a, slices_a, ings_a) =
        (api!(Job), api!(CronJob), api!(Service), api!(EndpointSlice), api!(Ingress));
    let (pvcs_a, cms_a, secs_a, hpas_a, pdbs_a) =
        (api!(PersistentVolumeClaim), api!(ConfigMap), api!(Secret), api!(HorizontalPodAutoscaler), api!(PodDisruptionBudget));
    let (pods, deploys, stss, dss, rss, jobs, crons, svcs, slices) = tokio::join!(
        pods_a.list(&lp),
        deploys_a.list(&lp),
        stss_a.list(&lp),
        dss_a.list(&lp),
        rss_a.list(&lp),
        jobs_a.list(&lp),
        crons_a.list(&lp),
        svcs_a.list(&lp),
        slices_a.list(&lp),
    );
    let (ings, gws, routes, pvcs, pvs, cms, secs, hpas, pdbs) = tokio::join!(
        ings_a.list(&lp),
        gws_api.list(&lp),
        routes_api.list(&lp),
        pvcs_a.list(&lp),
        pvs_api.list(&lp),
        cms_a.list_metadata(&lp),
        secs_a.list_metadata(&secret_lp), // metadata only: no Secret data crosses the wire
        hpas_a.list(&lp),
        pdbs_a.list(&lp),
    );

    let mut skipped = Vec::new();
    let src = Sources {
        pods: take(pods, "pods", false, &mut skipped),
        deploys: take(deploys, "deployments", false, &mut skipped),
        stss: take(stss, "statefulsets", false, &mut skipped),
        dss: take(dss, "daemonsets", false, &mut skipped),
        rss: take(rss, "replicasets", false, &mut skipped),
        jobs: take(jobs, "jobs", false, &mut skipped),
        crons: take(crons, "cronjobs", false, &mut skipped),
        svcs: take(svcs, "services", false, &mut skipped),
        slices: take(slices, "endpointslices", false, &mut skipped),
        ings: take(ings, "ingresses", false, &mut skipped),
        gws: take(gws, "gateways", true, &mut skipped),
        routes: take(routes, "httproutes", true, &mut skipped),
        pvcs: take(pvcs, "persistentvolumeclaims", false, &mut skipped),
        pvs: take(pvs, "persistentvolumes", false, &mut skipped),
        cms: take(cms, "configmaps", false, &mut skipped).map(names),
        secs: take(secs, "secrets", false, &mut skipped).map(names),
        hpas: take(hpas, "horizontalpodautoscalers", false, &mut skipped),
        pdbs: take(pdbs, "poddisruptionbudgets", false, &mut skipped),
    };
    let focus = focus.as_deref().and_then(|f| focus_id(f, &ns));
    Ok(build_map(&src, &ns, focus.as_deref(), NODE_CEILING, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
        serde_json::from_value(v).expect("fixture")
    }
    fn pod(name: &str, labels: Value, spec: Value) -> Pod {
        from(json!({"metadata": {"name": name, "uid": format!("uid-{name}"), "labels": labels}, "spec": spec}))
    }
    fn ep(e: &MapEdge) -> (&str, &str, &str) {
        (e.from.as_str(), e.to.as_str(), e.relation.as_str())
    }

    #[test]
    fn owner_edges_follow_uids_and_skip_unknown_owners() {
        let rs: ReplicaSet = from(json!({"metadata": {"name": "web-1", "uid": "u-rs", "ownerReferences": [{"apiVersion":"apps/v1","kind":"Deployment","name":"web","uid":"u-d"}]}}));
        let d: Deployment = from(json!({"metadata": {"name": "web", "uid": "u-d", "ownerReferences": [{"apiVersion":"x","kind":"Y","name":"z","uid":"elsewhere"}]}}));
        let p: Pod = from(json!({"metadata": {"name": "web-1-a", "uid": "u-p", "ownerReferences": [{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"web-1","uid":"u-rs"}]}}));
        let e = owner_edges(&[("pods", &p.metadata), ("rs", &rs.metadata), ("deploy", &d.metadata)], "ns");
        assert_eq!(e.iter().map(ep).collect::<Vec<_>>(), vec![
            ("rs/ns/web-1", "pods/ns/web-1-a", "owns"),
            ("deploy/ns/web", "rs/ns/web-1", "owns"),
        ]);
    }

    #[test]
    fn selector_edges_service_pdb_and_unmatched_service() {
        let pods = vec![pod("a", json!({"app": "web"}), json!({"containers": []})), pod("b", json!({"app": "db"}), json!({"containers": []}))];
        let svc: Service = from(json!({"metadata": {"name": "web"}, "spec": {"selector": {"app": "web"}, "ports": [{"port": 80, "targetPort": 8080}, {"port": 443}]}}));
        let lost: Service = from(json!({"metadata": {"name": "ghost"}, "spec": {"selector": {"app": "nope"}}}));
        let none: Service = from(json!({"metadata": {"name": "headless-no-selector"}, "spec": {}}));
        let pdb: PodDisruptionBudget = from(json!({"metadata": {"name": "p"}, "spec": {"selector": {"matchLabels": {"app": "db"}}}}));
        let nosel: PodDisruptionBudget = from(json!({"metadata": {"name": "q"}, "spec": {}}));
        let e = selector_edges(&[svc, lost, none], &[pdb, nosel], &pods, "ns");
        assert_eq!(e.iter().map(ep).collect::<Vec<_>>(), vec![
            ("svc/ns/web", "pods/ns/a", "selects"),
            ("pdb/ns/p", "pods/ns/b", "protects"),
        ]);
        assert_eq!(e[0].detail, "80 → 8080, 443 → 443");
    }

    #[test]
    fn ingress_edges_paths_hosts_and_default_backend() {
        let ing: Ingress = from(json!({"metadata": {"name": "i"}, "spec": {
            "defaultBackend": {"service": {"name": "fallback", "port": {"number": 80}}},
            "rules": [{"host": "a.io", "http": {"paths": [
                {"path": "/api", "pathType": "Prefix", "backend": {"service": {"name": "api", "port": {"number": 80}}}},
                {"pathType": "Prefix", "backend": {"resource": {"kind": "Bucket", "name": "b"}}}]}}, {"http": {"paths": [
                {"pathType": "Prefix", "backend": {"service": {"name": "web", "port": {"name": "http"}}}}]}}]}}));
        let e = ingress_edges(&[ing], "ns");
        assert_eq!(e.iter().map(|e| (e.to.as_str(), e.detail.as_str())).collect::<Vec<_>>(), vec![
            ("svc/ns/fallback", "default backend"), ("svc/ns/api", "a.io path /api"), ("svc/ns/web", "path /"),
        ]);
    }

    #[test]
    fn route_edges_parents_backends_and_foreign_kinds() {
        let r: DynamicObject = from(json!({"apiVersion": "gateway.networking.k8s.io/v1", "kind": "HTTPRoute", "metadata": {"name": "r"}, "spec": {
            "parentRefs": [{"name": "gw", "sectionName": "http"}, {"kind": "Mesh", "name": "m"}, {"name": "other", "namespace": "edge"}],
            "rules": [{"matches": [{"path": {"value": "/x"}}], "backendRefs": [{"name": "svc", "port": 8080}, {"kind": "Thing", "name": "t"}, {"name": "far", "namespace": "o"}]}]}}));
        let e = route_edges(&[r], "ns");
        assert_eq!(e.iter().map(|e| (e.to.as_str(), e.relation.as_str(), e.detail.as_str())).collect::<Vec<_>>(), vec![
            ("gw/ns/gw", "attaches-to", "listener http"), ("gw/edge/other", "attaches-to", ""),
            ("svc/ns/svc", "routes-to", "path /x, port 8080"), ("svc/o/far", "routes-to", "path /x"),
        ]);
        // a malformed route never panics
        let bad: DynamicObject = from(json!({"metadata": {"name": "b"}, "spec": {"parentRefs": "x", "rules": [1, {"backendRefs": [null]}]}}));
        assert!(route_edges(&[bad], "ns").is_empty());
    }

    #[test]
    fn volume_edges_pvc_config_secret_projected_and_binding() {
        let p = pod("a", json!({}), json!({"containers": [], "volumes": [
            {"name": "d", "persistentVolumeClaim": {"claimName": "data"}},
            {"name": "c", "configMap": {"name": "cfg"}},
            {"name": "s", "secret": {"secretName": "tok"}},
            {"name": "pr", "projected": {"sources": [{"configMap": {"name": "pcfg"}}, {"secret": {"name": "psec"}}, {"serviceAccountToken": {"path": "t"}}]}},
            {"name": "e", "emptyDir": {}}]}));
        let pvc: PersistentVolumeClaim = from(json!({"metadata": {"name": "data"}, "spec": {"volumeName": "pv-1"}}));
        let unbound: PersistentVolumeClaim = from(json!({"metadata": {"name": "new"}, "spec": {}}));
        let e = volume_edges(&[p], &[pvc, unbound], "ns");
        assert_eq!(e.iter().map(ep).collect::<Vec<_>>(), vec![
            ("pods/ns/a", "pvc/ns/data", "mounts"), ("pods/ns/a", "cm/ns/cfg", "uses-config"),
            ("pods/ns/a", "sec/ns/tok", "uses-secret"), ("pods/ns/a", "cm/ns/pcfg", "uses-config"),
            ("pods/ns/a", "sec/ns/psec", "uses-secret"), ("pvc/ns/data", "pv//pv-1", "binds"),
        ]);
        assert_eq!(e[3].detail, "projected volume pr");
    }

    #[test]
    fn env_edges_value_from_env_from_and_init_containers() {
        let p = pod("a", json!({}), json!({
            "containers": [{"name": "m", "env": [
                {"name": "A", "valueFrom": {"configMapKeyRef": {"name": "cfg", "key": "k"}}},
                {"name": "B", "valueFrom": {"secretKeyRef": {"name": "sec", "key": "k"}}},
                {"name": "C", "value": "plain"}], "envFrom": [{"configMapRef": {"name": "all"}}]}],
            "initContainers": [{"name": "i", "envFrom": [{"secretRef": {"name": "isec"}}]}]}));
        let e = env_edges(&[p], "ns");
        assert_eq!(e.iter().map(|e| (e.to.as_str(), e.relation.as_str(), e.detail.as_str())).collect::<Vec<_>>(), vec![
            ("cm/ns/cfg", "uses-config", "env"), ("sec/ns/sec", "uses-secret", "env"),
            ("cm/ns/all", "uses-config", "envFrom"), ("sec/ns/isec", "uses-secret", "envFrom"),
        ]);
    }

    #[test]
    fn hpa_edges_known_targets_only() {
        let mk = |kind: &str| -> HorizontalPodAutoscaler {
            from(json!({"metadata": {"name": "h"}, "spec": {"scaleTargetRef": {"kind": kind, "name": "web"}, "minReplicas": 2, "maxReplicas": 6}}))
        };
        let e = hpa_edges(&[mk("Deployment"), mk("StatefulSet"), mk("Rollout")], "ns");
        assert_eq!(e.iter().map(ep).collect::<Vec<_>>(), vec![("hpa/ns/h", "deploy/ns/web", "scales"), ("hpa/ns/h", "sts/ns/web", "scales")]);
        assert_eq!(e[0].detail, "2–6 replicas");
    }

    fn n(kind: &str, name: &str) -> MapNode {
        node(kind, "ns", name, "ok")
    }
    fn e(a: &str, b: &str) -> MapEdge {
        edge(a, b, "owns", "")
    }

    #[test]
    fn limit_component_focus_ceiling_and_unknown_focus() {
        // component A: a0 - a1 - a2; component B: b0 - b1 - b2 - b3; loner x
        let nodes: Vec<MapNode> = ["a0", "a1", "a2", "b0", "b1", "b2", "b3", "x"].iter().map(|s| n("cm", s)).collect();
        let edges = vec![e("cm/ns/a0", "cm/ns/a1"), e("cm/ns/a1", "cm/ns/a2"), e("cm/ns/b0", "cm/ns/b1"), e("cm/ns/b1", "cm/ns/b2"), e("cm/ns/b2", "cm/ns/b3")];
        let ids = |v: &[MapNode]| v.iter().map(|n| n.name.clone()).collect::<Vec<_>>();
        // no focus, under the ceiling: everything
        let (all, ae, t) = limit_component(nodes.clone(), edges.clone(), None, 50);
        assert!((all.len(), ae.len(), t) == (8, 5, false));
        // focus under the ceiling: the whole component only
        let (f, fe, t) = limit_component(nodes.clone(), edges.clone(), Some("cm/ns/a1"), 50);
        assert_eq!((ids(&f), fe.len(), t), (vec!["a0".into(), "a1".into(), "a2".into()], 2, false));
        // over the ceiling: empty with truncated, never a partial graph (focus is applied first)
        let (z, ze, t) = limit_component(nodes.clone(), edges.clone(), None, 7);
        assert!(z.is_empty() && ze.is_empty() && t);
        let (z, ze, t) = limit_component(nodes.clone(), edges.clone(), Some("cm/ns/b1"), 3);
        assert!(z.is_empty() && ze.is_empty() && t);
        let (f, _, t) = limit_component(nodes.clone(), edges.clone(), Some("cm/ns/b1"), 4);
        assert_eq!((f.len(), t), (4, false));
        // unknown focus: empty, not truncated
        let (z, ze, t) = limit_component(nodes, edges, Some("cm/ns/nope"), 5);
        assert!(z.is_empty() && ze.is_empty() && !t);
    }

    #[test]
    fn injected_root_ca_configmap_neither_joins_pods_nor_becomes_a_node() {
        let vols = json!({"containers": [], "volumes": [{"name": "kube-api-access-x", "projected": {"sources": [
            {"serviceAccountToken": {"path": "token"}}, {"configMap": {"name": "kube-root-ca.crt"}}]}}]});
        let src = Sources {
            pods: Some(vec![pod("a", json!({}), vols.clone()), pod("b", json!({}), vols)]),
            cms: Some(vec!["kube-root-ca.crt".into(), "openshift-service-ca.crt".into(), "real".into()]),
            ..Default::default()
        };
        let m = build_map(&src, "ns", None, 2000, vec![]);
        assert!(m.edges.is_empty());
        assert_eq!(m.nodes.iter().filter(|n| n.kind == "cm").map(|n| n.name.as_str()).collect::<Vec<_>>(), ["real"]);
        // the cm and secret nodes carry "unknown" status
        assert!(m.nodes.iter().filter(|n| n.kind == "cm").all(|n| n.status == "unknown"));
    }

    #[test]
    fn two_unrelated_deployments_are_two_components() {
        let dep = |name: &str| -> Deployment { from(json!({"metadata": {"name": name, "uid": format!("u-{name}")}})) };
        let owned = |name: &str, owner: &str| -> Pod {
            from(json!({"metadata": {"name": name, "uid": format!("u-{name}"), "ownerReferences": [{"apiVersion": "apps/v1", "kind": "Deployment", "name": owner, "uid": format!("u-{owner}")}]},
                "spec": {"containers": [], "volumes": [{"name": "k", "projected": {"sources": [{"configMap": {"name": "kube-root-ca.crt"}}]}}]}}))
        };
        let src = Sources {
            deploys: Some(vec![dep("a"), dep("b")]),
            pods: Some(vec![owned("a-1", "a"), owned("b-1", "b")]),
            cms: Some(vec!["kube-root-ca.crt".into()]),
            ..Default::default()
        };
        let m = build_map(&src, "ns", focus_id("deploy/a", "ns").as_deref(), 2000, vec![]);
        assert_eq!(m.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["pods/ns/a-1", "deploy/ns/a"]);
        assert_eq!(m.edges.len(), 1);
    }

    fn fixture(with_secrets: bool) -> Sources {
        Sources {
            pods: Some(vec![pod("a", json!({"app": "web"}), json!({"containers": [{"name": "m", "envFrom": [{"secretRef": {"name": "tok"}}, {"configMapRef": {"name": "cfg"}}]}]}))]),
            svcs: Some(vec![from(json!({"metadata": {"name": "web"}, "spec": {"selector": {"app": "web"}}}))]),
            cms: Some(vec!["cfg".into()]),
            secs: with_secrets.then(|| vec!["tok".to_string()]),
            ..Default::default()
        }
    }

    #[test]
    fn forbidden_secrets_remove_only_uses_secret_edges() {
        let rel = |m: &ResourceMap| m.edges.iter().map(|e| e.relation.clone()).collect::<Vec<_>>();
        let ok = build_map(&fixture(true), "ns", None, 400, vec![]);
        assert_eq!(rel(&ok), ["selects", "uses-secret", "uses-config"]);
        assert!(ok.nodes.iter().any(|n| n.kind == "sec"));
        let skip = vec![SkippedSource { source: "secrets".into(), reason: "forbidden".into() }];
        let no = build_map(&fixture(false), "ns", None, 400, skip);
        assert_eq!(rel(&no), ["selects", "uses-config"]);
        assert!(no.nodes.iter().all(|n| n.kind != "sec"));
        assert_eq!(no.skipped.len(), 1);
        // no edge ever points at a missing node
        let ids: HashSet<_> = no.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(no.edges.iter().all(|e| ids.contains(e.from.as_str()) && ids.contains(e.to.as_str())));
    }

    #[test]
    fn service_without_matching_pod_has_no_selects_edge_and_warns() {
        let mut src = fixture(true);
        src.svcs = Some(vec![from(json!({"metadata": {"name": "ghost"}, "spec": {"selector": {"app": "none"}}}))]);
        src.slices = Some(vec![]);
        let m = build_map(&src, "ns", None, 400, vec![]);
        assert!(m.edges.iter().all(|e| e.relation != "selects"));
        assert_eq!(m.nodes.iter().find(|n| n.kind == "svc").map(|n| n.status.as_str()), Some("warn"));
    }

    #[test]
    fn pv_nodes_only_for_bound_claims_and_dangling_pvs_are_dropped() {
        let src = Sources {
        pvcs: Some(vec![from(json!({"metadata": {"name": "data"}, "spec": {"volumeName": "pv-1"}, "status": {"phase": "Bound"}}))]),
        pvs: Some(vec![from(json!({"metadata": {"name": "pv-1"}, "status": {"phase": "Bound"}})), from(json!({"metadata": {"name": "other"}}))]),
        ..Default::default()
        };
        let m = build_map(&src, "ns", Some("pvc/data").and_then(|f| focus_id(f, "ns")).as_deref(), 400, vec![]);
        assert_eq!(m.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["pvc/ns/data", "pv//pv-1"]);
        assert_eq!(m.edges.len(), 1);
    }

    #[test]
    fn focus_and_namespace_scope_rules() {
        assert_eq!(focus_id("deploy/web", "ns").as_deref(), Some("deploy/ns/web"));
        assert_eq!(focus_id("pv/vol", "ns").as_deref(), Some("pv//vol"));
        assert_eq!(focus_id("deploy", "ns"), None);
        assert_eq!(focus_id("/x", "ns"), None);
        assert!(map_namespace("").is_err() && map_namespace("all").is_err());
        assert_eq!(map_namespace("prod"), Ok("prod"));
    }

    #[test]
    fn ready_endpoints_need_an_address_and_not_ready_false() {
        let s: EndpointSlice = from(json!({"metadata": {"name": "s", "labels": {"kubernetes.io/service-name": "web"}}, "addressType": "IPv4", "endpoints": [
            {"addresses": ["10.0.0.1"]}, {"addresses": ["10.0.0.2"], "conditions": {"ready": false}}, {"addresses": []}, {"addresses": ["10.0.0.3"], "conditions": {"ready": true}}]}));
        assert_eq!(ready_endpoints(&[s]).get("web"), Some(&2));
    }

    #[test]
    fn pod_and_replica_status_rules() {
        let crash: Pod = from(json!({"metadata": {"name": "p"}, "status": {"phase": "Running", "containerStatuses": [{"name": "m", "image": "i", "imageID": "", "ready": false, "restartCount": 3, "state": {"waiting": {"reason": "CrashLoopBackOff"}}}]}}));
        let unready: Pod = from(json!({"metadata": {"name": "p"}, "status": {"phase": "Running", "containerStatuses": [{"name": "m", "image": "i", "imageID": "", "ready": false, "restartCount": 0}]}}));
        let up: Pod = from(json!({"metadata": {"name": "p"}, "status": {"phase": "Running", "containerStatuses": [{"name": "m", "image": "i", "imageID": "", "ready": true, "restartCount": 0}]}}));
        assert_eq!((pod_status(&crash), pod_status(&unready), pod_status(&up), pod_status(&Pod::default())), ("bad", "warn", "ok", "unknown"));
        assert_eq!((replicas_status(3, 3), replicas_status(3, 1), replicas_status(3, 0), replicas_status(0, 0)), ("ok", "warn", "bad", "ok"));
    }

    #[test]
    fn over_the_ceiling_build_map_is_empty_and_truncated() {
        let src = Sources { cms: Some((0..5).map(|i| format!("c{i}")).collect()), ..Default::default() };
        let m = build_map(&src, "ns", None, 3, vec![]);
        assert!(m.truncated && m.nodes.is_empty() && m.edges.is_empty());
    }
}
