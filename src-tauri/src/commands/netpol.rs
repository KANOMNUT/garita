//! #24 NetworkPolicy model (v2.2.0). Read-only. Backend only converts policies, this namespace's
//! pod labels and every namespace's labels into plain data; the frontend evaluator
//! (`src/utils/netpolEval.ts`) holds the semantics, labelled "approximation".

use std::collections::BTreeMap;

use k8s_openapi::api::{
    core::v1::{Namespace, Pod},
    networking::v1::{NetworkPolicy, NetworkPolicyPeer, NetworkPolicyPort},
};
use k8s_openapi::apimachinery::pkg::{apis::meta::v1::LabelSelector, util::intstr::IntOrString};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::map::map_namespace;
use super::problems::{take, SkippedSource};
use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SelectorExpr {
    pub key: String,
    pub operator: String, // In | NotIn | Exists | DoesNotExist
    pub values: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct LabelSelectorModel {
    pub match_labels: BTreeMap<String, String>,
    pub match_expressions: Vec<SelectorExpr>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct IpBlockModel {
    pub cidr: String,
    pub except: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PeerModel {
    pub pod_selector: Option<LabelSelectorModel>,
    pub namespace_selector: Option<LabelSelectorModel>,
    pub ip_block: Option<IpBlockModel>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PortModel {
    pub protocol: String,
    /// A number or a name, as written; names are not resolved.
    pub port: Option<String>,
    pub end_port: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RuleModel {
    pub peers: Vec<PeerModel>, // empty = all peers
    pub ports: Vec<PortModel>, // empty = all ports
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PolicyModel {
    pub name: String,
    pub pod_selector: LabelSelectorModel,
    pub policy_types: Vec<String>,
    pub ingress: Vec<RuleModel>,
    pub egress: Vec<RuleModel>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PodLabels {
    pub name: String,
    pub labels: BTreeMap<String, String>,
    /// "<Kind>/<name>" of the controller ownerReference, else "".
    pub controller: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NamespaceLabels {
    pub name: String,
    pub labels: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetpolModel {
    pub policies: Vec<PolicyModel>,
    pub pods: Vec<PodLabels>,
    pub namespaces: Vec<NamespaceLabels>,
    pub skipped: Vec<SkippedSource>,
}

// ─── Conversion (pure) ───────────────────────────────────────────────────────

pub(crate) fn selector_model(s: &LabelSelector) -> LabelSelectorModel {
    LabelSelectorModel {
        match_labels: s.match_labels.clone().unwrap_or_default(),
        match_expressions: s
            .match_expressions
            .iter()
            .flatten()
            .map(|e| SelectorExpr { key: e.key.clone(), operator: e.operator.clone(), values: e.values.clone().unwrap_or_default() })
            .collect(),
    }
}

pub(crate) fn peer_model(p: &NetworkPolicyPeer) -> PeerModel {
    PeerModel {
        pod_selector: p.pod_selector.as_ref().map(selector_model),
        namespace_selector: p.namespace_selector.as_ref().map(selector_model),
        ip_block: p.ip_block.as_ref().map(|b| IpBlockModel { cidr: b.cidr.clone(), except: b.except.clone().unwrap_or_default() }),
    }
}

pub(crate) fn port_model(p: &NetworkPolicyPort) -> PortModel {
    PortModel {
        protocol: p.protocol.clone().unwrap_or_else(|| "TCP".to_string()),
        port: p.port.as_ref().map(|v| match v {
            IntOrString::Int(n) => n.to_string(),
            IntOrString::String(s) => s.clone(),
        }),
        end_port: p.end_port,
    }
}

fn rule_model(peers: Option<&Vec<NetworkPolicyPeer>>, ports: Option<&Vec<NetworkPolicyPort>>) -> RuleModel {
    RuleModel {
        peers: peers.into_iter().flatten().map(peer_model).collect(),
        ports: ports.into_iter().flatten().map(port_model).collect(),
    }
}

/// The API default: `Ingress` always, `Egress` too when the policy has egress rules.
pub(crate) fn effective_policy_types(declared: Option<&Vec<String>>, has_egress_rules: bool) -> Vec<String> {
    match declared.filter(|d| !d.is_empty()) {
        Some(d) => d.clone(),
        None if has_egress_rules => vec!["Ingress".into(), "Egress".into()],
        None => vec!["Ingress".into()],
    }
}

/// `None` when the object has no spec (never seen from a real API server).
pub(crate) fn policy_model(np: &NetworkPolicy) -> Option<PolicyModel> {
    let spec = np.spec.as_ref()?;
    let egress = spec.egress.as_deref().unwrap_or(&[]);
    Some(PolicyModel {
        name: np.metadata.name.clone().unwrap_or_default(),
        pod_selector: selector_model(&spec.pod_selector),
        policy_types: effective_policy_types(spec.policy_types.as_ref(), !egress.is_empty()),
        ingress: spec.ingress.iter().flatten().map(|r| rule_model(r.from.as_ref(), r.ports.as_ref())).collect(),
        egress: egress.iter().map(|r| rule_model(r.to.as_ref(), r.ports.as_ref())).collect(),
    })
}

/// Finished pods (Succeeded, Failed) have no network and are left out.
pub(crate) fn pod_labels(p: &Pod) -> Option<PodLabels> {
    if matches!(p.status.as_ref().and_then(|s| s.phase.as_deref()), Some("Succeeded" | "Failed")) {
        return None;
    }
    let controller = p
        .metadata
        .owner_references
        .iter()
        .flatten()
        .find(|o| o.controller == Some(true))
        .map(|o| format!("{}/{}", o.kind, o.name))
        .unwrap_or_default();
    Some(PodLabels { name: p.metadata.name.clone().unwrap_or_default(), labels: p.metadata.labels.clone().unwrap_or_default(), controller })
}

#[tauri::command]
pub async fn get_network_policy_model(context: String, namespace: String) -> Result<NetpolModel, String> {
    let ns = map_namespace(&namespace)?.to_string();
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let lp = ListParams::default();
    let policies_api = Api::<NetworkPolicy>::namespaced(client.clone(), &ns);
    let pods_api = Api::<Pod>::namespaced(client.clone(), &ns);
    let namespaces_api = Api::<Namespace>::all(client.clone());
    let (policies, pods, namespaces) = tokio::join!(
        policies_api.list(&lp),
        pods_api.list(&lp),
        namespaces_api.list(&lp),
    );
    let mut skipped = Vec::new();
    let policies = take(policies, "networkpolicies", false, &mut skipped).unwrap_or_default();
    let pods = take(pods, "pods", false, &mut skipped).unwrap_or_default();
    let namespaces = take(namespaces, "namespaces", false, &mut skipped).unwrap_or_default();
    Ok(NetpolModel {
        policies: policies.iter().filter_map(policy_model).collect(),
        pods: pods.iter().filter_map(pod_labels).collect(),
        namespaces: namespaces
            .into_iter()
            .map(|n| NamespaceLabels { name: n.metadata.name.unwrap_or_default(), labels: n.metadata.labels.unwrap_or_default() })
            .collect(),
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn np(spec: serde_json::Value) -> PolicyModel {
        let o: NetworkPolicy = serde_json::from_value(json!({"metadata": {"name": "p"}, "spec": spec})).expect("fixture");
        policy_model(&o).expect("model")
    }

    #[test]
    fn every_peer_shape_converts() {
        let m = np(json!({
            "podSelector": {"matchLabels": {"app": "web"}, "matchExpressions": [{"key": "tier", "operator": "In", "values": ["a", "b"]}, {"key": "x", "operator": "Exists"}]},
            "ingress": [{"from": [
                {"podSelector": {"matchLabels": {"role": "db"}}},
                {"namespaceSelector": {"matchLabels": {"env": "prod"}}},
                {"namespaceSelector": {}, "podSelector": {"matchLabels": {"a": "b"}}},
                {"ipBlock": {"cidr": "10.0.0.0/8", "except": ["10.1.0.0/16"]}},
                {"ipBlock": {"cidr": "0.0.0.0/0"}}]}]}));
        assert_eq!(m.pod_selector.match_labels.get("app").map(String::as_str), Some("web"));
        assert_eq!(m.pod_selector.match_expressions, vec![
            SelectorExpr { key: "tier".into(), operator: "In".into(), values: vec!["a".into(), "b".into()] },
            SelectorExpr { key: "x".into(), operator: "Exists".into(), values: vec![] },
        ]);
        let peers = &m.ingress[0].peers;
        assert_eq!(peers.len(), 5);
        assert!(peers[0].pod_selector.is_some() && peers[0].namespace_selector.is_none() && peers[0].ip_block.is_none());
        assert!(peers[1].pod_selector.is_none() && peers[1].namespace_selector.is_some());
        // an empty namespaceSelector is "every namespace", not "absent"; with podSelector it is the AND form
        assert_eq!(peers[2].namespace_selector, Some(LabelSelectorModel::default()));
        assert!(peers[2].pod_selector.is_some());
        assert_eq!(peers[3].ip_block, Some(IpBlockModel { cidr: "10.0.0.0/8".into(), except: vec!["10.1.0.0/16".into()] }));
        assert_eq!(peers[4].ip_block.as_ref().map(|b| b.except.len()), Some(0));
    }

    #[test]
    fn empty_peers_and_ports_mean_all_and_ports_convert() {
        let m = np(json!({"podSelector": {}, "ingress": [{}], "egress": [{"to": [], "ports": [
            {"port": 80}, {"protocol": "UDP", "port": "dns"}, {"port": 32000, "endPort": 32768}, {"protocol": "SCTP"}]}]}));
        assert_eq!(m.ingress, vec![RuleModel { peers: vec![], ports: vec![] }]);
        let p = &m.egress[0].ports;
        assert!(m.egress[0].peers.is_empty());
        assert_eq!(p[0], PortModel { protocol: "TCP".into(), port: Some("80".into()), end_port: None });
        assert_eq!(p[1], PortModel { protocol: "UDP".into(), port: Some("dns".into()), end_port: None });
        assert_eq!(p[2].end_port, Some(32768));
        assert_eq!(p[3], PortModel { protocol: "SCTP".into(), port: None, end_port: None });
    }

    #[test]
    fn missing_policy_types_default_per_the_api() {
        assert_eq!(np(json!({"podSelector": {}})).policy_types, ["Ingress"]);
        assert_eq!(np(json!({"podSelector": {}, "ingress": [{}]})).policy_types, ["Ingress"]);
        assert_eq!(np(json!({"podSelector": {}, "egress": [{}]})).policy_types, ["Ingress", "Egress"]);
        // declared wins, including egress-only default-deny with no rules
        assert_eq!(np(json!({"podSelector": {}, "policyTypes": ["Egress"]})).policy_types, ["Egress"]);
        assert_eq!(np(json!({"podSelector": {}, "policyTypes": []})).policy_types, ["Ingress"]);
    }

    #[test]
    fn pod_labels_carry_controller_and_skip_finished_pods() {
        let p = |v: serde_json::Value| -> Pod { serde_json::from_value(v).expect("fixture") };
        let rs = p(json!({"metadata": {"name": "web-abc-1", "labels": {"app": "web"}, "ownerReferences": [
            {"apiVersion": "v1", "kind": "ConfigMap", "name": "x", "uid": "u0"},
            {"apiVersion": "apps/v1", "kind": "ReplicaSet", "name": "web-abc", "uid": "u1", "controller": true}]}}));
        let m = pod_labels(&rs).expect("running");
        assert_eq!((m.name.as_str(), m.controller.as_str(), m.labels.len()), ("web-abc-1", "ReplicaSet/web-abc", 1));
        assert_eq!(pod_labels(&p(json!({"metadata": {"name": "bare"}}))).map(|m| m.controller), Some(String::new()));
        for phase in ["Succeeded", "Failed"] {
            assert!(pod_labels(&p(json!({"metadata": {"name": "done"}, "status": {"phase": phase}}))).is_none());
        }
        assert!(pod_labels(&p(json!({"metadata": {"name": "r"}, "status": {"phase": "Running"}}))).is_some());
    }

    #[test]
    fn a_policy_without_spec_is_skipped_not_a_panic() {
        let o: NetworkPolicy = serde_json::from_value(json!({"metadata": {"name": "p"}})).expect("fixture");
        assert!(policy_model(&o).is_none());
    }
}
