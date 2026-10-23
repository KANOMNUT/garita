// External observability (v2.3.0): validators, presets, query-key and range helpers, dialog draft logic and copy.
// The validators mirror commands/observability.rs exactly (valid_namespace, valid_port, valid_field_name,
// valid_tenant, the path-prefix rule in proxy_path); a Rust-side change needs the same change here and in the tests.
import type {
  BackendProbe, LogFlavour, LogLabelMap, LogsTarget, MetricRangeId, Observability, ObservabilityKind, ProbeState, ServiceTarget,
} from "../types/k8s";

// ─── validators ──────────────────────────────────────────────────────────────

/** DNS-1123 label, 1..63 (launch::valid_namespace). */
export const validNamespace = (s: string) => s.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s);
/** 1..65535 or a port name (lowercase, digits, "-", <= 15). */
export const validPort = (s: string) =>
  /^[0-9]+$/.test(s) ? Number(s) > 0 && Number(s) <= 65535 : s.length > 0 && s.length <= 15 && /^[a-z0-9-]+$/.test(s);
/** Empty, or absolute, no "..", only [A-Za-z0-9-._~/]. */
export const validPathPrefix = (s: string) => s === "" || (s.startsWith("/") && !s.includes("..") && /^[A-Za-z0-9\-._~/]+$/.test(s));
/** `[A-Za-z_][A-Za-z0-9_.]*`, <= 128. */
export const validLabelName = (s: string) => s.length <= 128 && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s);
/** Loki tenant id: `[A-Za-z0-9!._*'()-]`, 1..150. The dialog treats "" as "no tenant" before calling this. */
export const validTenant = (s: string) => s.length <= 150 && /^[A-Za-z0-9!._*'()-]+$/.test(s);

export const NAME_ERROR = 'Use lowercase letters, digits and "-".';
export const PORT_ERROR = "Enter a port number (1 to 65535) or a port name.";
export const PREFIX_ERROR = 'Path prefix must start with "/", use only letters, digits and - . _ ~ /, and must not contain "..".';
export const LABEL_ERROR = 'Use letters, digits, "_" and ".", starting with a letter or "_".';
export const TENANT_ERROR = "Use letters, digits and ! . _ * ' ( ) -, up to 150 characters.";

// ─── presets ─────────────────────────────────────────────────────────────────

/** Mirrors logs_backend.rs `label_preset`; a test compares the strings. */
export const LOG_LABEL_PRESETS: Record<LogFlavour, LogLabelMap> = {
  loki: { namespace: "namespace", pod: "pod", container: "container" },
  victorialogs: { namespace: "kubernetes.pod_namespace", pod: "kubernetes.pod_name", container: "kubernetes.container_name" },
};

export const FLAVOUR_LABEL: Record<ObservabilityKind, string> = { prometheus: "Prometheus", loki: "Loki", victorialogs: "VictoriaLogs" };

// ─── query key and ranges ────────────────────────────────────────────────────

export const targetKey = (t: ServiceTarget) =>
  `${t.namespace}/${t.service}:${t.port}|${t.scheme ?? "http"}|${t.path_prefix ?? ""}|${t.tenant ?? ""}`;

/** Identity of a probe: a Test result is shown only while the draft still has this key. */
export const probeKey = (kind: ObservabilityKind, t: ServiceTarget) => `${kind}|${targetKey(t)}`;

/** Every row stays at or under 1,100 points (the backend cap). */
export const METRIC_RANGES: Record<Exclude<MetricRangeId, "now">, { span: number; step: number }> = {
  "1h": { span: 3_600, step: 15 },
  "6h": { span: 21_600, step: 60 },
  "24h": { span: 86_400, step: 300 }, // shared by the 24 h chart and the p95 hint
  "7d": { span: 604_800, step: 900 },
};

/** Computed inside queryFn, so the query key never changes per render. */
export function rangeWindow(range: Exclude<MetricRangeId, "now">, nowSec: number) {
  const { span, step } = METRIC_RANGES[range];
  const end = Math.floor(nowSec / step) * step;
  return { start: end - span, end, stepSeconds: step };
}

/**
 * placeholderData guard: keep the previous chart only across a range change. Keys are
 * `[..., template, namespace, name, range]`; everything but the last element must match, else
 * the old data belongs to another pod, node, cluster or target.
 */
export function samePlotExceptRange(prevKey: readonly unknown[], nextKey: readonly unknown[]): boolean {
  return prevKey.length === nextKey.length && prevKey.slice(0, -1).every((v, i) => v === nextKey[i]);
}

/** An API-server 403 on services/proxy (commands/observability.rs RA-1b). */
export const isForbidden = (msg: string) => msg.startsWith("No access to services/proxy");

// ─── summary and copy ────────────────────────────────────────────────────────

const targetText = (t: ServiceTarget) => `${t.namespace}/${t.service}:${t.port}`;

export function observabilitySummary(o: Observability | undefined): { metrics: string; logs: string } {
  return {
    metrics: o?.prometheus ? `Prometheus: ${targetText(o.prometheus)}` : "Not set",
    logs: o?.logs ? `${FLAVOUR_LABEL[o.logs.flavour]}: ${targetText(o.logs.service)}` : "Not set",
  };
}

export function probeLine(p: Pick<BackendProbe, "state" | "message" | "version">, kind: ObservabilityKind, t: { namespace: string; service: string; port: string }): string {
  const f = FLAVOUR_LABEL[kind];
  // The forbidden prefix is this app's own marker, already said by the sentence below; "Why?" disclosures keep the raw text.
  const msg = p.state === "forbidden" ? (p.message ?? "").replace(/^No access to services\/proxy:\s*/, "") : p.message;
  const m = msg ? ` ${msg}` : "";
  const text: Record<ProbeState, string> = {
    ok: `Reachable: ${t.namespace}/${t.service}:${t.port}.${p.version ? ` ${f} ${p.version}.` : ""}`,
    unreachable: `Couldn't reach the service. Check the namespace, service and port.${m}`,
    forbidden: `No access to services/proxy in ${t.namespace}.${m}`,
    "wrong-service": `The service answered, but it doesn't look like ${f}. Check the port and path prefix.`,
  };
  return text[p.state];
}

export const hintLine = (ns: string, denied: boolean) =>
  denied
    ? `Hint: your account may not be allowed to read through the service proxy in ${ns}. Test shows the real result.`
    : `Hint: needs permission to get services/proxy in ${ns}.`;

export function skippedLine(skipped: { source: string; reason: string }[]): string {
  const where = skipped.map((s) => (s.source === "*" ? "every namespace" : s.source)).join(", ");
  return `Couldn't list Services in ${where} (${skipped[0]?.reason ?? "unknown"}). The list may be incomplete.`;
}

// ─── dialog draft ────────────────────────────────────────────────────────────

export interface ServiceDraft { namespace: string; service: string; port: string; scheme: "http" | "https"; path_prefix: string; tenant: string }
export interface LogsDraft extends ServiceDraft { flavour: LogFlavour; labelMode: "preset" | "custom"; custom: LogLabelMap }
export type DraftErrors = Partial<Record<"namespace" | "service" | "port" | "path_prefix" | "tenant" | "label_namespace" | "label_pod" | "label_container", string>>;

export const emptyServiceDraft = (): ServiceDraft => ({ namespace: "", service: "", port: "", scheme: "http", path_prefix: "", tenant: "" });
export const emptyLogsDraft = (flavour: LogFlavour = "loki"): LogsDraft => ({
  ...emptyServiceDraft(), flavour, labelMode: "preset", custom: { ...LOG_LABEL_PRESETS[flavour] },
});

/** Unset: namespace, service and port all empty. Anything else is judged by `draftErrors`. */
export const isUnsetDraft = (d: ServiceDraft) => !d.namespace && !d.service && !d.port;

export function draftErrors(d: ServiceDraft | LogsDraft): DraftErrors {
  const e: DraftErrors = {};
  if (isUnsetDraft(d)) return e;
  if (!validNamespace(d.namespace)) e.namespace = NAME_ERROR;
  if (!validNamespace(d.service)) e.service = NAME_ERROR;
  if (!validPort(d.port)) e.port = PORT_ERROR;
  if (!validPathPrefix(d.path_prefix)) e.path_prefix = PREFIX_ERROR;
  if (d.tenant !== "" && "flavour" in d && !validTenant(d.tenant)) e.tenant = TENANT_ERROR;
  if ("labelMode" in d && d.labelMode === "custom") {
    (["namespace", "pod", "container"] as const).forEach((k) => {
      if (!d.custom[k]) e[`label_${k}`] = "Enter a label name.";
      else if (!validLabelName(d.custom[k])) e[`label_${k}`] = LABEL_ERROR;
    });
  }
  return e;
}

function toTarget(d: ServiceDraft): ServiceTarget {
  const t: ServiceTarget = { namespace: d.namespace, service: d.service, port: d.port, scheme: d.scheme };
  if (d.path_prefix) t.path_prefix = d.path_prefix;
  if (d.tenant) t.tenant = d.tenant;
  return t;
}
function fromTarget(t: ServiceTarget): ServiceDraft {
  return { namespace: t.namespace, service: t.service, port: t.port, scheme: t.scheme === "https" ? "https" : "http", path_prefix: t.path_prefix ?? "", tenant: t.tenant ?? "" };
}

/** The Metrics group never carries a tenant (O-19). */
export const metricsTarget = (d: ServiceDraft): ServiceTarget => toTarget({ ...d, tenant: "" });
export const metricsDraft = (t: ServiceTarget | undefined): ServiceDraft => (t ? fromTarget(t) : emptyServiceDraft());

/** Stores the explicit names the user saw (a preset stores its own six strings), so what was shown is what is queried. */
export function logsTarget(d: LogsDraft): LogsTarget {
  return { service: toTarget(d), flavour: d.flavour, labels: d.labelMode === "preset" ? { ...LOG_LABEL_PRESETS[d.flavour] } : { ...d.custom } };
}
export function logsDraft(t: LogsTarget | undefined): LogsDraft {
  if (!t) return emptyLogsDraft();
  const preset = LOG_LABEL_PRESETS[t.flavour];
  const isPreset = t.labels.namespace === preset.namespace && t.labels.pod === preset.pod && t.labels.container === preset.container;
  return { ...fromTarget(t.service), flavour: t.flavour, labelMode: isPreset ? "preset" : "custom", custom: { ...t.labels } };
}

/** Switching backend moves the preset with it unless Custom is selected; the custom names stay in the draft. */
export const withFlavour = (d: LogsDraft, flavour: LogFlavour): LogsDraft => ({ ...d, flavour });

/** The record to save; a half-empty or invalid group is never saved (callers check `draftErrors` first). */
export function draftsToObservability(m: ServiceDraft, l: LogsDraft): Observability | null {
  const o: Observability = {};
  if (!isUnsetDraft(m)) o.prometheus = metricsTarget(m);
  if (!isUnsetDraft(l)) o.logs = logsTarget(l);
  return o.prometheus || o.logs ? o : null;
}

/** Same fields, same values: used for the dirty check. */
export const sameDrafts = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ─── dialog requests (module-level pub/sub, like clusterIdentity's notify) ───

const dialogListeners = new Set<(context: string) => void>();
export function requestObservabilityDialog(context: string) {
  dialogListeners.forEach((fn) => fn(context));
}
export function onObservabilityDialogRequest(fn: (context: string) => void): () => void {
  dialogListeners.add(fn);
  return () => void dialogListeners.delete(fn);
}
