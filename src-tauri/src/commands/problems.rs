//! `list_problems`: deterministic, read-only health rules over the cluster's current state.
//!
//! Every rule is a pure function over typed inputs (unit-tested with no cluster). A source that
//! cannot be listed (401/403/any API error) lands in `skipped` and the rules that need it do not
//! run; only client construction is an `Err`. No Secret data leaves this module: TLS Secrets are
//! parsed with the panic-free `tls_cert` parser for `not_after`/`not_before` only, and `tls.key`
//! is never read.

use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::{
    ContainerStatus, Event as K8sEvent, Node as K8sNode, PersistentVolumeClaim, Pod as K8sPod, PodSpec,
    Secret as K8sSecret, Service,
};
use k8s_openapi::api::discovery::v1::EndpointSlice;
use kube::{
    api::{DynamicObject, ListParams},
    core::ObjectList,
    Api,
};
use serde::{Deserialize, Serialize};

use super::certmanager::certificate_api_resource;
use super::tls_cert::parse_pem_bundle;
use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProblemEvidence {
    pub source: String, // "field" | "event"
    pub path: String,
    pub value: String, // verbatim, truncated at 500 chars on a char boundary
    pub event_age: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Finding {
    pub id: String, // "<rule>/<kind>/<namespace>/<name>[/<container>]"
    pub rule: String,
    pub severity: String, // "critical" | "warning" | "info"
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub container: Option<String>,
    pub summary: String,
    pub evidence: Vec<ProblemEvidence>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CertExpiryFact {
    pub kind: String, // "cert" | "sec"
    pub namespace: String,
    pub name: String,
    pub not_after: String, // RFC3339
    pub not_before: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkippedSource {
    pub source: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProblemReport {
    pub findings: Vec<Finding>,
    pub cert_expiry: Vec<CertExpiryFact>,
    pub skipped: Vec<SkippedSource>,
}

// ─── Small builders ──────────────────────────────────────────────────────────

const EVIDENCE_MAX_CHARS: usize = 500;

/// First 500 chars (never splits a multi-byte character).
fn trunc(s: &str) -> String {
    s.chars().take(EVIDENCE_MAX_CHARS).collect()
}

fn field(path: impl Into<String>, value: &str) -> ProblemEvidence {
    ProblemEvidence { source: "field".into(), path: path.into(), value: trunc(value), event_age: None }
}

fn finding(
    rule: &str,
    severity: &str,
    kind: &str,
    (ns, name): (&str, &str),
    container: Option<&str>,
    summary: String,
    evidence: Vec<ProblemEvidence>,
) -> Finding {
    let id = match container {
        Some(c) => format!("{rule}/{kind}/{ns}/{name}/{c}"),
        None => format!("{rule}/{kind}/{ns}/{name}"),
    };
    Finding {
        id,
        rule: rule.into(),
        severity: severity.into(),
        kind: kind.into(),
        namespace: ns.into(),
        name: name.into(),
        container: container.map(String::from),
        summary,
        evidence,
    }
}

fn ns_name(m: &k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta) -> (String, String) {
    (m.namespace.clone().unwrap_or_default(), m.name.clone().unwrap_or_default())
}

/// A status condition, reduced to the four fields the rules read.
struct Cond {
    type_: String,
    status: String,
    reason: String,
    message: String,
}

/// `Option<&Vec<XCondition>>` (any k8s-openapi condition type with these four fields) to `Vec<Cond>`.
macro_rules! conds {
    ($v:expr) => {
        $v.into_iter()
            .flatten()
            .map(|c| Cond {
                type_: c.type_.clone(),
                status: c.status.clone(),
                reason: c.reason.clone().unwrap_or_default(),
                message: c.message.clone().unwrap_or_default(),
            })
            .collect::<Vec<Cond>>()
    };
}

fn cond_evidence(path: &str, c: &Cond) -> ProblemEvidence {
    field(path, &format!("{}: {}", c.reason, c.message))
}

pub(crate) fn event_time(e: &K8sEvent) -> Option<DateTime<Utc>> {
    e.last_timestamp
        .as_ref()
        .map(|t| t.0)
        .or(e.event_time.as_ref().map(|t| t.0))
        .or(e.metadata.creation_timestamp.as_ref().map(|t| t.0))
}

/// Newest event whose `involvedObject.kind` AND name (and namespace) match and whose reason is
/// one of `reasons`. Matching on name alone would attach a Service's event to a same-named Deployment.
fn newest_event(
    events: &[K8sEvent],
    kind: &str,
    (ns, name): (&str, &str),
    reasons: &[&str],
) -> Option<ProblemEvidence> {
    events
        .iter()
        .filter(|e| {
            e.involved_object.kind.as_deref() == Some(kind)
                && e.involved_object.name.as_deref() == Some(name)
                && e.involved_object
                    .namespace
                    .as_deref()
                    .or(e.metadata.namespace.as_deref())
                    .unwrap_or("")
                    == ns
                && e.reason.as_deref().is_some_and(|r| reasons.contains(&r))
        })
        .max_by_key(|e| event_time(e))
        .map(|e| ProblemEvidence {
            source: "event".into(),
            path: e.reason.clone().unwrap_or_default(),
            value: trunc(e.message.as_deref().unwrap_or("")),
            event_age: Some(age_from_timestamp(event_time(e).as_ref())),
        })
}

fn app_statuses(pod: &K8sPod) -> impl Iterator<Item = &ContainerStatus> {
    pod.status.iter().flat_map(|s| s.container_statuses.iter().flatten())
}

fn init_statuses(pod: &K8sPod) -> impl Iterator<Item = &ContainerStatus> {
    pod.status.iter().flat_map(|s| s.init_container_statuses.iter().flatten())
}

fn waiting_reason(cs: &ContainerStatus) -> Option<&str> {
    cs.state.as_ref()?.waiting.as_ref()?.reason.as_deref()
}

// ─── Pod rules ───────────────────────────────────────────────────────────────

fn crashloop(pod: &K8sPod, events: &[K8sEvent]) -> Vec<Finding> {
    let (ns, name) = ns_name(&pod.metadata);
    app_statuses(pod)
        .filter(|cs| waiting_reason(cs) == Some("CrashLoopBackOff"))
        .map(|cs| {
            let base = format!("status.containerStatuses[{}].lastState.terminated", cs.name);
            let mut ev = Vec::new();
            if let Some(t) = cs.last_state.as_ref().and_then(|s| s.terminated.as_ref()) {
                if let Some(r) = &t.reason {
                    ev.push(field(format!("{base}.reason"), r));
                }
                ev.push(field(format!("{base}.exitCode"), &t.exit_code.to_string()));
            }
            ev.extend(newest_event(events, "Pod", (&ns, &name), &["BackOff"]));
            finding("crashloop", "critical", "pods", (&ns, &name), Some(&cs.name),
                format!("Container {} is in CrashLoopBackOff.", cs.name), ev)
        })
        .collect()
}

fn oom_killed(pod: &K8sPod) -> Vec<Finding> {
    let (ns, name) = ns_name(&pod.metadata);
    app_statuses(pod)
        .filter(|cs| {
            cs.restart_count > 0
                && cs.last_state.as_ref().and_then(|s| s.terminated.as_ref()).and_then(|t| t.reason.as_deref())
                    == Some("OOMKilled")
        })
        .map(|cs| {
            let mut ev = vec![field(
                format!("status.containerStatuses[{}].lastState.terminated.reason", cs.name),
                "OOMKilled",
            )];
            let limit = pod
                .spec
                .iter()
                .flat_map(|s| s.containers.iter())
                .find(|c| c.name == cs.name)
                .and_then(|c| c.resources.as_ref()?.limits.as_ref()?.get("memory"));
            if let Some(q) = limit {
                ev.push(field(format!("spec.containers[{}].resources.limits.memory", cs.name), &q.0));
            }
            finding("oom-killed", "critical", "pods", (&ns, &name), Some(&cs.name),
                format!("Container {} was OOMKilled and has restarted {} time(s).", cs.name, cs.restart_count), ev)
        })
        .collect()
}

fn image_pull(pod: &K8sPod) -> Vec<Finding> {
    let (ns, name) = ns_name(&pod.metadata);
    app_statuses(pod)
        .filter(|cs| matches!(waiting_reason(cs), Some("ErrImagePull") | Some("ImagePullBackOff")))
        .map(|cs| {
            let msg = cs.state.as_ref().and_then(|s| s.waiting.as_ref()).and_then(|w| w.message.as_deref());
            let ev = msg
                .map(|m| field(format!("status.containerStatuses[{}].state.waiting.message", cs.name), m))
                .into_iter()
                .collect();
            finding("image-pull", "critical", "pods", (&ns, &name), Some(&cs.name),
                format!("Container {} cannot pull its image.", cs.name), ev)
        })
        .collect()
}

fn init_failing(pod: &K8sPod) -> Vec<Finding> {
    let (ns, name) = ns_name(&pod.metadata);
    init_statuses(pod)
        .filter_map(|cs| {
            let base = format!("status.initContainerStatuses[{}].state", cs.name);
            let st = cs.state.as_ref()?;
            let ev = if let Some(w) = st.waiting.as_ref().filter(|w| w.reason.as_deref().is_some_and(|r| r.contains("BackOff"))) {
                field(format!("{base}.waiting.reason"), w.reason.as_deref().unwrap_or(""))
            } else if let Some(t) = st.terminated.as_ref().filter(|t| t.exit_code != 0) {
                field(format!("{base}.terminated.exitCode"), &t.exit_code.to_string())
            } else {
                return None;
            };
            Some(finding("init-failing", "critical", "pods", (&ns, &name), Some(&cs.name),
                format!("Init container {} is failing.", cs.name), vec![ev]))
        })
        .collect()
}

fn unschedulable(pod: &K8sPod, events: &[K8sEvent]) -> Vec<Finding> {
    let (ns, name) = ns_name(&pod.metadata);
    let Some(status) = pod.status.as_ref() else { return Vec::new() };
    if status.phase.as_deref() != Some("Pending") {
        return Vec::new();
    }
    let Some(c) = status.conditions.iter().flatten().find(|c| {
        c.type_ == "PodScheduled" && c.status == "False" && c.reason.as_deref() == Some("Unschedulable")
    }) else {
        return Vec::new();
    };
    let mut ev = vec![field("status.conditions[PodScheduled].message", c.message.as_deref().unwrap_or(""))];
    ev.extend(newest_event(events, "Pod", (&ns, &name), &["FailedScheduling"]));
    vec![finding("unschedulable", "critical", "pods", (&ns, &name), None,
        "Pod cannot be scheduled onto any node.".into(), ev)]
}

/// One `info` finding per container of a Deployment/StatefulSet pod template with no readiness
/// probe. Scaled-to-zero workloads (`replicas: 0`) are skipped.
fn missing_probes(kind: &str, (ns, name): (&str, &str), replicas: Option<i32>, template: Option<&PodSpec>) -> Vec<Finding> {
    if replicas == Some(0) {
        return Vec::new();
    }
    template
        .into_iter()
        .flat_map(|t| t.containers.iter())
        .filter(|c| c.readiness_probe.is_none())
        .map(|c| {
            finding("missing-probes", "info", kind, (ns, name), Some(&c.name),
                format!("Container {} has no readiness probe.", c.name),
                vec![field(format!("spec.template.spec.containers[{}].readinessProbe", c.name), "absent")])
        })
        .collect()
}

// ─── Workload / Job / Service / PVC / Node rules ─────────────────────────────

/// deploy/sts/ds with fewer ready than desired replicas and a stuck-rollout or unavailable condition.
fn workload_unavailable(kind: &str, (ns, name): (&str, &str), desired: i32, ready: i32, conds: &[Cond]) -> Option<Finding> {
    if ready >= desired {
        return None;
    }
    let (path, c) = conds
        .iter()
        .find(|c| c.type_ == "Progressing" && c.status == "False" && c.reason == "ProgressDeadlineExceeded")
        .map(|c| ("status.conditions[Progressing]", c))
        .or_else(|| {
            conds.iter().find(|c| c.type_ == "Available" && c.status == "False").map(|c| ("status.conditions[Available]", c))
        })?;
    Some(finding("workload-unavailable", "warning", kind, (ns, name), None,
        format!("{ready} of {desired} replicas are ready."), vec![cond_evidence(path, c)]))
}

fn workloads(s: &Sources) -> Vec<Finding> {
    let mut out = Vec::new();
    for d in s.deploys.iter().flatten() {
        let (ns, name) = ns_name(&d.metadata);
        let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        let ready = d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
        let conds = conds!(d.status.as_ref().and_then(|s| s.conditions.as_ref()));
        out.extend(workload_unavailable("deploy", (&ns, &name), desired, ready, &conds));
        out.extend(missing_probes("deploy", (&ns, &name), d.spec.as_ref().and_then(|s| s.replicas), d.spec.as_ref().and_then(|s| s.template.spec.as_ref())));
    }
    for d in s.stss.iter().flatten() {
        let (ns, name) = ns_name(&d.metadata);
        let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
        let ready = d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
        let conds = conds!(d.status.as_ref().and_then(|s| s.conditions.as_ref()));
        out.extend(workload_unavailable("sts", (&ns, &name), desired, ready, &conds));
        out.extend(missing_probes("sts", (&ns, &name), d.spec.as_ref().and_then(|s| s.replicas), d.spec.as_ref().and_then(|s| s.template.spec.as_ref())));
    }
    for d in s.dss.iter().flatten() {
        let (ns, name) = ns_name(&d.metadata);
        let (desired, ready) = d.status.as_ref().map(|s| (s.desired_number_scheduled, s.number_ready)).unwrap_or((0, 0));
        let conds = conds!(d.status.as_ref().and_then(|s| s.conditions.as_ref()));
        out.extend(workload_unavailable("ds", (&ns, &name), desired, ready, &conds));
    }
    out
}

fn job_failed(job: &Job) -> Option<Finding> {
    let (ns, name) = ns_name(&job.metadata);
    let conds = conds!(job.status.as_ref().and_then(|s| s.conditions.as_ref()));
    let c = conds.iter().find(|c| c.type_ == "Failed" && c.status == "True")?;
    Some(finding("job-failed", "warning", "jobs", (&ns, &name), None,
        "Job has failed.".into(), vec![cond_evidence("status.conditions[Failed]", c)]))
}

fn service_no_endpoints(svc: &Service, slices: &[EndpointSlice]) -> Option<Finding> {
    let (ns, name) = ns_name(&svc.metadata);
    let spec = svc.spec.as_ref()?;
    let selector = spec.selector.as_ref().filter(|s| !s.is_empty())?;
    if spec.type_.as_deref() == Some("ExternalName") {
        return None;
    }
    let mine: Vec<&EndpointSlice> = slices
        .iter()
        .filter(|s| {
            s.metadata.namespace.as_deref().unwrap_or("") == ns
                && s.metadata.labels.as_ref().and_then(|l| l.get("kubernetes.io/service-name")).map(String::as_str)
                    == Some(name.as_str())
        })
        .collect();
    // A nil `ready` condition means ready (EndpointSlice API contract).
    let any_ready = mine.iter().any(|s| {
        s.endpoints.iter().any(|e| {
            !e.addresses.is_empty() && e.conditions.as_ref().and_then(|c| c.ready) != Some(false)
        })
    });
    if any_ready {
        return None;
    }
    let sel = selector.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(",");
    Some(finding("service-no-endpoints", "warning", "svc", (&ns, &name), None,
        "Service has no ready endpoints.".into(),
        vec![field("spec.selector", &sel), field("endpointslices", &mine.len().to_string())]))
}

fn pvc_pending(pvc: &PersistentVolumeClaim, events: &[K8sEvent], now: DateTime<Utc>) -> Option<Finding> {
    let (ns, name) = ns_name(&pvc.metadata);
    if pvc.status.as_ref().and_then(|s| s.phase.as_deref()) != Some("Pending") {
        return None;
    }
    let created = pvc.metadata.creation_timestamp.as_ref()?.0;
    if now.signed_duration_since(created) <= chrono::Duration::minutes(5) {
        return None;
    }
    let mut ev = vec![field("status.phase", "Pending")];
    ev.extend(newest_event(events, "PersistentVolumeClaim", (&ns, &name), &["ProvisioningFailed", "FailedBinding"]));
    Some(finding("pvc-pending", "warning", "pvc", (&ns, &name), None,
        "PersistentVolumeClaim has been Pending for more than 5 minutes.".into(), ev))
}

fn node_not_ready(node: &K8sNode) -> Option<Finding> {
    let name = node.metadata.name.clone().unwrap_or_default();
    let conds = conds!(node.status.as_ref().and_then(|s| s.conditions.as_ref()));
    let c = conds.iter().find(|c| c.type_ == "Ready" && c.status != "True")?;
    Some(finding("node-not-ready", "critical", "nodes", ("", &name), None,
        "Node is not Ready.".into(),
        vec![field("status.conditions[Ready].status", &c.status), cond_evidence("status.conditions[Ready]", c)]))
}

// ─── Assembly ────────────────────────────────────────────────────────────────

/// Every source, `None` when it could not be listed (its rules then do not run).
#[derive(Default)]
struct Sources {
    pods: Option<Vec<K8sPod>>,
    deploys: Option<Vec<Deployment>>,
    stss: Option<Vec<StatefulSet>>,
    dss: Option<Vec<DaemonSet>>,
    jobs: Option<Vec<Job>>,
    services: Option<Vec<Service>>,
    slices: Option<Vec<EndpointSlice>>,
    pvcs: Option<Vec<PersistentVolumeClaim>>,
    events: Option<Vec<K8sEvent>>,
    nodes: Option<Vec<K8sNode>>,
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 0,
        "warning" => 1,
        _ => 2,
    }
}

fn build_findings(s: &Sources, cluster_wide: bool, now: DateTime<Utc>) -> Vec<Finding> {
    // Events are evidence only: a skipped events source weakens evidence, it does not stop a rule.
    let events: &[K8sEvent] = s.events.as_deref().unwrap_or(&[]);
    let mut out = Vec::new();
    for p in s.pods.iter().flatten() {
        out.extend(crashloop(p, events));
        out.extend(oom_killed(p));
        out.extend(image_pull(p));
        out.extend(init_failing(p));
        out.extend(unschedulable(p, events));
    }
    out.extend(workloads(s));
    out.extend(s.jobs.iter().flatten().filter_map(job_failed));
    if let Some(slices) = &s.slices {
        out.extend(s.services.iter().flatten().filter_map(|svc| service_no_endpoints(svc, slices)));
    }
    out.extend(s.pvcs.iter().flatten().filter_map(|p| pvc_pending(p, events, now)));
    if cluster_wide {
        out.extend(s.nodes.iter().flatten().filter_map(node_not_ready));
    }
    out.sort_by(|a, b| {
        (severity_rank(&a.severity), &a.kind, &a.namespace, &a.name, &a.id)
            .cmp(&(severity_rank(&b.severity), &b.kind, &b.namespace, &b.name, &b.id))
    });
    out
}

// ─── Certificate facts (timestamps only; the frontend classifies them with `expiryState`) ──────

fn cert_manager_facts(certs: &[DynamicObject]) -> Vec<CertExpiryFact> {
    certs
        .iter()
        .filter_map(|c| {
            let (ns, name) = ns_name(&c.metadata);
            let v = serde_json::to_value(c).ok()?;
            let not_after = v["status"]["notAfter"].as_str().filter(|s| !s.is_empty())?.to_string();
            let not_before = v["status"]["notBefore"].as_str().filter(|s| !s.is_empty()).map(String::from);
            Some(CertExpiryFact { kind: "cert".into(), namespace: ns, name, not_after, not_before })
        })
        .collect()
}

/// Leaf (`tls.crt`) validity of each `kubernetes.io/tls` Secret. Unparsable certs yield no fact.
fn tls_secret_facts(secrets: &[K8sSecret]) -> Vec<CertExpiryFact> {
    secrets
        .iter()
        .filter_map(|s| {
            let (ns, name) = ns_name(&s.metadata);
            let crt = s.data.as_ref().and_then(|d| d.get("tls.crt"))?;
            let leaf = parse_pem_bundle(&crt.0, "tls.crt").into_iter().find(|c| c.parse_error.is_empty() && !c.not_after.is_empty())?;
            Some(CertExpiryFact {
                kind: "sec".into(),
                namespace: ns,
                name,
                not_after: leaf.not_after,
                not_before: Some(leaf.not_before).filter(|s| !s.is_empty()),
            })
        })
        .collect()
}

// ─── Fetch layer ─────────────────────────────────────────────────────────────

pub(crate) fn skip_reason(e: &kube::Error) -> String {
    match e {
        kube::Error::Api(ae) if ae.code == 401 => format!("unauthorized: {}", ae.message),
        kube::Error::Api(ae) if ae.code == 403 => format!("forbidden: {}", ae.message),
        e => e.to_string(),
    }
}

/// A listed source, or `None` plus a `skipped` entry. `absent_ok`: a 404 means "CRD not installed", not a skip.
pub(crate) fn take<T>(
    r: Result<ObjectList<T>, kube::Error>,
    source: &str,
    absent_ok: bool,
    skipped: &mut Vec<SkippedSource>,
) -> Option<Vec<T>>
where
    T: Clone + serde::de::DeserializeOwned + std::fmt::Debug,
{
    match r {
        Ok(l) => Some(l.items),
        Err(kube::Error::Api(ae)) if absent_ok && ae.code == 404 => Some(Vec::new()),
        Err(e) => {
            skipped.push(SkippedSource { source: source.into(), reason: skip_reason(&e) });
            None
        }
    }
}

#[tauri::command]
pub async fn list_problems(context: String, namespace: Option<String>) -> Result<ProblemReport, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let ns = namespace.unwrap_or_default();
    let cluster_wide = ns.is_empty() || ns == "all";
    let ns = if cluster_wide { String::new() } else { ns };

    let lp = ListParams::default();
    let warn = ListParams::default().fields("type=Warning");
    let tls = ListParams::default().fields("type=kubernetes.io/tls");
    let ar = certificate_api_resource();
    let certs_api: Api<DynamicObject> = if cluster_wide {
        Api::all_with(client.clone(), &ar)
    } else {
        Api::namespaced_with(client.clone(), &ns, &ar)
    };
    let nodes_api: Api<K8sNode> = Api::all(client.clone());

    macro_rules! api {
        ($ty:ty) => {
            namespaced_or_all!(client.clone(), $ty, ns)
        };
    }
    let (pods_api, deploys_api, stss_api, dss_api, jobs_api) =
        (api!(K8sPod), api!(Deployment), api!(StatefulSet), api!(DaemonSet), api!(Job));
    let (svcs_api, slices_api, pvcs_api, events_api, secrets_api) =
        (api!(Service), api!(EndpointSlice), api!(PersistentVolumeClaim), api!(K8sEvent), api!(K8sSecret));

    let (pods, deploys, stss, dss, jobs, services, slices, pvcs, events, nodes, certs, secrets) = tokio::join!(
        pods_api.list(&lp),
        deploys_api.list(&lp),
        stss_api.list(&lp),
        dss_api.list(&lp),
        jobs_api.list(&lp),
        svcs_api.list(&lp),
        slices_api.list(&lp),
        pvcs_api.list(&lp),
        events_api.list(&warn),
        async { if cluster_wide { Some(nodes_api.list(&lp).await) } else { None } },
        certs_api.list(&lp),
        secrets_api.list(&tls),
    );

    let mut skipped = Vec::new();
    let sources = Sources {
        pods: take(pods, "pods", false, &mut skipped),
        deploys: take(deploys, "deployments", false, &mut skipped),
        stss: take(stss, "statefulsets", false, &mut skipped),
        dss: take(dss, "daemonsets", false, &mut skipped),
        jobs: take(jobs, "jobs", false, &mut skipped),
        services: take(services, "services", false, &mut skipped),
        slices: take(slices, "endpointslices", false, &mut skipped),
        pvcs: take(pvcs, "persistentvolumeclaims", false, &mut skipped),
        events: take(events, "events", false, &mut skipped),
        nodes: nodes.and_then(|r| take(r, "nodes", false, &mut skipped)),
    };
    let mut cert_expiry = take(certs, "certificates", true, &mut skipped)
        .map(|c| cert_manager_facts(&c))
        .unwrap_or_default();
    if let Some(s) = take(secrets, "secrets", false, &mut skipped) {
        cert_expiry.extend(tls_secret_facts(&s));
    }
    cert_expiry.sort_by(|a, b| (&a.not_after, &a.namespace, &a.name).cmp(&(&b.not_after, &b.namespace, &b.name)));

    Ok(ProblemReport {
        findings: build_findings(&sources, cluster_wide, Utc::now()),
        cert_expiry,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn pod(v: Value) -> K8sPod {
        serde_json::from_value(v).expect("pod")
    }
    fn event(kind: &str, name: &str, reason: &str, msg: &str, ts: &str) -> K8sEvent {
        serde_json::from_value(json!({
            "metadata": {"name": format!("{name}.{reason}.{ts}"), "namespace": "ns"},
            "involvedObject": {"kind": kind, "name": name, "namespace": "ns"},
            "reason": reason, "message": msg, "type": "Warning", "lastTimestamp": ts
        }))
        .expect("event")
    }
    fn crashing() -> K8sPod {
        pod(json!({
            "metadata": {"name": "p", "namespace": "ns"},
            "spec": {"containers": [{"name": "api"}]},
            "status": {"phase": "Running", "containerStatuses": [{
                "name": "api", "image": "i", "imageID": "", "ready": false, "restartCount": 5,
                "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}
            }]}
        }))
    }
    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T12:00:00Z").expect("ts").with_timezone(&Utc)
    }

    #[test]
    fn crashloop_fires_with_last_termination_and_newest_backoff_event() {
        let evs = vec![
            event("Pod", "p", "BackOff", "old", "2026-01-01T10:00:00Z"),
            event("Pod", "p", "BackOff", "new", "2026-01-01T11:00:00Z"),
        ];
        let f = crashloop(&crashing(), &evs);
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].rule.as_str(), f[0].severity.as_str(), f[0].container.as_deref()), ("crashloop", "critical", Some("api")));
        let paths: Vec<&str> = f[0].evidence.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"status.containerStatuses[api].lastState.terminated.exitCode"));
        let ev = f[0].evidence.iter().find(|e| e.source == "event").expect("event evidence");
        assert_eq!(ev.value, "new");
    }

    #[test]
    fn crashloop_does_not_fire_when_running() {
        let p = pod(json!({"metadata": {"name": "p"}, "status": {"containerStatuses": [{
            "name": "api", "image": "i", "imageID": "", "ready": true, "restartCount": 0,
            "state": {"running": {}}}]}}));
        assert!(crashloop(&p, &[]).is_empty());
    }

    #[test]
    fn event_evidence_needs_kind_and_name() {
        let evs = vec![
            event("Service", "p", "BackOff", "wrong kind", "2026-01-01T11:00:00Z"),
            event("Pod", "other", "BackOff", "wrong name", "2026-01-01T11:00:00Z"),
        ];
        assert!(newest_event(&evs, "Pod", ("ns", "p"), &["BackOff"]).is_none());
        assert!(newest_event(&evs, "Pod", ("other-ns", "other"), &["BackOff"]).is_none());
        assert!(newest_event(&evs, "Service", ("ns", "p"), &["BackOff"]).is_some());
        assert!(crashloop(&crashing(), &evs).iter().all(|f| f.evidence.iter().all(|e| e.source == "field")));
    }

    #[test]
    fn oom_killed_fires_with_memory_limit_and_needs_restarts() {
        let mut v = json!({
            "metadata": {"name": "p", "namespace": "ns"},
            "spec": {"containers": [{"name": "api", "resources": {"limits": {"memory": "64Mi"}}}]},
            "status": {"containerStatuses": [{
                "name": "api", "image": "i", "imageID": "", "ready": true, "restartCount": 2,
                "state": {"running": {}}, "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}}]}
        });
        let f = oom_killed(&pod(v.clone()));
        assert_eq!(f.len(), 1);
        assert!(f[0].evidence.iter().any(|e| e.value == "64Mi"));
        v["status"]["containerStatuses"][0]["restartCount"] = json!(0);
        assert!(oom_killed(&pod(v)).is_empty());
    }

    #[test]
    fn image_pull_fires_with_waiting_message() {
        let mk = |reason: &str| pod(json!({"metadata": {"name": "p", "namespace": "ns"}, "status": {"containerStatuses": [{
            "name": "api", "image": "i", "imageID": "", "ready": false, "restartCount": 0,
            "state": {"waiting": {"reason": reason, "message": "pull access denied"}}}]}}));
        let f = image_pull(&mk("ImagePullBackOff"));
        assert_eq!(f[0].evidence[0].value, "pull access denied");
        assert_eq!(image_pull(&mk("ErrImagePull")).len(), 1);
        assert!(image_pull(&mk("ContainerCreating")).is_empty());
    }

    #[test]
    fn init_failing_fires_on_backoff_or_nonzero_exit_only() {
        let mk = |state: Value| pod(json!({"metadata": {"name": "p", "namespace": "ns"}, "status": {"initContainerStatuses": [{
            "name": "init", "image": "i", "imageID": "", "ready": false, "restartCount": 1, "state": state}]}}));
        assert_eq!(init_failing(&mk(json!({"waiting": {"reason": "CrashLoopBackOff"}}))).len(), 1);
        assert_eq!(init_failing(&mk(json!({"terminated": {"exitCode": 1}}))).len(), 1);
        assert!(init_failing(&mk(json!({"terminated": {"exitCode": 0}}))).is_empty());
        assert!(init_failing(&mk(json!({"waiting": {"reason": "PodInitializing"}}))).is_empty());
    }

    #[test]
    fn unschedulable_fires_for_pending_pods_only() {
        let mk = |phase: &str| pod(json!({"metadata": {"name": "p", "namespace": "ns"}, "status": {"phase": phase, "conditions": [
            {"type": "PodScheduled", "status": "False", "reason": "Unschedulable", "message": "0/3 nodes available"}]}}));
        let evs = vec![event("Pod", "p", "FailedScheduling", "0/3 nodes", "2026-01-01T11:00:00Z")];
        let f = unschedulable(&mk("Pending"), &evs);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].evidence.len(), 2);
        assert!(unschedulable(&mk("Running"), &evs).is_empty());
    }

    #[test]
    fn workload_unavailable_needs_shortfall_and_a_bad_condition() {
        let bad = |t: &str, s: &str, r: &str| vec![Cond { type_: t.into(), status: s.into(), reason: r.into(), message: "m".into() }];
        let id = ("ns", "d");
        assert!(workload_unavailable("deploy", id, 3, 1, &bad("Progressing", "False", "ProgressDeadlineExceeded")).is_some());
        assert!(workload_unavailable("deploy", id, 3, 1, &bad("Available", "False", "MinimumReplicasUnavailable")).is_some());
        assert!(workload_unavailable("deploy", id, 3, 3, &bad("Available", "False", "x")).is_none());
        assert!(workload_unavailable("deploy", id, 3, 1, &bad("Available", "True", "x")).is_none());
        assert!(workload_unavailable("deploy", id, 3, 1, &[]).is_none());
    }

    #[test]
    fn workloads_reads_typed_deployments() {
        let d: Deployment = serde_json::from_value(json!({
            "metadata": {"name": "d", "namespace": "ns"}, "spec": {"replicas": 2, "selector": {}, "template": {}},
            "status": {"readyReplicas": 0, "conditions": [{"type": "Available", "status": "False", "reason": "R", "message": "M"}]}
        }))
        .expect("deploy");
        let f = workloads(&Sources { deploys: Some(vec![d]), ..Default::default() });
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].kind.as_str(), f[0].severity.as_str()), ("deploy", "warning"));
    }

    #[test]
    fn job_failed_fires_on_failed_true_only() {
        let mk = |s: &str| -> Job { serde_json::from_value(json!({"metadata": {"name": "j", "namespace": "ns"},
            "status": {"conditions": [{"type": "Failed", "status": s, "reason": "BackoffLimitExceeded", "message": "done"}]}})).expect("job") };
        let f = job_failed(&mk("True")).expect("finding");
        assert_eq!(f.evidence[0].value, "BackoffLimitExceeded: done");
        assert!(job_failed(&mk("False")).is_none());
    }

    fn svc(spec: Value) -> Service {
        serde_json::from_value(json!({"metadata": {"name": "s", "namespace": "ns"}, "spec": spec})).expect("svc")
    }
    fn slice(ready: Option<bool>, addrs: &[&str]) -> EndpointSlice {
        let cond = ready.map(|r| json!({"ready": r})).unwrap_or(json!({}));
        serde_json::from_value(json!({
            "metadata": {"name": "s-abc", "namespace": "ns", "labels": {"kubernetes.io/service-name": "s"}},
            "addressType": "IPv4",
            "endpoints": [{"addresses": addrs, "conditions": cond}]
        }))
        .expect("slice")
    }

    #[test]
    fn service_no_endpoints_fires_without_ready_addresses() {
        let s = svc(json!({"selector": {"app": "web"}}));
        let f = service_no_endpoints(&s, &[slice(Some(false), &["10.0.0.1"])]).expect("finding");
        assert_eq!(f.evidence[0].value, "app=web");
        assert!(service_no_endpoints(&s, &[]).is_some());
        assert!(service_no_endpoints(&s, &[slice(Some(true), &["10.0.0.1"])]).is_none());
        assert!(service_no_endpoints(&s, &[slice(None, &["10.0.0.1"])]).is_none()); // nil == ready
    }

    #[test]
    fn service_no_endpoints_skips_external_name_and_selectorless() {
        assert!(service_no_endpoints(&svc(json!({"type": "ExternalName", "externalName": "x.example", "selector": {"a": "b"}})), &[]).is_none());
        assert!(service_no_endpoints(&svc(json!({"type": "ClusterIP"})), &[]).is_none());
        assert!(service_no_endpoints(&svc(json!({"selector": {}})), &[]).is_none());
    }

    #[test]
    fn pvc_pending_needs_pending_for_over_five_minutes() {
        let mk = |phase: &str, created: &str| -> PersistentVolumeClaim { serde_json::from_value(json!({
            "metadata": {"name": "c", "namespace": "ns", "creationTimestamp": created}, "status": {"phase": phase}})).expect("pvc") };
        let evs = vec![event("PersistentVolumeClaim", "c", "ProvisioningFailed", "no sc", "2026-01-01T11:59:00Z")];
        let f = pvc_pending(&mk("Pending", "2026-01-01T11:00:00Z"), &evs, now()).expect("finding");
        assert!(f.evidence.iter().any(|e| e.source == "event" && e.value == "no sc"));
        assert!(pvc_pending(&mk("Pending", "2026-01-01T11:57:00Z"), &evs, now()).is_none());
        assert!(pvc_pending(&mk("Bound", "2026-01-01T11:00:00Z"), &evs, now()).is_none());
    }

    fn not_ready_node() -> K8sNode {
        serde_json::from_value(json!({"metadata": {"name": "n1"}, "status": {"conditions": [
            {"type": "Ready", "status": "False", "reason": "KubeletNotReady", "message": "down"}]}})).expect("node")
    }

    #[test]
    fn node_not_ready_fires_only_cluster_wide() {
        assert!(node_not_ready(&not_ready_node()).is_some());
        let ready: K8sNode = serde_json::from_value(json!({"metadata": {"name": "n"}, "status": {"conditions": [
            {"type": "Ready", "status": "True"}]}})).expect("node");
        assert!(node_not_ready(&ready).is_none());
        let s = Sources { nodes: Some(vec![not_ready_node()]), ..Default::default() };
        assert_eq!(build_findings(&s, true, now()).len(), 1);
        assert!(build_findings(&s, false, now()).is_empty());
    }

    fn spec_of(v: Value) -> PodSpec {
        serde_json::from_value(v).expect("spec")
    }

    #[test]
    fn missing_probes_fires_once_per_container_without_readiness_probe() {
        let t = spec_of(json!({"containers": [
            {"name": "web"},
            {"name": "ready", "readinessProbe": {"httpGet": {"port": 80}}},
            {"name": "side", "livenessProbe": {"httpGet": {"port": 81}}}
        ]}));
        let f = missing_probes("deploy", ("ns", "d"), Some(3), Some(&t));
        let names: Vec<_> = f.iter().map(|f| f.container.as_deref().unwrap_or("")).collect();
        assert_eq!(names, ["web", "side"]);
        assert_eq!((f[0].severity.as_str(), f[0].kind.as_str(), f[0].name.as_str()), ("info", "deploy", "d"));
        assert_eq!(f[0].id, "missing-probes/deploy/ns/d/web");
        assert_eq!(f[0].evidence[0].path, "spec.template.spec.containers[web].readinessProbe");
        assert_eq!(f[0].evidence[0].value, "absent");
    }

    #[test]
    fn missing_probes_silent_with_probe_zero_replicas_or_no_template() {
        let ok = spec_of(json!({"containers": [{"name": "web", "readinessProbe": {"httpGet": {"port": 80}}}]}));
        assert!(missing_probes("sts", ("ns", "s"), None, Some(&ok)).is_empty());
        let bare = spec_of(json!({"containers": [{"name": "web"}]}));
        assert!(missing_probes("sts", ("ns", "s"), Some(0), Some(&bare)).is_empty());
        assert_eq!(missing_probes("sts", ("ns", "s"), None, Some(&bare)).len(), 1); // replicas default 1
        assert!(missing_probes("deploy", ("ns", "d"), Some(1), None).is_empty());
    }

    #[test]
    fn three_replica_deployment_yields_one_finding_from_the_deployments_source_only() {
        let d: Deployment = serde_json::from_value(json!({
            "metadata": {"name": "d", "namespace": "ns"},
            "spec": {"replicas": 3, "selector": {}, "template": {"spec": {"containers": [{"name": "web"}]}}},
            "status": {"readyReplicas": 3}
        }))
        .expect("deploy");
        let with = Sources { deploys: Some(vec![d.clone()]), ..Default::default() };
        let f = build_findings(&with, true, now());
        assert_eq!(f.iter().filter(|f| f.rule == "missing-probes").count(), 1);
        // Skipped deployments source: the rule does not run for deploys; pods are irrelevant.
        let skipped = Sources { deploys: None, pods: Some(vec![crashing()]), ..Default::default() };
        assert!(build_findings(&skipped, true, now()).iter().all(|f| f.rule != "missing-probes"));
    }

    #[test]
    fn forbidden_source_is_skipped_and_its_rules_do_not_run() {
        let forbidden = kube::Error::Api(kube::core::ErrorResponse {
            status: "Failure".into(),
            message: "pods is forbidden".into(),
            reason: "Forbidden".into(),
            code: 403,
        });
        let mut skipped = Vec::new();
        let pods: Option<Vec<K8sPod>> = take(Err(forbidden), "pods", false, &mut skipped);
        assert!(pods.is_none());
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].source, "pods");
        assert!(skipped[0].reason.starts_with("forbidden: "));
        let s = Sources { pods, ..Default::default() };
        assert!(build_findings(&s, true, now()).is_empty());
        let s = Sources { pods: Some(vec![crashing()]), ..Default::default() };
        assert!(!build_findings(&s, true, now()).is_empty());
    }

    #[test]
    fn absent_crd_is_not_a_skip() {
        let nf = kube::Error::Api(kube::core::ErrorResponse { status: "Failure".into(), message: "nf".into(), reason: "NotFound".into(), code: 404 });
        let mut skipped = Vec::new();
        let r: Option<Vec<DynamicObject>> = take(Err(nf), "certificates", true, &mut skipped);
        assert_eq!(r.map(|v| v.len()), Some(0));
        assert!(skipped.is_empty());
    }

    #[test]
    fn evidence_truncation_is_char_boundary_safe() {
        let s = "é".repeat(600); // 2 bytes per char; byte index 500 would be mid-char for odd cuts
        let t = trunc(&s);
        assert_eq!(t.chars().count(), 500);
        assert_eq!(trunc("short"), "short");
        let emoji = "日本語🙂".repeat(200);
        assert_eq!(trunc(&emoji).chars().count(), 500);
    }

    #[test]
    fn finding_id_is_stable_and_sorting_is_by_severity_first() {
        let s = Sources { pods: Some(vec![crashing()]), nodes: Some(vec![not_ready_node()]), ..Default::default() };
        let a = build_findings(&s, true, now());
        let b = build_findings(&s, true, now());
        let ids = |v: &[Finding]| v.iter().map(|f| f.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&a), ids(&b));
        assert!(a.iter().any(|f| f.id == "crashloop/pods/ns/p/api"));
        assert!(a.iter().any(|f| f.id == "node-not-ready/nodes//n1"));
        let ranks: Vec<u8> = a.iter().map(|f| severity_rank(&f.severity)).collect();
        assert!(ranks.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn cert_manager_facts_read_status_timestamps() {
        let obj: DynamicObject = serde_json::from_value(json!({
            "apiVersion": "cert-manager.io/v1", "kind": "Certificate",
            "metadata": {"name": "c", "namespace": "ns"},
            "status": {"notAfter": "2027-01-01T00:00:00Z", "notBefore": "2026-01-01T00:00:00Z"}
        }))
        .expect("cert");
        let none: DynamicObject = serde_json::from_value(json!({
            "apiVersion": "cert-manager.io/v1", "kind": "Certificate", "metadata": {"name": "n"}})).expect("cert");
        let f = cert_manager_facts(&[obj, none]);
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].kind.as_str(), f[0].not_after.as_str(), f[0].not_before.as_deref()), ("cert", "2027-01-01T00:00:00Z", Some("2026-01-01T00:00:00Z")));
    }

    #[test]
    fn tls_secret_facts_use_tls_crt_only() {
        use crate::commands::tls_cert::tests::FIXTURE_PEM;
        let mk = |data: Value| -> K8sSecret { serde_json::from_value(json!({
            "metadata": {"name": "s", "namespace": "ns"}, "type": "kubernetes.io/tls", "data": data})).expect("secret") };
        let b64 = |s: &str| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(s)
        };
        let f = tls_secret_facts(&[mk(json!({"tls.crt": b64(FIXTURE_PEM), "tls.key": b64("PRIVATE")}))]);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "sec");
        assert!(!f[0].not_after.is_empty());
        assert!(tls_secret_facts(&[mk(json!({"tls.crt": b64("garbage")}))]).is_empty());
        assert!(tls_secret_facts(&[mk(json!({"ca.crt": b64(FIXTURE_PEM)}))]).is_empty());
    }
}
