// Pure YAML-emission primitives for the create-form layer.
//
// NO REACT AND NO IMPORTS HERE. This file must be loadable by a bare Node
// script (scripts/check-emit.ts) with zero transitive dependencies — Node's
// native TS type-stripping erases type annotations but does not resolve
// module graphs or transform JSX, so anything this file imports would have
// to be import-free all the way down. Easier to just have none.
//
// fields.tsx imports from here; this file never imports from fields.tsx —
// the dependency runs one way.

export type Entry = { key: string; value: string };

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// ConfigMap/Secret DATA key — IsConfigMapKey (apimachinery/pkg/util/validation):
// configMapKeyFmt = `[-._a-zA-Z0-9]+`, max length DNS1123SubdomainMaxLength
// (253), plus hasChDirPrefix: not ".", not "..", must not start with "..".
// This is a DIFFERENT grammar from a label/annotation key (see
// validateLabelKey below) — do not reuse this for labels/annotations, that
// was the original bug (see CLAUDE.md's Known Open Items).
const KEY_RE = /^[-._a-zA-Z0-9]+$/;

export function validateName(name: string): string {
  if (!name) return "Name is required";
  if (name.length > 253) return "Name must be 253 characters or fewer";
  if (!NAME_RE.test(name)) return "Lowercase alphanumeric or '-', must start/end alphanumeric";
  return "";
}

export function validateKey(key: string): string {
  if (!key) return "Key is required";
  if (key.length > 253) return "Key must be 253 characters or fewer";
  if (!KEY_RE.test(key)) return "Only letters, digits, '-', '_', '.' allowed";
  if (key === "." || key === ".." || key.startsWith("..")) return "Key cannot be '.', '..', or start with '..'";
  return "";
}

// Label/annotation KEY — a "qualified name": an optional DNS-1123 subdomain
// prefix (max 253) + "/", then a name part (max 63, must start/end
// alphanumeric, "-"/"_"/"." allowed between). See content.IsLabelKey in
// apimachinery/pkg/api/validate/content/kube.go. There is NO reserved-prefix
// rule (kubernetes.io/, k8s.io/ are not special-cased) — do not add one.
//
// Annotation keys are validated case-INSENSITIVELY: ValidateAnnotations
// lowercases the whole key before running this check (objectmeta.go). Label
// keys are case-sensitive (ValidateLabelName does not lowercase), so
// `Foo.com/bar` is a legal annotation key but an illegal label key.
const LABEL_NAME_RE = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const DNS1123_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export function validateLabelKey(key: string, annotation: boolean): string {
  if (!key) return "Key is required";
  const k = annotation ? key.toLowerCase() : key;
  const parts = k.split("/");
  if (parts.length > 2) return "At most one '/' allowed";
  let name = k;
  if (parts.length === 2) {
    const [prefix, rest] = parts;
    if (!prefix) return "Prefix cannot be empty";
    if (prefix.length > 253 || !DNS1123_SUBDOMAIN_RE.test(prefix)) return "Prefix must be a DNS subdomain (max 253)";
    name = rest;
  }
  if (!name) return "Name part is required";
  if (name.length > 63) return "Name part must be 63 characters or fewer";
  if (!LABEL_NAME_RE.test(name)) return "Name part must start/end alphanumeric ('-', '_', '.' allowed between)";
  return "";
}

// Namespace is interpolated raw into the document by metadata() below, with
// no escaping, so unlike an ordinary API-rejection risk this is one of the
// two fields (alongside name) that can break the YAML document's structure
// itself — a pasted value containing a newline would inject a sibling key.
// Same character class as a resource name, shorter max length (K8s
// namespace names cap at 63, not 253).
export function validateNamespace(ns: string): string {
  if (!ns) return "Namespace is required";
  if (ns.length > 63) return "Namespace must be 63 characters or fewer";
  if (!NAME_RE.test(ns)) return "Lowercase alphanumeric or '-', must start/end alphanumeric";
  return "";
}

// Per-entry error messages, "" when clean. A blank key is not itself an
// error (that row is just dropped before serialising) but it can't collide
// with another key either.
//
// `kind` is REQUIRED, no default — "data" (ConfigMap/Secret keys, container
// env names) and "label"/"annotation" (labels, selector, podSelector,
// matchLabels, StorageClass parameters, ResourceQuota hard, annotations) are
// different grammars (see validateKey vs validateLabelKey above). A default
// here previously let every label/annotation caller silently validate
// against the wrong one; requiring the argument at every call site is the
// fix.
export function entryErrors(entries: Entry[], kind: "data" | "label" | "annotation"): string[] {
  const seen = new Set<string>();
  return entries.map((e) => {
    if (!e.key) return "";
    const err = kind === "data" ? validateKey(e.key) : validateLabelKey(e.key, kind === "annotation");
    if (err) return err;
    if (seen.has(e.key)) return "Duplicate key";
    seen.add(e.key);
    return "";
  });
}

function pad(indent: number): string {
  return " ".repeat(indent);
}

// R8: explicit "|2-" indentation indicator, not a bare "|-". A bare literal
// block scalar auto-detects its strip width from the indentation of its
// first non-empty content line, so a value whose own first line starts with
// leading whitespace would have that whitespace folded into the detected
// width and stripped right back out (verified empirically — a bare "|-" on
// such input either silently loses the leading spaces or, if a later line
// is less indented than the first, fails to parse at all).
//
// The indicator is the constant 2 — not derived from `indent` — because it
// is relative to the PARENT MAPPING's indentation (i.e. the `key:` line
// itself), not absolute: content always sits exactly 2 spaces deeper than
// its own key, regardless of how deep the key itself is nested.
export function blockScalar(key: string, value: string, indent: number): string[] {
  const lines = [`${pad(indent)}${key}: |2-`];
  for (const line of value.split("\n")) {
    lines.push(line === "" ? "" : `${pad(indent + 2)}${line}`);
  }
  return lines;
}

const BARE_RE = /^[A-Za-z0-9/][-A-Za-z0-9_.@/]*$/;
const BOOL_NULL_LOOKALIKE_RE = /^(true|false|null|yes|no|on|off|~)$/i;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function isBareSafe(value: string): boolean {
  return (
    BARE_RE.test(value) &&
    !BOOL_NULL_LOOKALIKE_RE.test(value) &&
    !NUMERIC_RE.test(value) &&
    !value.includes("\n")
  );
}

// STRING semantics: the value is always meant to survive as a string, never
// silently retyped by the YAML parser into a bool/null/number. "" -> `""`.
// Bare only when it's a safe identifier-like token; otherwise a block
// scalar (never a quoted flow scalar — that reintroduces escaping, which is
// exactly what R8 avoids for the ConfigMap/Secret data path this was built
// for). The lookalike guard matters: a label value of "true" must stay a
// string, and one of "123" must not silently become a YAML integer.
export function kv(key: string, value: string, indent: number): string[] {
  if (value === "") return [`${pad(indent)}${key}: ""`];
  if (isBareSafe(value)) return [`${pad(indent)}${key}: ${value}`];
  // Single-line -> quoted flow scalar, the same choice listScalar() already
  // makes for list items. A block scalar is the right emitter for genuinely
  // multi-line content (the ConfigMap/Secret data path, which calls
  // blockScalar directly and never routes through here), but spilling a cron
  // schedule or a quota value of "4" across two lines as `|2-` reads as
  // broken in the YAML toggle. JSON's escaping is a valid subset of YAML
  // double-quoted escaping for single-line text, so there is no escaping
  // judgement being made here.
  if (!value.includes("\n")) return [`${pad(indent)}${key}: ${JSON.stringify(value)}`];
  return blockScalar(key, value, indent);
}

// For values the caller has already produced as a valid YAML literal
// (numbers, booleans, enum strings the form itself constrains) — emitted
// verbatim, no quoting/escaping decision made here.
export function kvRaw(key: string, literal: string, indent: number): string[] {
  // NumberField and friends are plain text inputs, so a pasted value can
  // contain a newline — which in block context would inject a sibling key
  // ("replicas: 1\n  hostNetwork: true"). Degrade to kv()'s string
  // semantics rather than emitting something structural.
  if (/[\n\r]/.test(literal)) return kv(key, literal, indent);
  return [`${pad(indent)}${key}: ${literal}`];
}

export function emitMap(key: string, entries: Entry[], indent: number): string[] {
  const clean = entries.filter((e) => e.key);
  if (clean.length === 0) return [`${pad(indent)}${key}: {}`];
  const lines = [`${pad(indent)}${key}:`];
  for (const { key: k, value } of clean) lines.push(...kv(k, value, indent + 2));
  return lines;
}

// A block-sequence list item that isn't safe to emit bare is quoted with
// JSON.stringify rather than routed through blockScalar — a multi-line
// block scalar as a bare list item (`- |2-\n    value`) is valid YAML but
// unreadable for what's normally a single short token (a command arg, a
// flag). JSON's escaping rules are a valid subset of YAML double-quoted
// flow-scalar escaping for ordinary text, so this is safe for the string
// content list fields actually feed it (command/args). Same isBareSafe
// guard as kv(), for the same reason: an arg of "3600" or "true" must not
// silently become a number/bool when the manifest is parsed.
function listScalar(value: string): string {
  if (value === "") return '""';
  return isBareSafe(value) ? value : JSON.stringify(value);
}

export function emitList(key: string, values: string[], indent: number): string[] {
  if (values.length === 0) return [];
  const lines = [`${pad(indent)}${key}:`];
  for (const v of values) lines.push(`${pad(indent + 2)}- ${listScalar(v)}`);
  return lines;
}

// R5: the ONLY place in the codebase that decides whether a `namespace:`
// line is emitted. `namespace: null` means cluster-scoped and emits none —
// a valid-YAML-but-API-rejected manifest (a stray namespace line on a
// cluster-scoped kind, or a missing one on a namespaced kind) is closed
// structurally here instead of by every form remembering it correctly.
// name/namespace are interpolated raw (both pre-validated by
// validateName/validateNamespace, so — like the shipped skeleton before
// this refactor — they can never need quoting); label/annotation VALUES go
// through kv() since arbitrary label values are not pre-validated the same
// way.
export function metadata(
  name: string,
  namespace: string | null,
  labels?: Entry[],
  annotations?: Entry[],
  indent = 0,
): string[] {
  const lines = [`${pad(indent)}metadata:`, `${pad(indent + 2)}name: ${name}`];
  if (namespace !== null) lines.push(...kvRaw("namespace", namespace, indent + 2));
  const cleanLabels = (labels ?? []).filter((e) => e.key);
  const cleanAnnotations = (annotations ?? []).filter((e) => e.key);
  if (cleanLabels.length > 0) lines.push(...emitMap("labels", cleanLabels, indent + 2));
  if (cleanAnnotations.length > 0) lines.push(...emitMap("annotations", cleanAnnotations, indent + 2));
  return lines;
}

// R7: the ONLY place that turns a form's line arrays into the final YAML
// string. Every form's serialiser ends by calling this, so the Form/YAML
// toggle and the submit path can never disagree — there is exactly one
// code path from state to string.
export function doc(lines: string[][]): string {
  return lines.flat().join("\n") + "\n";
}

// Moved verbatim from forms/keyvalue.tsx so ConfigMap and Secret (Opaque)
// share ONE definition. This must stay byte-identical to the pre-refactor
// ResourceCreator.tsx's serialiseKeyValue for the same inputs (verified in
// scripts/check-emit.ts case 7/10) — do NOT route the data block through
// emitMap()/kv(). kv()'s bare-value fast path would emit `foo: bar` for a
// simple value where the shipped serialiser (and this) always emits a
// block scalar (`foo: |2-` / `  bar`), per R8. emitMap/kv are for
// labels/annotations/nodeSelector elsewhere — this data block has its own,
// stricter, always-block-scalar rule.
export function emitDataBlock(dataKey: "data" | "stringData", entries: Entry[]): string[] {
  const clean = entries.filter((e) => e.key);
  if (clean.length === 0) return [`${dataKey}: {}`];
  return [
    `${dataKey}:`,
    ...clean.flatMap(({ key, value }) => (value === "" ? [`  ${key}: ""`] : blockScalar(key, value, 2))),
  ];
}

// ─── Secret type-specific serialisers ──────────────────────────────────────
// Four Secret types get special validation server-side (ValidateSecret in
// pkg/apis/core/validation/validation.go). `stringData` is merged into
// `data` BEFORE that validation runs (see ValidateSecretUpdate's comment),
// so cleartext PEM/JSON under stringData satisfies every required-keys
// check below — never base64 anything by hand except the docker `auth`
// field, which the API server never derives itself.
export type SecretPayload =
  | { type: "Opaque"; entries: Entry[] }
  | { type: "kubernetes.io/tls"; crt: string; key: string; ca: string }
  | { type: "kubernetes.io/dockerconfigjson"; json: string }
  | { type: "kubernetes.io/service-account-token"; serviceAccount: string };

// Mirrors kubectl's handleDockerCfgJSONContent / encodeDockerConfigFieldAuth
// (staging/.../kubectl/pkg/cmd/create/create_secret_docker.go): `auth` is
// generated CLIENT-SIDE as base64(username:password) — the API server never
// derives it. `email` is genuinely optional on a populated secret (Go
// `omitempty`, and kubectl does not require the flag), so a blank one is
// omitted as a key rather than sent as "". Blank username/password are
// omitted too, but that is OUR choice for a clean half-filled preview, not
// mirrored behaviour — kubectl enforces both as required before it ever
// marshals, so upstream has no blank-username case to copy. The form blocks
// submit on either being empty. A bare btoa() throws
// InvalidCharacterError on any
// non-Latin-1 character (a password containing e.g. "é"), so encode
// through TextEncoder first — base64-of-UTF-8-bytes, which is what Docker
// expects.
export function dockerConfigJson(server: string, username: string, password: string, email: string): string {
  const auth = btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)));
  const entry: Record<string, string> = {};
  if (username) entry.username = username;
  if (password) entry.password = password;
  if (email) entry.email = email;
  entry.auth = auth;
  // One JSON.stringify call -> any newline in a free-text field is escaped
  // to "\n" in the output, so the emitted block scalar always has exactly
  // ONE content line. That is what makes this path structurally safe
  // without a separate newline guard.
  return JSON.stringify({ auths: { [server]: entry } });
}

// The only serialiser for all four Secret types. `type` is emitted via
// kvRaw (not a raw template string) so all four literals go through the
// same newline-guarded path as every other enum-like field — degrades
// safely rather than needing a "never make the type select allowCustom"
// rule.
export function emitSecret(name: string, namespace: string, payload: SecretPayload): string {
  const head = ["apiVersion: v1", "kind: Secret", ...metadata(name, namespace)];
  switch (payload.type) {
    case "Opaque":
      return doc([[...head, ...kvRaw("type", payload.type, 0)], emitDataBlock("stringData", payload.entries)]);
    case "kubernetes.io/tls": {
      const entries: Entry[] = [
        { key: "tls.crt", value: payload.crt },
        { key: "tls.key", value: payload.key },
      ];
      // ca.crt is optional upstream — omitted entirely when blank, never
      // emitted as `ca.crt: ""`.
      if (payload.ca) entries.push({ key: "ca.crt", value: payload.ca });
      return doc([[...head, ...kvRaw("type", payload.type, 0)], emitDataBlock("stringData", entries)]);
    }
    case "kubernetes.io/dockerconfigjson":
      return doc([
        [...head, ...kvRaw("type", payload.type, 0)],
        emitDataBlock("stringData", [{ key: ".dockerconfigjson", value: payload.json }]),
      ]);
    case "kubernetes.io/service-account-token":
      // The token controller resolves the ServiceAccount in the Secret's
      // OWN namespace and DELETES the Secret if it doesn't exist there —
      // see CLAUDE.md. No data/stringData block: the controller populates
      // `token`, `ca.crt`, `namespace` itself.
      return doc([
        [
          "apiVersion: v1",
          "kind: Secret",
          ...metadata(name, namespace, undefined, [
            { key: "kubernetes.io/service-account.name", value: payload.serviceAccount },
          ]),
          ...kvRaw("type", payload.type, 0),
        ],
      ]);
  }
}

// ─── Shared container/pod-spec types + emitters ────────────────────────────
// These live here (not in fields.tsx) so the dependency direction is fixed:
// fields.tsx imports emit.ts, never the reverse.

export type PortEntry = { name: string; port: string; targetPort: string; protocol: string };
export type ResourceReq = { cpuReq: string; memReq: string; cpuLim: string; memLim: string };
export type ContainerEntry = {
  name: string;
  image: string;
  command: string[];
  args: string[];
  ports: PortEntry[];
  env: Entry[];
  envFrom: { kind: "configMapRef" | "secretRef"; name: string }[];
  resources: ResourceReq;
};

export function emitPorts(ports: PortEntry[], shape: "container" | "service", indent: number): string[] {
  const clean = ports.filter((p) => p.port.trim() !== "");
  if (clean.length === 0) return [];
  const lines = [`${pad(indent)}ports:`];
  for (const p of clean) {
    const rows: string[] = [];
    if (p.name.trim()) rows.push(`name: ${p.name.trim()}`);
    if (shape === "container") {
      rows.push(`containerPort: ${p.port.trim()}`);
    } else {
      rows.push(`port: ${p.port.trim()}`);
      if (p.targetPort.trim()) rows.push(`targetPort: ${p.targetPort.trim()}`);
    }
    const proto = p.protocol.trim().toUpperCase();
    if (proto && proto !== "TCP") rows.push(`protocol: ${proto}`); // TCP is the k8s default; omit to match shipped-template style
    lines.push(`${pad(indent + 2)}- ${rows[0]}`);
    for (const r of rows.slice(1)) lines.push(`${pad(indent + 4)}${r}`);
  }
  return lines;
}

// A pure numeric string ("4") is quoted so it round-trips as a string
// Quantity rather than a YAML integer — matches the shipped `rq` template's
// own convention (`requests.cpu: "4"` vs unquoted `cpu: 500m`).
function quantity(v: string): string {
  const t = v.trim();
  return NUMERIC_RE.test(t) ? `"${t}"` : t;
}

// [] when all four fields are blank — omit `resources:` entirely rather
// than emit an empty requests/limits shell.
export function emitResources(r: ResourceReq, indent: number): string[] {
  const hasReq = r.cpuReq.trim() !== "" || r.memReq.trim() !== "";
  const hasLim = r.cpuLim.trim() !== "" || r.memLim.trim() !== "";
  if (!hasReq && !hasLim) return [];
  const lines = [`${pad(indent)}resources:`];
  if (hasReq) {
    lines.push(`${pad(indent + 2)}requests:`);
    if (r.cpuReq.trim()) lines.push(`${pad(indent + 4)}cpu: ${quantity(r.cpuReq)}`);
    if (r.memReq.trim()) lines.push(`${pad(indent + 4)}memory: ${quantity(r.memReq)}`);
  }
  if (hasLim) {
    lines.push(`${pad(indent + 2)}limits:`);
    if (r.cpuLim.trim()) lines.push(`${pad(indent + 4)}cpu: ${quantity(r.cpuLim)}`);
    if (r.memLim.trim()) lines.push(`${pad(indent + 4)}memory: ${quantity(r.memLim)}`);
  }
  return lines;
}

// env: is a LIST of {name, value} objects (not a map like ConfigMap data /
// labels), so it cannot go through emitMap. Not exported — only
// emitContainers needs it, and exposing it would invite a caller to use it
// for an actual map field by mistake.
function emitEnvList(
  entries: Entry[],
  envFrom: ContainerEntry["envFrom"],
  indent: number,
): string[] {
  const clean = entries.filter((e) => e.key);
  const cleanFrom = envFrom.filter((e) => e.name.trim());
  const lines: string[] = [];
  if (clean.length > 0) {
    lines.push(`${pad(indent)}env:`);
    for (const { key, value } of clean) {
      lines.push(`${pad(indent + 2)}- name: ${key}`);
      lines.push(...kv("value", value, indent + 4));
    }
  }
  if (cleanFrom.length > 0) {
    lines.push(`${pad(indent)}envFrom:`);
    for (const ef of cleanFrom) {
      lines.push(`${pad(indent + 2)}- ${ef.kind}:`);
      lines.push(`${pad(indent + 4)}name: ${ef.name.trim()}`);
    }
  }
  return lines;
}

export function emitContainers(cs: ContainerEntry[], indent: number): string[] {
  if (cs.length === 0) return [];
  const lines = [`${pad(indent)}containers:`];
  for (const c of cs) {
    lines.push(`${pad(indent + 2)}- name: ${c.name.trim()}`);
    lines.push(`${pad(indent + 4)}image: ${c.image.trim()}`);
    lines.push(...emitList("command", c.command.filter((s) => s.trim() !== ""), indent + 4));
    lines.push(...emitList("args", c.args.filter((s) => s.trim() !== ""), indent + 4));
    lines.push(...emitPorts(c.ports, "container", indent + 4));
    lines.push(...emitEnvList(c.env, c.envFrom, indent + 4));
    lines.push(...emitResources(c.resources, indent + 4));
  }
  return lines;
}

// Pod-*spec*-level fields only — no replicas, no selector, no workload
// shape. Each workload form owns translating its own kind into a
// template/podSpec wrapper; this function must never grow a kind switch,
// that's the failure mode it exists to avoid.
export function emitPodSpec(
  opts: {
    containers: ContainerEntry[];
    restartPolicy?: string;
    serviceAccountName?: string;
    nodeSelector?: Entry[];
  },
  indent: number,
): string[] {
  const lines: string[] = [];
  lines.push(...emitContainers(opts.containers, indent));
  if (opts.restartPolicy) lines.push(...kvRaw("restartPolicy", opts.restartPolicy, indent));
  if (opts.serviceAccountName?.trim()) {
    lines.push(...kvRaw("serviceAccountName", opts.serviceAccountName.trim(), indent));
  }
  const cleanSelector = (opts.nodeSelector ?? []).filter((e) => e.key);
  if (cleanSelector.length > 0) lines.push(...emitMap("nodeSelector", cleanSelector, indent));
  return lines;
}
