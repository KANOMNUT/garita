//! Guided-edit backend: two generic commands driven by one GVK table.
//!
//! **Since v1.3.1 the table means "kinds `get_resource_json` / `patch_resource` can reach"**: it covers
//! every kind that has a `get_resource_yaml` arm (except `argo-appsets` / `argo-projects`, whose
//! version must come from runtime discovery). Editability is decided only by the frontend's
//! `EDIT_FORM`.
//!
//! See `docs/plan-guided-edit.md` §3 for the frozen contract. Mirrors the
//! `DynamicObject` + `ApiResource` precedent in `resource_create.rs` rather than
//! the 35-arm per-kind matches in `pods.rs` (`get_resource_yaml` /
//! `apply_resource_yaml` / `delete_resource`) — those three stay untouched;
//! consolidating them onto this table is a future cleanup, not done here to
//! avoid unrelated risk in an already-large feature.

use kube::{
    api::{Api, ApiResource, DynamicObject, Patch, PatchParams},
};

use super::utils::client_for_context;

/// resource_type (the app's short kind, plus the long aliases the rest of
/// the codebase accepts) → (group, version, kind, plural, namespaced).
///
/// The ONLY per-kind knowledge in this file. Adding an editable kind = one row.
/// Versions are copied from wherever they already ship elsewhere in the
/// codebase (`pods.rs`'s `get_resource_yaml`/`apply_resource_yaml`/`delete_resource`
/// arms, `argocd.rs`) rather than invented — see plan §"Which kinds the table
/// must cover".
pub(crate) fn gvk_for(
    resource_type: &str,
) -> Result<(&'static str, &'static str, &'static str, &'static str, bool), String> {
    Ok(match resource_type {
        "cm" | "configmap" | "configmaps" => ("", "v1", "ConfigMap", "configmaps", true),
        "sec" | "secret" | "secrets" => ("", "v1", "Secret", "secrets", true),
        "deploy" | "deployment" | "deployments" => ("apps", "v1", "Deployment", "deployments", true),
        "sts" | "statefulset" | "statefulsets" => ("apps", "v1", "StatefulSet", "statefulsets", true),
        "ds" | "daemonset" | "daemonsets" => ("apps", "v1", "DaemonSet", "daemonsets", true),
        "svc" | "service" | "services" => ("", "v1", "Service", "services", true),
        "ing" | "ingress" | "ingresses" => {
            ("networking.k8s.io", "v1", "Ingress", "ingresses", true)
        }
        "roles" | "role" => ("rbac.authorization.k8s.io", "v1", "Role", "roles", true),
        "croles" | "clusterrole" => {
            ("rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles", false)
        }
        "rbindings" | "rolebinding" => {
            ("rbac.authorization.k8s.io", "v1", "RoleBinding", "rolebindings", true)
        }
        "crbindings" | "clusterrolebinding" => (
            "rbac.authorization.k8s.io",
            "v1",
            "ClusterRoleBinding",
            "clusterrolebindings",
            false,
        ),
        // ArgoCD Applications live in a namespace (see argocd.rs's use of
        // Api::namespaced_with / ns candidates) even though the app lists
        // them cluster-wide across namespace candidates.
        "argocd" | "application" => ("argoproj.io", "v1alpha1", "Application", "applications", true),
        "pvc" | "persistentvolumeclaim" | "pvcs" => {
            ("", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", true)
        }
        "sa" | "serviceaccount" => ("", "v1", "ServiceAccount", "serviceaccounts", true),
        "rq" | "resourcequota" => ("", "v1", "ResourceQuota", "resourcequotas", true),
        "lr" | "limitrange" => ("", "v1", "LimitRange", "limitranges", true),
        "cron" | "cronjob" | "cronjobs" => ("batch", "v1", "CronJob", "cronjobs", true),
        "flux-ks" | "kustomization" => (
            "kustomize.toolkit.fluxcd.io",
            "v1",
            "Kustomization",
            "kustomizations",
            true,
        ),
        "flux-hr" | "helmrelease" => {
            ("helm.toolkit.fluxcd.io", "v2", "HelmRelease", "helmreleases", true)
        }
        // ── v1.3.1 widening: every kind with a `get_resource_yaml` arm (except
        // argo-appsets / argo-projects, whose version must come from `argo_api_resource`
        // runtime discovery). Versions copied from the typed imports / ApiResource literals in
        // `pods.rs`. `get_resource_json` / `patch_resource` can now REACH these kinds; whether
        // one is EDITABLE is decided only by the frontend's `EDIT_FORM`.
        "pods" | "pod" => ("", "v1", "Pod", "pods", true),
        "jobs" | "job" => ("batch", "v1", "Job", "jobs", true),
        "hpa" | "horizontalpodautoscaler" => (
            "autoscaling",
            "v2",
            "HorizontalPodAutoscaler",
            "horizontalpodautoscalers",
            true,
        ),
        "pdb" | "poddisruptionbudget" => {
            ("policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", true)
        }
        "rs" | "replicaset" | "replicasets" => ("apps", "v1", "ReplicaSet", "replicasets", true),
        "netpol" | "networkpolicy" => {
            ("networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", true)
        }
        "ep" | "endpoints" => ("", "v1", "Endpoints", "endpoints", true),
        "eps" | "endpointslice" | "endpointslices" => {
            ("discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", true)
        }
        "pv" | "persistentvolume" | "pvs" => ("", "v1", "PersistentVolume", "persistentvolumes", false),
        "sc" | "storageclass" => ("storage.k8s.io", "v1", "StorageClass", "storageclasses", false),
        "nodes" | "node" => ("", "v1", "Node", "nodes", false),
        "ns" | "namespace" | "namespaces" => ("", "v1", "Namespace", "namespaces", false),
        "crd" | "customresourcedefinition" => (
            "apiextensions.k8s.io",
            "v1",
            "CustomResourceDefinition",
            "customresourcedefinitions",
            false,
        ),
        "pc" | "priorityclass" => {
            ("scheduling.k8s.io", "v1", "PriorityClass", "priorityclasses", false)
        }
        "mwc" | "mutatingwebhookconfiguration" => (
            "admissionregistration.k8s.io",
            "v1",
            "MutatingWebhookConfiguration",
            "mutatingwebhookconfigurations",
            false,
        ),
        "vwc" | "validatingwebhookconfiguration" => (
            "admissionregistration.k8s.io",
            "v1",
            "ValidatingWebhookConfiguration",
            "validatingwebhookconfigurations",
            false,
        ),
        "vs" | "volumesnapshot" | "volumesnapshots" => {
            ("snapshot.storage.k8s.io", "v1", "VolumeSnapshot", "volumesnapshots", true)
        }
        "cert" | "certificate" | "certificates" => {
            ("cert-manager.io", "v1", "Certificate", "certificates", true)
        }
        "gw" | "gateway" => ("gateway.networking.k8s.io", "v1", "Gateway", "gateways", true),
        "httproute" => ("gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes", true),
        _ => return Err(format!("Unsupported resource type: {}", resource_type)),
    })
}

/// Mirror of the "cluster-scoped kind must ignore `namespace`" rule: a
/// namespaced kind called with an empty namespace is the same failure class
/// (silently wrong scope) and would otherwise surface as an opaque 404 from
/// `/namespaces//...`. Caught here as a readable error instead.
pub(crate) fn require_namespace(namespaced: bool, namespace: &str, kind: &str) -> Result<(), String> {
    if namespaced && namespace.is_empty() {
        return Err(format!(
            "{} is namespace-scoped and requires a namespace",
            kind
        ));
    }
    Ok(())
}

pub(crate) fn api_resource_for(group: &str, version: &str, kind: &str, plural: &str) -> ApiResource {
    let api_version = if group.is_empty() {
        version.to_string()
    } else {
        format!("{}/{}", group, version)
    };
    ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version,
        kind: kind.to_string(),
        plural: plural.to_string(),
    }
}

/// The raw live object, exactly as the API server has it. No filtering, no
/// status stripping — the frontend diffs against this, so any omission here
/// becomes a field the resulting patch could clobber.
#[tauri::command]
pub async fn get_resource_json(
    context: String,
    namespace: String,
    resource_type: String,
    name: String,
) -> Result<serde_json::Value, String> {
    crate::app_log::log_read("get_resource_json", &context);
    let (group, version, kind, plural, namespaced) = gvk_for(&resource_type)?;
    require_namespace(namespaced, &namespace, kind)?;
    let ar = api_resource_for(group, version, kind, plural);

    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    // Cluster-scoped kinds ignore `namespace` entirely — the table's bool is
    // the only thing that decides this, never a caller-supplied value.
    let api: Api<DynamicObject> = if namespaced {
        Api::namespaced_with(client, &namespace, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    let obj = api
        .get(&name)
        .await
        .map_err(|e| format!("Failed to get {}: {}", kind, e))?;

    serde_json::to_value(&obj).map_err(|e| format!("Failed to serialize {}: {}", kind, e))
}

/// RFC 7386 JSON merge patch. `patch` is built frontend-side by diffing a
/// mutated clone against the object `get_resource_json` returned.
#[tauri::command]
pub async fn patch_resource(
    context: String,
    namespace: String,
    resource_type: String,
    name: String,
    patch: serde_json::Value,
    dry_run: Option<bool>,
) -> Result<String, String> {
    let dry = dry_run.unwrap_or(false);
    let result: Result<String, String> = async {
    let dry_run = dry_run.unwrap_or(false);
    let (group, version, kind, plural, namespaced) = gvk_for(&resource_type)?;
    require_namespace(namespaced, &namespace, kind)?;
    let ar = api_resource_for(group, version, kind, plural);

    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api: Api<DynamicObject> = if namespaced {
        Api::namespaced_with(client, &namespace, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    let pp = PatchParams {
        dry_run,
        ..Default::default()
    };
    api.patch(&name, &pp, &Patch::Merge(&patch))
        .await
        .map_err(|e| format!("Failed to patch {}: {}", kind, e))?;

    if dry_run {
        Ok(format!("{}/{} would be patched (dry run)", kind, name))
    } else {
        Ok(format!("{}/{} patched", kind, name))
    }
    }
    .await;
    if !dry {
        crate::app_log::log_write(&context, "patch", &resource_type, &namespace, &name, Some(&patch), &result);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::gvk_for;

    /// Every kind in the guided-edit scope (plan §"Which kinds the table
    /// must cover") must resolve.
    const EDITABLE_KINDS: &[&str] = &[
        "cm", "sec", "deploy", "sts", "ds", "svc", "ing", "roles", "croles", "rbindings",
        "crbindings", "argocd", "pvc", "sa", "rq", "lr", "cron", "flux-ks", "flux-hr",
    ];

    #[test]
    fn resolves_every_editable_kind() {
        for kind in EDITABLE_KINDS {
            assert!(gvk_for(kind).is_ok(), "expected '{}' to resolve", kind);
        }
    }

    #[test]
    fn cluster_scoped_kinds_are_marked_cluster_scoped() {
        for kind in ["croles", "crbindings"] {
            let (_, _, _, _, namespaced) = gvk_for(kind).unwrap();
            assert!(!namespaced, "'{}' should be cluster-scoped", kind);
        }
    }

    #[test]
    fn namespaced_kinds_are_marked_namespaced() {
        // argocd included deliberately: ArgoCD Applications are namespaced
        // K8s objects even though the app lists them cluster-wide — see
        // argocd.rs's Api::namespaced_with usage.
        for kind in ["cm", "deploy", "argocd"] {
            let (_, _, _, _, namespaced) = gvk_for(kind).unwrap();
            assert!(namespaced, "'{}' should be namespaced", kind);
        }
    }

    /// Every kind `pods.rs::get_resource_yaml` serves, except `argo-appsets` / `argo-projects`
    /// (their version must come from `argo_api_resource` runtime discovery, so they are not
    /// widened here), plus the existing `argocd` row.
    const READABLE_KINDS: &[&str] = &[
        "pods", "deploy", "sts", "ds", "jobs", "cron", "svc", "ing", "cm", "sec", "pvc", "pv",
        "nodes", "hpa", "crd", "netpol", "sa", "roles", "croles", "rbindings", "crbindings", "sc",
        "pdb", "ep", "eps", "rs", "mwc", "vwc", "vs", "cert", "flux-ks", "flux-hr", "gw",
        "httproute", "rq", "lr", "pc", "argocd", "ns",
    ];

    #[test]
    fn resolves_every_readable_kind() {
        for kind in READABLE_KINDS {
            assert!(gvk_for(kind).is_ok(), "expected '{}' to resolve", kind);
        }
    }

    #[test]
    fn cluster_scoped_set_is_exactly_the_null_namespace_kinds() {
        let mut cluster_scoped: Vec<&str> = READABLE_KINDS
            .iter()
            .copied()
            .filter(|k| !gvk_for(k).expect("resolves").4)
            .collect();
        cluster_scoped.sort_unstable();
        let mut expected = vec!["pv", "sc", "nodes", "crd", "croles", "crbindings", "pc", "mwc", "vwc", "ns"];
        expected.sort_unstable();
        assert_eq!(cluster_scoped, expected);
    }

    #[test]
    fn argo_appsets_and_projects_are_not_widened() {
        for kind in ["argo-appsets", "argo-projects"] {
            assert!(gvk_for(kind).is_err(), "'{}' must stay out of the table", kind);
        }
    }

    #[test]
    fn widened_rows_use_the_versions_pods_rs_already_ships() {
        assert_eq!(gvk_for("hpa").unwrap(), ("autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", true));
        assert_eq!(gvk_for("eps").unwrap().0, "discovery.k8s.io");
        assert_eq!(gvk_for("flux-hr").unwrap().1, "v2");
        assert_eq!(gvk_for("pods").unwrap(), gvk_for("pod").unwrap());
        assert_eq!(gvk_for("pv").unwrap(), gvk_for("persistentvolume").unwrap());
        assert_eq!(gvk_for("nodes").unwrap(), gvk_for("node").unwrap());
    }

    #[test]
    fn namespace_row_is_cluster_scoped_core_v1_and_aliases_agree() {
        assert_eq!(gvk_for("ns").unwrap(), ("", "v1", "Namespace", "namespaces", false));
        assert_eq!(gvk_for("ns").unwrap(), gvk_for("namespace").unwrap());
        assert_eq!(gvk_for("ns").unwrap(), gvk_for("namespaces").unwrap());
    }

    #[test]
    fn unknown_kind_errors() {
        let err = gvk_for("not-a-real-kind").unwrap_err();
        assert!(err.contains("Unsupported resource type"));
    }

    #[test]
    fn long_aliases_agree_with_short_form() {
        assert_eq!(gvk_for("deploy").unwrap(), gvk_for("deployment").unwrap());
        assert_eq!(gvk_for("deploy").unwrap(), gvk_for("deployments").unwrap());
        assert_eq!(gvk_for("croles").unwrap(), gvk_for("clusterrole").unwrap());
        assert_eq!(
            gvk_for("crbindings").unwrap(),
            gvk_for("clusterrolebinding").unwrap()
        );
        assert_eq!(gvk_for("flux-ks").unwrap(), gvk_for("kustomization").unwrap());
        assert_eq!(gvk_for("flux-hr").unwrap(), gvk_for("helmrelease").unwrap());
    }
}
