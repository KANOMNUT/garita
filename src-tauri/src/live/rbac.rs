//! Who can / subject permissions against real bindings.
use super::{fixture, js, Ns};
use crate::commands::rbac;

#[tokio::test]
#[ignore]
async fn who_can_and_subject_permissions() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("rbac.yaml")).await;
    let r = rbac::who_can(ctx.clone(), "get".into(), String::new(), "pods".into(), Some(n.clone()), None).await.unwrap();
    println!("who_can: {}", js(&r));
    assert!(r.grants.iter().any(|g| g.subject.kind == "ServiceAccount" && g.subject.name == "viewer" && g.scope == "namespace"));
    // kind binds cluster-admin to the system:masters group
    assert!(r.grants.iter().any(|g| g.subject.name == "system:masters"), "no system:masters grant");
    let w = rbac::who_can(ctx.clone(), "delete".into(), String::new(), "pods".into(), Some(n.clone()), None).await.unwrap();
    assert!(!w.grants.iter().any(|g| g.subject.name == "viewer"));
    let s = rbac::subject_permissions(ctx.clone(), "ServiceAccount".into(), "viewer".into(), Some(n.clone())).await.unwrap();
    println!("subject: {}", js(&s));
    assert!(s.iter().any(|g| g.resources.iter().any(|r| r == "pods") && g.verbs.iter().any(|v| v == "get")));
    ns.cleanup().await;
}
