import type { ResourceType } from "../types/k8s";

/** API kind (PascalCase) -> ResourceType. ArgoCD resources tab, Journal kind labels. */
export const KIND_TO_RESOURCE_TYPE: Record<string, ResourceType> = {
  Deployment:              "deploy",
  StatefulSet:             "sts",
  DaemonSet:               "ds",
  Job:                     "jobs",
  CronJob:                 "cron",
  Pod:                     "pods",
  Service:                 "svc",
  Ingress:                 "ing",
  NetworkPolicy:           "netpol",
  ConfigMap:               "cm",
  Secret:                  "sec",
  PersistentVolumeClaim:   "pvc",
  PersistentVolume:        "pv",
  StorageClass:            "sc",
  ServiceAccount:          "sa",
  Role:                    "roles",
  ClusterRole:             "croles",
  RoleBinding:             "rbindings",
  ClusterRoleBinding:      "crbindings",
  HorizontalPodAutoscaler: "hpa",
  PodDisruptionBudget:     "pdb",
  Certificate:             "cert",
};

/** ResourceType display label (TopBar breadcrumb, Journal). */
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  pods: "pods", deploy: "deployments", sts: "statefulsets", ds: "daemonsets",
  jobs: "jobs", cron: "cronjobs", hpa: "hpas", pdb: "poddisruptionbudgets",
  svc: "services", ing: "ingresses", gw: "gateways", httproute: "httproutes",
  cm: "configmaps", sec: "secrets", pvc: "pvcs", pv: "persistentvolumes", sc: "storageclasses",
  cert: "certificates", rq: "resourcequotas", lr: "limitranges",
  nodes: "nodes", events: "events", crd: "customresourcedefinitions", pc: "priorityclasses",
  netpol: "networkpolicies", sa: "serviceaccounts", roles: "roles", croles: "clusterroles",
  rbindings: "rolebindings", crbindings: "clusterrolebindings", helm: "helm releases",
  argocd: "argocd applications", "flux-ks": "flux kustomizations", "flux-hr": "flux helmreleases",
  "argo-appsets": "applicationsets", "argo-projects": "appprojects", "argo-repos": "repositories",
  ep: "endpoints", eps: "endpointslices", rs: "replicasets",
  mwc: "mutatingwebhookconfigurations", vwc: "validatingwebhookconfigurations", vs: "volumesnapshots",
  "crd-instances": "custom resources",
};
