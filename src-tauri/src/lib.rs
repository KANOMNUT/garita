mod app_log;
mod commands;
mod journal;
pub mod launch;
#[cfg(test)]
mod live;

/// Bundled .app on macOS launches with a minimal PATH (no shell profile).
/// Read the real PATH from a login shell so auth exec plugins like
/// gke-gcloud-auth-plugin are found regardless of where they are installed.
#[cfg(target_os = "macos")]
fn fix_path() {
    // Login shells (-l) skip ~/.zshrc — explicitly source both profile and rc
    // files so PATH entries added there (Homebrew, gcloud, etc.) are included.
    let cmds = [
        (
            "/bin/zsh",
            "[ -f ~/.zprofile ] && source ~/.zprofile 2>/dev/null; \
             [ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null; \
             echo $PATH",
        ),
        (
            "/bin/bash",
            "[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null; \
             [ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null; \
             echo $PATH",
        ),
    ];
    for (shell, cmd) in &cmds {
        if let Ok(out) = std::process::Command::new(shell)
            .args(["-l", "-c", cmd])
            .output()
        {
            if let Ok(raw) = String::from_utf8(out.stdout) {
                // Take the last non-empty line — sourcing rc files may print extra output.
                let path = raw.lines()
                    .rev()
                    .find(|l| l.contains('/'))
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() {
                    std::env::set_var("PATH", &path);
                    return;
                }
            }
        }
    }
    // Last-resort fallback: prepend common locations for all K8s auth plugins
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let static_extra = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        // GKE
        "/opt/homebrew/share/google-cloud-sdk/bin",
        "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin",
        "/usr/local/google-cloud-sdk/bin",
        "/usr/lib/google-cloud-sdk/bin",
        "/usr/share/google-cloud-sdk/bin",
        // EKS — AWS CLI v2 macOS pkg installer
        "/usr/local/aws-cli/v2/current/bin",
        "/usr/local/aws-cli/bin",
        // Linux snap
        "/snap/bin",
        "/snap/google-cloud-cli/current/bin",
    ];
    let home_extra = [
        format!("{}/google-cloud-sdk/bin", home),
        format!("{}/Library/google-cloud-sdk/bin", home),
        format!("{}/.local/bin", home),
        format!("{}/bin", home),
        // AKS kubelogin
        format!("{}/.azure/bin", home),
        // krew plugins
        format!("{}/.krew/bin", home),
    ];
    let mut parts: Vec<String> = static_extra.iter().map(|s| s.to_string()).chain(home_extra).collect();
    parts.extend(current.split(':').filter(|s| !s.is_empty()).map(|s| s.to_string()));
    parts.dedup();
    std::env::set_var("PATH", parts.join(":"));
}

#[cfg(not(target_os = "macos"))]
fn fix_path() {}

use launch::{parse_launch_args, LaunchAction};
use tauri::{Emitter, Manager};
use commands::{
    access::can_i,
    admission::{list_mutating_webhooks, list_validating_webhooks},
    apply_file::{apply_yaml_documents, preview_yaml_documents},
    argocd::{
        list_argocd_apps, sync_argocd_app, refresh_argocd_app, get_argocd_commit_info,
        get_argocd_app_resources, delete_argocd_app, list_argocd_appsets, list_argocd_projects,
        list_argocd_repositories, rollback_argocd_app,
    },
    capacity::list_node_capacity,
    certmanager::list_certificates,
    flux::{list_flux_kustomizations, list_flux_helmreleases},
    gateway::{list_gateways, list_gateway_classes, list_http_routes},
    graph::get_resource_graph,
    map::get_resource_map,
    logs_backend::query_backend_logs,
    observability::discover_observability,
    prometheus::{probe_observability_backend, query_metric_range},
    netpol::get_network_policy_model,
    quotas::{list_resource_quotas, list_limit_ranges, list_priority_classes},
    search::search_resources,
    cluster_info::{check_cluster_access, get_cluster_info, get_pod_events, get_resource_events, list_events},
    config_storage::{
        list_configmaps, list_pvcs, list_pvs, list_secrets, list_storage_classes,
        list_volume_snapshots,
    },
    context::{get_current_context, list_contexts},
    launcher::get_launch_args,
    cli::{get_cli_status, install_cli_command},
    crds::{list_crds, list_crd_resources},
    deployments::list_deployments,
    diagnostics::{get_log_settings, list_journal, open_log_folder, open_release_page, set_log_level},
    drain::{evict_pod, preview_node_drain},
    extras::{
        create_namespace, delete_namespace, get_resource_metadata, get_workload_conditions,
        trigger_cronjob,
    },
    helm::{
        get_helm_values, install_helm_release, list_helm_releases, list_helm_history,
        preview_helm_upgrade,
        list_helm_repos, rollback_helm_release, uninstall_helm_release, upgrade_helm_release,
    },
    hpa::list_hpas,
    kubeconfig::{
        add_kubeconfig_path, add_kubeconfig_yaml, list_kubeconfigs, preview_kubeconfig_path,
        preview_kubeconfig_yaml, remove_kubeconfig, set_kubeconfig_enabled,
    },
    namespaces::list_namespaces,
    networking::{
        list_endpoint_slices, list_endpoints, list_ingress_classes, list_ingresses,
        list_network_policies, list_services,
    },
    nodes::{add_node_taint, cordon_node, delete_node, list_nodes, remove_node_taint, uncordon_node},
    pdb::list_pdbs,
    presence::list_api_presence,
    problems::list_problems,
    pods::{
        apply_resource_yaml, delete_pod, delete_resource, exec_pod_command, get_pod, get_pod_logs, get_pod_metrics,
        preview_resource_yaml, start_debug_container,
        get_resource_yaml, get_resource_yaml_neat, list_pod_metrics, list_pods, list_pods_on_node, stream_pod_logs,
    },
    portforward::{
        list_port_forwards, start_pod_port_forward, start_service_port_forward, stop_port_forward,
        PortForwardState,
    },
    rbac::{
        list_cluster_role_bindings, list_cluster_roles, list_role_bindings, list_roles,
        list_service_accounts, subject_permissions, who_can,
    },
    resource_create::create_resource_from_yaml,
    resource_edit::{get_resource_json, patch_resource},
    shell::{
        resize_shell, start_shell_session, stop_shell_session, write_to_shell, ShellState,
    },
    tls_cert::get_tls_certificate_info,
    unused::list_possibly_unused,
    deprecations::scan_deprecated_apis,
    workload_actions::{
        list_rollout_history, pause_deployment, restart_workload, resume_deployment,
        rollback_deployment, scale_workload,
    },
    workload_pods::list_workload_pods,
    workloads::{list_cronjobs, list_daemonsets, list_jobs, list_replicasets, list_statefulsets},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path();
    tauri::Builder::default()
        // MUST stay first: the plugin has to run before any other plugin or setup.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Forwarded argv is DATA ONLY: parsed and stored, never run. The webview pulls it (K6).
            if let LaunchAction::Run(args) = parse_launch_args(&argv) {
                commands::launcher::set_pending(args);
                let _ = app.emit("launch-args", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PortForwardState::default())
        .manage(ShellState::default())
        .setup(|app| {
            commands::migrate::run(app.handle());
            commands::kubeconfig::init_config_dir(app.handle());
            app_log::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // context
            list_contexts,
            get_launch_args,
            get_cli_status,
            install_cli_command,
            get_current_context,
            // kubeconfig
            list_kubeconfigs,
            preview_kubeconfig_path,
            preview_kubeconfig_yaml,
            add_kubeconfig_path,
            add_kubeconfig_yaml,
            remove_kubeconfig,
            set_kubeconfig_enabled,
            commands::migrate::detect_legacy_install,
            // namespaces
            list_namespaces,
            // workloads
            list_pods,
            list_pods_on_node,
            list_deployments,
            list_statefulsets,
            list_daemonsets,
            list_jobs,
            list_cronjobs,
            list_hpas,
            list_replicasets,
            // networking
            list_services,
            list_ingresses,
            list_ingress_classes,
            list_endpoints,
            list_endpoint_slices,
            // config & storage
            list_configmaps,
            list_secrets,
            list_pvcs,
            list_pvs,
            list_storage_classes,
            list_volume_snapshots,
            // nodes
            list_nodes,
            cordon_node,
            uncordon_node,
            delete_node,
            preview_node_drain,
            evict_pod,
            add_node_taint,
            remove_node_taint,
            // port-forward
            start_pod_port_forward,
            start_service_port_forward,
            stop_port_forward,
            list_port_forwards,
            // cluster info & events
            get_cluster_info,
            check_cluster_access,
            list_events,
            get_pod_events,
            get_resource_events,
            // CRDs
            list_crds,
            list_crd_resources,
            // admission webhooks
            list_mutating_webhooks,
            list_validating_webhooks,
            // pod actions
            get_pod_logs,
            stream_pod_logs,
            delete_pod,
            delete_resource,
            exec_pod_command,
            get_pod_metrics,
            get_resource_yaml,
            get_resource_yaml_neat,
            apply_resource_yaml,
            preview_resource_yaml,
            get_pod,
            start_debug_container,
            // workload actions
            scale_workload,
            restart_workload,
            pause_deployment,
            resume_deployment,
            list_rollout_history,
            rollback_deployment,
            // extras
            trigger_cronjob,
            create_namespace,
            delete_namespace,
            get_resource_metadata,
            get_workload_conditions,
            // rbac
            list_service_accounts,
            list_roles,
            list_cluster_roles,
            list_role_bindings,
            list_cluster_role_bindings,
            who_can,
            subject_permissions,
            // networking extras
            list_network_policies,
            // helm
            list_helm_releases,
            get_helm_values,
            upgrade_helm_release,
            uninstall_helm_release,
            install_helm_release,
            rollback_helm_release,
            list_helm_history,
            list_helm_repos,
            preview_helm_upgrade,
            // diagnostics
            get_log_settings,
            set_log_level,
            open_log_folder,
            open_release_page,
            list_journal,
            // v2.2.0 map and timeline
            get_resource_map,
            query_backend_logs,
            discover_observability,
            query_metric_range,
            probe_observability_backend,
            get_network_policy_model,
            // pdb
            list_pdbs,
            // v1.4.0 health
            list_api_presence,
            list_problems,
            list_node_capacity,
            // cert-manager
            list_certificates,
            // tls certs
            get_tls_certificate_info,
            list_possibly_unused,
            scan_deprecated_apis,
            // flux
            list_flux_kustomizations,
            list_flux_helmreleases,
            // gateway api
            list_gateways,
            list_gateway_classes,
            list_http_routes,
            // quotas & priority
            list_resource_quotas,
            list_limit_ranges,
            list_priority_classes,
            // search
            search_resources,
            // argocd
            list_argocd_apps,
            sync_argocd_app,
            refresh_argocd_app,
            get_argocd_commit_info,
            get_argocd_app_resources,
            delete_argocd_app,
            list_argocd_appsets,
            list_argocd_projects,
            list_argocd_repositories,
            rollback_argocd_app,
            // workload pods
            list_workload_pods,
            list_pod_metrics,
            get_resource_graph,
            // resource create
            create_resource_from_yaml,
            // merge from file
            preview_yaml_documents,
            apply_yaml_documents,
            // guided edit
            get_resource_json,
            patch_resource,
            // access / can-i
            can_i,
            // shell
            start_shell_session,
            write_to_shell,
            resize_shell,
            stop_shell_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
