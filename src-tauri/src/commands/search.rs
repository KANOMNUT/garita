use futures::future::join_all;
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{ConfigMap, Pod, Secret, Service};
use k8s_openapi::api::networking::v1::Ingress;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};

use super::utils::client_for_context;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
    pub resource_type: String,
}

/// Search a single typed resource, returning matched results or empty on error.
async fn search_one<T>(
    api: Api<T>,
    query: &str,
    kind: &str,
    resource_type: &str,
) -> Vec<SearchResult>
where
    T: kube::Resource + for<'de> serde::Deserialize<'de> + Clone + std::fmt::Debug,
    T::DynamicType: Default,
{
    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };
    let q = query.to_lowercase();
    list.items
        .into_iter()
        .filter_map(|obj| {
            let meta = obj.meta();
            let name = meta.name.clone().unwrap_or_default();
            if name.to_lowercase().contains(&q) {
                Some(SearchResult {
                    kind: kind.to_string(),
                    name,
                    namespace: meta.namespace.clone(),
                    resource_type: resource_type.to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
pub async fn search_resources(
    context: String,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    if query.len() < 2 {
        return Ok(Vec::new());
    }

    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let q = query.clone();

    let futures: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = Vec<SearchResult>> + Send>>> = vec![
        Box::pin(search_one::<Pod>(Api::all(client.clone()), &q, "Pod", "pods")),
        Box::pin(search_one::<Deployment>(Api::all(client.clone()), &q, "Deployment", "deploy")),
        Box::pin(search_one::<StatefulSet>(Api::all(client.clone()), &q, "StatefulSet", "sts")),
        Box::pin(search_one::<DaemonSet>(Api::all(client.clone()), &q, "DaemonSet", "ds")),
        Box::pin(search_one::<Job>(Api::all(client.clone()), &q, "Job", "jobs")),
        Box::pin(search_one::<CronJob>(Api::all(client.clone()), &q, "CronJob", "cron")),
        Box::pin(search_one::<Service>(Api::all(client.clone()), &q, "Service", "svc")),
        Box::pin(search_one::<ConfigMap>(Api::all(client.clone()), &q, "ConfigMap", "cm")),
        Box::pin(search_one::<Secret>(Api::all(client.clone()), &q, "Secret", "sec")),
        Box::pin(search_one::<Ingress>(Api::all(client.clone()), &q, "Ingress", "ing")),
    ];

    let results_nested = join_all(futures).await;
    let mut results: Vec<SearchResult> = results_nested.into_iter().flatten().collect();
    results.truncate(50);

    Ok(results)
}
