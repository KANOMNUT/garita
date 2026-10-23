//! Log reads and the per-invocation log stream channel.
use super::{eventually, fixture, Ns};
use crate::commands::pods::{self, LogStreamEvent};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

#[tokio::test]
#[ignore]
async fn logs_get_and_stream() {
    let Some(ctx) = super::ctx() else { return };
    let ns = Ns::create(&ctx).await;
    let n = ns.name.clone();
    ns.apply(fixture!("logger.yaml")).await;
    ns.wait("condition=Ready", "pod/logger").await;
    // a just-started container can answer with "unable to retrieve container logs": wait for real lines
    let fresh = eventually(30, || {
        let (c, n) = (ctx.clone(), n.clone());
        async move {
            pods::get_pod_logs(c, n, "logger".into(), "c".into(), Some(2), None, None, None).await.is_ok_and(|o| o.contains("line-2"))
        }
    })
    .await;
    assert!(fresh, "no log lines");
    // tail + timestamps + since_seconds together
    let out = pods::get_pod_logs(ctx.clone(), n.clone(), "logger".into(), "c".into(), Some(2), None, Some(60), Some(true))
        .await
        .unwrap();
    assert_eq!(out.lines().count(), 2, "{out}");
    assert!(out.lines().all(|l| l.contains("line-") && l.contains('T')), "{out}");
    // previous on the crashing pod
    ns.wait("jsonpath={.status.containerStatuses[0].restartCount}=1", "pod/crash").await;
    let got_prev = eventually(30, || {
        let (c, n) = (ctx.clone(), n.clone());
        async move {
            pods::get_pod_logs(c, n, "crash".into(), "c".into(), None, Some(true), None, None).await.is_ok_and(|o| o.contains("boom"))
        }
    })
    .await;
    assert!(got_prev, "previous logs never returned boom");
    // stream
    let got: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = got.clone();
    let ch: Channel<LogStreamEvent> = Channel::new(move |b| {
        if let InvokeResponseBody::Json(s) = b {
            sink.lock().unwrap().push(s);
        }
        Ok(())
    });
    pods::stream_pod_logs(ch, ctx.clone(), n.clone(), "logger".into(), "c".into(), Some(1), None, None).await.unwrap();
    assert!(eventually(20, || async { got.lock().unwrap().iter().filter(|s| s.contains("\"line\"")).count() >= 2 }).await);
    // a missing container is rejected at start
    let ch: Channel<LogStreamEvent> = Channel::new(|_| Ok(()));
    let e = pods::stream_pod_logs(ch, ctx.clone(), n.clone(), "logger".into(), "nope".into(), None, None, None).await.unwrap_err();
    println!("start rejection: {e}");
    ns.cleanup().await;
}
