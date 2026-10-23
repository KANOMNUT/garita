use k8s_openapi::api::core::v1::{
    ConfigMap as K8sCm, PersistentVolume as K8sPV, PersistentVolumeClaim as K8sPVC,
    Secret as K8sSecret,
};
use k8s_openapi::api::storage::v1::StorageClass as K8sStorageClass;
use kube::{api::{ApiResource, DynamicObject, ListParams}, Api};
use serde::{Deserialize, Serialize};
use k8s_openapi::ByteString;
use std::collections::{BTreeMap, HashMap};

use super::utils::{age_from_timestamp, client_for_context, namespaced_or_all};

// ─── ConfigMap ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfigMap {
    pub name: String,
    pub namespace: String,
    pub data_count: usize,
    pub data: HashMap<String, String>,
    pub age: String,
}

#[tauri::command]
pub async fn list_configmaps(context: String, namespace: String) -> Result<Vec<ConfigMap>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sCm> = namespaced_or_all!(client, K8sCm, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list configmaps: {}", e))?;
    Ok(list.items.into_iter().map(|cm| {
        let data: HashMap<String, String> = cm.data.unwrap_or_default().into_iter().collect();
        let binary_count = cm.binary_data.as_ref().map(|d| d.len()).unwrap_or(0);
        ConfigMap {
            name: cm.metadata.name.unwrap_or_default(),
            namespace: cm.metadata.namespace.unwrap_or_default(),
            data_count: data.len() + binary_count,
            data,
            age: age_from_timestamp(cm.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── Secret ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Secret {
    pub name: String,
    pub namespace: String,
    pub type_: String,
    pub data_count: usize,
    pub keys: Vec<String>,
    pub sizes: BTreeMap<String, u64>,
    pub age: String,
}

#[tauri::command]
pub async fn list_secrets(context: String, namespace: String) -> Result<Vec<Secret>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sSecret> = namespaced_or_all!(client, K8sSecret, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list secrets: {}", e))?;
    Ok(list.items.into_iter().map(|s| {
        let sizes = secret_sizes(s.data.as_ref());
        Secret {
            name: s.metadata.name.unwrap_or_default(),
            namespace: s.metadata.namespace.unwrap_or_default(),
            type_: s.type_.unwrap_or_else(|| "Opaque".to_string()),
            data_count: sizes.len(),
            keys: sizes.keys().cloned().collect(),
            sizes,
            age: age_from_timestamp(s.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

/// Decoded byte length per key. Values never leave the backend; `BTreeMap` keeps keys sorted.
fn secret_sizes(data: Option<&BTreeMap<String, ByteString>>) -> BTreeMap<String, u64> {
    data.map(|d| d.iter().map(|(k, v)| (k.clone(), v.0.len() as u64)).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_decoded_lengths_sorted_with_empty_zero() {
        let d = BTreeMap::from([
            ("b".to_string(), ByteString(b"hello".to_vec())),
            ("a".to_string(), ByteString(vec![])),
        ]);
        let s = secret_sizes(Some(&d));
        assert_eq!(s.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(), vec![("a", 0), ("b", 5)]);
        assert!(secret_sizes(None).is_empty());
    }
}

// ─── PersistentVolumeClaim ────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PersistentVolumeClaim {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub volume: String,
    pub capacity: String,
    pub access_modes: String,
    pub storage_class: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_pvcs(context: String, namespace: String) -> Result<Vec<PersistentVolumeClaim>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPVC> = namespaced_or_all!(client, K8sPVC, namespace);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list PVCs: {}", e))?;
    Ok(list.items.into_iter().map(|pvc| {
        let phase = pvc.status.as_ref().and_then(|s| s.phase.as_deref()).unwrap_or("Unknown").to_string();
        let volume = pvc.spec.as_ref().and_then(|s| s.volume_name.as_deref()).unwrap_or("").to_string();
        let capacity = pvc.status.as_ref()
            .and_then(|s| s.capacity.as_ref())
            .and_then(|c| c.get("storage"))
            .map(|q| q.0.clone())
            .unwrap_or_else(|| "—".to_string());
        let access_modes = pvc.spec.as_ref()
            .and_then(|s| s.access_modes.as_ref())
            .map(|modes| modes.join(", "))
            .unwrap_or_default();
        let storage_class = pvc.spec.as_ref()
            .and_then(|s| s.storage_class_name.as_deref())
            .unwrap_or("—")
            .to_string();
        PersistentVolumeClaim {
            name: pvc.metadata.name.unwrap_or_default(),
            namespace: pvc.metadata.namespace.unwrap_or_default(),
            status: phase,
            volume,
            capacity,
            access_modes,
            storage_class,
            age: age_from_timestamp(pvc.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── StorageClass ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorageClassRow {
    pub name: String,
    pub provisioner: String,
    pub reclaim_policy: String,
    pub volume_binding_mode: String,
    pub allow_volume_expansion: bool,
    pub is_default: bool,
    pub age: String,
}

#[tauri::command]
pub async fn list_storage_classes(context: String) -> Result<Vec<StorageClassRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sStorageClass> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list StorageClasses: {}", e))?;
    Ok(list.items.into_iter().map(|sc| {
        let is_default = sc.metadata.annotations.as_ref()
            .and_then(|a| a.get("storageclass.kubernetes.io/is-default-class"))
            .map(|v| v == "true")
            .unwrap_or(false);
        StorageClassRow {
            name: sc.metadata.name.unwrap_or_default(),
            provisioner: sc.provisioner.clone(),
            reclaim_policy: sc.reclaim_policy.as_deref().unwrap_or("Delete").to_string(),
            volume_binding_mode: sc.volume_binding_mode.as_deref().unwrap_or("Immediate").to_string(),
            allow_volume_expansion: sc.allow_volume_expansion.unwrap_or(false),
            is_default,
            age: age_from_timestamp(sc.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── PersistentVolume ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PersistentVolume {
    pub name: String,
    pub capacity: String,
    pub access_modes: String,
    pub reclaim_policy: String,
    pub status: String,
    pub claim: String,
    pub storage_class: String,
    pub age: String,
}

#[tauri::command]
pub async fn list_pvs(context: String) -> Result<Vec<PersistentVolume>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPV> = Api::all(client);
    let list = api.list(&ListParams::default()).await
        .map_err(|e| format!("Failed to list PVs: {}", e))?;
    Ok(list.items.into_iter().map(|pv| {
        let spec = pv.spec.as_ref();
        let capacity = spec.and_then(|s| s.capacity.as_ref())
            .and_then(|c| c.get("storage"))
            .map(|q| q.0.clone())
            .unwrap_or_else(|| "—".to_string());
        let access_modes = spec.and_then(|s| s.access_modes.as_ref())
            .map(|m| m.join(", "))
            .unwrap_or_default();
        let reclaim_policy = spec.and_then(|s| s.persistent_volume_reclaim_policy.as_deref())
            .unwrap_or("—")
            .to_string();
        let claim = spec.and_then(|s| s.claim_ref.as_ref())
            .map(|cr| format!("{}/{}", cr.namespace.as_deref().unwrap_or(""), cr.name.as_deref().unwrap_or("")))
            .unwrap_or_default();
        let storage_class = spec.and_then(|s| s.storage_class_name.as_deref())
            .unwrap_or("—")
            .to_string();
        let status = pv.status.as_ref().and_then(|s| s.phase.as_deref()).unwrap_or("Unknown").to_string();
        PersistentVolume {
            name: pv.metadata.name.unwrap_or_default(),
            capacity,
            access_modes,
            reclaim_policy,
            status,
            claim,
            storage_class,
            age: age_from_timestamp(pv.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}

// ─── VolumeSnapshot (CSI snapshot CRD) ────────────────────────────────────────
// The `snapshot.storage.k8s.io` CRDs are frequently absent (no CSI snapshot controller
// installed) — graceful-empty pattern copied verbatim from flux.rs / gateway.rs.

fn volumesnapshot_api_resource() -> ApiResource {
    ApiResource {
        group: "snapshot.storage.k8s.io".to_string(),
        version: "v1".to_string(),
        api_version: "snapshot.storage.k8s.io/v1".to_string(),
        kind: "VolumeSnapshot".to_string(),
        plural: "volumesnapshots".to_string(),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VolumeSnapshotRow {
    pub name: String,
    pub namespace: String,
    pub ready: bool,          // status.readyToUse
    pub source_pvc: String,   // spec.source.persistentVolumeClaimName; "" when the source
                               // is a pre-provisioned volumeSnapshotContentName instead
    pub snapshot_class: String, // spec.volumeSnapshotClassName
    pub restore_size: String,   // status.restoreSize
    pub age: String,
}

#[tauri::command]
pub async fn list_volume_snapshots(
    context: String, namespace: String,
) -> Result<Vec<VolumeSnapshotRow>, String> {
    let client = client_for_context(&context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let ar = volumesnapshot_api_resource();
    let api: Api<DynamicObject> = if namespace == "all" || namespace.is_empty() {
        Api::all_with(client, &ar)
    } else {
        Api::namespaced_with(client, &namespace, &ar)
    };

    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found")
                || msg.contains("could not find the requested resource")
                || msg.contains("the server could not find")
            {
                return Ok(Vec::new());
            }
            return Err(format!("Failed to list volume snapshots: {}", msg));
        }
    };

    Ok(list.items.into_iter().map(|obj| {
        let spec = &obj.data["spec"];
        let status = &obj.data["status"];
        // restoreSize is a Quantity — normally a JSON string, but fall back to a number
        // rather than rendering blank.
        let restore_size = status["restoreSize"].as_str().map(String::from)
            .or_else(|| status["restoreSize"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        VolumeSnapshotRow {
            name: obj.metadata.name.unwrap_or_default(),
            namespace: obj.metadata.namespace.unwrap_or_default(),
            ready: status["readyToUse"].as_bool().unwrap_or(false),
            source_pvc: spec["source"]["persistentVolumeClaimName"].as_str().unwrap_or("").to_string(),
            snapshot_class: spec["volumeSnapshotClassName"].as_str().unwrap_or("").to_string(),
            restore_size,
            age: age_from_timestamp(obj.metadata.creation_timestamp.as_ref().map(|t| &t.0)),
        }
    }).collect())
}
