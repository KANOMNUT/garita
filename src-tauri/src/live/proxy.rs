//! proxy-url through squid (http) and a SOCKS5 server, against kind's INTERNAL server name
//! (only resolvable on the kind docker network, so a silent bypass fails on DNS: T51-10).
//! run.sh generates the contexts `<ctx>-http|-socks5|-userinfo|-deadproxy|-direct`.
use super::{eventually, fixture, js, Ns};
use crate::commands::pods::LogStreamEvent;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use crate::commands::{cluster_info, context, pods, utils::client_for_context, workload_actions};
use k8s_openapi::api::core::v1::Pod;
use kube::Api;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn exercise(base: &str, via: &str) {
    let ns = Ns::create(base).await;
    let n = ns.name.clone();
    ns.apply(fixture!("logger.yaml")).await;
    ns.apply(fixture!("httpd.yaml")).await;
    ns.apply(fixture!("rollback.yaml")).await;
    ns.wait("condition=Ready", "pod/logger").await;
    ns.wait("condition=Ready", "pod/httpd").await;
    ns.wait("condition=Available", "deploy/app").await;
    let via = via.to_string();

    let a = cluster_info::check_cluster_access(via.clone()).await.unwrap();
    println!("access via {via}: {}", js(&a));
    assert_eq!(a.state, "ok");
    assert!(a.via_proxy);

    let list = pods::list_pods(via.clone(), n.clone()).await.unwrap();
    assert!(list.iter().any(|p| p.name == "httpd"));
    assert!(pods::get_pod(via.clone(), n.clone(), "httpd".into()).await.unwrap().is_some());
    let logs = pods::get_pod_logs(via.clone(), n.clone(), "logger".into(), "c".into(), Some(3), None, None, None).await.unwrap();
    assert!(logs.contains("line-"), "{logs}");
    let out = pods::exec_pod_command(via.clone(), n.clone(), "httpd".into(), "c".into(), "echo exec-ok".into()).await.unwrap();
    assert!(out.contains("exec-ok"), "{out}");

    // logs stream through the proxy (per-invocation channel, as in logs.rs)
    let got: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = got.clone();
    let ch: Channel<LogStreamEvent> = Channel::new(move |b| {
        if let InvokeResponseBody::Json(s) = b {
            sink.lock().unwrap().push(s);
        }
        Ok(())
    });
    pods::stream_pod_logs(ch, via.clone(), n.clone(), "logger".into(), "c".into(), Some(1), None, None).await.unwrap();
    assert!(eventually(20, || async { got.lock().unwrap().iter().filter(|s| s.contains("\"line\"")).count() >= 2 }).await, "no streamed lines via proxy");

    // port-forward (the app command needs a Tauri State; use the same client + kube call)
    let client = client_for_context(&via).await.unwrap();
    let api: Api<Pod> = Api::namespaced(client, &n);
    let mut pf = api.portforward("httpd", &[8080]).await.unwrap();
    let mut s = pf.take_stream(8080).unwrap();
    s.write_all(b"GET / HTTP/1.0\r\n\r\n").await.unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).await.unwrap();
    assert!(buf.contains("garita-ok"), "{buf}");

    workload_actions::scale_workload(via.clone(), n.clone(), "deploy".into(), "app".into(), 2).await.unwrap();
    ns.wait("jsonpath={.spec.replicas}=2", "deploy/app").await;
    ns.cleanup().await;
}

#[tokio::test]
#[ignore]
async fn through_http_proxy() {
    let Some(ctx) = super::ctx() else { return };
    exercise(&ctx, &format!("{ctx}-http")).await;
}

#[tokio::test]
#[ignore]
async fn through_socks5_proxy() {
    let Some(ctx) = super::ctx() else { return };
    exercise(&ctx, &format!("{ctx}-socks5")).await;
}

#[tokio::test]
#[ignore]
async fn userinfo_context_works_and_is_hidden() {
    let Some(ctx) = super::ctx() else { return };
    let via = format!("{ctx}-userinfo");
    let a = cluster_info::check_cluster_access(via.clone()).await.unwrap();
    assert_eq!(a.state, "ok", "{}", a.message);
    let all = context::list_contexts().await.unwrap();
    let c = all.iter().find(|c| c.name == via).expect("userinfo context");
    let p = c.proxy.clone().expect("proxy shown");
    println!("proxy shown: {p}");
    assert!(!p.contains('@'));
    assert!(!js(&all).to_string().contains('@'), "userinfo leaked in list_contexts");
}

#[tokio::test]
#[ignore]
async fn negative_control_direct_internal_is_unreachable() {
    let Some(ctx) = super::ctx() else { return };
    let a = cluster_info::check_cluster_access(format!("{ctx}-direct")).await.unwrap();
    println!("direct: {}", js(&a));
    assert_eq!(a.state, "unreachable");
    assert!(!a.via_proxy);
}

#[tokio::test]
#[ignore]
async fn dead_proxy_is_unreachable_via_proxy() {
    let Some(ctx) = super::ctx() else { return };
    let a = cluster_info::check_cluster_access(format!("{ctx}-deadproxy")).await.unwrap();
    println!("dead: {}", js(&a));
    assert_eq!(a.state, "unreachable");
    assert!(a.via_proxy);
}

#[tokio::test]
#[ignore]
async fn helm_list_through_http_proxy() {
    let Some(ctx) = super::ctx() else { return };
    // helm_run sets KUBECONFIG; client-go reads proxy-url itself
    let r = crate::commands::helm::list_helm_releases(format!("{ctx}-http")).await;
    assert!(r.is_ok(), "{r:?}");
}
