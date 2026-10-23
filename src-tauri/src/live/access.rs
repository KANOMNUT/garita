//! can_i, per-kind reads (gvk_for), API presence.
use super::{fixture, js, Ns};
use crate::commands::{access, nodes, pods, presence};

#[tokio::test]
#[ignore]
async fn can_i_admin_allowed() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let check = |verb: &str, resource: &str, sub: Option<&str>| access::AccessCheck {
        group: String::new(),
        resource: resource.into(),
        verb: verb.into(),
        namespace: ns.name.clone(),
        subresource: sub.map(Into::into),
    };
    let r = access::can_i(
        ctx.clone(),
        vec![check("get", "pods", None), check("create", "pods", Some("eviction")), check("update", "pods", Some("ephemeralcontainers"))],
    )
    .await
    .unwrap();
    println!("can_i: {}", js(&r));
    assert!(r.iter().all(|x| x.allowed));
    // denial needs a non-admin identity: not coverable with kind's admin kubeconfig.
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn reads_for_namespaced_and_cluster_kinds() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    for f in [fixture!("pdb.yaml"), fixture!("rbac.yaml"), fixture!("unused.yaml"), fixture!("problems.yaml")] {
        ns.apply(f).await;
    }
    let node = nodes::list_nodes(ctx.clone()).await.unwrap().remove(0).name;
    let cases: [(&str, &str, &str); 14] = [
        ("deploy", "web", ""),
        ("pdb", "web", ""),
        ("job", "done", ""),
        ("sa", "viewer", ""),
        ("roles", "pod-reader", ""),
        ("rbindings", "viewer-reads-pods", ""),
        ("cm", "orphan-cm", ""),
        ("cron", "cj", ""),
        ("svc", "lonely", ""),
        ("pvc", "unbound", ""),
        ("nodes", node.as_str(), "cluster"),
        ("sc", "standard", "cluster"),
        ("croles", "view", "cluster"),
        ("crbindings", "cluster-admin", "cluster"),
    ];
    for (kind, name, scope) in cases {
        let ns_arg = if scope == "cluster" { String::new() } else { n.clone() };
        let y = pods::get_resource_yaml(ctx.clone(), ns_arg, kind.into(), name.into()).await;
        match &y {
            Ok(t) => assert!(t.contains(name), "{kind}/{name}"),
            Err(e) => panic!("{kind}/{name}: {e}"),
        }
        let neat = pods::get_resource_yaml_neat(ctx.clone(), if scope == "cluster" { String::new() } else { n.clone() }, kind.into(), name.into()).await.unwrap();
        assert!(!neat.yaml.contains("managedFields"), "{kind}/{name}");
    }
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn api_presence_reports_core_groups() {
    let Some(ctx) = super::ctx() else { return };
    let r = presence::list_api_presence(ctx.clone()).await.unwrap();
    println!("presence: {}", js(&r));
    assert!(!r.is_empty());
    assert!(r.iter().all(|p| ["installed", "absent", "unknown"].contains(&p.state.as_str())));
    // a fresh kind cluster has no cert-manager / argocd / flux
    assert!(r.iter().any(|p| p.state == "absent"));
}
