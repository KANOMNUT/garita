// Pure clone-and-mutate transforms for the guided-edit forms (v1.3.0, F0).
//
// Each `build*Next` takes the frozen `live` object plus the form's own state
// and returns a MUTATED CLONE of `live`. The forms call these from their
// reporting effect; ResourceEditor diffs the result with `mergePatch`. They
// live here, React/JSX-free, so Vitest can assert through `mergePatch(base,
// next)` — the same call the host makes. NO BEHAVIOUR CHANGE vs the inline
// versions they replace: every comment about why a key is conditionally
// written still applies.
//
// Must stay React/JSX-free and import only from `../create/emit` (types).
import type { Entry, PortEntry, ResourceReq } from "../create/emit";

type Obj = Record<string, any>;

// ─── shared ─────────────────────────────────────────────────────────────────

export function toEntries(m: Record<string, unknown> | undefined | null): Entry[] {
  return Object.entries(m ?? {}).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

export function entriesToMap(entries: Entry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const key = e.key.trim();
    if (key) out[key] = e.value;
  }
  return out;
}

// Only writes `obj[key]` when there is something to write, OR `orig` already
// carried the key. Always assigning `{}` would make mergePatch see "absent on
// live" vs "present as {} on next" and emit a spurious patch entry.
export function setMap(obj: Obj, key: string, entries: Entry[], orig: Obj | undefined): void {
  const value: Record<string, string> = {};
  for (const e of entries) if (e.key.trim() !== "") value[e.key] = e.value;
  if (Object.keys(value).length > 0 || orig?.[key] !== undefined) obj[key] = value;
}

// ─── cm ─────────────────────────────────────────────────────────────────────

export function buildConfigMapNext(
  live: Obj,
  s: { labels: Entry[]; annotations: Entry[]; data: Entry[] },
): Obj {
  const next = structuredClone(live);
  next.metadata ??= {};
  setMap(next.metadata, "labels", s.labels, live.metadata);
  setMap(next.metadata, "annotations", s.annotations, live.metadata);
  setMap(next, "data", s.data, live);
  return next;
}

// ─── sec ────────────────────────────────────────────────────────────────────

export function decodeSecretData(data: Record<string, string> | undefined): { decoded: Entry[]; failedKeys: string[] } {
  const decoded: Entry[] = [];
  const failedKeys: string[] = [];
  for (const [key, b64] of Object.entries(data ?? {})) {
    try {
      const value = atob(b64);
      // Byte-preserving round-trip check: if it doesn't hold, treat the value
      // as opaque rather than display (and write back) a mangled copy.
      if (btoa(value) === b64) decoded.push({ key, value });
      else failedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  }
  return { decoded, failedKeys };
}

// Secret read path (`data`, base64) and write path (`stringData`, cleartext)
// are different fields. Edits/additions -> stringData; removals -> `data`
// omission (mergePatch turns it into the null sentinel). Keys that failed to
// decode were never shown, so "absent from the editor" never means "removed".
export function buildSecretNext(
  live: Obj,
  s: { entries: Entry[]; labels: Entry[]; annotations: Entry[] },
  originalValues: Record<string, string>,
  failedKeys: string[],
): Obj {
  const next = structuredClone(live);
  next.metadata ??= {};
  setMap(next.metadata, "labels", s.labels, live.metadata);
  setMap(next.metadata, "annotations", s.annotations, live.metadata);

  const currentKeys = new Set(s.entries.filter((e) => e.key.trim() !== "").map((e) => e.key));
  const stringData: Record<string, string> = {};
  for (const e of s.entries) {
    if (!e.key.trim()) continue;
    if (originalValues[e.key] !== e.value) stringData[e.key] = e.value;
  }
  if (Object.keys(stringData).length > 0) next.stringData = stringData;
  else delete next.stringData;

  if (live.data) {
    next.data = { ...live.data };
    for (const key of Object.keys(live.data)) {
      if (!currentKeys.has(key) && !failedKeys.includes(key)) delete next.data[key];
    }
  }
  return next;
}

// ─── deploy / sts / ds ──────────────────────────────────────────────────────

// Rebuilds a metadata map (labels/annotations) wholesale from the form's own
// entries. Safe because the entries were seeded from EVERY key `live` had.
export function applyEntries(target: Obj, key: "labels" | "annotations", entries: Entry[]): void {
  const map: Record<string, string> = {};
  for (const e of entries) {
    const k = e.key.trim();
    if (k) map[k] = e.value;
  }
  const had = Object.prototype.hasOwnProperty.call(target, key);
  if (Object.keys(map).length > 0 || had) target[key] = map;
  else delete target[key];
}

export type ContainerEdit = {
  name: string; // display only — this form does not add/remove/rename containers
  image: string;
  args: string[];
  env: Entry[]; // literal (plain-value) env vars only
  resources: ResourceReq;
};

export function seedContainers(live: Obj): ContainerEdit[] {
  const containers = live.spec?.template?.spec?.containers;
  if (!Array.isArray(containers)) return [];
  return containers.map((c: any) => ({
    name: typeof c?.name === "string" ? c.name : "",
    image: typeof c?.image === "string" ? c.image : "",
    args: Array.isArray(c?.args) ? c.args.map(String) : [],
    env: Array.isArray(c?.env)
      ? c.env
          .filter((e: any) => e && typeof e === "object" && e.valueFrom === undefined)
          .map((e: any) => ({
            key: typeof e.name === "string" ? e.name : "",
            value: e.value !== undefined ? String(e.value) : "",
          }))
      : [],
    resources: {
      cpuReq: c?.resources?.requests?.cpu !== undefined ? String(c.resources.requests.cpu) : "",
      memReq: c?.resources?.requests?.memory !== undefined ? String(c.resources.requests.memory) : "",
      cpuLim: c?.resources?.limits?.cpu !== undefined ? String(c.resources.limits.cpu) : "",
      memLim: c?.resources?.limits?.memory !== undefined ? String(c.resources.limits.memory) : "",
    },
  }));
}

// Mutates one request/limit key in place — never replaces the whole map, so
// an unmodelled entry (ephemeral-storage, nvidia.com/gpu) survives.
export function setResourceKey(resources: Obj, bucket: "requests" | "limits", key: string, value: string): void {
  const v = value.trim();
  resources[bucket] ??= {};
  if (v === "") delete resources[bucket][key];
  else resources[bucket][key] = v;
  if (Object.keys(resources[bucket]).length === 0) delete resources[bucket];
}

// Entries carrying `valueFrom` are copied through in their original slot;
// plain-value entries are matched by name (edited in place), dropped if the
// row was removed, and new ones are appended.
export function reconcileEnv(origEnv: unknown, formEnv: Entry[]): any[] {
  const orig = Array.isArray(origEnv) ? origEnv : [];
  const literalByName = new Map<string, string>();
  for (const e of formEnv) {
    const k = e.key.trim();
    if (k) literalByName.set(k, e.value);
  }
  const seen = new Set<string>();
  const rebuilt: any[] = [];
  for (const e of orig) {
    if (e && typeof e === "object" && e.valueFrom !== undefined) {
      rebuilt.push(e);
      continue;
    }
    const name = e?.name;
    if (typeof name === "string" && literalByName.has(name)) {
      // Only mutate when the value actually changed — an entry with no `value`
      // key (legal: means "") must stay keyless when left alone.
      const v = literalByName.get(name)!;
      const seededValue = e.value !== undefined ? String(e.value) : "";
      if (v !== seededValue) e.value = v;
      rebuilt.push(e);
      seen.add(name);
    }
  }
  for (const [name, value] of literalByName) {
    if (!seen.has(name)) rebuilt.push({ name, value });
  }
  return rebuilt;
}

export function buildWorkloadNext(
  live: Obj,
  s: { containers: ContainerEdit[]; labels: Entry[]; annotations: Entry[] },
): Obj {
  const next = structuredClone(live);
  const cs = next.spec?.template?.spec?.containers;
  if (Array.isArray(cs)) {
    s.containers.forEach((ce, i) => {
      const c = cs[i];
      if (!c) return; // array shape changed under us — nothing safe to write
      c.image = ce.image;

      // `args`/`env` are omitempty on the wire: only touch the key when the
      // new value differs or the key was already present.
      const hadArgs = Object.prototype.hasOwnProperty.call(c, "args");
      const nextArgs = [...ce.args];
      if (nextArgs.length > 0 || hadArgs) c.args = nextArgs;
      else delete c.args;

      const hadEnv = Object.prototype.hasOwnProperty.call(c, "env");
      const nextEnv = reconcileEnv(c.env, ce.env);
      if (nextEnv.length > 0 || hadEnv) c.env = nextEnv;
      else delete c.env;

      c.resources ??= {};
      setResourceKey(c.resources, "requests", "cpu", ce.resources.cpuReq);
      setResourceKey(c.resources, "requests", "memory", ce.resources.memReq);
      setResourceKey(c.resources, "limits", "cpu", ce.resources.cpuLim);
      setResourceKey(c.resources, "limits", "memory", ce.resources.memLim);
      if (Object.keys(c.resources).length === 0) delete c.resources;
    });
  }
  // spec.template.spec.initContainers is never referenced: rides through.
  next.metadata ??= {};
  applyEntries(next.metadata, "labels", s.labels);
  applyEntries(next.metadata, "annotations", s.annotations);
  return next;
}

// ─── svc ────────────────────────────────────────────────────────────────────

// PortEntry + a hidden original-index marker (survives PortListField's
// spread/filter handlers). Rows without it are new.
export type ServicePortRow = PortEntry & { _origIndex?: number | null };

export function seedServicePorts(live: Obj): ServicePortRow[] {
  const ports = Array.isArray(live.spec?.ports) ? live.spec.ports : [];
  return ports.map((p: any, i: number) => ({
    name: p.name ?? "",
    port: p.port != null ? String(p.port) : "",
    targetPort: p.targetPort != null ? String(p.targetPort) : "",
    protocol: p.protocol ?? "TCP",
    _origIndex: i,
  }));
}

export function buildServiceNext(
  live: Obj,
  s: { type: string; sessionAffinity: string; selector: Entry[]; ports: ServicePortRow[] },
): Obj {
  const next = structuredClone(live);
  next.spec ??= {};

  // clusterIP is never read from state nor written: the clone carries it.
  next.spec.type = s.type;
  next.spec.sessionAffinity = s.sessionAffinity;
  next.spec.selector = entriesToMap(s.selector);

  const origPorts: any[] = Array.isArray(next.spec.ports) ? next.spec.ports : [];
  const rebuilt = s.ports
    .filter((row) => row.port.trim() !== "")
    .map((row) => {
      const oi = row._origIndex;
      // Existing port: mutate the SAME cloned element so nodePort/appProtocol
      // survive. New port: minimal fresh object.
      const el: Obj = oi != null && origPorts[oi] ? origPorts[oi] : {};
      el.port = Number(row.port.trim());
      el.protocol = row.protocol || "TCP";
      if (row.name.trim()) el.name = row.name.trim();
      else delete el.name;
      const tp = row.targetPort.trim();
      if (tp) el.targetPort = /^\d+$/.test(tp) ? Number(tp) : tp;
      else delete el.targetPort;
      return el;
    });
  if (rebuilt.length > 0 || origPorts.length > 0) next.spec.ports = rebuilt;
  else delete next.spec.ports;
  return next;
}

// ─── rbindings / crbindings ─────────────────────────────────────────────────

export type SubjectEntry = { kind: "ServiceAccount" | "User" | "Group"; namespace: string; name: string };

export function subjectFromLive(s: any): SubjectEntry {
  return {
    kind: s?.kind === "User" || s?.kind === "Group" ? s.kind : "ServiceAccount",
    namespace: typeof s?.namespace === "string" ? s.namespace : "",
    name: typeof s?.name === "string" ? s.name : "",
  };
}

// rbacv1.Subject is a closed field set, so index-based mutate-in-place is
// lossless. namespace is required on a ServiceAccount subject in BOTH
// RoleBinding and ClusterRoleBinding.
export function buildSubjects(cloneSubjects: unknown, subjects: SubjectEntry[]): unknown[] {
  const base = Array.isArray(cloneSubjects) ? cloneSubjects : [];
  return subjects.map((s, i) => {
    const target: Record<string, unknown> =
      i < base.length && typeof base[i] === "object" && base[i] !== null ? (base[i] as Record<string, unknown>) : {};
    target.kind = s.kind;
    target.name = s.name.trim();
    if (s.kind === "ServiceAccount") {
      target.namespace = s.namespace.trim();
      if (target.apiGroup === "rbac.authorization.k8s.io") delete target.apiGroup;
    } else {
      target.apiGroup = "rbac.authorization.k8s.io";
      delete target.namespace;
    }
    return target;
  });
}

export function buildBindingNext(live: Obj, subjects: SubjectEntry[]): Obj {
  const next = structuredClone(live);
  const built = buildSubjects(next.subjects, subjects);
  // No phantom `subjects: []` on a binding that never had any.
  if (built.length > 0) next.subjects = built;
  else delete next.subjects;
  return next;
}
