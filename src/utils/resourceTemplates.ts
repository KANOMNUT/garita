import type { ResourceType } from "../types/k8s";

// `ns` is a ResourceType member since the Namespaces page; the `| "ns"` below is redundant and harmless.
export type CreatableKind = ResourceType | "ns";

// { kind, yaml } rather than a bare string so the create-modal title
// ("New ConfigMap") needs no second label map — ResourceDetailPanel's
// kind-label map is not exported and must not be (plan §5.2).
type Template = { kind: string; yaml: (ns: string) => string };

// Cluster-scoped kinds (pv, sc, croles, crbindings, pc) take no `ns` param and
// emit no `namespace:` line at all — a stray one is a hard API-server rejection.
export const RESOURCE_TEMPLATE: Partial<Record<CreatableKind, Template>> = {
  pods: {
    kind: "Pod",
    yaml: (ns) => `apiVersion: v1
kind: Pod
metadata:
  name: example-pod
  namespace: ${ns}
  labels:
    app: example-pod
spec:
  containers:
    - name: app
      image: nginx:1.27
      ports:
        - containerPort: 80
`,
  },
  deploy: {
    kind: "Deployment",
    yaml: (ns) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-app
  namespace: ${ns}
  labels:
    app: example-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: example-app
  template:
    metadata:
      labels:
        app: example-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
`,
  },
  sts: {
    kind: "StatefulSet",
    yaml: (ns) => `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: example-app
  namespace: ${ns}
spec:
  serviceName: example-app
  replicas: 1
  selector:
    matchLabels:
      app: example-app
  template:
    metadata:
      labels:
        app: example-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
`,
  },
  ds: {
    kind: "DaemonSet",
    yaml: (ns) => `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: example-agent
  namespace: ${ns}
spec:
  selector:
    matchLabels:
      app: example-agent
  template:
    metadata:
      labels:
        app: example-agent
    spec:
      containers:
        - name: agent
          image: busybox:1.36
          command: ["sleep", "3600"]
`,
  },
  jobs: {
    kind: "Job",
    yaml: (ns) => `apiVersion: batch/v1
kind: Job
metadata:
  name: example-job
  namespace: ${ns}
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: job
          image: busybox:1.36
          command: ["echo", "hello"]
`,
  },
  cron: {
    kind: "CronJob",
    yaml: (ns) => `apiVersion: batch/v1
kind: CronJob
metadata:
  name: example-cronjob
  namespace: ${ns}
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: job
              image: busybox:1.36
              command: ["echo", "hello"]
`,
  },
  hpa: {
    kind: "HorizontalPodAutoscaler",
    yaml: (ns) => `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: example-app
  namespace: ${ns}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: example-app
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
`,
  },
  pdb: {
    kind: "PodDisruptionBudget",
    yaml: (ns) => `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: example-app
  namespace: ${ns}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: example-app
`,
  },
  svc: {
    kind: "Service",
    yaml: (ns) => `apiVersion: v1
kind: Service
metadata:
  name: example-app
  namespace: ${ns}
spec:
  type: ClusterIP
  selector:
    app: example-app
  ports:
    - port: 80
      targetPort: 80
`,
  },
  ing: {
    kind: "Ingress",
    yaml: (ns) => `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: example-app
  namespace: ${ns}
spec:
  rules:
    - host: example.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: example-app
                port:
                  number: 80
`,
  },
  netpol: {
    kind: "NetworkPolicy",
    yaml: (ns) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: example-allow-same-namespace
  namespace: ${ns}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}
`,
  },
  gw: {
    kind: "Gateway",
    yaml: (ns) => `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: example-gateway
  namespace: ${ns}
spec:
  gatewayClassName: example-gateway-class
  listeners:
    - name: http
      protocol: HTTP
      port: 80
`,
  },
  httproute: {
    kind: "HTTPRoute",
    yaml: (ns) => `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: example-route
  namespace: ${ns}
spec:
  parentRefs:
    - name: example-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: example-app
          port: 80
`,
  },
  cm: {
    kind: "ConfigMap",
    yaml: (ns) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: ${ns}
data:
  key: value
`,
  },
  sec: {
    kind: "Secret",
    yaml: (ns) => `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: ${ns}
type: Opaque
stringData:
  key: value
`,
  },
  pvc: {
    kind: "PersistentVolumeClaim",
    yaml: (ns) => `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: example-data
  namespace: ${ns}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`,
  },
  pv: {
    kind: "PersistentVolume",
    yaml: () => `apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /mnt/data/example-pv
`,
  },
  sc: {
    kind: "StorageClass",
    yaml: () => `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: example-storage-class
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
`,
  },
  cert: {
    kind: "Certificate",
    yaml: (ns) => `apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: example-tls
  namespace: ${ns}
spec:
  secretName: example-tls
  dnsNames:
    - example.local
  issuerRef:
    name: example-issuer
    kind: ClusterIssuer
`,
  },
  rq: {
    kind: "ResourceQuota",
    yaml: (ns) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: example-quota
  namespace: ${ns}
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 4Gi
    limits.cpu: "8"
    limits.memory: 8Gi
`,
  },
  lr: {
    kind: "LimitRange",
    yaml: (ns) => `apiVersion: v1
kind: LimitRange
metadata:
  name: example-limits
  namespace: ${ns}
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
`,
  },
  pc: {
    kind: "PriorityClass",
    yaml: () => `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: example-priority
value: 1000
globalDefault: false
description: "Example priority class"
`,
  },
  sa: {
    kind: "ServiceAccount",
    yaml: (ns) => `apiVersion: v1
kind: ServiceAccount
metadata:
  name: example-sa
  namespace: ${ns}
`,
  },
  roles: {
    kind: "Role",
    yaml: (ns) => `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: example-role
  namespace: ${ns}
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
`,
  },
  croles: {
    kind: "ClusterRole",
    yaml: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: example-cluster-role
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
`,
  },
  rbindings: {
    kind: "RoleBinding",
    yaml: (ns) => `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: example-role-binding
  namespace: ${ns}
subjects:
  - kind: ServiceAccount
    name: example-sa
    namespace: ${ns}
roleRef:
  kind: Role
  name: example-role
  apiGroup: rbac.authorization.k8s.io
`,
  },
  crbindings: {
    kind: "ClusterRoleBinding",
    yaml: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: example-cluster-role-binding
subjects:
  - kind: ServiceAccount
    name: example-sa
    namespace: default
roleRef:
  kind: ClusterRole
  name: example-cluster-role
  apiGroup: rbac.authorization.k8s.io
`,
  },
  argocd: {
    kind: "Application",
    yaml: (ns) => `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: example-app
  namespace: ${ns}
spec:
  project: default
  source:
    repoURL: https://github.com/example/example-repo.git
    targetRevision: main
    path: manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
`,
  },
  "flux-ks": {
    kind: "Kustomization",
    yaml: (ns) => `apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: example-kustomization
  namespace: ${ns}
spec:
  interval: 5m
  path: ./manifests
  prune: true
  sourceRef:
    kind: GitRepository
    name: example-repo
`,
  },
  "flux-hr": {
    kind: "HelmRelease",
    yaml: (ns) => `apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: example-release
  namespace: ${ns}
spec:
  interval: 5m
  chart:
    spec:
      chart: example-chart
      version: "1.0.0"
      sourceRef:
        kind: HelmRepository
        name: example-repo
        namespace: ${ns}
  values: {}
`,
  },
  ns: {
    kind: "Namespace",
    // Cluster-scoped like pv/sc/pc/croles/crbindings — no `namespace:` line.
    yaml: () => `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`,
  },
};
