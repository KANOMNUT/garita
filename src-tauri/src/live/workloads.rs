//! Drain/eviction, events, delete propagation, rollback, ephemeral debug container.
use super::{eventually, fixture, js, Ns};
use crate::commands::{cluster_info, drain, pods, workload_actions};

#[tokio::test]
#[ignore]
async fn eviction_blocked_by_pdb_and_completed_pod_evicts() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    ns.apply(fixture!("pdb.yaml")).await;
    ns.wait("condition=Available", "deploy/web").await;
    ns.wait("condition=Complete", "job/done").await;
    let list = pods::list_pods(ctx.clone(), ns.name.clone()).await.unwrap();
    let web = list.iter().find(|p| p.name.starts_with("web-")).expect("web pod");
    let r = drain::evict_pod(ctx.clone(), ns.name.clone(), web.name.clone()).await.unwrap();
    println!("evict web: {}", js(&r));
    assert_eq!(r.outcome, "blocked");
    assert!(r.message.contains("disruption budget"), "{}", r.message);
    let done = list.iter().find(|p| p.name.starts_with("done-")).expect("done pod");
    let r = drain::evict_pod(ctx.clone(), ns.name.clone(), done.name.clone()).await.unwrap();
    println!("evict completed: {}", js(&r));
    assert!(r.outcome == "evicted" || r.outcome == "gone", "{}", js(&r));
    // preview only: never cordons or drains a node
    let nodes = crate::commands::nodes::list_nodes(ctx.clone()).await.unwrap();
    let w = nodes.iter().find(|n| n.name.contains("worker")).expect("worker");
    let p = drain::preview_node_drain(ctx.clone(), w.name.clone()).await.unwrap();
    assert_eq!(p.node, w.name);
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn events_by_pod_and_by_kind() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    ns.apply(fixture!("pdb.yaml")).await;
    ns.wait("condition=Available", "deploy/web").await;
    let n = ns.name.clone();
    let pod = pods::list_pods(ctx.clone(), n.clone()).await.unwrap().remove(0).name;
    let ev = cluster_info::get_pod_events(ctx.clone(), n.clone(), pod.clone()).await.unwrap();
    assert!(ev.iter().any(|e| e.reason == "Scheduled" || e.reason == "Started"), "{}", js(&ev));
    // involvedObject.kind field selector accepted
    let ev = cluster_info::get_resource_events(ctx.clone(), n.clone(), "web".into(), Some("Deployment".into())).await.unwrap();
    assert!(ev.iter().any(|e| e.reason == "ScalingReplicaSet"), "{}", js(&ev));
    let all = cluster_info::list_events(ctx.clone(), n.clone()).await.unwrap();
    assert!(!all.is_empty());
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn delete_propagation_background_and_orphan() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    ns.apply(fixture!("pdb.yaml")).await;
    ns.wait("condition=Available", "deploy/web").await;
    ns.wait("condition=Complete", "job/done").await;
    let n = ns.name.clone();
    let count = |prefix: &'static str| {
        let (c, n) = (ctx.clone(), n.clone());
        async move { pods::list_pods(c, n).await.unwrap().iter().filter(|p| p.name.starts_with(prefix)).count() }
    };
    // Background: deleting the Job removes its pod
    assert_eq!(count("done-").await, 1);
    pods::delete_resource(ctx.clone(), n.clone(), "job".into(), "done".into(), Some("background".into())).await.unwrap();
    assert!(eventually(60, || async { count("done-").await == 0 }).await, "job pod still there");
    // Orphan: deleting the Deployment keeps ReplicaSet and pods
    pods::delete_resource(ctx.clone(), n.clone(), "deploy".into(), "web".into(), Some("orphan".into())).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    assert_eq!(count("web-").await, 2, "orphaned pods vanished");
    let rs = ns.kubectl(&["get", "rs", "-o", "name"]).await.unwrap();
    assert!(rs.contains("replicaset"), "{rs}");
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn rollback_reuses_old_replicaset_and_scale_writes() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("rollback.yaml")).await;
    ns.wait("condition=Available", "deploy/app").await;
    ns.kubectl(&["set", "image", "deploy/app", "c=busybox:1.35"]).await.unwrap();
    ns.kubectl(&["rollout", "status", "deploy/app", "--timeout=120s"]).await.unwrap();
    let h = workload_actions::list_rollout_history(ctx.clone(), n.clone(), "app".into()).await.unwrap();
    println!("history: {}", js(&h));
    assert_eq!(h.len(), 2);
    let first = h.iter().map(|r| r.revision).min().unwrap();
    workload_actions::rollback_deployment(ctx.clone(), n.clone(), "app".into(), first).await.unwrap();
    ns.kubectl(&["rollout", "status", "deploy/app", "--timeout=120s"]).await.unwrap();
    let rs = ns.kubectl(&["get", "rs", "-o", "name"]).await.unwrap();
    assert_eq!(rs.lines().count(), 2, "rollback created a duplicate ReplicaSet: {rs}");
    workload_actions::scale_workload(ctx.clone(), n.clone(), "deploy".into(), "app".into(), 2).await.unwrap();
    ns.wait("jsonpath={.status.readyReplicas}=2", "deploy/app").await;
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn debug_container_second_one_keeps_first() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("logger.yaml")).await;
    ns.wait("condition=Ready", "pod/logger").await;
    for name in ["dbg1", "dbg2"] {
        pods::start_debug_container(ctx.clone(), n.clone(), "logger".into(), name.into(), "busybox:1.36".into(), Some("c".into()))
            .await
            .unwrap();
    }
    let out = ns.kubectl(&["get", "pod", "logger", "-o", "jsonpath={.spec.ephemeralContainers[*].name}"]).await.unwrap();
    let mut names: Vec<&str> = out.split_whitespace().collect();
    names.sort_unstable(); // strategic merge does not keep append order (observed: "dbg2 dbg1")
    assert_eq!(names, ["dbg1", "dbg2"]);
    ns.cleanup().await;
}
