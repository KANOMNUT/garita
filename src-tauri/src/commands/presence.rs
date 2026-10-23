use futures::future::join_all;
use kube::{discovery, error::DiscoveryError, Client, Error as KubeError};
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiPresence {
    pub key: String,
    pub group: String,
    pub state: String, // "installed" | "absent" | "unknown"
    pub version: Option<String>,
    pub message: String, // "" unless state == "unknown" (verbatim discovery error)
}

/// `(key, group, resource that must be served)`; a closed set mirrored in the v1.4.0 brief §2.2.
const PROBES: &[(&str, &str, &str)] = &[
    ("flux-ks", "kustomize.toolkit.fluxcd.io", "kustomizations"),
    ("flux-hr", "helm.toolkit.fluxcd.io", "helmreleases"),
    ("gw", "gateway.networking.k8s.io", "gateways"),
    ("httproute", "gateway.networking.k8s.io", "httproutes"),
    ("cert", "cert-manager.io", "certificates"),
    ("vs", "snapshot.storage.k8s.io", "volumesnapshots"),
    ("argocd", "argoproj.io", "applications"),
    ("argo-appsets", "argoproj.io", "applicationsets"),
    ("argo-projects", "argoproj.io", "appprojects"),
    ("metrics", "metrics.k8s.io", "nodes"),
];

/// Outcome of one `discovery::group` call, reduced to what the state decision needs.
enum GroupLookup {
    Missing,
    /// `(version, served plural names)`, preferred version first.
    Served(Vec<(String, Vec<String>)>),
    Failed(String),
}

fn lookup_from(r: Result<discovery::ApiGroup, KubeError>) -> GroupLookup {
    match r {
        Ok(g) => {
            let preferred = g.preferred_version_or_latest().to_string();
            let mut versions: Vec<String> = g.versions().map(str::to_string).collect();
            versions.sort_by_key(|v| *v != preferred); // stable: preferred first
            GroupLookup::Served(
                versions
                    .into_iter()
                    .map(|v| {
                        let plurals = g
                            .versioned_resources(&v)
                            .into_iter()
                            .map(|(ar, _)| ar.plural)
                            .collect();
                        (v, plurals)
                    })
                    .collect(),
            )
        }
        Err(KubeError::Discovery(DiscoveryError::MissingApiGroup(_))) => GroupLookup::Missing,
        Err(e) => GroupLookup::Failed(e.to_string()),
    }
}

/// `(state, version)` for one resource in a group lookup.
fn presence_state(l: &GroupLookup, resource: &str) -> (&'static str, Option<String>) {
    match l {
        GroupLookup::Missing => ("absent", None),
        GroupLookup::Failed(_) => ("unknown", None),
        GroupLookup::Served(vs) => match vs.iter().find(|(_, rs)| rs.iter().any(|r| r == resource)) {
            Some((v, _)) => ("installed", Some(v.clone())),
            None => ("absent", None),
        },
    }
}

#[tauri::command]
pub async fn list_api_presence(context: String) -> Result<Vec<ApiPresence>, String> {
    let client: Client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let mut groups: Vec<&str> = PROBES.iter().map(|p| p.1).collect();
    groups.dedup(); // PROBES keeps same-group rows adjacent
    let lookups = join_all(groups.iter().map(|g| {
        let client = client.clone();
        async move { lookup_from(discovery::group(&client, g).await) }
    }))
    .await;

    Ok(PROBES
        .iter()
        .filter_map(|(key, group, resource)| {
            let l = groups.iter().position(|g| g == group).and_then(|i| lookups.get(i))?;
            let (state, version) = presence_state(l, resource);
            Some(ApiPresence {
                key: key.to_string(),
                group: group.to_string(),
                state: state.to_string(),
                version,
                message: match l {
                    GroupLookup::Failed(m) => m.clone(),
                    _ => String::new(),
                },
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served() -> GroupLookup {
        GroupLookup::Served(vec![
            ("v1".into(), vec!["certificates".into()]),
            ("v1beta1".into(), vec!["certificates".into(), "legacy".into()]),
        ])
    }

    #[test]
    fn missing_group_is_absent() {
        assert_eq!(presence_state(&GroupLookup::Missing, "certificates"), ("absent", None));
    }

    #[test]
    fn group_without_the_resource_is_absent() {
        assert_eq!(presence_state(&served(), "issuers"), ("absent", None));
    }

    #[test]
    fn group_with_the_resource_is_installed_at_first_serving_version() {
        assert_eq!(presence_state(&served(), "certificates"), ("installed", Some("v1".to_string())));
        assert_eq!(presence_state(&served(), "legacy"), ("installed", Some("v1beta1".to_string())));
    }

    #[test]
    fn other_discovery_error_is_unknown() {
        assert_eq!(presence_state(&GroupLookup::Failed("403 forbidden".into()), "x"), ("unknown", None));
    }

    #[test]
    fn probes_keep_same_group_rows_adjacent() {
        let mut seen: Vec<&str> = Vec::new();
        for (_, g, _) in PROBES {
            if seen.last() != Some(g) {
                assert!(!seen.contains(g), "group {g} split across non-adjacent rows");
                seen.push(g);
            }
        }
    }
}
