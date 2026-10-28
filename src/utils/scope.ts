import type { ResourceType, SelectedResource } from "../types/k8s";

/**
 * Object-scope source of truth: kinds whose objects are cluster-scoped.
 * Must equal the Rust list asserted in src-tauri/src/commands/resource_edit.rs
 * (the `cluster_scoped_set_is_exactly_the_null_namespace_kinds` test).
 */
export const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "pv", "sc", "nodes", "crd", "croles", "crbindings", "pc", "mwc", "vwc", "ns",
]);

/** Namespace of the selected object, or null when the object is cluster-scoped. */
export function resourceNamespace(resource: SelectedResource): string | null {
  return CLUSTER_SCOPED_KINDS.has(resource.kind) || !("ns" in resource) ? null : resource.ns;
}

/**
 * TopBar: true when the view has no namespace picker. NOT object scope:
 * argocd + siblings are namespaced objects that are only listed cluster-wide,
 * and crd-instances depends on whether the CRD is namespaced.
 */
export function viewHidesNamespacePicker(view: ResourceType, crdNamespaced?: boolean): boolean {
  return CLUSTER_SCOPED_KINDS.has(view)
    || view === "argocd" || view === "argo-appsets" || view === "argo-projects" || view === "argo-repos"
    || (view === "crd-instances" && !crdNamespaced);
}
