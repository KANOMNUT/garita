//! YAML save preview/apply (server dry run) and Helm previews.
use super::{fixture, helm, js, Ns};
use crate::commands::{helm as app_helm, pods};

#[tokio::test]
#[ignore]
async fn yaml_preview_ok_conflict_invalid_then_apply() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("unused.yaml")).await;
    let yaml = pods::get_resource_yaml(ctx.clone(), n.clone(), "cm".into(), "orphan-cm".into()).await.unwrap();
    let edit = |f: &dyn Fn(&mut serde_yaml::Value)| {
        let mut v: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        f(&mut v);
        serde_yaml::to_string(&v).unwrap()
    };
    let changed = edit(&|v| v["data"]["k"] = "v2".into());
    let p = pods::preview_resource_yaml(ctx.clone(), n.clone(), "cm".into(), "orphan-cm".into(), changed.clone()).await.unwrap();
    println!("preview ok: outcome={} dropped={:?}", p.outcome, p.dropped_paths);
    assert_eq!(p.outcome, "ok", "{}", p.message);
    assert_eq!(p.result["data"]["k"], "v2");
    // dry run wrote nothing
    assert_eq!(ns.kubectl(&["get", "cm", "orphan-cm", "-o", "jsonpath={.data.k}"]).await.unwrap(), "v");
    let stale = edit(&|v| {
        v["data"]["k"] = "v2".into();
        v["metadata"]["resourceVersion"] = "1".into();
    });
    let p = pods::preview_resource_yaml(ctx.clone(), n.clone(), "cm".into(), "orphan-cm".into(), stale).await.unwrap();
    println!("preview stale: {} / {}", p.outcome, p.message);
    assert_eq!(p.outcome, "conflict");
    let p = pods::preview_resource_yaml(ctx.clone(), n.clone(), "cm".into(), "orphan-cm".into(), "a: [".into()).await.unwrap();
    assert_eq!(p.outcome, "invalid");
    pods::apply_resource_yaml(ctx.clone(), n.clone(), "cm".into(), "orphan-cm".into(), changed).await.unwrap();
    assert_eq!(ns.kubectl(&["get", "cm", "orphan-cm", "-o", "jsonpath={.data.k}"]).await.unwrap(), "v2");
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn helm_list_and_upgrade_preview() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    let chart = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/live/fixtures/chart");
    helm(&ctx, &["install", "rel", chart, "-n", &n]).await.unwrap();
    let rels = app_helm::list_helm_releases(ctx.clone()).await.unwrap();
    assert!(rels.iter().any(|r| r.name == "rel" && r.namespace == n), "{}", js(&rels));
    let p = app_helm::preview_helm_upgrade(ctx.clone(), n.clone(), "rel".into(), "greeting: bye\n".into()).await.unwrap();
    println!("helm preview: outcome={} msg={} resources={}", p.outcome, p.message, p.resources.len());
    assert_eq!(p.outcome, "ok", "{}", p.message);
    assert_eq!(p.new_values["greeting"], "bye");
    assert!(p.rendered_manifest.contains("bye"));
    let p = app_helm::preview_helm_upgrade(ctx.clone(), n.clone(), "rel".into(), "a: [".into()).await.unwrap();
    assert_eq!(p.outcome, "invalid");
    let v = app_helm::get_helm_values(ctx.clone(), n.clone(), "rel".into(), None).await.unwrap();
    println!("values: {v}");
    let _ = helm(&ctx, &["uninstall", "rel", "-n", &n]).await;
    ns.cleanup().await;
}
