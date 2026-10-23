use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition as K8sCRD;
use kube::{api::{ApiResource, DynamicObject, ListParams}, Api};
use serde::{Deserialize, Serialize};

use super::utils::{age_from_timestamp, client_for_context};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CRD {
    pub name: String,
    pub group: String,
    pub kind: String,
    pub plural: String,
    pub scope: String,
    pub versions: String,
    pub established: bool,
    pub age: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CRDResource {
    pub name: String,
    pub namespace: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_crds(context: String) -> Result<Vec<CRD>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sCRD> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list CRDs: {}", e))?;
    Ok(list.items.into_iter().map(|crd| {
        let spec = &crd.spec;
        let group = spec.group.clone();
        let kind = spec.names.kind.clone();
        let plural = spec.names.plural.clone();
        let scope = spec.scope.clone();
        let versions = spec.versions.iter()
            .filter(|v| v.served)
            .map(|v| v.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let established = crd.status.as_ref()
            .and_then(|s| s.conditions.as_ref())
            .map(|cs| cs.iter().any(|c| c.type_ == "Established" && c.status == "True"))
            .unwrap_or(false);
        CRD {
            name: crd.metadata.name.unwrap_or_default(),
            group,
            kind,
            plural,
            scope,
            versions,
            established,
            age: age_from_timestamp(crd.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

/// Decide which namespace (if any) a CRD-instance list should be scoped to.
/// Pulled out as a pure function so the fix — `namespace: Option<String>`, not a bare
/// `String` (a bare bool/String errors "missing required key" when the caller omits it,
/// per CLAUDE.md) — is unit-testable without a live `Client`. See
/// docs/plan-kubeconfig-and-parity.md §4.5: both branches of this decision were
/// previously identical, silently ignoring the namespace picker for namespaced CRDs.
fn crd_list_namespace<'a>(namespace: &'a Option<String>, scope: &str) -> Option<&'a str> {
    match namespace {
        Some(ns) if scope == "Namespaced" && ns != "all" && !ns.is_empty() => Some(ns.as_str()),
        _ => None,
    }
}

#[tauri::command]
pub async fn list_crd_resources(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: Option<String>,
) -> Result<Vec<CRDResource>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let api_version = if group.is_empty() {
        version.clone()
    } else {
        format!("{}/{}", group, version)
    };

    let ar = ApiResource {
        group,
        version,
        api_version,
        kind,
        plural,
    };

    let items = match crd_list_namespace(&namespace, &scope) {
        Some(ns) => Api::<DynamicObject>::namespaced_with(client, ns, &ar),
        None => Api::<DynamicObject>::all_with(client, &ar),
    };

    let list = items.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list CRD resources: {}", e))?;

    Ok(list.items.into_iter().map(|item| CRDResource {
        name: item.metadata.name.unwrap_or_default(),
        namespace: item.metadata.namespace.unwrap_or_default(),
        age: age_from_timestamp(item.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::crd_list_namespace;

    #[test]
    fn namespaced_scope_with_specific_namespace_scopes_the_list() {
        let ns = Some("kube-system".to_string());
        assert_eq!(crd_list_namespace(&ns, "Namespaced"), Some("kube-system"));
    }

    #[test]
    fn namespaced_scope_with_all_lists_cluster_wide() {
        let ns = Some("all".to_string());
        assert_eq!(crd_list_namespace(&ns, "Namespaced"), None);
    }

    #[test]
    fn cluster_scope_ignores_namespace_even_if_provided() {
        let ns = Some("kube-system".to_string());
        assert_eq!(crd_list_namespace(&ns, "Cluster"), None);
    }

    #[test]
    fn namespaced_scope_with_no_namespace_lists_cluster_wide() {
        // The existing `useCRDResources` caller does not pass `namespace` at all.
        assert_eq!(crd_list_namespace(&None, "Namespaced"), None);
    }
}
