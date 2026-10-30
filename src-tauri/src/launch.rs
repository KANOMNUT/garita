//! Command-line launcher grammar (#55). Pure: no I/O, never panics on any argv.
//! `[--context <ctx>|--context=<ctx>] [-n|--namespace <ns>|--namespace=<ns>] [<kind>]`,
//! `-h/--help`, `-V/--version`. Args are DATA ONLY: they never reach a subprocess or shell.

use serde::{Deserialize, Serialize};

pub const CLI_COMMAND_NAME: &str = "garita";
use crate::commands::utils::PRODUCT_NAME;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct LaunchArgs {
    pub context: Option<String>,
    pub namespace: Option<String>,
    /// A frontend `ResourceType` string; `None` if absent or unrecognised.
    pub kind: Option<String>,
    /// Tokens that were not understood, for the UI strip.
    pub ignored: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LaunchAction {
    Run(LaunchArgs),
    PrintHelp,
    PrintVersion,
}

pub fn help_text() -> String {
    let (p, n) = (PRODUCT_NAME, CLI_COMMAND_NAME);
    format!(
        "{p} {v}: Kubernetes desktop client

Usage:
  {n} [options] [kind]

Options:
  --context <name>         Open with this kubeconfig context selected
  -n, --namespace <name>   Open with this namespace selected
  -h, --help               Show this help and exit
  -V, --version            Show the version and exit

Kind:
  A resource type to open, such as pods, deployments or services.
  kubectl short names work: {short}.

Examples:
  {n} --context prod -n kube-system pods
  {n} deploy

Running {n} while {p} is open brings that window to the front and applies these options.
",
        v = env!("CARGO_PKG_VERSION"),
        short = HELP_SHORT_NAMES.join(", "),
    )
}

/// Short names printed in `--help`; a test checks each resolves in `normalize_kind`.
pub const HELP_SHORT_NAMES: [&str; 8] = ["po", "deploy", "svc", "ing", "cm", "secret", "no", "ns"];

/// Cap untrusted echoed text at 64 chars with a `...` suffix.
fn cap(s: &str) -> String {
    if s.chars().count() <= 64 {
        s.to_string()
    } else {
        s.chars().take(64).chain("...".chars()).collect()
    }
}

/// RFC 1123 label: `^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$` (hand-written, no regex crate).
pub fn valid_namespace(s: &str) -> bool {
    let b = s.as_bytes();
    let ok = |c: &u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    match (b.first(), b.last()) {
        (Some(f), Some(l)) => b.len() <= 63 && ok(f) && ok(l) && b.iter().all(|c| ok(c) || *c == b'-'),
        _ => false,
    }
}

/// stderr line for one `ignored` token (printed by the launching process on a terminal).
pub fn ignored_warning(token: &str) -> String {
    let n = CLI_COMMAND_NAME;
    let value_flag = matches!(token, "-n" | "--namespace" | "--context")
        || matches!(token, "-n=" | "--namespace=" | "--context=");
    let bad_ns = ["-n ", "-n=", "--namespace ", "--namespace="]
        .iter()
        .find_map(|p| token.strip_prefix(p).filter(|v| !v.is_empty()));
    if let (false, Some(v)) = (value_flag, bad_ns) {
        format!("{n}: ignoring invalid namespace '{v}'")
    } else if value_flag {
        format!("{n}: option '{token}' needs a value (ignored)")
    } else if token.starts_with('-') {
        format!("{n}: ignoring unknown option '{token}' (see {n} --help)")
    } else {
        format!("{n}: ignoring unknown resource type '{token}' (see {n} --help)")
    }
}

/// Process argv, lossy on non-UTF-8 (`std::env::args()` would panic).
pub fn os_argv() -> Vec<String> {
    std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect()
}

pub fn version_text() -> String {
    format!("{} {}\n", PRODUCT_NAME, env!("CARGO_PKG_VERSION"))
}

/// Kind token (case-insensitive) -> frontend `ResourceType` string (`src/types/k8s.ts`).
/// `crd-instances` needs a CRD, so it stays unmapped.
pub fn normalize_kind(token: &str) -> Option<&'static str> {
    Some(match token.to_ascii_lowercase().as_str() {
        "po" | "pod" | "pods" => "pods",
        "deploy" | "deployment" | "deployments" => "deploy",
        "sts" | "statefulset" | "statefulsets" => "sts",
        "ds" | "daemonset" | "daemonsets" => "ds",
        "cron" | "cronjob" | "cronjobs" => "cron",
        "jobs" | "job" => "jobs",
        "hpa" | "horizontalpodautoscaler" | "horizontalpodautoscalers" => "hpa",
        "pdb" | "poddisruptionbudget" | "poddisruptionbudgets" => "pdb",
        "rs" | "replicaset" | "replicasets" => "rs",
        "svc" | "service" | "services" => "svc",
        "ing" | "ingress" | "ingresses" => "ing",
        "netpol" | "networkpolicy" | "networkpolicies" => "netpol",
        "gw" | "gateway" | "gateways" => "gw",
        "httproute" | "httproutes" => "httproute",
        "ep" | "endpoints" => "ep",
        "eps" | "endpointslice" | "endpointslices" => "eps",
        "cm" | "configmap" | "configmaps" => "cm",
        "sec" | "secret" | "secrets" => "sec",
        "pv" | "persistentvolume" | "persistentvolumes" => "pv",
        "pvc" | "persistentvolumeclaim" | "persistentvolumeclaims" => "pvc",
        "sc" | "storageclass" | "storageclasses" => "sc",
        "cert" | "certs" | "certificate" | "certificates" => "cert",
        "rq" | "quota" | "resourcequota" | "resourcequotas" => "rq",
        "lr" | "limitrange" | "limitranges" => "lr",
        "vs" | "volumesnapshot" | "volumesnapshots" => "vs",
        "no" | "node" | "nodes" => "nodes",
        "ns" | "namespace" | "namespaces" => "ns",
        "ev" | "event" | "events" => "events",
        "crd" | "crds" | "customresourcedefinition" | "customresourcedefinitions" => "crd",
        "pc" | "priorityclass" | "priorityclasses" => "pc",
        "mwc" | "mutatingwebhookconfiguration" | "mutatingwebhookconfigurations" => "mwc",
        "vwc" | "validatingwebhookconfiguration" | "validatingwebhookconfigurations" => "vwc",
        "sa" | "serviceaccount" | "serviceaccounts" => "sa",
        "role" | "roles" => "roles",
        "croles" | "clusterrole" | "clusterroles" => "croles",
        "rbindings" | "rolebinding" | "rolebindings" => "rbindings",
        "crbindings" | "clusterrolebinding" | "clusterrolebindings" => "crbindings",
        "helm" => "helm",
        "argocd" => "argocd",
        "flux-ks" | "ks" | "kustomization" | "kustomizations" => "flux-ks",
        "flux-hr" | "hr" | "helmrelease" | "helmreleases" => "flux-hr",
        "argo-appsets" | "appset" | "appsets" | "applicationset" | "applicationsets" => {
            "argo-appsets"
        }
        "argo-projects" | "appproject" | "appprojects" => "argo-projects",
        "argo-repos" => "argo-repos",
        _ => return None,
    })
}

/// `argv[0]` is skipped. `--help` beats `--version` regardless of order.
pub fn parse_launch_args(argv: &[String]) -> LaunchAction {
    let mut out = LaunchArgs::default();
    let (mut help, mut version) = (false, false);
    let mut kind_seen = false;
    let mut it = argv.iter().skip(1);
    let mut next: Option<&String> = it.next();

    while let Some(arg) = next {
        next = it.next();
        let a = arg.as_str();
        match a {
            "-h" | "--help" => help = true,
            "-V" | "--version" => version = true,
            _ if a.starts_with("-psn_") => {} // macOS Finder launch
            "--context" | "-n" | "--namespace" => {
                // A value is the next token unless it is empty or looks like a flag.
                match next.filter(|v| !v.starts_with('-') && !v.is_empty()) {
                    Some(v) => {
                        if a == "--context" {
                            out.context = Some(v.clone());
                        } else if valid_namespace(v) {
                            out.namespace = Some(v.clone());
                        } else {
                            out.ignored.push(format!("{a} {}", cap(v)));
                        }
                        next = it.next();
                    }
                    None => out.ignored.push(cap(a)),
                }
            }
            _ => {
                if let Some(v) = a.strip_prefix("--context=") {
                    set_or_ignore(&mut out.context, v, arg, &mut out.ignored);
                } else if let Some(v) = a
                    .strip_prefix("--namespace=")
                    .or_else(|| a.strip_prefix("-n="))
                {
                    if v.is_empty() || valid_namespace(v) {
                        set_or_ignore(&mut out.namespace, v, arg, &mut out.ignored);
                    } else {
                        let flag = if a.starts_with("--") { "--namespace" } else { "-n" };
                        out.ignored.push(format!("{flag}={}", cap(v)));
                    }
                } else if a.starts_with('-') {
                    out.ignored.push(cap(a)); // includes `-nfoo`
                } else if !kind_seen {
                    kind_seen = true;
                    match normalize_kind(a) {
                        Some(k) => out.kind = Some(k.to_string()),
                        None => out.ignored.push(cap(a)),
                    }
                } else {
                    out.ignored.push(cap(a));
                }
            }
        }
    }

    if help {
        LaunchAction::PrintHelp
    } else if version {
        LaunchAction::PrintVersion
    } else {
        LaunchAction::Run(out)
    }
}

fn set_or_ignore(slot: &mut Option<String>, v: &str, raw: &str, ignored: &mut Vec<String>) {
    if v.is_empty() {
        ignored.push(cap(raw));
    } else {
        *slot = Some(v.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> LaunchAction {
        let mut v = vec!["garita".to_string()];
        v.extend(args.iter().map(|s| s.to_string()));
        parse_launch_args(&v)
    }
    fn run(args: &[&str]) -> LaunchArgs {
        match p(args) {
            LaunchAction::Run(a) => a,
            other => panic!("expected Run, got {:?}", other),
        }
    }

    #[test]
    fn empty_and_bare_argv() {
        assert_eq!(parse_launch_args(&[]), LaunchAction::Run(LaunchArgs::default()));
        assert_eq!(run(&[]), LaunchArgs::default());
    }

    #[test]
    fn context_both_forms() {
        assert_eq!(run(&["--context", "prod"]).context.as_deref(), Some("prod"));
        assert_eq!(run(&["--context=prod"]).context.as_deref(), Some("prod"));
    }

    #[test]
    fn namespace_all_forms() {
        for a in [
            &["-n", "kube-system"][..],
            &["--namespace", "kube-system"],
            &["--namespace=kube-system"],
            &["-n=kube-system"],
        ] {
            assert_eq!(run(a).namespace.as_deref(), Some("kube-system"), "{:?}", a);
        }
    }

    #[test]
    fn nfoo_ignored_and_n_equals_accepted() {
        assert_eq!(run(&["-n=ns1"]).namespace.as_deref(), Some("ns1"));
        let a = run(&["-nfoo"]);
        assert_eq!((a.namespace, a.ignored), (None, vec!["-nfoo".to_string()]));
    }

    #[test]
    fn help_names_resolve_and_caps() {
        for n in HELP_SHORT_NAMES {
            assert!(normalize_kind(n).is_some(), "{}", n);
            assert!(help_text().contains(n));
        }
        let long = "x".repeat(200);
        let a = run(&[&long]);
        assert_eq!(a.ignored[0].chars().count(), 67);
        assert!(a.ignored[0].ends_with("..."));
        assert!(ignored_warning("-n").contains("needs a value"));
        assert!(ignored_warning("--foo").contains("unknown option"));
        assert!(ignored_warning("pdos").contains("unknown resource type"));
        assert_eq!(p(&["--foo", "--version", "--help"]), LaunchAction::PrintHelp);
    }

    #[test]
    fn lone_and_empty_values_ignored() {
        let a = run(&["-n"]);
        assert_eq!((a.namespace, a.ignored), (None, vec!["-n".to_string()]));
        let a = run(&["--context"]);
        assert_eq!((a.context, a.ignored), (None, vec!["--context".to_string()]));
        assert_eq!(run(&["--context="]).ignored, vec!["--context=".to_string()]);
        // a value that looks like a flag is not consumed
        let a = run(&["--context", "-n", "x"]);
        assert_eq!(a.context, None);
        assert_eq!(a.namespace.as_deref(), Some("x"));
        assert_eq!(a.ignored, vec!["--context".to_string()]);
    }

    #[test]
    fn unknown_flags_and_extra_positionals_ignored() {
        let a = run(&["--foo", "po", "extra", "-x"]);
        assert_eq!(a.kind.as_deref(), Some("pods"));
        assert_eq!(a.ignored, vec!["--foo", "extra", "-x"]);
    }

    #[test]
    fn unknown_kind_ignored_and_consumes_positional() {
        let a = run(&["bogus", "po"]);
        assert_eq!(a.kind, None);
        assert_eq!(a.ignored, vec!["bogus", "po"]);
        // `crd-instances` needs a CRD, so it has no token.
        assert_eq!(run(&["crd-instances"]).kind, None);
    }

    #[test]
    fn kubectl_short_names() {
        for (t, k) in [
            ("po", "pods"),
            ("deploy", "deploy"),
            ("svc", "svc"),
            ("ing", "ing"),
            ("cm", "cm"),
            ("secret", "sec"),
            ("secrets", "sec"),
            ("no", "nodes"),
            ("ns", "ns"),
            ("namespace", "ns"),
            ("namespaces", "ns"),
            ("NS", "ns"),
            ("Namespaces", "ns"),
            ("Pods", "pods"),
            ("sts", "sts"),
            ("pvc", "pvc"),
            ("kustomization", "flux-ks"),
            ("appset", "argo-appsets"),
        ] {
            assert_eq!(run(&[t]).kind.as_deref(), Some(k), "{}", t);
        }
    }

    #[test]
    fn namespace_tokens_open_the_namespaces_page() {
        let a = run(&["ns"]);
        assert_eq!((a.kind.as_deref(), a.ignored.is_empty()), (Some("ns"), true));
        // `-n` stays a separate namespace value; the token `ns` is only ever the kind.
        let a = run(&["--context=c", "-n", "kube-system", "namespaces"]);
        assert_eq!(a.kind.as_deref(), Some("ns"));
        assert_eq!(a.namespace.as_deref(), Some("kube-system"));
        assert!(a.ignored.is_empty());
        // A second kind token is still ignored; the first one wins.
        let a = run(&["ns", "po"]);
        assert_eq!((a.kind.as_deref(), a.ignored), (Some("ns"), vec!["po".to_string()]));
        // As the value of `-n`, `ns` is a namespace name, not a kind.
        let a = run(&["-n", "ns"]);
        assert_eq!((a.namespace.as_deref(), a.kind), (Some("ns"), None));
        assert!(help_text().contains("no, ns."));
    }

    #[test]
    fn full_line() {
        assert_eq!(
            run(&["--context=c", "-n", "ns1", "deploy"]),
            LaunchArgs {
                context: Some("c".into()),
                namespace: Some("ns1".into()),
                kind: Some("deploy".into()),
                ignored: vec![],
            }
        );
    }

    #[test]
    fn help_version_and_precedence() {
        assert_eq!(p(&["--help"]), LaunchAction::PrintHelp);
        assert_eq!(p(&["-h"]), LaunchAction::PrintHelp);
        assert_eq!(p(&["--version"]), LaunchAction::PrintVersion);
        assert_eq!(p(&["-V"]), LaunchAction::PrintVersion);
        assert_eq!(p(&["--version", "--help"]), LaunchAction::PrintHelp);
        assert_eq!(p(&["--help", "--version"]), LaunchAction::PrintHelp);
        assert_eq!(p(&["--context", "x", "-V"]), LaunchAction::PrintVersion);
    }

    #[test]
    fn invalid_namespace_ignored() {
        for a in [&["-n", "Bad_NS"][..], &["--namespace", "UPPER"], &["-n=-x"], &["--namespace=a.b"]] {
            let r = run(a);
            assert_eq!(r.namespace, None, "{:?}", a);
            assert_eq!(r.ignored.len(), 1, "{:?}", a);
        }
        assert_eq!(run(&["-n", "Bad_NS"]).ignored, vec!["-n Bad_NS"]);
        assert_eq!(run(&["--namespace=a.b"]).ignored, vec!["--namespace=a.b"]);
        assert_eq!(ignored_warning("-n Bad_NS"), "garita: ignoring invalid namespace 'Bad_NS'");
        assert_eq!(ignored_warning("--namespace=a.b"), "garita: ignoring invalid namespace 'a.b'");
        assert!(ignored_warning("-n=").contains("needs a value"));
        assert!(valid_namespace("a") && valid_namespace("kube-system") && valid_namespace(&"a".repeat(63)));
        assert!(!valid_namespace("") && !valid_namespace("-a") && !valid_namespace("a-"));
        assert!(!valid_namespace(&"a".repeat(64)) && !valid_namespace("Aa") && !valid_namespace("a_b"));
    }

    #[test]
    fn macos_psn_dropped_silently() {
        assert_eq!(run(&["-psn_0_12345"]), LaunchArgs::default());
    }

    #[test]
    fn hostile_input_no_panic() {
        for a in ["", "-", "--", "-n=", "=", "--context=\u{0}", "é", "-nü"] {
            let _ = p(&[a]);
        }
    }
}
