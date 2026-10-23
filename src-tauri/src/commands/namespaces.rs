use k8s_openapi::api::core::v1::Namespace;
use kube::{api::ListParams, Api};

use super::utils::client_for_context;

#[tauri::command]
pub async fn list_namespaces(context: String) -> Result<Vec<String>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<Namespace> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list namespaces: {}", e))?;
    Ok(list.items.into_iter().filter_map(|ns| ns.metadata.name).collect())
}
