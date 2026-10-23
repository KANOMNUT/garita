//! `list_possibly_unused`: objects nothing in the cluster appears to reference.
//!
//! Hints only. Every rule is a pure function over already-listed objects; a source that cannot be
//! listed lands in `skipped` and the kinds that need it are not emitted at all (never a guess).
//! No Secret data is inspected, returned or kept: Secrets are reduced to `type` + labels the
//! moment they are listed.

use std::collections::{BTreeMap, HashSet};

use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, EnvFromSource, EnvVar, PersistentVolume, PersistentVolumeClaim, Pod, PodSpec,
    Secret, ServiceAccount,
};
use k8s_openapi::api::networking::v1::Ingress;
use k8s_openapi::api::rbac::v1::{ClusterRole, ClusterRoleBinding, Role, RoleBinding};
use kube::{
    api::{ApiResource, DynamicObject, ListParams},
    core::ObjectList,
    Api, Client,
};
use serde::{Deserialize, Serialize};

use super::certmanager::certificate_api_resource;
use super::gateway::gateway_api_resource;
use super::problems::{take, SkippedSource};
use super::utils::client_for_context;

/// Namespaces never offered as candidates under "all" (they are still read as references).
const EXCLUDED_NAMESPACES: &[&str] = &["kube-system", "kube-public", "kube-node-lease"];

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnusedCandidate {
    pub kind: String, // "cm" | "sec" | "pvc" | "pv" | "roles" | "croles" | "sa" | "deploy" | "sts"
    pub namespace: String,
    pub name: String,
    pub reason: String, // not-referenced | not-mounted | unbound | no-binding | no-pods | zero-replicas
    pub detail: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnusedReport {
    pub candidates: Vec<UnusedCandidate>,
    pub skipped: Vec<SkippedSource>,
    pub excluded_namespaces: Vec<String>,
}

/// A Secret reduced to what the rules may look at.
#[derive(Debug, Clone)]
pub(crate) struct SecretFacts {
    pub namespace: String,
    pub name: String,
    pub type_: String,
    pub labels: BTreeMap<String, String>,
}

/// Every listed source; `None` = the list failed (skipped).
#[derive(Default)]
pub(crate) struct Inputs {
    pub pods: Option<Vec<Pod>>,
    pub deploys: Option<Vec<Deployment>>,
    pub stss: Option<Vec<StatefulSet>>,
    pub dss: Option<Vec<DaemonSet>>,
    pub rss: Option<Vec<ReplicaSet>>,
    pub jobs: Option<Vec<Job>>,
    pub crons: Option<Vec<CronJob>>,
    pub ingresses: Option<Vec<Ingress>>,
    pub gateways: Option<Vec<DynamicObject>>,
    pub certs: Option<Vec<DynamicObject>>,
    pub sas: Option<Vec<ServiceAccount>>,
    pub cms: Option<Vec<ConfigMap>>,
    pub secrets: Option<Vec<SecretFacts>>,
    pub pvcs: Option<Vec<PersistentVolumeClaim>>,
    pub pvs: Option<Vec<PersistentVolume>>,
    pub roles: Option<Vec<Role>>,
    pub croles: Option<Vec<ClusterRole>>,
    pub rbs: Option<Vec<RoleBinding>>,
    pub crbs: Option<Vec<ClusterRoleBinding>>,
}

type Key = (String, String); // (namespace, name)

#[derive(Default)]
struct Refs {
    cms: HashSet<Key>,
    secrets: HashSet<Key>,
    pvcs: HashSet<Key>,
    sas: HashSet<Key>,
}

impl Refs {
    fn env(&mut self, ns: &str, env: Option<&Vec<EnvVar>>, env_from: Option<&Vec<EnvFromSource>>) {
        let k = |n: &str| (ns.to_string(), n.to_string());
        for v in env.into_iter().flatten() {
            if let Some(src) = &v.value_from {
                if let Some(r) = &src.config_map_key_ref {
                    self.cms.insert(k(&r.name));
                }
                if let Some(r) = &src.secret_key_ref {
                    self.secrets.insert(k(&r.name));
                }
            }
        }
        for e in env_from.into_iter().flatten() {
            if let Some(r) = &e.config_map_ref {
                self.cms.insert(k(&r.name));
            }
            if let Some(r) = &e.secret_ref {
                self.secrets.insert(k(&r.name));
            }
        }
    }

    fn spec(&mut self, ns: &str, s: &PodSpec) {
        let k = |n: &str| (ns.to_string(), n.to_string());
        for v in s.volumes.iter().flatten() {
            if let Some(c) = &v.config_map {
                self.cms.insert(k(&c.name));
            }
            if let Some(n) = v.secret.as_ref().and_then(|x| x.secret_name.as_deref()) {
                self.secrets.insert(k(n));
            }
            if let Some(c) = &v.persistent_volume_claim {
                self.pvcs.insert(k(&c.claim_name));
            }
            if let Some(r) = v.csi.as_ref().and_then(|c| c.node_publish_secret_ref.as_ref()) {
                self.secrets.insert(k(&r.name));
            }
            for p in v.projected.iter().flat_map(|p| p.sources.iter().flatten()) {
                if let Some(c) = &p.config_map {
                    self.cms.insert(k(&c.name));
                }
                if let Some(c) = &p.secret {
                    self.secrets.insert(k(&c.name));
                }
            }
        }
        for c in s.containers.iter().chain(s.init_containers.iter().flatten()) {
            self.env(ns, c.env.as_ref(), c.env_from.as_ref());
        }
        for c in s.ephemeral_containers.iter().flatten() {
            self.env(ns, c.env.as_ref(), c.env_from.as_ref());
        }
        for r in s.image_pull_secrets.iter().flatten() {
            self.secrets.insert(k(&r.name));
        }
        let sa = s.service_account_name.as_deref().or(s.service_account.as_deref()).unwrap_or("default");
        self.sas.insert(k(sa));
    }
}

fn ns_of(m: &k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta) -> String {
    m.namespace.clone().unwrap_or_default()
}

/// Names referenced by pods, workload templates, Ingress TLS, ServiceAccounts, Gateway listeners
/// and cert-manager Certificates. Sources that were not read simply contribute nothing; the caller
/// only trusts the result for kinds whose sources were all read.
fn collect_refs(i: &Inputs) -> Refs {
    let mut r = Refs::default();
    for p in i.pods.iter().flatten() {
        if let Some(s) = &p.spec {
            r.spec(&ns_of(&p.metadata), s);
        }
    }
    for d in i.deploys.iter().flatten() {
        if let Some(s) = d.spec.as_ref().and_then(|s| s.template.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for d in i.stss.iter().flatten() {
        if let Some(s) = d.spec.as_ref().and_then(|s| s.template.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for d in i.dss.iter().flatten() {
        if let Some(s) = d.spec.as_ref().and_then(|s| s.template.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for d in i.rss.iter().flatten() {
        if let Some(s) = d.spec.as_ref().and_then(|s| s.template.as_ref()).and_then(|t| t.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for d in i.jobs.iter().flatten() {
        if let Some(s) = d.spec.as_ref().and_then(|s| s.template.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for d in i.crons.iter().flatten() {
        let tpl = d.spec.as_ref().and_then(|s| s.job_template.spec.as_ref());
        if let Some(s) = tpl.and_then(|j| j.template.spec.as_ref()) {
            r.spec(&ns_of(&d.metadata), s);
        }
    }
    for ing in i.ingresses.iter().flatten() {
        let ns = ns_of(&ing.metadata);
        for t in ing.spec.iter().flat_map(|s| s.tls.iter().flatten()) {
            if let Some(n) = &t.secret_name {
                r.secrets.insert((ns.clone(), n.clone()));
            }
        }
    }
    for sa in i.sas.iter().flatten() {
        let ns = ns_of(&sa.metadata);
        for s in sa.secrets.iter().flatten() {
            if let Some(n) = &s.name {
                r.secrets.insert((ns.clone(), n.clone()));
            }
        }
        for s in sa.image_pull_secrets.iter().flatten() {
            r.secrets.insert((ns.clone(), s.name.clone()));
        }
    }
    for g in i.gateways.iter().flatten() {
        let gns = g.metadata.namespace.clone().unwrap_or_default();
        let listeners = g.data.pointer("/spec/listeners").and_then(|l| l.as_array());
        for l in listeners.into_iter().flatten() {
            let refs = l.pointer("/tls/certificateRefs").and_then(|c| c.as_array());
            for c in refs.into_iter().flatten() {
                let kind = c.get("kind").and_then(|k| k.as_str()).unwrap_or("Secret");
                if let (Some(n), "Secret") = (c.get("name").and_then(|n| n.as_str()), kind) {
                    let ns = c.get("namespace").and_then(|n| n.as_str()).unwrap_or(&gns);
                    r.secrets.insert((ns.to_string(), n.to_string()));
                }
            }
        }
    }
    for c in i.certs.iter().flatten() {
        if let Some(n) = c.data.pointer("/spec/secretName").and_then(|n| n.as_str()) {
            r.secrets.insert((ns_of(&c.metadata), n.to_string()));
        }
    }
    r
}

fn cand(kind: &str, ns: &str, name: &str, reason: &str, detail: &str) -> UnusedCandidate {
    UnusedCandidate { kind: kind.into(), namespace: ns.into(), name: name.into(), reason: reason.into(), detail: detail.into() }
}

fn has<T>(o: &Option<Vec<T>>) -> bool {
    o.is_some()
}

/// A Secret the rules never offer: service-account tokens, Helm release storage, Argo CD
/// repository/credential Secrets.
fn secret_excluded(s: &SecretFacts) -> bool {
    s.type_ == "kubernetes.io/service-account-token"
        || s.type_ == "helm.sh/release.v1"
        || s.labels.get("owner").map(String::as_str) == Some("helm")
        || s.labels.contains_key("argocd.argoproj.io/secret-type")
}

/// Candidates over the read sources. `all` = cluster-wide scope (system namespaces are not
/// offered as candidates, but they were read as references; `pv` and `croles` only here).
/// A kind is emitted only when its own list and every reference source it needs were read.
pub(crate) fn find_unused(i: &Inputs, all: bool) -> Vec<UnusedCandidate> {
    let refs = collect_refs(i);
    let workloads = has(&i.deploys) && has(&i.stss) && has(&i.dss) && has(&i.rss) && has(&i.jobs) && has(&i.crons);
    let pods_wl = has(&i.pods) && workloads;
    let shown = |ns: &str| !(all && EXCLUDED_NAMESPACES.contains(&ns));
    let mut out = Vec::new();

    if let (true, Some(cms)) = (pods_wl, &i.cms) {
        for c in cms {
            let (ns, n) = (ns_of(&c.metadata), c.metadata.name.clone().unwrap_or_default());
            if n == "kube-root-ca.crt" || !shown(&ns) || refs.cms.contains(&(ns.clone(), n.clone())) {
                continue;
            }
            out.push(cand("cm", &ns, &n, "not-referenced", "No pod or workload template references this ConfigMap."));
        }
    }
    if let (true, true, true, true, Some(secrets)) =
        (pods_wl, has(&i.ingresses), has(&i.sas), has(&i.gateways) && has(&i.certs), &i.secrets)
    {
        for s in secrets {
            if secret_excluded(s) || !shown(&s.namespace) || refs.secrets.contains(&(s.namespace.clone(), s.name.clone())) {
                continue;
            }
            out.push(cand("sec", &s.namespace, &s.name, "not-referenced", "No pod, workload, Ingress, Gateway, ServiceAccount or Certificate references this Secret."));
        }
    }
    if let (true, Some(pvcs)) = (pods_wl, &i.pvcs) {
        for p in pvcs {
            let (ns, n) = (ns_of(&p.metadata), p.metadata.name.clone().unwrap_or_default());
            let bound = p.status.as_ref().and_then(|s| s.phase.as_deref()) == Some("Bound");
            // A generic ephemeral volume's claim is owned by its Pod and dies with it.
            let pod_owned = p.metadata.owner_references.iter().flatten().any(|o| o.kind == "Pod");
            if !bound || pod_owned || !shown(&ns) || refs.pvcs.contains(&(ns.clone(), n.clone())) {
                continue;
            }
            out.push(cand("pvc", &ns, &n, "not-mounted", "Bound, but no pod or workload template mounts it."));
        }
    }
    if let (true, Some(pvs)) = (all, &i.pvs) {
        for p in pvs {
            let phase = p.status.as_ref().and_then(|s| s.phase.as_deref()).unwrap_or("");
            if phase == "Available" || phase == "Released" {
                out.push(cand("pv", "", p.metadata.name.as_deref().unwrap_or(""), "unbound", &format!("Phase is {phase}.")));
            }
        }
    }
    if let (Some(roles), Some(rbs)) = (&i.roles, &i.rbs) {
        let used: HashSet<Key> = rbs
            .iter()
            .filter(|b| b.role_ref.kind == "Role")
            .map(|b| (ns_of(&b.metadata), b.role_ref.name.clone()))
            .collect();
        for r in roles {
            let (ns, n) = (ns_of(&r.metadata), r.metadata.name.clone().unwrap_or_default());
            if n.starts_with("system:") || !shown(&ns) || used.contains(&(ns.clone(), n.clone())) {
                continue;
            }
            out.push(cand("roles", &ns, &n, "no-binding", "No RoleBinding references this Role."));
        }
    }
    if let (true, Some(croles), Some(crbs), Some(rbs)) = (all, &i.croles, &i.crbs, &i.rbs) {
        let used: HashSet<&str> = crbs
            .iter()
            .map(|b| &b.role_ref)
            .chain(rbs.iter().map(|b| &b.role_ref))
            .filter(|r| r.kind == "ClusterRole")
            .map(|r| r.name.as_str())
            .collect();
        for r in croles {
            let n = r.metadata.name.clone().unwrap_or_default();
            let aggregated = r.metadata.labels.iter().flatten().any(|(k, _)| k.starts_with("rbac.authorization.k8s.io/aggregate-to-"));
            let default_role = r.metadata.labels.as_ref().and_then(|l| l.get("kubernetes.io/bootstrapping")).map(String::as_str) == Some("rbac-defaults");
            if n.starts_with("system:") || default_role || aggregated || used.contains(n.as_str()) {
                continue;
            }
            out.push(cand("croles", "", &n, "no-binding", "No binding references this ClusterRole and it is not aggregated into another."));
        }
    }
    if let (true, Some(sas)) = (pods_wl, &i.sas) {
        for s in sas {
            let (ns, n) = (ns_of(&s.metadata), s.metadata.name.clone().unwrap_or_default());
            if n == "default" || !shown(&ns) || refs.sas.contains(&(ns.clone(), n.clone())) {
                continue;
            }
            out.push(cand("sa", &ns, &n, "no-pods", "No pod or workload template uses this ServiceAccount."));
        }
    }
    for d in i.deploys.iter().flatten() {
        let ns = ns_of(&d.metadata);
        if shown(&ns) && d.spec.as_ref().and_then(|s| s.replicas) == Some(0) {
            out.push(cand("deploy", &ns, d.metadata.name.as_deref().unwrap_or(""), "zero-replicas", "spec.replicas is 0."));
        }
    }
    for d in i.stss.iter().flatten() {
        let ns = ns_of(&d.metadata);
        if shown(&ns) && d.spec.as_ref().and_then(|s| s.replicas) == Some(0) {
            out.push(cand("sts", &ns, d.metadata.name.as_deref().unwrap_or(""), "zero-replicas", "spec.replicas is 0."));
        }
    }
    out.sort_by(|a, b| (&a.kind, &a.namespace, &a.name).cmp(&(&b.kind, &b.namespace, &b.name)));
    out
}

// ─── Fetch layer ─────────────────────────────────────────────────────────────

async fn list_ns<T>(client: &Client, ns: &str) -> Result<ObjectList<T>, kube::Error>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope>
        + Clone
        + serde::de::DeserializeOwned
        + std::fmt::Debug,
    T::DynamicType: Default,
{
    let api: Api<T> = if ns.is_empty() { Api::all(client.clone()) } else { Api::namespaced(client.clone(), ns) };
    api.list(&ListParams::default()).await
}

/// Service-account tokens and Helm release storage are never candidates, so the server leaves them out
/// (less transfer); `secret_excluded` stays as the backstop.
async fn list_secrets(client: &Client, ns: &str) -> Result<ObjectList<Secret>, kube::Error> {
    let api: Api<Secret> = if ns.is_empty() { Api::all(client.clone()) } else { Api::namespaced(client.clone(), ns) };
    let lp = ListParams::default().fields("type!=kubernetes.io/service-account-token,type!=helm.sh/release.v1");
    api.list(&lp).await
}

async fn list_dyn(client: &Client, ns: &str, ar: &ApiResource) -> Result<ObjectList<DynamicObject>, kube::Error> {
    let api: Api<DynamicObject> =
        if ns.is_empty() { Api::all_with(client.clone(), ar) } else { Api::namespaced_with(client.clone(), ns, ar) };
    api.list(&ListParams::default()).await
}

#[tauri::command]
pub async fn list_possibly_unused(context: String, namespace: Option<String>) -> Result<UnusedReport, String> {
    let client = client_for_context(&context).await.map_err(|e| format!("Failed to connect: {}", e))?;
    let ns = namespace.filter(|n| !n.is_empty() && n != "all").unwrap_or_default();
    let all = ns.is_empty();
    let c = &client;
    let (gw_ar, cert_ar) = (gateway_api_resource(), certificate_api_resource());
    let lp = ListParams::default();

    let (pods, deploys, stss, dss, rss, jobs, crons, ingresses, gateways, certs) = tokio::join!(
        list_ns::<Pod>(c, &ns),
        list_ns::<Deployment>(c, &ns),
        list_ns::<StatefulSet>(c, &ns),
        list_ns::<DaemonSet>(c, &ns),
        list_ns::<ReplicaSet>(c, &ns),
        list_ns::<Job>(c, &ns),
        list_ns::<CronJob>(c, &ns),
        list_ns::<Ingress>(c, &ns),
        list_dyn(c, &ns, &gw_ar),
        list_dyn(c, &ns, &cert_ar),
    );
    let (sas, cms, secrets, pvcs, roles, rbs) = tokio::join!(
        list_ns::<ServiceAccount>(c, &ns),
        list_ns::<ConfigMap>(c, &ns),
        list_secrets(c, &ns),
        list_ns::<PersistentVolumeClaim>(c, &ns),
        list_ns::<Role>(c, &ns),
        list_ns::<RoleBinding>(c, &ns),
    );
    let pvs_api: Api<PersistentVolume> = Api::all(client.clone());
    let croles_api: Api<ClusterRole> = Api::all(client.clone());
    let crbs_api: Api<ClusterRoleBinding> = Api::all(client.clone());
    let (pvs, croles, crbs) = tokio::join!(
        async { if all { Some(pvs_api.list(&lp).await) } else { None } },
        async { if all { Some(croles_api.list(&lp).await) } else { None } },
        async { if all { Some(crbs_api.list(&lp).await) } else { None } },
    );

    let mut skipped = Vec::new();
    let inputs = Inputs {
        pods: take(pods, "pods", false, &mut skipped),
        deploys: take(deploys, "deployments", false, &mut skipped),
        stss: take(stss, "statefulsets", false, &mut skipped),
        dss: take(dss, "daemonsets", false, &mut skipped),
        rss: take(rss, "replicasets", false, &mut skipped),
        jobs: take(jobs, "jobs", false, &mut skipped),
        crons: take(crons, "cronjobs", false, &mut skipped),
        ingresses: take(ingresses, "ingresses", false, &mut skipped),
        // A 404 means the CRD is not installed: nothing to reference from there, not a skip.
        gateways: take(gateways, "gateways", true, &mut skipped),
        certs: take(certs, "certificates", true, &mut skipped),
        sas: take(sas, "serviceaccounts", false, &mut skipped),
        cms: take(cms, "configmaps", false, &mut skipped),
        secrets: take(secrets, "secrets", false, &mut skipped).map(|v| {
            v.into_iter()
                .map(|s| SecretFacts {
                    namespace: ns_of(&s.metadata),
                    name: s.metadata.name.clone().unwrap_or_default(),
                    type_: s.type_.clone().unwrap_or_default(),
                    labels: s.metadata.labels.clone().unwrap_or_default(),
                })
                .collect()
        }),
        pvcs: take(pvcs, "persistentvolumeclaims", false, &mut skipped),
        pvs: pvs.and_then(|r| take(r, "persistentvolumes", false, &mut skipped)),
        roles: take(roles, "roles", false, &mut skipped),
        croles: croles.and_then(|r| take(r, "clusterroles", false, &mut skipped)),
        rbs: take(rbs, "rolebindings", false, &mut skipped),
        crbs: crbs.and_then(|r| take(r, "clusterrolebindings", false, &mut skipped)),
    };
    Ok(UnusedReport {
        candidates: find_unused(&inputs, all),
        skipped,
        excluded_namespaces: if all { EXCLUDED_NAMESPACES.iter().map(|s| s.to_string()).collect() } else { vec![] },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn o<T: serde::de::DeserializeOwned>(v: Value) -> T {
        serde_json::from_value(v).expect("fixture")
    }
    fn meta(ns: &str, n: &str) -> Value {
        json!({"name": n, "namespace": ns})
    }
    fn pod_with(spec: Value) -> Pod {
        o(json!({"metadata": meta("a", "p"), "spec": spec}))
    }
    /// Every source read and empty, so a test names only what it varies.
    fn empty() -> Inputs {
        Inputs {
            pods: Some(vec![]), deploys: Some(vec![]), stss: Some(vec![]), dss: Some(vec![]), rss: Some(vec![]),
            jobs: Some(vec![]), crons: Some(vec![]), ingresses: Some(vec![]), gateways: Some(vec![]),
            certs: Some(vec![]), sas: Some(vec![]), cms: Some(vec![]), secrets: Some(vec![]), pvcs: Some(vec![]),
            pvs: Some(vec![]), roles: Some(vec![]), croles: Some(vec![]), rbs: Some(vec![]), crbs: Some(vec![]),
        }
    }
    fn cm(ns: &str, n: &str) -> ConfigMap {
        o(json!({"metadata": meta(ns, n)}))
    }
    fn sec(ns: &str, n: &str, t: &str, labels: Value) -> SecretFacts {
        SecretFacts {
            namespace: ns.into(), name: n.into(), type_: t.into(),
            labels: serde_json::from_value(labels).expect("labels"),
        }
    }
    fn names(c: &[UnusedCandidate], kind: &str) -> Vec<String> {
        c.iter().filter(|x| x.kind == kind).map(|x| x.name.clone()).collect()
    }

    #[test]
    fn configmap_references_from_pod_init_projected_and_cronjob() {
        let mut i = empty();
        i.cms = Some(["env", "init", "proj", "cron", "vol", "free", "kube-root-ca.crt"].iter().map(|n| cm("a", n)).collect());
        i.pods = Some(vec![pod_with(json!({
            "containers": [{"name": "c", "image": "i", "envFrom": [{"configMapRef": {"name": "env"}}],
                            "env": [{"name": "X", "valueFrom": {"configMapKeyRef": {"name": "vol", "key": "k"}}}]}],
            "initContainers": [{"name": "i", "image": "i", "envFrom": [{"configMapRef": {"name": "init"}}]}],
            "volumes": [{"name": "v", "projected": {"sources": [{"configMap": {"name": "proj"}}]}}]
        }))]);
        i.crons = Some(vec![o(json!({"metadata": meta("a", "cj"), "spec": {"schedule": "* * * * *", "jobTemplate": {"spec": {"template": {"spec": {
            "containers": [{"name": "c", "image": "i"}],
            "volumes": [{"name": "v", "configMap": {"name": "cron"}}]}}}}}}))]);
        assert_eq!(names(&find_unused(&i, true), "cm"), vec!["free"]);
    }

    #[test]
    fn secret_exclusions_and_references() {
        let mut i = empty();
        i.secrets = Some(vec![
            sec("a", "token", "kubernetes.io/service-account-token", json!({})),
            sec("a", "rel", "helm.sh/release.v1", json!({})),
            sec("a", "rel2", "Opaque", json!({"owner": "helm"})),
            sec("a", "repo", "Opaque", json!({"argocd.argoproj.io/secret-type": "repository"})),
            sec("a", "used-env", "Opaque", json!({})),
            sec("a", "used-tls", "kubernetes.io/tls", json!({})),
            sec("a", "used-cert", "kubernetes.io/tls", json!({})),
            sec("a", "used-gw", "kubernetes.io/tls", json!({})),
            sec("a", "used-pull", "Opaque", json!({})),
            sec("a", "free", "Opaque", json!({})),
        ]);
        i.pods = Some(vec![pod_with(json!({"containers": [{"name": "c", "image": "i",
            "env": [{"name": "X", "valueFrom": {"secretKeyRef": {"name": "used-env", "key": "k"}}}]}],
            "imagePullSecrets": [{"name": "used-pull"}]}))]);
        i.ingresses = Some(vec![o(json!({"metadata": meta("a", "ing"), "spec": {"tls": [{"secretName": "used-tls"}]}}))]);
        i.certs = Some(vec![o(json!({"metadata": meta("a", "c"), "spec": {"secretName": "used-cert"}}))]);
        i.gateways = Some(vec![o(json!({"metadata": meta("a", "g"), "spec": {"listeners": [{"tls": {"certificateRefs": [{"name": "used-gw"}]}}]}}))]);
        assert_eq!(names(&find_unused(&i, true), "sec"), vec!["free"]);
    }

    #[test]
    fn pvc_pv_roles_sa_and_zero_replicas() {
        let mut i = empty();
        i.pvcs = Some(vec![
            o(json!({"metadata": meta("a", "mounted"), "status": {"phase": "Bound"}})),
            o(json!({"metadata": meta("a", "idle"), "status": {"phase": "Bound"}})),
            o(json!({"metadata": meta("a", "pending"), "status": {"phase": "Pending"}})),
            o(json!({"metadata": {"name": "ephemeral", "namespace": "a", "ownerReferences": [{"apiVersion": "v1", "kind": "Pod", "name": "p", "uid": "u"}]}, "status": {"phase": "Bound"}})),
        ]);
        i.pods = Some(vec![pod_with(json!({"containers": [{"name": "c", "image": "i"}],
            "serviceAccountName": "used", "volumes": [{"name": "v", "persistentVolumeClaim": {"claimName": "mounted"}}]}))]);
        i.pvs = Some(vec![
            o(json!({"metadata": {"name": "pv1"}, "status": {"phase": "Released"}})),
            o(json!({"metadata": {"name": "pv2"}, "status": {"phase": "Bound"}})),
        ]);
        i.roles = Some(vec![o(json!({"metadata": meta("a", "bound")})), o(json!({"metadata": meta("a", "free")}))]);
        i.rbs = Some(vec![o(json!({"metadata": meta("a", "rb"), "roleRef": {"apiGroup": "x", "kind": "Role", "name": "bound"}}))]);
        i.sas = Some(["default", "used", "idle"].iter().map(|n| o(json!({"metadata": meta("a", n)}))).collect());
        i.deploys = Some(vec![o(json!({"metadata": meta("a", "d0"), "spec": {"replicas": 0, "selector": {}, "template": {}}})),
                              o(json!({"metadata": meta("a", "d1"), "spec": {"replicas": 1, "selector": {}, "template": {}}}))]);
        let c = find_unused(&i, true);
        assert_eq!(names(&c, "pvc"), vec!["idle"]);
        assert_eq!(names(&c, "pv"), vec!["pv1"]);
        assert_eq!(names(&c, "roles"), vec!["free"]);
        assert_eq!(names(&c, "sa"), vec!["idle"]);
        assert_eq!(names(&c, "deploy"), vec!["d0"]);
    }

    #[test]
    fn skipped_pods_emits_no_dependent_kinds() {
        let mut i = empty();
        i.pods = None;
        i.cms = Some(vec![cm("a", "x")]);
        i.secrets = Some(vec![sec("a", "x", "Opaque", json!({}))]);
        i.pvcs = Some(vec![o(json!({"metadata": meta("a", "x"), "status": {"phase": "Bound"}}))]);
        i.sas = Some(vec![o(json!({"metadata": meta("a", "x")}))]);
        i.deploys = Some(vec![o(json!({"metadata": meta("a", "d0"), "spec": {"replicas": 0, "selector": {}, "template": {}}}))]);
        let c = find_unused(&i, true);
        assert_eq!(c.iter().map(|x| x.kind.as_str()).collect::<Vec<_>>(), vec!["deploy"]); // needs only its own list
    }

    #[test]
    fn skipped_reference_source_blocks_only_its_kinds() {
        let mut i = empty();
        i.ingresses = None; // only secrets need ingresses
        i.cms = Some(vec![cm("a", "x")]);
        i.secrets = Some(vec![sec("a", "x", "Opaque", json!({}))]);
        let c = find_unused(&i, true);
        assert_eq!(names(&c, "cm"), vec!["x"]);
        assert!(names(&c, "sec").is_empty());
    }

    #[test]
    fn system_namespace_hidden_as_candidate_but_read_as_reference() {
        let mut i = empty();
        i.cms = Some(vec![cm("kube-system", "hidden"), cm("a", "shown")]);
        let all = find_unused(&i, true);
        assert_eq!(names(&all, "cm"), vec!["shown"]);
        assert_eq!(names(&find_unused(&i, false), "cm"), vec!["shown", "hidden"]);
        // A ClusterRole bound only from a kube-system RoleBinding is not listed.
        let mut j = empty();
        j.croles = Some(vec![o(json!({"metadata": {"name": "c"}}))]);
        j.rbs = Some(vec![o(json!({"metadata": meta("kube-system", "rb"), "roleRef": {"apiGroup": "x", "kind": "ClusterRole", "name": "c"}}))]);
        assert!(names(&find_unused(&j, true), "croles").is_empty());
    }

    #[test]
    fn croles_exclusions_and_namespace_scope() {
        let mut i = empty();
        i.croles = Some(vec![
            o(json!({"metadata": {"name": "free"}})),
            o(json!({"metadata": {"name": "system:thing"}})),
            o(json!({"metadata": {"name": "agg", "labels": {"rbac.authorization.k8s.io/aggregate-to-view": "true"}}})),
            o(json!({"metadata": {"name": "used"}})),
            o(json!({"metadata": {"name": "admin", "labels": {"kubernetes.io/bootstrapping": "rbac-defaults"}}})),
        ]);
        i.crbs = Some(vec![o(json!({"metadata": {"name": "b"}, "roleRef": {"apiGroup": "x", "kind": "ClusterRole", "name": "used"}}))]);
        assert_eq!(names(&find_unused(&i, true), "croles"), vec!["free"]);
        i.pvs = Some(vec![o(json!({"metadata": {"name": "pv"}, "status": {"phase": "Available"}}))]);
        let scoped = find_unused(&i, false);
        assert!(names(&scoped, "croles").is_empty() && names(&scoped, "pv").is_empty());
    }
}
