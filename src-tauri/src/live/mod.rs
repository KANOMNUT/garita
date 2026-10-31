//! Live verification harness (v2.1.2 #47, docs/impl/v2.1.2-tasks.md §2.4).
//!
//! Every live test is `#[ignore]` and returns early unless `GARITA_LIVE_CONTEXT` is set, so
//! `cargo test --lib` never touches a cluster. Run it with `scripts/live/run.sh` / `make live`.
//!
//! Safety (T51-6): the context must start with `kind-` or `k3d-` (or `GARITA_LIVE_ALLOW_ANY=1`);
//! writes go only into `garita-live-<random>` namespaces created here and deleted at the end.
//! Config (T51-5): `CONFIG_DIR` is never set under test, so only `$KUBECONFIG` is read.

mod access;
mod crds;
mod health;
mod logs;
mod preview;
mod rbac;
mod workloads;
mod proxy;

use k8s_openapi::api::core::v1::Namespace;
use kube::api::{DeleteParams, ObjectMeta, PostParams};
use kube::Api;
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::io::AsyncWriteExt;

use crate::commands::utils::client_for_context;

/// Fixture text from `scripts/live/fixtures/`.
macro_rules! fixture {
    ($f:expr) => {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/live/fixtures/", $f))
    };
}
pub(crate) use fixture;

/// T51-6 gate as a pure function.
fn context_allowed(ctx: &str, allow_any: bool) -> bool {
    allow_any || ctx.starts_with("kind-") || ctx.starts_with("k3d-")
}

/// The context to test, or `None` (test returns early). Panics when the gate refuses.
pub(crate) fn ctx() -> Option<String> {
    let c = std::env::var("GARITA_LIVE_CONTEXT").ok().filter(|c| !c.is_empty())?;
    let any = std::env::var("GARITA_LIVE_ALLOW_ANY").is_ok_and(|v| v == "1");
    assert!(
        context_allowed(&c, any),
        "refusing context {c:?}: must start with kind- or k3d- (or set GARITA_LIVE_ALLOW_ANY=1)"
    );
    // Each #[tokio::test] has its own runtime; a cached client's buffer worker dies with the
    // previous test's runtime ("Service(Closed)"). The app has one runtime, so only tests need this.
    crate::commands::utils::invalidate_client_cache();
    Some(c)
}

static SEQ: AtomicU32 = AtomicU32::new(0);

fn ns_name() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("garita-live-{:06x}", (t ^ (std::process::id() << 8) ^ (SEQ.fetch_add(1, Ordering::Relaxed) * 7919)) & 0xff_ffff)
}

/// Run `kubectl --context <ctx> <args>`; stdin optional. `Err` carries stdout+stderr.
pub(crate) async fn kubectl(ctx: &str, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
    run("kubectl", &[&["--context", ctx], args].concat(), stdin).await
}

/// Run `helm --kube-context <ctx> <args>`.
pub(crate) async fn helm(ctx: &str, args: &[&str]) -> Result<String, String> {
    run("helm", &[&["--kube-context", ctx], args].concat(), None).await
}

async fn run(bin: &str, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .stdin(if stdin.is_some() { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("{bin}: {e}"))?;
    if let (Some(text), Some(mut si)) = (stdin, child.stdin.take()) {
        si.write_all(text.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() { Ok(text) } else { Err(text) }
}

/// A namespace this harness created. Call `cleanup()` at the end of the test (a panic leaks it
/// until the kind cluster is deleted, which is the only place the harness runs).
pub(crate) struct Ns {
    pub ctx: String,
    pub name: String,
}

impl Ns {
    pub async fn create(ctx: &str) -> Ns {
        let client = client_for_context(ctx).await.expect("connect");
        let name = ns_name();
        let api: Api<Namespace> = Api::all(client);
        let ns = Namespace {
            metadata: ObjectMeta {
                name: Some(name.clone()),
                labels: Some([("garita-live".to_string(), "1".to_string())].into()),
                ..Default::default()
            },
            ..Default::default()
        };
        api.create(&PostParams::default(), &ns).await.expect("create namespace");
        Ns { ctx: ctx.to_string(), name }
    }

    /// `kubectl apply` a fixture (`__NS__` is replaced by the namespace name).
    pub async fn apply(&self, yaml: &str) {
        let y = yaml.replace("__NS__", &self.name);
        kubectl(&self.ctx, &["-n", &self.name, "apply", "-f", "-"], Some(&y))
            .await
            .unwrap_or_else(|e| panic!("apply failed: {e}"));
    }

    pub async fn kubectl(&self, args: &[&str]) -> Result<String, String> {
        kubectl(&self.ctx, &[&["-n", &self.name], args].concat(), None).await
    }

    /// `kubectl wait` (`what` e.g. `deploy/web`, `cond` e.g. `condition=Available`).
    pub async fn wait(&self, cond: &str, what: &str) {
        let c = format!("--for={cond}");
        self.kubectl(&["wait", &c, what, "--timeout=180s"])
            .await
            .unwrap_or_else(|e| panic!("wait {cond} {what}: {e}"));
    }

    pub async fn cleanup(self) {
        if let Ok(client) = client_for_context(&self.ctx).await {
            let api: Api<Namespace> = Api::all(client);
            let _ = api.delete(&self.name, &DeleteParams::background()).await;
        }
    }
}

/// Poll `f` every second for up to `secs`; true when it returned true.
pub(crate) async fn eventually<F, Fut>(secs: u64, mut f: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for _ in 0..secs {
        if f().await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    false
}

/// Any serialisable command result as JSON, for shape-light assertions.
pub(crate) fn js<T: serde::Serialize>(v: &T) -> serde_json::Value {
    serde_json::to_value(v).expect("serialise")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_accepts_only_throwaway_contexts() {
        assert!(context_allowed("kind-garita-live", false));
        assert!(context_allowed("k3d-x", false));
        assert!(!context_allowed("prod-eks", false));
        assert!(!context_allowed("minikube", false));
        assert!(context_allowed("minikube", true));
    }

    #[test]
    fn namespaces_are_owned_and_distinct() {
        let (a, b) = (ns_name(), ns_name());
        assert!(a.starts_with("garita-live-") && a != b);
    }
}
