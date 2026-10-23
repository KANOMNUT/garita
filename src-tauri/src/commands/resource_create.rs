use kube::{api::{ApiResource, DynamicObject, PostParams}, Api};
use serde_json;
use serde_yaml;

use super::utils::{client_for_context, kind_to_plural};

#[tauri::command]
pub async fn create_resource_from_yaml(
    context: String,
    yaml: String,
    dry_run: Option<bool>,
) -> Result<String, String> {
    let dry_run = dry_run.unwrap_or(false);

    let value: serde_json::Value = serde_yaml::from_str::<serde_json::Value>(&yaml)
        .map_err(|e| format!("Invalid YAML: {}", e))?;

    let api_version = value["apiVersion"]
        .as_str()
        .unwrap_or("v1")
        .to_string();

    let kind = value["kind"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if kind.is_empty() {
        return Err("Missing required field: kind".to_string());
    }

    let namespace = value["metadata"]["namespace"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let name = value["metadata"]["name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return Err("Missing required field: metadata.name".to_string());
    }

    let (group, version) = if api_version.contains('/') {
        let mut parts = api_version.splitn(2, '/');
        let g = parts.next().unwrap_or("").to_string();
        let v = parts.next().unwrap_or("").to_string();
        (g, v)
    } else {
        ("".to_string(), api_version.clone())
    };

    let plural = kind_to_plural(&kind);

    let ar = ApiResource {
        group,
        version,
        api_version: api_version.clone(),
        kind: kind.clone(),
        plural,
    };

    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let obj: DynamicObject = serde_json::from_value(value.clone())
        .map_err(|e| format!("Invalid resource: {}", e))?;

    let api = if namespace.is_empty() {
        Api::<DynamicObject>::all_with(client, &ar)
    } else {
        Api::<DynamicObject>::namespaced_with(client, &namespace, &ar)
    };

    let pp = PostParams { dry_run, ..Default::default() };
    let created = api
        .create(&pp, &obj)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to create: {}", e));
    if !dry_run {
        crate::app_log::log_write(&context, "create", &kind, &namespace, &name, Some(&value), &created);
    }
    created?;

    if dry_run {
        Ok(format!("{}/{} would be created (dry run)", kind, name))
    } else {
        Ok(format!("{}/{} created", kind, name))
    }
}
