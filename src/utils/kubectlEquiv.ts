// #28 kubectl equivalent (docs/ux/03-diffs-write-safety.md §10, E1–E7).
//
// Pure and React-free. Builders return structured argv lists, never shell strings: the
// quoting differs between POSIX shells and PowerShell 5.1, so the string is produced at
// render time by renderCommand(). A builder NEVER reads the on-screen patch/diff text
// (E4): ResourceEditor's Patch tab shows `stringData` in clear text, and the copyable
// command must not reuse it. Secret values are masked here, in the builder.
//
// No shell-out, no kubectl dependency — this module only formats text.
import type { ResourceType } from "../types/k8s";
import { CLUSTER_SCOPED_KINDS } from "./scope";
import { PRODUCT_NAME } from "../brand";

/** A literal argv element, or `{ raw }` for a placeholder that must not be quoted (`<values.yaml>`). */
export type EquivArg = string | { raw: string };
export interface EquivCommand {
  /** argv[0] is the tool: "kubectl" or "helm". */
  argv: EquivArg[];
}
export interface KubectlEquiv {
  commands: EquivCommand[];
  /** Plain-text lines shown under the block, after the honesty footer's siblings. */
  footnotes: string[];
  /** When set, replaces the command block with this explanatory line (Merge from file, D3-10). */
  note?: string;
  /** Builder could not produce a command: "No equivalent available for this action." */
  unavailable?: boolean;
}

export type ShellKind = "posix" | "powershell";

export const HONESTY_FOOTER =
  `Equivalent, not identical. ${PRODUCT_NAME} calls the Kubernetes API directly and doesn't run kubectl.`;
export const MASK_FOOTNOTE = "Secret values are replaced with <redacted>. Fill them in before running.";
export const DRAIN_FOOTNOTE = `kubectl retries refused evictions. ${PRODUCT_NAME} stops and reports them (see the drain preview).`;
export const FORCE_DELETE_FOOTNOTE = "Deleting a pod directly bypasses PodDisruptionBudgets.";
export const ARGOCD_DELETE_FOOTNOTE =
  "Whether the app's resources are deleted too depends on the resources-finalizer.argocd.argoproj.io finalizer, not on --cascade.";
export const ARGOCD_KEEP_FOOTNOTE =
  "Clearing finalizers removes every finalizer on the Application, not only ArgoCD's.";
export const ARGOCD_ROLLBACK_FOOTNOTE = `${PRODUCT_NAME} reads the source from the app's history entry.`;
export const HELM_UPGRADE_FOOTNOTE =
  `${PRODUCT_NAME} upgrades from the chart stored with the release, using temporary files. <chart> and <values.yaml> stand for those files.`;
export const REPLACE_FOOTNOTE = "The file is the YAML in the editor.";
export const MERGE_FROM_FILE_NOTE =
  "Merge from file has no single kubectl equivalent. Each document is created if it doesn't exist and merge-patched if it does. The preview lists the exact keys that will be set.";
export const TRIGGER_FOOTNOTE = "The Job name is generated when the action runs; <job-name> stands for it.";

// ─── Quoting (D3-11) ─────────────────────────────────────────────────────────

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function quotePosix(s: string): string {
  if (SAFE_ARG.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// PowerShell 5.1 hands a native executable the string it builds, and strips unescaped
// double quotes on the way. Single quotes keep PowerShell itself from expanding the
// text; `\"` is what survives the second round (the CRT command-line parser) as `"`.
export function quotePowerShell(s: string): string {
  if (SAFE_ARG.test(s)) return s;
  return `'${s.replace(/'/g, "''").replace(/"/g, '\\"')}'`;
}

export function renderCommand(cmd: EquivCommand, shell: ShellKind): string {
  const quote = shell === "powershell" ? quotePowerShell : quotePosix;
  return cmd.argv.map((a) => (typeof a === "string" ? quote(a) : a.raw)).join(" ");
}

/** One command per line, no line-continuation characters, so a paste always runs. */
export function renderCopyText(eq: KubectlEquiv, shell: ShellKind): string {
  if (eq.note) return eq.note;
  return eq.commands.map((c) => renderCommand(c, shell)).join("\n");
}

/** Display text for the block: long single commands are cut at 300 chars (Copy keeps the full text). */
export const LONG_COMMAND_CHARS = 1000;
export const LONG_COMMAND_SHOWN = 300;
export function truncateForDisplay(text: string): { shown: string; truncated: boolean } {
  if (text.length <= LONG_COMMAND_CHARS) return { shown: text, truncated: false };
  return { shown: `${text.slice(0, LONG_COMMAND_SHOWN)}…`, truncated: true };
}

// ─── Kinds ───────────────────────────────────────────────────────────────────

// kubectl's short singular where one exists, otherwise plural.group (03 §10.3).
const KUBECTL_NOUN: Partial<Record<ResourceType, string>> = {
  pods: "pod", deploy: "deployment", sts: "statefulset", ds: "daemonset", jobs: "job", cron: "cronjob",
  hpa: "hpa", pdb: "pdb", rs: "replicaset", svc: "service", ing: "ingress", netpol: "networkpolicy",
  gw: "gateways.gateway.networking.k8s.io", httproute: "httproutes.gateway.networking.k8s.io",
  ep: "endpoints", eps: "endpointslices.discovery.k8s.io", cm: "configmap", sec: "secret", pvc: "pvc",
  cert: "certificates.cert-manager.io", rq: "resourcequota", lr: "limitrange",
  vs: "volumesnapshots.snapshot.storage.k8s.io", sa: "serviceaccount", roles: "role",
  rbindings: "rolebinding", events: "event", pv: "pv", sc: "storageclass", nodes: "node",
  crd: "customresourcedefinition", pc: "priorityclass", mwc: "mutatingwebhookconfiguration",
  vwc: "validatingwebhookconfiguration", croles: "clusterrole", crbindings: "clusterrolebinding",
  argocd: "applications.argoproj.io", "argo-appsets": "applicationsets.argoproj.io",
  "argo-projects": "appprojects.argoproj.io",
  "flux-ks": "kustomizations.kustomize.toolkit.fluxcd.io", "flux-hr": "helmreleases.helm.toolkit.fluxcd.io",
};

/** Owner kinds: the only ones whose delete carries `--cascade=` (#30). Matches PropagationPicker. */
export const CASCADE_KINDS: ReadonlySet<string> = new Set(["deploy", "sts", "ds", "jobs", "rs", "cron"]);

export function kubectlNoun(kind: string): string {
  return KUBECTL_NOUN[kind as ResourceType] ?? kind;
}

// ─── Builders ────────────────────────────────────────────────────────────────

interface Where { context: string; namespace?: string }

function tail(w: Where, namespaced = true): EquivArg[] {
  const out: EquivArg[] = [];
  if (namespaced && w.namespace) out.push("-n", w.namespace);
  out.push("--context", w.context);
  return out;
}

function one(argv: EquivArg[], footnotes: string[] = []): KubectlEquiv {
  return { commands: [{ argv }], footnotes };
}

export function unavailableEquiv(): KubectlEquiv {
  return { commands: [], footnotes: [], unavailable: true };
}

export type DeletePropagation = "background" | "foreground" | "orphan";

export function deleteEquiv(
  w: Where & { kind: string; name: string; propagation?: DeletePropagation },
): KubectlEquiv {
  const argv: EquivArg[] = ["kubectl", "delete", kubectlNoun(w.kind), w.name, ...tail(w, !CLUSTER_SCOPED_KINDS.has(w.kind))];
  // Owner kinds always render the cascade explicitly, even when it is the default (03 §10.3).
  if (CASCADE_KINDS.has(w.kind)) argv.push(`--cascade=${w.propagation ?? "background"}`);
  return one(argv);
}

export function deletePodsEquiv(w: Where & { names: string[] }): KubectlEquiv {
  return one(["kubectl", "delete", "pod", ...w.names, ...tail(w)]);
}

/** Pod header "Restart" is a delete — said honestly (E1). */
export function restartPodEquiv(w: Where & { name: string }): KubectlEquiv {
  return deletePodsEquiv({ ...w, names: [w.name] });
}

export function scaleEquiv(w: Where & { kind: string; name: string; replicas: number }): KubectlEquiv {
  return one(["kubectl", "scale", `${kubectlNoun(w.kind)}/${w.name}`, `--replicas=${w.replicas}`, ...tail(w)]);
}

export function rolloutRestartEquiv(w: Where & { kind: string; name: string }): KubectlEquiv {
  return one(["kubectl", "rollout", "restart", `${kubectlNoun(w.kind)}/${w.name}`, ...tail(w)]);
}

export function rolloutPauseEquiv(w: Where & { name: string; resume?: boolean }): KubectlEquiv {
  return one(["kubectl", "rollout", w.resume ? "resume" : "pause", `deployment/${w.name}`, ...tail(w)]);
}

export function rollbackDeploymentEquiv(w: Where & { name: string; revision: number }): KubectlEquiv {
  return one(["kubectl", "rollout", "undo", `deployment/${w.name}`, `--to-revision=${w.revision}`, ...tail(w)]);
}

export function triggerCronJobEquiv(w: Where & { name: string }): KubectlEquiv {
  return one(
    ["kubectl", "create", "job", { raw: "<job-name>" }, `--from=cronjob/${w.name}`, ...tail(w)],
    [TRIGGER_FOOTNOTE],
  );
}

export function cordonEquiv(w: Where & { node: string; uncordon?: boolean }): KubectlEquiv {
  return one(["kubectl", w.uncordon ? "uncordon" : "cordon", w.node, "--context", w.context]);
}

export function drainEquiv(w: Where & { node: string; includesUnmanaged?: boolean }): KubectlEquiv {
  const argv: EquivArg[] = ["kubectl", "drain", w.node, "--ignore-daemonsets", "--delete-emptydir-data"];
  if (w.includesUnmanaged) argv.push("--force");
  argv.push("--context", w.context);
  return one(argv, [DRAIN_FOOTNOTE]);
}

export function deleteNodeEquiv(w: Where & { node: string }): KubectlEquiv {
  return one(["kubectl", "delete", "node", w.node, "--context", w.context]);
}

export function taintEquiv(
  w: Where & { node: string; key: string; value?: string; effect: string; remove?: boolean },
): KubectlEquiv {
  const spec = w.remove
    ? `${w.key}:${w.effect}-`
    : w.value ? `${w.key}=${w.value}:${w.effect}` : `${w.key}:${w.effect}`;
  return one(["kubectl", "taint", "nodes", w.node, spec, "--context", w.context]);
}

export function createNamespaceEquiv(w: Where & { name: string }): KubectlEquiv {
  return one(["kubectl", "create", "namespace", w.name, "--context", w.context]);
}

export function deleteNamespaceEquiv(w: Where & { name: string }): KubectlEquiv {
  return one(["kubectl", "delete", "namespace", w.name, "--context", w.context]);
}

/** One `kubectl delete pod` per namespace, namespaces sorted; names keep their given order. */
function deletePodCommands(context: string, pods: { namespace: string; name: string }[]): EquivCommand[] {
  const byNs = new Map<string, string[]>();
  for (const p of pods) {
    const list = byNs.get(p.namespace) ?? [];
    list.push(p.name);
    byNs.set(p.namespace, list);
  }
  const commands: EquivCommand[] = [];
  for (const [namespace, names] of [...byNs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    commands.push({ argv: ["kubectl", "delete", "pod", ...names, "-n", namespace, "--context", context] });
  }
  return commands;
}

/** Bulk pod delete / restart across a selection: one command per namespace. */
export function deletePodsByNamespaceEquiv(w: { context: string; pods: { namespace: string; name: string }[] }): KubectlEquiv {
  return { commands: deletePodCommands(w.context, w.pods), footnotes: [] };
}

/** Force-delete of PDB-blocked pods: one command per namespace (03 §13.1). */
export function forceDeleteEquiv(w: { context: string; pods: { namespace: string; name: string }[] }): KubectlEquiv {
  return { commands: deletePodCommands(w.context, w.pods), footnotes: [FORCE_DELETE_FOOTNOTE] };
}

/** Masks every value under data/stringData of a Secret merge patch. Keys and `null` removals stay. */
export function maskSecretPatch(patch: unknown): { masked: unknown; didMask: boolean } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { masked: patch, didMask: false };
  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  let didMask = false;
  for (const field of ["data", "stringData"]) {
    const block = src[field];
    if (typeof block === "object" && block !== null && !Array.isArray(block)) {
      const masked: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
        if (v === null) masked[k] = null;
        else { masked[k] = "<redacted>"; didMask = true; }
      }
      out[field] = masked;
    }
  }
  return { masked: out, didMask };
}

export function patchEquiv(w: Where & { kind: string; name: string; patch: unknown }): KubectlEquiv {
  const isSecret = w.kind === "sec";
  const { masked, didMask } = isSecret ? maskSecretPatch(w.patch) : { masked: w.patch, didMask: false };
  return one(
    [
      "kubectl", "patch", kubectlNoun(w.kind), w.name,
      ...tail(w, !CLUSTER_SCOPED_KINDS.has(w.kind)),
      "--type=merge", "-p", JSON.stringify(masked),
    ],
    didMask ? [MASK_FOOTNOTE] : [],
  );
}

/** YAML Save is a typed whole-object replace — `replace`, not `apply` and not `patch` (E1). */
export function replaceEquiv(w: Where): KubectlEquiv {
  return one(["kubectl", "replace", "-f", { raw: "<your-edited-yaml>" }, "--context", w.context], [REPLACE_FOOTNOTE]);
}

/** create_resource_from_yaml is create-only (api.create), so it IS `kubectl create -f` (Q3-7b). */
export function createFromFileEquiv(w: { context: string }): KubectlEquiv {
  return one(["kubectl", "create", "-f", { raw: "<file>" }, "--context", w.context]);
}

/** Merge from file is never rendered as `kubectl apply` (E6, D3-10). */
export function mergeFromFileEquiv(): KubectlEquiv {
  return { commands: [], footnotes: [], note: MERGE_FROM_FILE_NOTE };
}

// ─── ArgoCD (Q3-7a). Never `argocd app sync`; never `--cascade` on a delete (F3-12). ───

const APPS = "applications.argoproj.io";

export function argoSyncEquiv(
  w: Where & { name: string; prune?: boolean; dryRun?: boolean; force?: boolean; revision?: string },
): KubectlEquiv {
  const sync: string[] = [
    `"prune":${w.prune === true}`,
    `"dryRun":${w.dryRun === true}`,
    `"syncStrategy":{"hook":{"force":${w.force === true}}}`,
  ];
  if (w.revision) sync.push(`"revision":${JSON.stringify(w.revision)}`);
  return one([
    "kubectl", "patch", APPS, w.name, ...tail(w), "--type=merge",
    "-p", `{"operation":{"sync":{${sync.join(",")}}}}`,
  ]);
}

/** Bulk Sync: one line per app, Copy gives all of them. */
export function argoBulkSyncEquiv(w: { context: string; apps: { namespace: string; name: string }[] }): KubectlEquiv {
  return {
    commands: w.apps.flatMap((a) => argoSyncEquiv({ context: w.context, namespace: a.namespace, name: a.name }).commands),
    footnotes: [],
  };
}

export function argoRefreshEquiv(w: Where & { name: string; hard?: boolean }): KubectlEquiv {
  return one([
    "kubectl", "annotate", APPS, w.name, ...tail(w),
    `argocd.argoproj.io/refresh=${w.hard ? "hard" : "normal"}`, "--overwrite",
  ]);
}

export function argoBulkRefreshEquiv(w: { context: string; apps: { namespace: string; name: string }[]; hard?: boolean }): KubectlEquiv {
  return {
    commands: w.apps.flatMap((a) => argoRefreshEquiv({ context: w.context, namespace: a.namespace, name: a.name, hard: w.hard }).commands),
    footnotes: [],
  };
}

export function argoRollbackEquiv(w: Where & { name: string; historyId: number }): KubectlEquiv {
  const body =
    `{"operation":{"sync":{"revision":"<revision of history id ${w.historyId}>",` +
    `"source":<source of history id ${w.historyId}>,"syncStrategy":{"apply":{}},"prune":false,"dryRun":false}}}`;
  return one(["kubectl", "patch", APPS, w.name, ...tail(w), "--type=merge", "-p", body], [ARGOCD_ROLLBACK_FOOTNOTE]);
}

/** `cascade` false = keep the managed resources: clear the finalizers first, then delete (two commands). */
export function argoDeleteEquiv(w: Where & { name: string; cascade: boolean }): KubectlEquiv {
  const del: EquivCommand = { argv: ["kubectl", "delete", APPS, w.name, ...tail(w)] };
  if (w.cascade) return { commands: [del], footnotes: [ARGOCD_DELETE_FOOTNOTE] };
  const clear: EquivCommand = {
    argv: ["kubectl", "patch", APPS, w.name, ...tail(w), "--type=merge", "-p", `{"metadata":{"finalizers":[]}}`],
  };
  return { commands: [clear, del], footnotes: [ARGOCD_KEEP_FOOTNOTE] };
}

// ─── Helm — the real helm command, not kubectl (03 §9.6, §10.3) ──────────────

export function helmRollbackEquiv(w: { context: string; namespace: string; release: string; revision: number }): KubectlEquiv {
  return one(["helm", "rollback", w.release, String(w.revision), "--namespace", w.namespace, "--kube-context", w.context]);
}

export function helmUninstallEquiv(w: { context: string; namespace: string; release: string }): KubectlEquiv {
  return one(["helm", "uninstall", w.release, "--namespace", w.namespace, "--kube-context", w.context]);
}

export function helmUpgradeEquiv(w: { context: string; namespace: string; release: string }): KubectlEquiv {
  return one(
    [
      "helm", "upgrade", w.release, { raw: "<chart>" }, "--values", { raw: "<values.yaml>" },
      "--namespace", w.namespace, "--kube-context", w.context,
    ],
    [HELM_UPGRADE_FOOTNOTE],
  );
}

export function helmInstallEquiv(w: {
  context: string; namespace: string; release: string; chart: string;
  version?: string; createNamespace?: boolean; dryRun?: boolean; hasValues?: boolean;
}): KubectlEquiv {
  const argv: EquivArg[] = ["helm", "install", w.release, w.chart, "--namespace", w.namespace, "--kube-context", w.context];
  if (w.version) argv.push("--version", w.version);
  if (w.createNamespace) argv.push("--create-namespace");
  if (w.dryRun) argv.push("--dry-run");
  if (w.hasValues) argv.push("--values", { raw: "<values.yaml>" });
  return one(argv, w.hasValues ? ["<values.yaml> stands for the values you entered."] : []);
}

// ─── Debug container (F7) ────────────────────────────────────────────────────

export function debugEquiv(w: Where & { pod: string; image: string; target?: string }): KubectlEquiv {
  const argv: EquivArg[] = ["kubectl", "debug", "-it", w.pod, `--image=${w.image}`];
  if (w.target) argv.push(`--target=${w.target}`);
  argv.push(...tail(w));
  return one(argv);
}

// ─── --kubeconfig footnote (03 §10.2) ────────────────────────────────────────

function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return n(a) === n(b);
}

/**
 * The extra footnote shown when the context lives outside the default kubeconfig: a bare
 * `--context prod-eu-1` fails in a shell that cannot see that file. Null = no footnote
 * (source unknown, default kubeconfig unknown, or they match).
 */
export function kubeconfigFootnote(
  context: string,
  contextSource: string | undefined,
  defaultKubeconfigPath: string | undefined,
): string | null {
  if (!contextSource || !defaultKubeconfigPath) return null;
  if (samePath(contextSource, defaultKubeconfigPath)) return null;
  const file = contextSource.replace(/\\/g, "/").split("/").pop() || contextSource;
  return `Context "${context}" is defined in ${file}. Add --kubeconfig ${contextSource}, or include that file in KUBECONFIG.`;
}
