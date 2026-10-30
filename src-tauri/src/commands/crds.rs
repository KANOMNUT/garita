use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::{
    CustomResourceDefinition as K8sCRD, CustomResourceDefinitionVersion,
};
use kube::{api::{ApiResource, DynamicObject, ListParams}, Api};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

use super::argocd::operation_message_display;
use super::extras::ResourceCondition;
use super::pods::{self, NeatYaml, ReplaceTarget, YamlSavePreview};
use super::resource_edit::{api_resource_for, require_namespace};
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
    /// The version Garita reads and writes this CRD's objects at: the storage version when it is
    /// served, else the first served version; "" when none is served.
    pub read_version: String,
}

/// The version Garita reads and writes a CRD's objects at (`CRD.read_version`). The storage version
/// never needs a conversion, so it wins when it is served; otherwise the first served version.
fn read_version(versions: &[CustomResourceDefinitionVersion]) -> String {
    versions
        .iter()
        .find(|v| v.storage && v.served)
        .or_else(|| versions.iter().find(|v| v.served))
        .map(|v| v.name.clone())
        .unwrap_or_default()
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
        let read_version = read_version(&spec.versions);
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
            read_version,
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

// ─── Custom resource objects (v2.4.1) ────────────────────────────────────────
//
// Six commands take the CRD's group, version, kind, plural and scope flat, like
// `list_crd_resources`. The scope comes from the CRD, never from the namespace value. Every one
// calls `cr_request` before it connects.

/// One entry of `metadata.ownerReferences`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CustomResourceOwner {
    pub kind: String,
    pub name: String,
    /// `controller: true` on the reference; absent reads false.
    pub controller: bool,
}

/// Display shape of one custom resource object (the panel's Overview and Summary). Built by `cr_detail`.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CustomResourceDetail {
    pub name: String,
    /// "" for a cluster-scoped object.
    pub namespace: String,
    /// The object's own `apiVersion` (the version it was read at); the request's when absent.
    pub api_version: String,
    /// The object's own `kind`; the request's when absent.
    pub kind: String,
    /// `age_from_timestamp(metadata.creationTimestamp)`.
    pub age: String,
    /// `metadata.creationTimestamp` as RFC 3339; "" when absent.
    pub created: String,
    /// `metadata.deletionTimestamp` as RFC 3339 while the object is being deleted.
    pub deletion_timestamp: Option<String>,
    pub generation: Option<i64>,
    /// `status.observedGeneration` when it is an integer.
    pub observed_generation: Option<i64>,
    /// `status.phase`, else `status.state`, when it is a string; "" otherwise.
    pub phase: String,
    /// `cr_conditions(status)`.
    pub conditions: Vec<ResourceCondition>,
    /// Sorted by key.
    pub labels: BTreeMap<String, String>,
    /// Sorted by key. Values verbatim (a custom resource is not a Secret; `cr_request` keeps core kinds out).
    pub annotations: BTreeMap<String, String>,
    pub owners: Vec<CustomResourceOwner>,
    /// `metadata.finalizers`, in order.
    pub finalizers: Vec<String>,
}

/// Validates a request before any network call. Returns the `ApiResource` and the namespace to use
/// (`Some(ns)` for a namespaced CRD, `None` for a cluster-scoped one, whose namespace is ignored).
/// Called first by every custom resource command, read or write: a CRD always has a group, and
/// without the empty-group refusal a webview-supplied `group: ""` with `plural: "secrets"` would
/// read, replace or delete a core Secret with no reveal, no masking and no Secret rules.
/// `label` is `kind`, or "custom resource" when `kind` is empty. The messages describe a bad
/// request, not a failed read or write, so the write commands use them too.
pub(crate) fn cr_request<'a>(
    group: &str,
    version: &str,
    kind: &str,
    plural: &str,
    scope: &str,
    namespace: &'a str,
    name: &str,
) -> Result<(ApiResource, Option<&'a str>), String> {
    let label = if kind.is_empty() { "custom resource" } else { kind };
    if group.is_empty() {
        return Err(format!("Failed to get {}: a custom resource needs an API group", label));
    }
    for (field, value) in [("version", version), ("kind", kind), ("plural", plural), ("name", name)] {
        if value.is_empty() {
            return Err(format!("Failed to get {}: missing {}", label, field));
        }
    }
    let namespaced = match scope {
        "Namespaced" => true,
        "Cluster" => false,
        other => return Err(format!("Failed to get {}: unknown scope '{}'", label, other)),
    };
    require_namespace(namespaced, namespace, kind)?;
    let ar = api_resource_for(group, version, kind, plural);
    Ok((ar, if namespaced { Some(namespace) } else { None }))
}

/// `status.conditions` entries that are objects with a non-empty string `type`, in order, first per
/// type wins. `status`: a string verbatim; a bool as "True" / "False"; anything else "Unknown".
/// `reason` and `lastTransitionTime`: strings verbatim, else "". `message`: a string through
/// `operation_message_display` (2000 characters, cut by characters), else "". `[]` when `status`
/// is `None`, not an object, or has no `conditions` array. `status` is untrusted input: no
/// `unwrap`, `expect` or indexing.
fn cr_conditions(status: Option<&serde_json::Value>) -> Vec<ResourceCondition> {
    use serde_json::Value;
    let Some(list) = status.and_then(|s| s.get("conditions")).and_then(Value::as_array) else {
        return Vec::new();
    };
    let text = |obj: &serde_json::Map<String, Value>, key: &str| -> String {
        obj.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out = Vec::new();
    for entry in list {
        let Some(obj) = entry.as_object() else { continue };
        let Some(type_) = obj.get("type").and_then(Value::as_str).filter(|t| !t.is_empty()) else {
            continue;
        };
        if !seen.insert(type_) {
            continue;
        }
        let status = match obj.get("status") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Bool(true)) => "True".to_string(),
            Some(Value::Bool(false)) => "False".to_string(),
            _ => "Unknown".to_string(),
        };
        out.push(ResourceCondition {
            type_: type_.to_string(),
            status,
            reason: text(obj, "reason"),
            message: obj
                .get("message")
                .and_then(Value::as_str)
                .map(operation_message_display)
                .unwrap_or_default(),
            last_transition: text(obj, "lastTransitionTime"),
        });
    }
    out
}

fn non_empty_or(value: &str, fallback: &str) -> String {
    if value.is_empty() { fallback.to_string() } else { value.to_string() }
}

/// The panel shape. `ar` supplies `apiVersion` and `kind` when the object's TypeMeta is absent.
fn cr_detail(obj: &DynamicObject, ar: &ApiResource) -> CustomResourceDetail {
    use serde_json::Value;
    let meta = &obj.metadata;
    let status = obj.data.get("status");
    let (api_version, kind) = match &obj.types {
        Some(t) => (non_empty_or(&t.api_version, &ar.api_version), non_empty_or(&t.kind, &ar.kind)),
        None => (ar.api_version.clone(), ar.kind.clone()),
    };
    let rfc3339 = |t: &k8s_openapi::apimachinery::pkg::apis::meta::v1::Time| {
        t.0.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    };
    let phase = ["phase", "state"]
        .iter()
        .find_map(|key| status.and_then(|s| s.get(*key)).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    CustomResourceDetail {
        name: meta.name.clone().unwrap_or_default(),
        namespace: meta.namespace.clone().unwrap_or_default(),
        api_version,
        kind,
        age: age_from_timestamp(meta.creation_timestamp.as_ref().map(|t| &t.0)),
        created: meta.creation_timestamp.as_ref().map(rfc3339).unwrap_or_default(),
        deletion_timestamp: meta.deletion_timestamp.as_ref().map(rfc3339),
        generation: meta.generation,
        observed_generation: status.and_then(|s| s.get("observedGeneration")).and_then(Value::as_i64),
        phase,
        conditions: cr_conditions(status),
        labels: meta.labels.clone().unwrap_or_default(),
        annotations: meta.annotations.clone().unwrap_or_default(),
        owners: meta
            .owner_references
            .iter()
            .flatten()
            .map(|o| CustomResourceOwner {
                kind: o.kind.clone(),
                name: o.name.clone(),
                controller: o.controller.unwrap_or(false),
            })
            .collect(),
        finalizers: meta.finalizers.clone().unwrap_or_default(),
    }
}

/// The journal kind of a custom resource write: "<plural>.<group>", kubectl's noun for it.
fn cr_journal_kind(plural: &str, group: &str) -> String {
    format!("{}.{}", plural, group)
}

fn cr_api(client: kube::Client, ar: &ApiResource, ns: Option<&str>) -> Api<DynamicObject> {
    match ns {
        Some(ns) => Api::namespaced_with(client, ns, ar),
        None => Api::all_with(client, ar),
    }
}

/// One custom resource object. `Ok(None)` when it is gone (404), so the panel can say so instead of
/// showing an error box.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn get_custom_resource(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
) -> Result<Option<CustomResourceDetail>, String> {
    let (ar, ns) = cr_request(&group, &version, &kind, &plural, &scope, &namespace, &name)?;
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    match cr_api(client, &ar, ns).get(&name).await {
        Ok(obj) => Ok(Some(cr_detail(&obj, &ar))),
        Err(kube::Error::Api(ae)) if ae.code == 404 => Ok(None),
        Err(e) => Err(format!("Failed to get {}: {}", kind, e)),
    }
}

/// The shared fetch of the two YAML reads (one function, a `neat` flag, like `fetch_resource_yaml`).
#[allow(clippy::too_many_arguments)] // the eight command fields plus `neat`
async fn fetch_custom_resource_yaml(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
    neat: bool,
) -> Result<(String, Vec<String>), String> {
    let (ar, ns) = cr_request(&group, &version, &kind, &plural, &scope, &namespace, &name)?;
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let obj = cr_api(client, &ar, ns).get(&name).await
        .map_err(|e| format!("Failed to get {}: {}", kind, e))?;
    pods::render_obj(&obj, neat)
}

/// The object as YAML, exactly as the API server has it. The editor is seeded from this, never
/// from the neat text. A missing object is an `Err` here (the YAML tab shows it as an error).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn get_custom_resource_yaml(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
) -> Result<String, String> {
    fetch_custom_resource_yaml(context, group, version, kind, plural, scope, namespace, name, false)
        .await
        .map(|(yaml, _)| yaml)
}

/// Display only: the same fetch with the noise removed (`neat_value`). Never feed the result to
/// `apply_custom_resource_yaml`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn get_custom_resource_yaml_neat(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
) -> Result<NeatYaml, String> {
    fetch_custom_resource_yaml(context, group, version, kind, plural, scope, namespace, name, true)
        .await
        .map(|(yaml, hidden)| NeatYaml { yaml, hidden })
}

/// Delete one custom resource. Background propagation is sent explicitly (`delete_params_for`);
/// there is no propagation parameter. Logged on every attempt, like `delete_resource`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn delete_custom_resource(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let (ar, ns) = cr_request(&group, &version, &kind, &plural, &scope, &namespace, &name)?;
        let dp = pods::delete_params_for(None)?;
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        cr_api(client, &ar, ns).delete(&name, &dp).await
            .map_err(|e| format!("Failed to delete {}: {}", kind, e))?;
        Ok(())
    }
    .await;
    crate::app_log::log_write(&context, "delete", &cr_journal_kind(&plural, &group), &namespace, &name,
        Some(&serde_json::json!({ "propagation": "background" })), &result);
    result
}

/// Dry-run a custom resource YAML save without writing anything, through the one replace path in
/// `pods.rs` (`preview_replace`), so the preview validates exactly what the save does. API
/// refusals are outcomes (`rejected` / `conflict`); `Err` is "preview unavailable", and a bad
/// request (`cr_request`) is one too.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn preview_custom_resource_yaml(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
    yaml: String,
) -> Result<YamlSavePreview, String> {
    crate::app_log::log_read("preview_custom_resource_yaml", &context);
    let (ar, ns) = cr_request(&group, &version, &kind, &plural, &scope, &namespace, &name)?;
    if let Some(p) = pods::invalid_yaml_preview(&yaml) {
        return Ok(p);
    }
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let namespaced = ns.is_some();
    pods::preview_replace(
        client,
        ns.unwrap_or_default(),
        &ReplaceTarget::Custom { ar: &ar, namespaced },
        &ar,
        namespaced,
        &name,
        &yaml,
    )
    .await
}

/// Save a custom resource YAML (a replace), through the one replace path in `pods.rs`
/// (`apply_replace`). The frontend reaches it only after the preview gate. Logged on every attempt.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat CRD fields, frozen IPC signature (v2.4.1 §2.4)
pub async fn apply_custom_resource_yaml(
    context: String,
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String,
    namespace: String,
    name: String,
    yaml: String,
) -> Result<(), String> {
    let result: Result<(), String> = async {
        let (ar, ns) = cr_request(&group, &version, &kind, &plural, &scope, &namespace, &name)?;
        let client = client_for_context(&context).await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        let namespaced = ns.is_some();
        pods::apply_replace(
            client,
            ns.unwrap_or_default(),
            &ReplaceTarget::Custom { ar: &ar, namespaced },
            &name,
            &yaml,
        )
        .await
    }
    .await;
    crate::app_log::log_write(&context, "apply", &cr_journal_kind(&plural, &group), &namespace, &name,
        serde_yaml::from_str::<serde_json::Value>(&yaml).ok().as_ref(), &result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};


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
    // ---- read_version ------------------------------------------------------

    fn version(name: &str, served: bool, storage: bool) -> CustomResourceDefinitionVersion {
        CustomResourceDefinitionVersion {
            name: name.to_string(),
            served,
            storage,
            ..Default::default()
        }
    }

    #[test]
    fn read_version_prefers_the_served_storage_version() {
        let vs = [version("v1beta1", true, false), version("v1", true, true)];
        assert_eq!(read_version(&vs), "v1");
    }

    #[test]
    fn read_version_falls_back_to_the_first_served_when_storage_is_not_served() {
        let vs = [version("v1alpha1", false, true), version("v1beta1", true, false), version("v1", true, false)];
        assert_eq!(read_version(&vs), "v1beta1");
    }

    #[test]
    fn read_version_is_empty_when_nothing_is_served() {
        assert_eq!(read_version(&[version("v1", false, true)]), "");
        assert_eq!(read_version(&[]), "");
    }

    // ---- cr_request --------------------------------------------------------

    #[test]
    fn cr_request_namespaced_with_a_namespace_scopes_the_call() {
        let (ar, ns) = cr_request("acme.io", "v1", "Widget", "widgets", "Namespaced", "prod", "w1").expect("ok");
        assert_eq!(ns, Some("prod"));
        assert_eq!(ar.api_version, "acme.io/v1");
        assert_eq!((ar.group.as_str(), ar.version.as_str(), ar.kind.as_str(), ar.plural.as_str()),
            ("acme.io", "v1", "Widget", "widgets"));
    }

    #[test]
    fn cr_request_namespaced_without_a_namespace_uses_the_require_namespace_message() {
        let err = cr_request("acme.io", "v1", "Widget", "widgets", "Namespaced", "", "w1").expect_err("err");
        assert_eq!(err, "Widget is namespace-scoped and requires a namespace");
    }

    #[test]
    fn cr_request_cluster_scope_ignores_the_namespace() {
        for namespace in ["", "prod"] {
            let (_, ns) = cr_request("acme.io", "v1", "Gadget", "gadgets", "Cluster", namespace, "g1").expect("ok");
            assert_eq!(ns, None, "{:?}", namespace);
        }
    }

    #[test]
    fn cr_request_rejects_an_unknown_scope() {
        let err = cr_request("acme.io", "v1", "Widget", "widgets", "namespaced", "prod", "w1").expect_err("err");
        assert_eq!(err, "Failed to get Widget: unknown scope 'namespaced'");
        let err = cr_request("acme.io", "v1", "Widget", "widgets", "", "prod", "w1").expect_err("err");
        assert_eq!(err, "Failed to get Widget: unknown scope ''");
    }

    #[test]
    fn cr_request_names_each_missing_field() {
        let ok = ["acme.io", "v1", "Widget", "widgets", "w1"];
        let call = |g: &str, v: &str, k: &str, p: &str, n: &str| {
            cr_request(g, v, k, p, "Namespaced", "prod", n).map(|_| ())
        };
        assert_eq!(call("acme.io", "", ok[2], ok[3], ok[4]).expect_err("version"), "Failed to get Widget: missing version");
        assert_eq!(call("acme.io", "v1", ok[2], "", ok[4]).expect_err("plural"), "Failed to get Widget: missing plural");
        assert_eq!(call("acme.io", "v1", ok[2], ok[3], "").expect_err("name"), "Failed to get Widget: missing name");
        // No kind: the label falls back to "custom resource".
        assert_eq!(
            call("acme.io", "v1", "", ok[3], ok[4]).expect_err("kind"),
            "Failed to get custom resource: missing kind"
        );
    }

    #[test]
    fn cr_request_refuses_an_empty_group_so_a_core_secret_is_out_of_reach() {
        let err = cr_request("", "v1", "Secret", "secrets", "Namespaced", "prod", "db-password").expect_err("err");
        assert_eq!(err, "Failed to get Secret: a custom resource needs an API group");
        let err = cr_request("", "v1", "", "secrets", "Namespaced", "prod", "db-password").expect_err("err");
        assert_eq!(err, "Failed to get custom resource: a custom resource needs an API group");
        // The group check comes first, so it wins over every other missing field.
        let err = cr_request("", "", "Secret", "", "", "", "").expect_err("err");
        assert_eq!(err, "Failed to get Secret: a custom resource needs an API group");
    }

    /// All six commands run `cr_request` before they connect: with an empty group each returns the
    /// request error, never "Failed to connect" (the context does not exist).
    #[tokio::test]
    async fn every_command_refuses_an_empty_group_before_connecting() {
        let want = "Failed to get Secret: a custom resource needs an API group";
        let args = || {
            ("no-such-context".to_string(), String::new(), "v1".to_string(), "Secret".to_string(),
             "secrets".to_string(), "Namespaced".to_string(), "prod".to_string(), "db-password".to_string())
        };
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(get_custom_resource(c, g, v, k, p, s, ns, n).await.expect_err("get"), want);
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(get_custom_resource_yaml(c, g, v, k, p, s, ns, n).await.expect_err("yaml"), want);
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(get_custom_resource_yaml_neat(c, g, v, k, p, s, ns, n).await.expect_err("neat"), want);
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(delete_custom_resource(c, g, v, k, p, s, ns, n).await.expect_err("delete"), want);
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(
            preview_custom_resource_yaml(c, g, v, k, p, s, ns, n, "a: 1".into()).await.expect_err("preview"),
            want
        );
        let (c, g, v, k, p, s, ns, n) = args();
        assert_eq!(
            apply_custom_resource_yaml(c, g, v, k, p, s, ns, n, "a: 1".into()).await.expect_err("apply"),
            want
        );
    }

    // ---- cr_conditions -----------------------------------------------------

    #[test]
    fn cr_conditions_is_empty_without_a_conditions_array() {
        assert!(cr_conditions(None).is_empty());
        assert!(cr_conditions(Some(&json!("Ready"))).is_empty());
        assert!(cr_conditions(Some(&json!([{"type": "Ready"}]))).is_empty());
        assert!(cr_conditions(Some(&json!({}))).is_empty());
        assert!(cr_conditions(Some(&json!({"conditions": {"type": "Ready"}}))).is_empty());
        assert!(cr_conditions(Some(&json!({"conditions": "Ready"}))).is_empty());
    }

    #[test]
    fn cr_conditions_skips_entries_without_a_usable_type() {
        let status = json!({"conditions": [
            "Ready", 7, null, [],
            {"status": "True"},
            {"type": "", "status": "True"},
            {"type": 3, "status": "True"},
            {"type": null},
            {"type": "Ready", "status": "True"},
        ]});
        let got = cr_conditions(Some(&status));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].type_, "Ready");
    }

    #[test]
    fn cr_conditions_status_is_a_string_a_bool_or_unknown() {
        let status = json!({"conditions": [
            {"type": "A", "status": "False"},
            {"type": "B", "status": true},
            {"type": "C", "status": false},
            {"type": "D", "status": 1},
            {"type": "E"},
            {"type": "F", "status": null},
            {"type": "G", "status": "Maybe"},
        ]});
        let got: Vec<(String, String)> =
            cr_conditions(Some(&status)).into_iter().map(|c| (c.type_, c.status)).collect();
        let want: Vec<(String, String)> = [
            ("A", "False"), ("B", "True"), ("C", "False"), ("D", "Unknown"),
            ("E", "Unknown"), ("F", "Unknown"), ("G", "Maybe"),
        ]
        .iter()
        .map(|(t, s)| (t.to_string(), s.to_string()))
        .collect();
        assert_eq!(got, want);
    }

    #[test]
    fn cr_conditions_text_fields_default_to_empty_and_the_first_type_wins() {
        let status = json!({"conditions": [
            {"type": "Ready", "status": "True", "reason": "AllGood", "message": "ok",
             "lastTransitionTime": "2026-10-30T10:00:00Z"},
            {"type": "Stalled", "status": "False", "reason": 5, "message": 6, "lastTransitionTime": false},
            {"type": "Ready", "status": "False", "reason": "Later"},
            {"type": "Healthy"},
        ]});
        let got = cr_conditions(Some(&status));
        let types: Vec<&str> = got.iter().map(|c| c.type_.as_str()).collect();
        assert_eq!(types, ["Ready", "Stalled", "Healthy"]);
        assert_eq!(got[0].status, "True");
        assert_eq!(got[0].reason, "AllGood");
        assert_eq!(got[0].message, "ok");
        assert_eq!(got[0].last_transition, "2026-10-30T10:00:00Z");
        assert_eq!((got[1].reason.as_str(), got[1].message.as_str(), got[1].last_transition.as_str()), ("", "", ""));
        assert_eq!((got[2].status.as_str(), got[2].reason.as_str()), ("Unknown", ""));
    }

    #[test]
    fn cr_conditions_cuts_a_long_multibyte_message_by_characters() {
        let message = "é".repeat(2100);
        let status = json!({"conditions": [{"type": "Ready", "status": "True", "message": message}]});
        let got = cr_conditions(Some(&status));
        let cut = &got[0].message;
        assert_eq!(cut.chars().count(), 2001);
        assert!(cut.ends_with('\u{2026}'));
        assert!(cut.starts_with("éé"));
    }

    // ---- cr_detail ---------------------------------------------------------

    fn widget_ar() -> ApiResource {
        api_resource_for("acme.io", "v1", "Widget", "widgets")
    }

    fn object(v: Value) -> DynamicObject {
        serde_json::from_value(v).expect("a DynamicObject")
    }

    #[test]
    fn cr_detail_reads_metadata_in_sorted_order() {
        let obj = object(json!({
            "apiVersion": "acme.io/v1beta1",
            "kind": "Widget",
            "metadata": {
                "name": "w1",
                "namespace": "prod",
                "creationTimestamp": "2026-10-30T10:00:00Z",
                "generation": 4,
                "labels": {"b": "2", "a": "1"},
                "annotations": {"z": "last", "m": "mid"},
                "finalizers": ["acme.io/second", "acme.io/first"],
                "ownerReferences": [
                    {"apiVersion": "v1", "kind": "Deployment", "name": "d1", "uid": "u1", "controller": true},
                    {"apiVersion": "v1", "kind": "Team", "name": "t1", "uid": "u2"},
                ],
            },
            "spec": {"size": 3},
        }));
        let d = cr_detail(&obj, &widget_ar());
        assert_eq!((d.name.as_str(), d.namespace.as_str()), ("w1", "prod"));
        assert_eq!((d.api_version.as_str(), d.kind.as_str()), ("acme.io/v1beta1", "Widget"));
        assert_eq!(d.created, "2026-10-30T10:00:00Z");
        assert_ne!(d.age, "");
        assert_eq!(d.generation, Some(4));
        assert_eq!(d.labels.keys().map(String::as_str).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(d.annotations.keys().map(String::as_str).collect::<Vec<_>>(), ["m", "z"]);
        assert_eq!(d.finalizers, ["acme.io/second", "acme.io/first"]);
        assert_eq!(
            d.owners,
            vec![
                CustomResourceOwner { kind: "Deployment".into(), name: "d1".into(), controller: true },
                CustomResourceOwner { kind: "Team".into(), name: "t1".into(), controller: false },
            ]
        );
        assert_eq!(d.deletion_timestamp, None);
    }

    #[test]
    fn cr_detail_reports_a_deletion_in_progress() {
        let obj = object(json!({
            "metadata": {"name": "w1", "deletionTimestamp": "2026-10-30T11:30:00Z"},
        }));
        let d = cr_detail(&obj, &widget_ar());
        assert_eq!(d.deletion_timestamp.as_deref(), Some("2026-10-30T11:30:00Z"));
    }

    #[test]
    fn cr_detail_observed_generation_needs_an_integer() {
        let with = |v: Value| cr_detail(&object(json!({"metadata": {"name": "w"}, "status": {"observedGeneration": v}})), &widget_ar());
        assert_eq!(with(json!(7)).observed_generation, Some(7));
        assert_eq!(with(json!("7")).observed_generation, None);
        assert_eq!(with(json!(7.5)).observed_generation, None);
        assert_eq!(with(json!(null)).observed_generation, None);
        let none = cr_detail(&object(json!({"metadata": {"name": "w"}})), &widget_ar());
        assert_eq!((none.observed_generation, none.generation), (None, None));
    }

    #[test]
    fn cr_detail_phase_comes_from_phase_then_state_and_only_from_strings() {
        let phase = |status: Value| cr_detail(&object(json!({"metadata": {"name": "w"}, "status": status})), &widget_ar()).phase;
        assert_eq!(phase(json!({"phase": "Running", "state": "Other"})), "Running");
        assert_eq!(phase(json!({"state": "Provisioned"})), "Provisioned");
        assert_eq!(phase(json!({"phase": 3})), "");
        assert_eq!(phase(json!({"phase": {"name": "x"}, "state": ["y"]})), "");
        assert_eq!(phase(json!("Running")), "");
        let no_status = cr_detail(&object(json!({"metadata": {"name": "w"}})), &widget_ar());
        assert_eq!(no_status.phase, "");
    }

    #[test]
    fn cr_detail_falls_back_to_the_request_without_type_meta() {
        let d = cr_detail(&object(json!({"metadata": {"name": "w1"}})), &widget_ar());
        assert_eq!((d.api_version.as_str(), d.kind.as_str()), ("acme.io/v1", "Widget"));
        assert_eq!((d.created.as_str(), d.age.as_str()), ("", "\u{2014}"));
        // An empty TypeMeta string falls back too.
        let d = cr_detail(&object(json!({"apiVersion": "", "kind": "", "metadata": {"name": "w1"}})), &widget_ar());
        assert_eq!((d.api_version.as_str(), d.kind.as_str()), ("acme.io/v1", "Widget"));
    }

    #[test]
    fn cr_detail_of_a_cluster_scoped_object_has_an_empty_namespace() {
        let ar = api_resource_for("acme.io", "v1", "Gadget", "gadgets");
        let d = cr_detail(&object(json!({"metadata": {"name": "g1"}})), &ar);
        assert_eq!((d.name.as_str(), d.namespace.as_str()), ("g1", ""));
        assert!(d.labels.is_empty() && d.annotations.is_empty() && d.owners.is_empty() && d.finalizers.is_empty());
        assert!(d.conditions.is_empty());
    }

    #[test]
    fn cr_detail_conditions_come_from_status() {
        let obj = object(json!({
            "metadata": {"name": "w1"},
            "status": {"conditions": [{"type": "Ready", "status": "True"}]},
        }));
        let d = cr_detail(&obj, &widget_ar());
        assert_eq!(d.conditions.len(), 1);
        assert_eq!(d.conditions[0].type_, "Ready");
    }

    #[test]
    fn cr_detail_serialises_exactly_the_documented_keys() {
        let d = cr_detail(&object(json!({"metadata": {"name": "w1"}})), &widget_ar());
        let value = serde_json::to_value(&d).expect("json");
        let mut keys: Vec<&str> = value.as_object().expect("object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        let mut want = vec![
            "name", "namespace", "api_version", "kind", "age", "created", "deletion_timestamp",
            "generation", "observed_generation", "phase", "conditions", "labels", "annotations",
            "owners", "finalizers",
        ];
        want.sort_unstable();
        assert_eq!(keys, want);
        let owner = serde_json::to_value(CustomResourceOwner { kind: "K".into(), name: "n".into(), controller: true })
            .expect("json");
        assert_eq!(owner, json!({"kind": "K", "name": "n", "controller": true}));
    }

    // ---- cr_journal_kind ---------------------------------------------------

    #[test]
    fn cr_journal_kind_is_plural_dot_group() {
        assert_eq!(cr_journal_kind("widgets", "acme.io"), "widgets.acme.io");
    }
}
