use std::collections::{BTreeMap, HashMap};

use k8s_openapi::api::core::v1::{Container, Node as K8sNode, Pod as K8sPod, PodSpec};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::nodes::fetch_node_metrics;
use super::utils::{client_for_context, parse_cpu_millis, parse_mem_bytes};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NodeCapacity {
    pub node: String,
    pub cpu_allocatable_m: Option<i64>,
    pub mem_allocatable_mi: Option<i64>,
    pub pods_allocatable: Option<i64>,
    pub cpu_requests_m: i64,
    pub cpu_limits_m: i64,
    pub mem_requests_mi: i64,
    pub mem_limits_mi: i64,
    pub pods: i64,
    pub pods_without_limits: i64,
    pub cpu_usage_m: Option<i64>,
    pub mem_usage_mi: Option<i64>,
}

const MIB: i64 = 1_048_576;

type Quantities = BTreeMap<String, Quantity>;

fn cpu_m(q: Option<&Quantities>, key: &str) -> Option<i64> {
    q?.get(key).and_then(|v| parse_cpu_millis(&v.0))
}

fn mem_bytes(q: Option<&Quantities>, key: &str) -> Option<i64> {
    q?.get(key).and_then(|v| parse_mem_bytes(&v.0))
}

fn qty(c: &Container, limits: bool) -> Option<&Quantities> {
    let r = c.resources.as_ref()?;
    if limits { r.limits.as_ref() } else { r.requests.as_ref() }
}

/// One resource of upstream `PodRequests`/`PodLimits` (`k8s.io/component-helpers/resource`),
/// before overhead: `max(sum(app) + sum(sidecars), peak init)`, where a sidecar is an init
/// container with `restartPolicy: Always` that keeps running beside every later init container.
fn aggregate_resource(spec: &PodSpec, f: &dyn Fn(&Container) -> i64) -> i64 {
    let app = spec.containers.iter().fold(0i64, |a, c| a.saturating_add(f(c)));
    let (mut sidecars, mut peak) = (0i64, 0i64);
    for c in spec.init_containers.iter().flatten() {
        let v = f(c);
        if c.restart_policy.as_deref() == Some("Always") {
            sidecars = sidecars.saturating_add(v);
            peak = peak.max(sidecars);
        } else {
            peak = peak.max(v.saturating_add(sidecars));
        }
    }
    app.saturating_add(sidecars).max(peak)
}

/// Effective pod `(cpu_req_m, mem_req_bytes, cpu_lim_m, mem_lim_bytes)`, matching upstream
/// (what `kubectl describe node` sums): pod overhead is added to requests, and to a limit only
/// when the aggregated limit for that resource is non-zero. Absent or unparsable quantities are 0.
pub(crate) fn pod_effective_requests(spec: &PodSpec) -> (i64, i64, i64, i64) {
    let oh = spec.overhead.as_ref();
    let (oh_cpu, oh_mem) = (cpu_m(oh, "cpu").unwrap_or(0), mem_bytes(oh, "memory").unwrap_or(0));
    let with_oh = |agg: i64, oh: i64, only_if_set: bool| {
        if only_if_set && agg == 0 { agg } else { agg.saturating_add(oh) }
    };
    let cpu = |limits| move |c: &Container| cpu_m(qty(c, limits), "cpu").unwrap_or(0);
    let mem = |limits| move |c: &Container| mem_bytes(qty(c, limits), "memory").unwrap_or(0);
    (
        with_oh(aggregate_resource(spec, &cpu(false)), oh_cpu, false),
        with_oh(aggregate_resource(spec, &mem(false)), oh_mem, false),
        with_oh(aggregate_resource(spec, &cpu(true)), oh_cpu, true),
        with_oh(aggregate_resource(spec, &mem(true)), oh_mem, true),
    )
}

/// At least one app container lacks a cpu or a memory limit.
fn lacks_limits(spec: &PodSpec) -> bool {
    spec.containers.iter().any(|c| {
        let l = c.resources.as_ref().and_then(|r| r.limits.as_ref());
        l.map_or(true, |l| !l.contains_key("cpu") || !l.contains_key("memory"))
    })
}

fn is_terminal(pod: &K8sPod) -> bool {
    matches!(
        pod.status.as_ref().and_then(|s| s.phase.as_deref()),
        Some("Succeeded") | Some("Failed")
    )
}

/// One row per node. Pods without a `nodeName`, bound to an unknown node, or terminal are skipped.
/// `usage` maps node name to `(cpu millicores, memory bytes)`; a node absent from it has no usage.
pub(crate) fn aggregate_by_node(
    nodes: &[K8sNode],
    pods: &[K8sPod],
    usage: &HashMap<String, (u64, u64)>,
) -> Vec<NodeCapacity> {
    let mut rows: Vec<NodeCapacity> = nodes
        .iter()
        .map(|n| {
            let name = n.metadata.name.clone().unwrap_or_default();
            let alloc = n.status.as_ref().and_then(|s| s.allocatable.as_ref());
            let u = usage.get(&name);
            NodeCapacity {
                cpu_allocatable_m: cpu_m(alloc, "cpu"),
                mem_allocatable_mi: mem_bytes(alloc, "memory").map(|b| b / MIB),
                pods_allocatable: alloc.and_then(|a| a.get("pods")).and_then(|q| q.0.parse().ok()),
                cpu_requests_m: 0,
                cpu_limits_m: 0,
                mem_requests_mi: 0,
                mem_limits_mi: 0,
                pods: 0,
                pods_without_limits: 0,
                cpu_usage_m: u.map(|(c, _)| *c as i64),
                mem_usage_mi: u.map(|(_, m)| (*m / MIB as u64) as i64),
                node: name,
            }
        })
        .collect();
    let index: HashMap<String, usize> =
        rows.iter().enumerate().map(|(i, r)| (r.node.clone(), i)).collect();
    // Memory is summed in bytes and converted to MiB once, so per-container flooring cannot drift.
    let mut bytes = vec![(0i64, 0i64); rows.len()];

    for pod in pods.iter().filter(|p| !is_terminal(p)) {
        let Some(spec) = pod.spec.as_ref() else { continue };
        let Some(i) = spec.node_name.as_ref().and_then(|n| index.get(n)).copied() else { continue };
        let (Some(row), Some(b)) = (rows.get_mut(i), bytes.get_mut(i)) else { continue };
        let (cr, mr, cl, ml) = pod_effective_requests(spec);
        row.cpu_requests_m += cr;
        row.cpu_limits_m += cl;
        b.0 = b.0.saturating_add(mr);
        b.1 = b.1.saturating_add(ml);
        row.pods += 1;
        if lacks_limits(spec) {
            row.pods_without_limits += 1;
        }
    }
    for (row, (req, lim)) in rows.iter_mut().zip(bytes) {
        row.mem_requests_mi = req / MIB;
        row.mem_limits_mi = lim / MIB;
    }
    rows
}

#[tauri::command]
pub async fn list_node_capacity(context: String) -> Result<Vec<NodeCapacity>, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let nodes_api: Api<K8sNode> = Api::all(client.clone());
    let pods_api: Api<K8sPod> = Api::all(client.clone());
    let all = ListParams::default();
    let lp = ListParams::default().fields("status.phase!=Succeeded,status.phase!=Failed");
    let (nodes, pods, usage) = tokio::join!(
        nodes_api.list(&all),
        pods_api.list(&lp),
        fetch_node_metrics(client)
    );
    let nodes = nodes.map_err(|e| format!("Failed to list nodes: {}", e))?;
    let pods = pods.map_err(|e| format!("Failed to list pods: {}", e))?;
    Ok(aggregate_by_node(&nodes.items, &pods.items, &usage))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(v: serde_json::Value) -> PodSpec {
        serde_json::from_value(v).expect("spec json")
    }

    fn c(name: &str, req: (&str, &str), lim: Option<(&str, &str)>) -> serde_json::Value {
        let mut r = json!({"requests": {"cpu": req.0, "memory": req.1}});
        if let Some((cpu, mem)) = lim {
            r["limits"] = json!({"cpu": cpu, "memory": mem});
        }
        json!({"name": name, "resources": r})
    }

    #[test]
    fn app_sum_beats_smaller_init() {
        let s = spec(json!({
            "containers": [c("a", ("100m", "64Mi"), None), c("b", ("200m", "64Mi"), None)],
            "initContainers": [c("i", ("250m", "32Mi"), None)]
        }));
        assert_eq!(pod_effective_requests(&s), (300, 128 * MIB, 0, 0));
    }

    #[test]
    fn init_beats_smaller_app_sum() {
        let s = spec(json!({
            "containers": [c("a", ("100m", "64Mi"), Some(("200m", "128Mi")))],
            "initContainers": [c("i", ("500m", "512Mi"), Some(("1", "1Gi"))), c("j", ("50m", "8Mi"), None)]
        }));
        assert_eq!(pod_effective_requests(&s), (500, 512 * MIB, 1000, 1024 * MIB));
    }

    fn sc(name: &str, req: (&str, &str)) -> serde_json::Value {
        let mut v = c(name, req, None);
        v["restartPolicy"] = json!("Always");
        v
    }

    #[test]
    fn overhead_without_limits_leaves_limits_zero() {
        let s = spec(json!({
            "containers": [c("a", ("100m", "64Mi"), None)],
            "overhead": {"cpu": "250m", "memory": "120Mi"}
        }));
        assert_eq!(pod_effective_requests(&s), (350, 184 * MIB, 0, 0));
    }

    #[test]
    fn overhead_with_limits_is_added_to_limits() {
        let s = spec(json!({
            "containers": [c("a", ("100m", "64Mi"), Some(("500m", "256Mi")))],
            "overhead": {"cpu": "250m", "memory": "120Mi"}
        }));
        assert_eq!(pod_effective_requests(&s), (350, 184 * MIB, 750, 376 * MIB));
    }

    #[test]
    fn overhead_only_on_the_resource_that_has_a_limit() {
        let s = spec(json!({
            "containers": [{"name": "a", "resources": {"limits": {"cpu": "1"}}}],
            "overhead": {"cpu": "100m", "memory": "10Mi"}
        }));
        assert_eq!(pod_effective_requests(&s), (100, 10 * MIB, 1100, 0));
    }

    #[test]
    fn sidecar_before_larger_plain_init() {
        // sidecar 100m runs beside the 500m init: peak 600m; app + sidecar = 300m.
        let s = spec(json!({
            "containers": [c("a", ("200m", "64Mi"), None)],
            "initContainers": [sc("side", ("100m", "10Mi")), c("i", ("500m", "100Mi"), None)]
        }));
        assert_eq!(pod_effective_requests(&s), (600, 110 * MIB, 0, 0));
    }

    #[test]
    fn sidecar_after_plain_init_does_not_run_beside_it() {
        // plain init first (500m alone), sidecar after: peak 500m; app + sidecar = 300m.
        let s = spec(json!({
            "containers": [c("a", ("200m", "64Mi"), None)],
            "initContainers": [c("i", ("500m", "100Mi"), None), sc("side", ("100m", "10Mi"))]
        }));
        assert_eq!(pod_effective_requests(&s), (500, 100 * MIB, 0, 0));
    }

    #[test]
    fn sidecar_only_pod_adds_to_app_sum() {
        let s = spec(json!({
            "containers": [c("a", ("200m", "64Mi"), Some(("1", "128Mi")))],
            "initContainers": [{"name": "side", "restartPolicy": "Always",
                "resources": {"requests": {"cpu": "100m", "memory": "10Mi"}, "limits": {"cpu": "200m", "memory": "20Mi"}}}]
        }));
        assert_eq!(pod_effective_requests(&s), (300, 74 * MIB, 1200, 148 * MIB));
    }

    #[test]
    fn missing_limit_counts_as_without_limits() {
        let none = spec(json!({"containers": [c("a", ("1", "1Gi"), None)]}));
        let half = spec(json!({"containers": [{"name": "a", "resources": {"limits": {"cpu": "1"}}}]}));
        let full = spec(json!({"containers": [c("a", ("1", "1Gi"), Some(("1", "1Gi")))]}));
        assert!(lacks_limits(&none));
        assert!(lacks_limits(&half));
        assert!(!lacks_limits(&full));
    }

    #[test]
    fn unparsable_quantities_count_as_zero() {
        let s = spec(json!({"containers": [c("a", ("lots", "plenty"), Some(("x", "y")))]}));
        assert_eq!(pod_effective_requests(&s), (0, 0, 0, 0));
    }

    #[test]
    fn aggregates_per_node_and_skips_unbound_unknown_terminal() {
        let node: K8sNode = serde_json::from_value(json!({
            "metadata": {"name": "n1"},
            "status": {"allocatable": {"cpu": "2", "memory": "4096Mi", "pods": "110"}}
        }))
        .expect("node");
        let pod = |node: Option<&str>, phase: &str, limits: bool| -> K8sPod {
            let mut sp = json!({"containers": [c("a", ("100m", "64Mi"), limits.then_some(("200m", "128Mi")))]});
            if let Some(n) = node {
                sp["nodeName"] = json!(n);
            }
            serde_json::from_value(json!({"spec": sp, "status": {"phase": phase}})).expect("pod")
        };
        let pods = vec![
            pod(Some("n1"), "Running", true),
            pod(Some("n1"), "Running", false),
            pod(Some("n1"), "Succeeded", false),
            pod(Some("other"), "Running", true),
            pod(None, "Pending", true),
        ];
        let usage = HashMap::from([("n1".to_string(), (750u64, 512u64 * 1024 * 1024))]);
        let rows = aggregate_by_node(std::slice::from_ref(&node), &pods, &usage);
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!((r.cpu_allocatable_m, r.mem_allocatable_mi, r.pods_allocatable), (Some(2000), Some(4096), Some(110)));
        assert_eq!((r.cpu_requests_m, r.mem_requests_mi, r.cpu_limits_m, r.mem_limits_mi), (200, 128, 200, 128));
        // Memory sums in bytes and floors once: 3 x 0.6Mi = 1.8Mi -> 1, not 0.
        let frac = || -> K8sPod {
            serde_json::from_value(json!({"spec": {"nodeName": "n1", "containers": [{"name": "a", "resources": {"requests": {"memory": "629146"}}}]}, "status": {"phase": "Running"}})).expect("pod")
        };
        let rows = aggregate_by_node(std::slice::from_ref(&node), &[frac(), frac(), frac()], &HashMap::new());
        assert_eq!(rows[0].mem_requests_mi, 1);
        assert_eq!((r.pods, r.pods_without_limits), (2, 1));
        assert_eq!((r.cpu_usage_m, r.mem_usage_mi), (Some(750), Some(512)));
        // Metrics unavailable: usage is None, everything else unchanged.
        let rows = aggregate_by_node(&[node], &pods, &HashMap::new());
        assert_eq!((rows[0].cpu_usage_m, rows[0].mem_usage_mi), (None, None));
    }
}
