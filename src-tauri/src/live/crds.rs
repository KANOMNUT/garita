//! Custom resource commands (v2.4.1, D19) on a built-in API group. The harness never writes
//! cluster-scoped objects (T51-6) and kind ships no CRD, so a Role in the test's own namespace
//! stands in for a custom resource: it passes `cr_request` (non-empty group), runs the
//! `ReplaceTarget::Custom` arm, the dry run, the conflict and the delete on a real API server.
use super::{eventually, Ns};
use crate::commands::crds;

const GROUP: &str = "rbac.authorization.k8s.io";
const NAME: &str = "garita-cr";

/// The CRD fields every custom resource command takes, for a namespaced `Role` in `ns`.
struct Role {
    ctx: String,
    ns: String,
}

impl Role {
    async fn get(&self) -> Result<Option<crds::CustomResourceDetail>, String> {
        crds::get_custom_resource(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(),
        )
        .await
    }

    async fn yaml(&self) -> Result<String, String> {
        crds::get_custom_resource_yaml(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(),
        )
        .await
    }

    async fn neat(&self) -> Result<crate::commands::pods::NeatYaml, String> {
        crds::get_custom_resource_yaml_neat(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(),
        )
        .await
    }

    async fn preview(&self, yaml: String) -> Result<crate::commands::pods::YamlSavePreview, String> {
        crds::preview_custom_resource_yaml(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(), yaml,
        )
        .await
    }

    async fn apply(&self, yaml: String) -> Result<(), String> {
        crds::apply_custom_resource_yaml(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(), yaml,
        )
        .await
    }

    async fn delete(&self) -> Result<(), String> {
        crds::delete_custom_resource(
            self.ctx.clone(), GROUP.into(), "v1".into(), "Role".into(), "roles".into(),
            "Namespaced".into(), self.ns.clone(), NAME.into(),
        )
        .await
    }
}

#[tokio::test]
#[ignore]
async fn custom_resource_read_preview_save_delete_on_a_builtin_group() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    ns.kubectl(&["create", "role", NAME, "--verb=get", "--resource=pods"]).await.unwrap();
    let role = Role { ctx: ctx.clone(), ns: ns.name.clone() };
    let verbs = || ns.kubectl(&["get", "role", NAME, "-o", "jsonpath={.rules[0].verbs[*]}"]);

    // Reads.
    let detail = role.get().await.unwrap().expect("the role exists");
    println!("detail: kind={} api_version={} namespace={}", detail.kind, detail.api_version, detail.namespace);
    assert_eq!(detail.kind, "Role");
    assert_eq!(detail.name, NAME);
    assert_eq!(detail.namespace, ns.name);
    assert_eq!(detail.api_version, "rbac.authorization.k8s.io/v1");
    let yaml = role.yaml().await.unwrap();
    assert!(yaml.contains("kind: Role"), "{yaml}");
    let neat = role.neat().await.unwrap();
    assert!(neat.yaml.contains("kind: Role"), "{}", neat.yaml);
    assert!(!neat.yaml.contains("managedFields"), "{}", neat.yaml);
    assert!(neat.hidden.iter().any(|p| p == "metadata.managedFields"), "{:?}", neat.hidden);

    let edit = |f: &dyn Fn(&mut serde_yaml::Value)| {
        let mut v: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        f(&mut v);
        serde_yaml::to_string(&v).unwrap()
    };
    let set_verbs = |v: &mut serde_yaml::Value| {
        v["rules"][0]["verbs"] = serde_yaml::Value::Sequence(vec!["get".into(), "list".into()]);
    };
    let changed = edit(&set_verbs);

    // Preview: ok, and the dry run wrote nothing.
    let p = role.preview(changed.clone()).await.unwrap();
    println!("preview ok: outcome={} dropped={:?}", p.outcome, p.dropped_paths);
    assert_eq!(p.outcome, "ok", "{}", p.message);
    assert_eq!(p.result["rules"][0]["verbs"], serde_json::json!(["get", "list"]));
    assert!(p.dropped_paths.is_empty());
    assert_eq!(verbs().await.unwrap(), "get");

    // A stale resourceVersion is a conflict.
    let stale = edit(&|v| {
        set_verbs(v);
        v["metadata"]["resourceVersion"] = "1".into();
    });
    let p = role.preview(stale).await.unwrap();
    println!("preview stale: {} / {}", p.outcome, p.message);
    assert_eq!(p.outcome, "conflict");

    // YAML that does not parse is invalid, with no cluster call needed.
    let p = role.preview("a: [".into()).await.unwrap();
    assert_eq!(p.outcome, "invalid");

    // Save.
    role.apply(changed).await.unwrap();
    assert_eq!(verbs().await.unwrap(), "get list");

    // Delete, then the object is gone: the read says so with None, not an error.
    role.delete().await.unwrap();
    let gone = eventually(30, || async { matches!(role.get().await, Ok(None)) }).await;
    assert!(gone, "the role still reads as present after delete");
    assert!(ns.kubectl(&["get", "role", NAME]).await.is_err());

    ns.cleanup().await;
}
