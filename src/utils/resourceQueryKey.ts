import type { ResourceType } from "../types/k8s";

export const RESOURCE_QUERY_KEY: Partial<Record<ResourceType, string>> = {
  pods:       "pods",
  deploy:     "deployments",
  sts:        "statefulsets",
  ds:         "daemonsets",
  jobs:       "jobs",
  cron:       "cronjobs",
  hpa:        "hpas",
  pdb:        "pdbs",
  svc:        "services",
  ing:        "ingresses",
  netpol:     "networkpolicies",
  gw:         "gateways",
  httproute:  "httproutes",
  cm:         "configmaps",
  sec:        "secrets",
  pvc:        "pvcs",
  pv:         "pvs",
  sc:         "storageclasses",
  cert:       "certificates",
  rq:         "resource-quotas",
  lr:         "limit-ranges",
  nodes:      "nodes",
  events:     "events",
  crd:        "crds",
  pc:         "priority-classes",
  sa:         "serviceaccounts",
  roles:      "roles",
  croles:     "clusterroles",
  rbindings:  "rolebindings",
  crbindings: "clusterrolebindings",
  helm:       "helm-releases",
  argocd:     "argocd-apps",
  "flux-ks":  "flux-kustomizations",
  "flux-hr":  "flux-helmreleases",
  "argo-appsets":  "argocd-appsets",
  "argo-projects": "argocd-projects",
  "argo-repos":    "argocd-repositories",
  // Phase 4 — coverage (docs/plan-kubeconfig-and-parity.md §4)
  ep:  "endpoints",
  eps: "endpointslices",
  rs:  "replicasets",
  mwc: "mutating-webhooks",
  vwc: "validating-webhooks",
  vs:  "volumesnapshots",
  "crd-instances": "crd-resources",
};

/**
 * Health pages are app views, not ResourceType members (T4-9): their query key and TopBar rules
 * live here, not in RESOURCE_QUERY_KEY.
 */
/** App views (Settings, Journal, Who can) are never ResourceType members; "health" has its own pages. */
export type MainView = "resources" | "settings" | "health" | "journal" | "whocan";
export type HealthPage = "problems" | "capacity" | "unused" | "deprecations" | "map";
export const HEALTH_QUERY_KEY: Record<HealthPage, string> = { problems: "problems", capacity: "node-capacity", unused: "possibly-unused", deprecations: "deprecated-apis", map: "resource-map" };
export const HEALTH_PAGES: Record<HealthPage, { label: string; breadcrumb: string; placeholder: string; nsPicker: boolean }> = {
  problems: { label: "Problems", breadcrumb: "problems", placeholder: "Filter findings…", nsPicker: true },
  capacity: { label: "Node capacity", breadcrumb: "node capacity", placeholder: "Filter nodes…", nsPicker: false },
  unused: { label: "Possibly unused", breadcrumb: "possibly unused", placeholder: "Filter findings…", nsPicker: true },
  deprecations: { label: "Deprecated APIs", breadcrumb: "deprecated apis", placeholder: "Filter findings…", nsPicker: true },
  map: { label: "Map", breadcrumb: "map", placeholder: "Find on map…", nsPicker: true },
};
