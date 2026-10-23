use k8s_openapi::api::core::v1::ServiceAccount as K8sSA;
use k8s_openapi::api::rbac::v1::{
    ClusterRole as K8sCR, ClusterRoleBinding as K8sCRB, PolicyRule, Role as K8sRole,
    RoleBinding as K8sRB, Subject as K8sSubject,
};
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::problems::{take, SkippedSource};
use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServiceAccountRow {
    pub name: String,
    pub namespace: String,
    pub age: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoleRow {
    pub name: String,
    pub namespace: String,
    pub rules_count: usize,
    pub age: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterRoleRow {
    pub name: String,
    pub rules_count: usize,
    pub age: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoleBindingRow {
    pub name: String,
    pub namespace: String,
    pub role_ref: String,
    pub subjects: String,
    pub subject_list: Vec<RbacSubject>,
    pub age: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterRoleBindingRow {
    pub name: String,
    pub role_ref: String,
    pub subjects: String,
    pub subject_list: Vec<RbacSubject>,
    pub age: String,
}

#[tauri::command]
pub async fn list_service_accounts(
    context: String, namespace: String,
) -> Result<Vec<ServiceAccountRow>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
    let api: Api<K8sSA> = namespaced_or_all!(client, K8sSA, namespace);
    let list = api.list(&ListParams::default()).await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().map(|sa| ServiceAccountRow {
        name: sa.metadata.name.unwrap_or_default(),
        namespace: sa.metadata.namespace.unwrap_or_default(),
        age: age_from_timestamp(sa.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
    }).collect())
}

#[tauri::command]
pub async fn list_roles(
    context: String, namespace: String,
) -> Result<Vec<RoleRow>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
    let api: Api<K8sRole> = namespaced_or_all!(client, K8sRole, namespace);
    let list = api.list(&ListParams::default()).await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().map(|r| RoleRow {
        name: r.metadata.name.unwrap_or_default(),
        namespace: r.metadata.namespace.unwrap_or_default(),
        rules_count: r.rules.as_ref().map(|v| v.len()).unwrap_or(0),
        age: age_from_timestamp(r.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
    }).collect())
}

#[tauri::command]
pub async fn list_cluster_roles(context: String) -> Result<Vec<ClusterRoleRow>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
    let api: Api<K8sCR> = Api::all(client);
    let list = api.list(&ListParams::default()).await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().map(|cr| ClusterRoleRow {
        name: cr.metadata.name.unwrap_or_default(),
        rules_count: cr.rules.as_ref().map(|v| v.len()).unwrap_or(0),
        age: age_from_timestamp(cr.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
    }).collect())
}

#[tauri::command]
pub async fn list_role_bindings(
    context: String, namespace: String,
) -> Result<Vec<RoleBindingRow>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
    let api: Api<K8sRB> = namespaced_or_all!(client, K8sRB, namespace);
    let list = api.list(&ListParams::default()).await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().map(|rb| {
        let role_ref = format!("{}/{}", rb.role_ref.kind, rb.role_ref.name);
        let subjects = rb.subjects.as_ref()
            .map(|ss| ss.iter().map(|s| format!("{}/{}", s.kind, s.name)).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        RoleBindingRow {
            subject_list: subject_list(rb.subjects.as_ref(), rb.metadata.namespace.as_deref()),
            name: rb.metadata.name.unwrap_or_default(),
            namespace: rb.metadata.namespace.unwrap_or_default(),
            role_ref,
            subjects,
            age: age_from_timestamp(rb.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

#[tauri::command]
pub async fn list_cluster_role_bindings(context: String) -> Result<Vec<ClusterRoleBindingRow>, String> {
    let client = client_for_context(&context).await.map_err(|e| e.to_string())?;
    let api: Api<K8sCRB> = Api::all(client);
    let list = api.list(&ListParams::default()).await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().map(|crb| {
        let role_ref = format!("{}/{}", crb.role_ref.kind, crb.role_ref.name);
        let subjects = crb.subjects.as_ref()
            .map(|ss| ss.iter().map(|s| format!("{}/{}", s.kind, s.name)).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        ClusterRoleBindingRow {
            subject_list: subject_list(crb.subjects.as_ref(), None),
            name: crb.metadata.name.unwrap_or_default(),
            role_ref,
            subjects,
            age: age_from_timestamp(crb.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── Who can / subject permissions (v1.4.1, #32) ─────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct RbacSubject {
    pub kind: String, // User | Group | ServiceAccount
    pub name: String,
    pub namespace: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WhoCanGrant {
    pub subject: RbacSubject,
    pub binding_kind: String, // "RoleBinding" | "ClusterRoleBinding"
    pub binding: String,
    pub binding_namespace: Option<String>,
    pub role_kind: String, // "Role" | "ClusterRole"
    pub role: String,
    pub scope: String,               // "cluster" | "namespace"
    pub resource_names: Vec<String>, // non-empty = only these objects
    pub via_wildcard: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WhoCanResult {
    pub grants: Vec<WhoCanGrant>,
    pub notes: Vec<String>,
    pub skipped: Vec<SkippedSource>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleGrant {
    pub api_groups: Vec<String>,
    pub resources: Vec<String>,
    pub verbs: Vec<String>,
    pub resource_names: Vec<String>,
    pub non_resource_urls: Vec<String>,
    pub binding_kind: String,
    pub binding: String,
    pub binding_namespace: Option<String>,
    pub role_kind: String,
    pub role: String,
    pub scope: String,
    /// Implicit group through which the binding reaches the subject; `None` = named directly.
    pub via_group: Option<String>,
}

/// A ServiceAccount subject without a namespace in a RoleBinding means the binding's namespace
/// (Kubernetes `appliesToUser`); `default_ns` is the binding's namespace, `None` for ClusterRoleBindings.
fn subject_list(ss: Option<&Vec<K8sSubject>>, default_ns: Option<&str>) -> Vec<RbacSubject> {
    ss.map(|v| {
        v.iter()
            .map(|s| {
                let namespace = match (&s.namespace, s.kind.as_str()) {
                    (Some(n), _) if !n.is_empty() => Some(n.clone()),
                    (_, "ServiceAccount") => default_ns.map(str::to_string),
                    _ => s.namespace.clone(),
                };
                RbacSubject { kind: s.kind.clone(), name: s.name.clone(), namespace }
            })
            .collect()
    })
    .unwrap_or_default()
}

/// One RoleBinding or ClusterRoleBinding, flattened.
struct Bind {
    kind: &'static str,
    name: String,
    ns: Option<String>,
    role_kind: String,
    role: String,
    subjects: Vec<RbacSubject>,
}

fn binds(rbs: &[K8sRB], crbs: &[K8sCRB]) -> Vec<Bind> {
    let rb = rbs.iter().map(|b| Bind {
        kind: "RoleBinding",
        name: b.metadata.name.clone().unwrap_or_default(),
        ns: b.metadata.namespace.clone(),
        role_kind: b.role_ref.kind.clone(),
        role: b.role_ref.name.clone(),
        subjects: subject_list(b.subjects.as_ref(), b.metadata.namespace.as_deref()),
    });
    let crb = crbs.iter().map(|b| Bind {
        kind: "ClusterRoleBinding",
        name: b.metadata.name.clone().unwrap_or_default(),
        ns: None,
        role_kind: b.role_ref.kind.clone(),
        role: b.role_ref.name.clone(),
        subjects: subject_list(b.subjects.as_ref(), None),
    });
    rb.chain(crb).collect()
}

/// A binding's rules, `None` when the role does not exist; the flag marks an aggregated
/// ClusterRole whose rules are not filled in yet.
fn role_rules<'a>(b: &Bind, roles: &'a [K8sRole], croles: &'a [K8sCR]) -> Option<(&'a [PolicyRule], bool)> {
    match b.role_kind.as_str() {
        "Role" => roles
            .iter()
            .find(|r| r.metadata.name.as_deref() == Some(&b.role) && r.metadata.namespace == b.ns)
            .map(|r| (r.rules.as_deref().unwrap_or(&[]), false)),
        "ClusterRole" => croles.iter().find(|r| r.metadata.name.as_deref() == Some(&b.role)).map(|r| {
            let rules = r.rules.as_deref().unwrap_or(&[]);
            (rules, r.aggregation_rule.is_some() && rules.is_empty())
        }),
        _ => None,
    }
}

/// `Some(via_wildcard)` when the rule grants `verb` on `resource[/subresource]` in `group`.
/// `resourceNames` is the caller's business: a match here may still be limited to named objects.
fn rule_matches(rule: &PolicyRule, verb: &str, group: &str, resource: &str, sub: Option<&str>) -> Option<bool> {
    let any = |l: &[String], x: &str| -> Option<bool> {
        if l.iter().any(|e| e == x) {
            Some(false)
        } else if l.iter().any(|e| e == "*") {
            Some(true)
        } else {
            None
        }
    };
    let res_match = |e: &str| -> Option<bool> {
        if e == "*" {
            return Some(true);
        }
        let (r, s) = match e.split_once('/') {
            Some((r, s)) => (r, Some(s)),
            None => (e, None),
        };
        let r_wild = r == "*";
        if !r_wild && r != resource {
            return None;
        }
        match (s, sub) {
            (None, None) => Some(false),
            (Some(a), Some(b)) if a == b => Some(r_wild),
            _ => None,
        }
    };
    let w_verb = any(&rule.verbs, verb)?;
    let w_group = any(rule.api_groups.as_deref().unwrap_or(&[]), group)?;
    let w_res = rule.resources.as_deref().unwrap_or(&[]).iter().filter_map(|e| res_match(e)).min()?;
    Some(w_verb || w_group || w_res)
}

const WHO_CAN_NOTE: &str = "Computed from RBAC bindings. Admission webhooks and non-RBAC authorizers (for example cloud IAM mappings) are not visible here.";

/// Pure core of `who_can`. Pass no RoleBindings for the cluster-wide question.
#[allow(clippy::too_many_arguments)]
fn compute_who_can(
    verb: &str, group: &str, resource: &str, sub: Option<&str>,
    roles: &[K8sRole], croles: &[K8sCR], rbs: &[K8sRB], crbs: &[K8sCRB],
    roles_read: bool, croles_read: bool,
) -> (Vec<WhoCanGrant>, Vec<String>) {
    let mut notes = vec![WHO_CAN_NOTE.to_string()];
    let mut grants = Vec::new();
    for b in binds(rbs, crbs) {
        let Some((rules, aggregated)) = role_rules(&b, roles, croles) else {
            let read = if b.role_kind == "Role" { roles_read } else { croles_read };
            let n = format!("Binding {} references {} {}, which does not exist.", b.name, b.role_kind, b.role);
            if read && !notes.contains(&n) {
                notes.push(n);
            }
            continue;
        };
        if aggregated {
            let n = format!("ClusterRole {} is aggregated and its rules are not filled in yet; results may be incomplete.", b.role);
            if !notes.contains(&n) {
                notes.push(n);
            }
        }
        let hits: Vec<(&PolicyRule, bool)> = rules
            .iter()
            // `resourceNames` cannot restrict `create` or `deletecollection`, so such a rule grants nothing here.
            .filter(|r| !(matches!(verb, "create" | "deletecollection") && r.resource_names.as_ref().is_some_and(|n| !n.is_empty())))
            .filter_map(|r| rule_matches(r, verb, group, resource, sub).map(|w| (r, w)))
            .collect();
        if hits.is_empty() {
            continue;
        }
        // Any matching rule without resourceNames makes the grant unrestricted.
        let mut names: Vec<String> = Vec::new();
        if hits.iter().all(|(r, _)| r.resource_names.as_ref().is_some_and(|n| !n.is_empty())) {
            names = hits.iter().flat_map(|(r, _)| r.resource_names.clone().unwrap_or_default()).collect();
            names.sort();
            names.dedup();
        }
        let via_wildcard = hits.iter().all(|(_, w)| *w);
        for s in &b.subjects {
            grants.push(WhoCanGrant {
                subject: s.clone(),
                binding_kind: b.kind.into(),
                binding: b.name.clone(),
                binding_namespace: b.ns.clone(),
                role_kind: b.role_kind.clone(),
                role: b.role.clone(),
                scope: if b.ns.is_some() { "namespace" } else { "cluster" }.into(),
                resource_names: names.clone(),
                via_wildcard,
            });
        }
    }
    grants.sort_by(|a, b| {
        (&a.subject, &a.binding_kind, &a.binding_namespace, &a.binding)
            .cmp(&(&b.subject, &b.binding_kind, &b.binding_namespace, &b.binding))
    });
    (grants, notes)
}

/// `Some(None)` = the binding names the subject; `Some(Some(g))` = reaches it through implicit group `g`.
fn reach(s: &RbacSubject, kind: &str, name: &str, ns: Option<&str>) -> Option<Option<String>> {
    if s.kind == kind && s.name == name && (kind != "ServiceAccount" || s.namespace.as_deref() == ns) {
        return Some(None);
    }
    if s.kind != "Group" {
        return None;
    }
    let implicit: Vec<String> = match kind {
        "ServiceAccount" => vec![
            "system:serviceaccounts".into(),
            format!("system:serviceaccounts:{}", ns.unwrap_or_default()),
            "system:authenticated".into(),
        ],
        "User" => vec!["system:authenticated".into()],
        _ => vec![],
    };
    implicit.contains(&s.name).then(|| Some(s.name.clone()))
}

/// Pure core of `subject_permissions`: every rule reachable by the subject, from all bindings.
fn compute_permissions(
    kind: &str, name: &str, ns: Option<&str>,
    roles: &[K8sRole], croles: &[K8sCR], rbs: &[K8sRB], crbs: &[K8sCRB],
) -> Vec<RuleGrant> {
    let mut out = Vec::new();
    for b in binds(rbs, crbs) {
        let mut via: Option<Option<String>> = None;
        for s in &b.subjects {
            match reach(s, kind, name, ns) {
                Some(None) => {
                    via = Some(None);
                    break;
                }
                Some(g) if via.is_none() => via = Some(g),
                _ => {}
            }
        }
        let (Some(via_group), Some((rules, _))) = (via, role_rules(&b, roles, croles)) else { continue };
        for r in rules {
            out.push(RuleGrant {
                api_groups: r.api_groups.clone().unwrap_or_default(),
                resources: r.resources.clone().unwrap_or_default(),
                verbs: r.verbs.clone(),
                resource_names: r.resource_names.clone().unwrap_or_default(),
                // A RoleBinding never grants non-resource URLs, even through a ClusterRole.
                non_resource_urls: if b.ns.is_some() { vec![] } else { r.non_resource_urls.clone().unwrap_or_default() },
                binding_kind: b.kind.into(),
                binding: b.name.clone(),
                binding_namespace: b.ns.clone(),
                role_kind: b.role_kind.clone(),
                role: b.role.clone(),
                scope: if b.ns.is_some() { "namespace" } else { "cluster" }.into(),
                via_group: via_group.clone(),
            });
        }
    }
    out
}

/// `namespace: None` = ClusterRoleBindings only (grants that apply in every namespace);
/// `Some(ns)` = ClusterRoleBindings plus the RoleBindings in `ns`.
#[tauri::command]
pub async fn who_can(
    context: String, verb: String, group: String, resource: String,
    namespace: Option<String>, subresource: Option<String>,
) -> Result<WhoCanResult, String> {
    let client = client_for_context(&context).await.map_err(|e| format!("Failed to connect: {}", e))?;
    let lp = ListParams::default();
    let ns = namespace.filter(|n| !n.is_empty() && n != "all");
    let croles_api: Api<K8sCR> = Api::all(client.clone());
    let crbs_api: Api<K8sCRB> = Api::all(client.clone());
    let (croles, crbs) = tokio::join!(croles_api.list(&lp), crbs_api.list(&lp));
    let mut skipped = Vec::new();
    let croles = take(croles, "clusterroles", false, &mut skipped);
    let crbs = take(crbs, "clusterrolebindings", false, &mut skipped);
    let (mut roles, mut rbs) = (None, None);
    if let Some(ns) = &ns {
        let roles_api: Api<K8sRole> = Api::namespaced(client.clone(), ns);
        let rbs_api: Api<K8sRB> = Api::namespaced(client, ns);
        let (r, b) = tokio::join!(roles_api.list(&lp), rbs_api.list(&lp));
        roles = take(r, "roles", false, &mut skipped);
        rbs = take(b, "rolebindings", false, &mut skipped);
    }
    let (grants, notes) = compute_who_can(
        &verb, &group, &resource, subresource.as_deref().filter(|s| !s.is_empty()),
        roles.as_deref().unwrap_or(&[]), croles.as_deref().unwrap_or(&[]),
        rbs.as_deref().unwrap_or(&[]), crbs.as_deref().unwrap_or(&[]),
        ns.is_none() || roles.is_some(), croles.is_some(),
    );
    Ok(WhoCanResult { grants, notes, skipped })
}

#[tauri::command]
pub async fn subject_permissions(
    context: String, subject_kind: String, name: String, namespace: Option<String>,
) -> Result<Vec<RuleGrant>, String> {
    let client = client_for_context(&context).await.map_err(|e| format!("Failed to connect: {}", e))?;
    let lp = ListParams::default();
    let roles_api: Api<K8sRole> = Api::all(client.clone());
    let croles_api: Api<K8sCR> = Api::all(client.clone());
    let rbs_api: Api<K8sRB> = Api::all(client.clone());
    let crbs_api: Api<K8sCRB> = Api::all(client);
    let (roles, croles, rbs, crbs) =
        tokio::join!(roles_api.list(&lp), croles_api.list(&lp), rbs_api.list(&lp), crbs_api.list(&lp));
    // Any of the four lists failing is an Err: an unread role must never read as "can do nothing".
    let roles = roles.map_err(|e| format!("Failed to list roles: {}", e))?;
    let croles = croles.map_err(|e| format!("Failed to list cluster roles: {}", e))?;
    let rbs = rbs.map_err(|e| format!("Failed to list role bindings: {}", e))?;
    let crbs = crbs.map_err(|e| format!("Failed to list cluster role bindings: {}", e))?;
    Ok(compute_permissions(
        &subject_kind, &name, namespace.as_deref(),
        &roles.items,
        &croles.items,
        &rbs.items, &crbs.items,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rule(v: serde_json::Value) -> PolicyRule {
        serde_json::from_value(v).expect("rule")
    }
    fn role(ns: &str, name: &str, rules: serde_json::Value) -> K8sRole {
        serde_json::from_value(json!({"metadata": {"name": name, "namespace": ns}, "rules": rules})).expect("role")
    }
    fn crole(name: &str, rules: serde_json::Value) -> K8sCR {
        serde_json::from_value(json!({"metadata": {"name": name}, "rules": rules})).expect("crole")
    }
    fn rb(ns: &str, name: &str, kind: &str, role: &str, subjects: serde_json::Value) -> K8sRB {
        serde_json::from_value(json!({"metadata": {"name": name, "namespace": ns},
            "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": kind, "name": role}, "subjects": subjects})).expect("rb")
    }
    fn crb(name: &str, role: &str, subjects: serde_json::Value) -> K8sCRB {
        serde_json::from_value(json!({"metadata": {"name": name},
            "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "ClusterRole", "name": role}, "subjects": subjects})).expect("crb")
    }
    fn user(n: &str) -> serde_json::Value {
        json!({"kind": "User", "name": n, "apiGroup": "rbac.authorization.k8s.io"})
    }

    #[test]
    fn rule_matching_wildcards_subresources() {
        let r = rule(json!({"verbs": ["get"], "apiGroups": [""], "resources": ["pods"]}));
        assert_eq!(rule_matches(&r, "get", "", "pods", None), Some(false));
        assert_eq!(rule_matches(&r, "list", "", "pods", None), None);
        assert_eq!(rule_matches(&r, "get", "apps", "pods", None), None);
        assert_eq!(rule_matches(&r, "get", "", "pods", Some("log")), None);
        let w = rule(json!({"verbs": ["*"], "apiGroups": ["*"], "resources": ["*"]}));
        assert_eq!(rule_matches(&w, "delete", "apps", "deployments", Some("scale")), Some(true));
        let s = rule(json!({"verbs": ["update"], "apiGroups": ["apps"], "resources": ["deployments/scale"]}));
        assert_eq!(rule_matches(&s, "update", "apps", "deployments", Some("scale")), Some(false));
        assert_eq!(rule_matches(&s, "update", "apps", "deployments", None), None);
        let star = rule(json!({"verbs": ["get"], "apiGroups": [""], "resources": ["*/log"]}));
        assert_eq!(rule_matches(&star, "get", "", "pods", Some("log")), Some(true));
        assert_eq!(rule_matches(&star, "get", "", "pods", None), None);
        let url = rule(json!({"verbs": ["get"], "nonResourceURLs": ["/healthz"]}));
        assert_eq!(rule_matches(&url, "get", "", "pods", None), None);
    }

    #[test]
    fn who_can_resource_names_and_namespace_scope() {
        let roles = vec![role("a", "named", json!([{"verbs": ["get"], "apiGroups": [""], "resources": ["secrets"], "resourceNames": ["x"]}]))];
        let croles = vec![crole("view", json!([{"verbs": ["get"], "apiGroups": [""], "resources": ["secrets"]}]))];
        let rbs = vec![
            rb("a", "r1", "Role", "named", json!([user("u1")])),
            rb("a", "r2", "ClusterRole", "view", json!([user("u2")])),
        ];
        let (g, notes) = compute_who_can("get", "", "secrets", None, &roles, &croles, &rbs, &[], true, true);
        assert_eq!(g.len(), 2);
        let u1 = g.iter().find(|x| x.subject.name == "u1").expect("u1");
        assert_eq!(u1.resource_names, vec!["x"]);
        assert_eq!(u1.scope, "namespace");
        assert!(g.iter().find(|x| x.subject.name == "u2").expect("u2").resource_names.is_empty());
        assert_eq!(notes.len(), 1);
    }

    #[test]
    fn who_can_cluster_binding_is_cluster_scope_and_notes() {
        let mut croles = vec![
            crole("agg", json!([])),
            crole("all", json!([{"verbs": ["*"], "apiGroups": ["*"], "resources": ["*"]}])),
        ];
        croles[0].aggregation_rule = Some(serde_json::from_value(json!({"clusterRoleSelectors": []})).expect("agg"));
        let crbs = vec![
            crb("b1", "all", json!([user("u")])),
            crb("b2", "agg", json!([user("u")])),
            crb("b3", "gone", json!([user("u")])),
        ];
        let (g, notes) = compute_who_can("get", "", "pods", None, &[], &croles, &[], &crbs, true, true);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].scope, "cluster");
        assert!(g[0].via_wildcard);
        assert!(notes.iter().any(|n| n.starts_with("ClusterRole agg is aggregated")));
        assert!(notes.contains(&"Binding b3 references ClusterRole gone, which does not exist.".to_string()));
        // a skipped ClusterRole list suppresses the missing-role note
        let (_, notes) = compute_who_can("get", "", "pods", None, &[], &[], &[], &crbs, true, false);
        assert_eq!(notes.len(), 1);
    }

    #[test]
    fn service_account_reaches_implicit_groups() {
        let croles = vec![crole("v", json!([{"verbs": ["get"], "apiGroups": [""], "resources": ["pods"]}]))];
        let crbs = vec![
            crb("direct", "v", json!([{"kind": "ServiceAccount", "name": "sa", "namespace": "ns"}])),
            crb("grp", "v", json!([{"kind": "Group", "name": "system:serviceaccounts:ns"}])),
            crb("auth", "v", json!([{"kind": "Group", "name": "system:authenticated"}])),
            crb("other", "v", json!([{"kind": "Group", "name": "system:serviceaccounts:other"}])),
            crb("othersa", "v", json!([{"kind": "ServiceAccount", "name": "sa", "namespace": "other"}])),
        ];
        let p = compute_permissions("ServiceAccount", "sa", Some("ns"), &[], &croles, &[], &crbs);
        let by = |b: &str| p.iter().find(|x| x.binding == b).map(|x| x.via_group.clone());
        assert_eq!(by("direct"), Some(None));
        assert_eq!(by("grp"), Some(Some("system:serviceaccounts:ns".into())));
        assert_eq!(by("auth"), Some(Some("system:authenticated".into())));
        assert_eq!(by("other"), None);
        assert_eq!(by("othersa"), None);
    }

    #[test]
    fn role_binding_to_cluster_role_has_no_non_resource_urls() {
        let croles = vec![crole("c", json!([{"verbs": ["get"], "nonResourceURLs": ["/healthz"]}]))];
        let rbs = vec![rb("ns", "rb", "ClusterRole", "c", json!([user("u")]))];
        let crbs = vec![crb("crb", "c", json!([user("u")]))];
        let p = compute_permissions("User", "u", None, &[], &croles, &rbs, &crbs);
        assert_eq!(p.len(), 2);
        assert!(p.iter().find(|x| x.binding == "rb").expect("rb").non_resource_urls.is_empty());
        assert_eq!(p.iter().find(|x| x.binding == "crb").expect("crb").non_resource_urls, vec!["/healthz"]);
    }

    #[test]
    fn binding_row_subject_list_keeps_namespace() {
        let l = subject_list(Some(&vec![K8sSubject { kind: "ServiceAccount".into(), name: "a".into(), namespace: Some("n".into()), api_group: None }]), Some("other"));
        assert_eq!(l[0].namespace.as_deref(), Some("n"));
        assert!(subject_list(None, None).is_empty());
    }

    #[test]
    fn service_account_without_namespace_defaults_to_the_binding_namespace() {
        let croles = vec![crole("v", json!([{"verbs": ["get"], "apiGroups": [""], "resources": ["pods"]}]))];
        let rbs = vec![rb("ns", "rb", "ClusterRole", "v", json!([{"kind": "ServiceAccount", "name": "sa"}]))];
        let p = compute_permissions("ServiceAccount", "sa", Some("ns"), &[], &croles, &rbs, &[]);
        assert_eq!(p.len(), 1);
        let (g, _) = compute_who_can("get", "", "pods", None, &[], &croles, &rbs, &[], true, true);
        assert_eq!(g[0].subject.namespace.as_deref(), Some("ns"));
        // a ClusterRoleBinding has no namespace to default to; a User is never given one
        let l = subject_list(Some(&vec![K8sSubject { kind: "User".into(), name: "u".into(), namespace: None, api_group: None }]), Some("ns"));
        assert!(l[0].namespace.is_none());
    }

    #[test]
    fn no_resource_slash_star_arm_and_create_ignores_resource_names() {
        let r = rule(json!({"verbs": ["get"], "apiGroups": [""], "resources": ["pods/*"]}));
        assert_eq!(rule_matches(&r, "get", "", "pods", Some("log")), None);
        let roles = vec![role("a", "named", json!([{"verbs": ["create", "deletecollection", "get"], "apiGroups": [""], "resources": ["pods"], "resourceNames": ["x"]}]))];
        let rbs = vec![rb("a", "r", "Role", "named", json!([user("u")]))];
        for verb in ["create", "deletecollection"] {
            let (g, _) = compute_who_can(verb, "", "pods", None, &roles, &[], &rbs, &[], true, true);
            assert!(g.is_empty(), "{verb}");
        }
        let (g, _) = compute_who_can("get", "", "pods", None, &roles, &[], &rbs, &[], true, true);
        assert_eq!(g.len(), 1);
    }
}
