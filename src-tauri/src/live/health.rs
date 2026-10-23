//! Problems, node capacity, possibly-unused, deprecated APIs.
use super::{eventually, fixture, js, Ns};
use crate::commands::{capacity, deprecations, problems, unused};

#[tokio::test]
#[ignore]
async fn problems_fire_on_fixtures() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("problems.yaml")).await;
    let want = ["crashloop", "unschedulable", "job-failed", "service-no-endpoints"];
    // oom-killed is not asserted: kind on Docker Desktop reports OOM kills as reason "Error" (exit 137).
    // pvc-pending only fires after 5 minutes: opt in with GARITA_LIVE_SLOW=1
    let slow = std::env::var("GARITA_LIVE_SLOW").is_ok_and(|v| v == "1");
    let seen: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
    let ok = eventually(if slow { 400 } else { 150 }, || {
        let (c, n, seen) = (ctx.clone(), n.clone(), seen.clone());
        async move {
            let r = problems::list_problems(c, Some(n)).await.unwrap();
            let rules: Vec<String> = r.findings.iter().map(|f| f.rule.clone()).collect();
            let all = want.iter().all(|w| rules.iter().any(|r| r == w)) && (!slow || rules.iter().any(|r| r == "pvc-pending"));
            *seen.lock().unwrap() = rules;
            all
        }
    })
    .await;
    let last = seen.lock().unwrap().clone();
    println!("rules seen: {last:?}");
    assert!(ok, "missing rules; saw {last:?}");
    // namespace-scoped call never touches cluster-scoped sources as errors
    let r = problems::list_problems(ctx.clone(), Some(n.clone())).await.unwrap();
    println!("skipped: {}", js(&r.skipped));
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn node_capacity_rows() {
    let Some(ctx) = super::ctx() else { return };
    let rows = capacity::list_node_capacity(ctx.clone()).await.unwrap();
    println!("capacity: {}", js(&rows));
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|r| r.cpu_allocatable_m.is_some_and(|c| c > 0) && r.mem_allocatable_mi.is_some_and(|m| m > 0)));
    // usage needs metrics-server (absent in kind): must be None, not an error
    assert!(rows.iter().all(|r| r.cpu_usage_m.is_none()));
}

#[tokio::test]
#[ignore]
async fn unused_has_no_false_positives() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("unused.yaml")).await;
    ns.wait("condition=Ready", "pod/consumer").await;
    let r = unused::list_possibly_unused(ctx.clone(), Some(n.clone())).await.unwrap();
    println!("unused: {}", js(&r));
    let cms: Vec<&str> = r.candidates.iter().filter(|c| c.kind == "cm").map(|c| c.name.as_str()).collect();
    assert!(cms.contains(&"orphan-cm"), "{cms:?}");
    for used in ["cron-cm", "init-cm", "proj-cm"] {
        assert!(!cms.contains(&used), "false positive {used}");
    }
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn deprecations_last_applied_and_server_version() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("deprecated.yaml")).await;
    let old = r#"{"apiVersion":"batch/v1beta1","kind":"CronJob","metadata":{"name":"oldapi"}}"#;
    let ann = format!("kubectl.kubernetes.io/last-applied-configuration={old}");
    ns.kubectl(&["annotate", "--overwrite", "cronjob/oldapi", &ann]).await.unwrap();
    let r = deprecations::scan_deprecated_apis(ctx.clone(), Some(n.clone())).await.unwrap();
    println!("deprecations: {}", js(&r));
    assert!(r.server_version.starts_with('v'), "{}", r.server_version);
    assert!(r.findings.iter().any(|f| f.source == "last-applied" && f.name == "oldapi"));
    ns.cleanup().await;
}
