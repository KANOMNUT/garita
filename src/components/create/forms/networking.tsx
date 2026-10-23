// OWNED BY THE NETWORKING AGENT. Exactly these five kinds, no others:
//   svc, ing, netpol, gw, httproute
//
// Five genuinely different shapes — five separate components, no sharing
// beyond the primitives in ../fields.tsx.
//
// gw.spec.gatewayClassName -> useGatewayClasses(context)
// ing.spec.ingressClassName -> useIngressClasses(context)
// Both hooks are already in src/hooks/useResources.ts and both Tauri
// commands (list_gateway_classes / list_ingress_classes) are landed and
// registered.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import {
  validateName,
  validateNamespace,
  entryErrors,
  kv,
  kvRaw,
  emitMap,
  emitList,
  metadata,
  doc,
  emitPorts,
  type Entry,
  type PortEntry,
} from "../emit";
import { Section, TextField, NumberField, SelectField, CheckField, KeyValueField, StringListField, PortListField } from "../fields";
import {
  useNamespaces,
  useServices,
  useSecrets,
  useGateways,
  useIngressClasses,
  useGatewayClasses,
} from "../../../hooks/useResources";

// ─── local UI helpers (private to this file — not shared across forms) ─────

function AddButton(p: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
    >
      <Plus size={11} /> {p.label}
    </button>
  );
}

function RemoveButton(p: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      title={p.title ?? "Remove"}
      className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
    >
      <Trash2 size={12} />
    </button>
  );
}

// ─── line-emission helpers (pure, no React) ────────────────────────────────

function pad(n: number): string {
  return " ".repeat(n);
}

// Merges a dash prefix ("  - ") with the first line of a kv()/emitMap()
// result, keeping any subsequent lines (a multi-line block scalar, or a
// non-empty map's body) at their already-correct absolute indentation.
// Needed everywhere a dash-list item's first field is a STRING value that
// isn't pre-validated (host, path, a dropdown name with allowCustom) — kv()
// may emit a block scalar for those, which a bare template-literal dash line
// can't represent.
function mergeDash(prefix: string, kvLines: string[]): string[] {
  return [`${prefix}${kvLines[0].trimStart()}`, ...kvLines.slice(1)];
}

// ── svc ──────────────────────────────────────────────────────────────────

function serialiseService(
  name: string,
  ns: string,
  labels: Entry[],
  type: string,
  selector: Entry[],
  ports: PortEntry[],
  externalName: string,
): string {
  const head = ["apiVersion: v1", "kind: Service", ...metadata(name, ns, labels), "spec:"];
  const spec: string[] = [...kvRaw("type", type, 2)];
  if (type === "ExternalName") {
    spec.push(...kv("externalName", externalName.trim(), 2));
  } else {
    spec.push(...emitMap("selector", selector, 2));
    spec.push(...emitPorts(ports, "service", 2));
  }
  return doc([head, spec]);
}

function SvcForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [type, setType] = useState("ClusterIP");
  const [selector, setSelector] = useState<Entry[]>([{ key: "app", value: "" }]);
  const [ports, setPorts] = useState<PortEntry[]>([{ name: "", port: "80", targetPort: "80", protocol: "TCP" }]);
  const [externalName, setExternalName] = useState("");

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasPort = ports.some((p) => p.port.trim() !== "");
  const valid =
    !nameError &&
    !namespaceError &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(selector, "label").some(Boolean) &&
    (type === "ExternalName" ? externalName.trim() !== "" : hasPort);

  useEffect(() => {
    onChange(serialiseService(name, ns, labels, type, selector, ports, externalName), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, type, selector, ports, externalName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-service" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]}
      />
      {type === "ExternalName" ? (
        <TextField label="External Name" value={externalName} onChange={setExternalName} placeholder="my.external.svc" mono />
      ) : (
        <>
          <KeyValueField keyKind="label" label="Selector" entries={selector} onChange={setSelector} keyPlaceholder="app" valuePlaceholder="value" />
          <PortListField label="Ports" ports={ports} onChange={setPorts} shape="service" />
        </>
      )}
    </div>
  );
}

// ── ing ──────────────────────────────────────────────────────────────────

type IngPath = { path: string; pathType: string; serviceName: string; servicePort: string };
type IngRule = { host: string; paths: IngPath[] };
type IngTlsEntry = { secretName: string; hosts: string[] };

function emitIngressRule(r: IngRule, indent: number): string[] {
  const validPaths = r.paths.filter((p) => p.serviceName.trim() !== "" && p.servicePort.trim() !== "");
  if (validPaths.length === 0) return [];
  const contIndent = indent + 2;
  const lines: string[] = [];
  if (r.host.trim()) {
    lines.push(...mergeDash(`${pad(indent)}- `, kv("host", r.host.trim(), contIndent)));
    lines.push(`${pad(contIndent)}http:`);
  } else {
    lines.push(`${pad(indent)}- http:`);
  }
  lines.push(`${pad(contIndent + 2)}paths:`);
  for (const p of validPaths) {
    const pathDash = contIndent + 4;
    const pathKeyCol = pathDash + 2;
    lines.push(...mergeDash(`${pad(pathDash)}- `, kv("path", p.path.trim() || "/", pathKeyCol)));
    lines.push(...kvRaw("pathType", p.pathType, pathKeyCol));
    lines.push(`${pad(pathKeyCol)}backend:`);
    lines.push(`${pad(pathKeyCol + 2)}service:`);
    lines.push(...kv("name", p.serviceName.trim(), pathKeyCol + 4));
    lines.push(`${pad(pathKeyCol + 4)}port:`);
    lines.push(...kvRaw("number", p.servicePort.trim(), pathKeyCol + 6));
  }
  return lines;
}

function emitTlsEntry(t: IngTlsEntry, indent: number): string[] {
  const keyCol = indent + 2;
  const lines = mergeDash(`${pad(indent)}- `, kv("secretName", t.secretName.trim(), keyCol));
  lines.push(...emitList("hosts", t.hosts.filter((h) => h.trim() !== ""), keyCol));
  return lines;
}

function serialiseIngress(
  name: string,
  ns: string,
  labels: Entry[],
  annotations: Entry[],
  ingressClassName: string,
  rules: IngRule[],
  tls: IngTlsEntry[],
): string {
  const head = ["apiVersion: networking.k8s.io/v1", "kind: Ingress", ...metadata(name, ns, labels, annotations), "spec:"];
  const spec: string[] = [];
  if (ingressClassName.trim()) spec.push(...kv("ingressClassName", ingressClassName.trim(), 2));
  const tlsClean = tls.filter((t) => t.secretName.trim() !== "");
  if (tlsClean.length > 0) {
    spec.push(`${pad(2)}tls:`);
    for (const t of tlsClean) spec.push(...emitTlsEntry(t, 4));
  }
  const ruleLines = rules.flatMap((r) => emitIngressRule(r, 4));
  if (ruleLines.length > 0) {
    spec.push(`${pad(2)}rules:`);
    spec.push(...ruleLines);
  }
  return doc([head, spec]);
}

function newIngPath(): IngPath {
  return { path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" };
}

function IngForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [annotations, setAnnotations] = useState<Entry[]>([]);
  const [ingressClassName, setIngressClassName] = useState("");
  const [rules, setRules] = useState<IngRule[]>([{ host: "", paths: [newIngPath()] }]);
  const [tls, setTls] = useState<IngTlsEntry[]>([]);

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  const { data: ingressClasses = [], isLoading: icLoading } = useIngressClasses(context);
  const { data: services = [] } = useServices(context, ns);
  const { data: secrets = [] } = useSecrets(context, ns);
  const serviceNames = services.map((s) => s.name);
  const secretNames = secrets.map((s) => s.name);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasValidRule = rules.some((r) => r.paths.some((p) => p.serviceName.trim() !== "" && p.servicePort.trim() !== ""));
  const valid =
    !nameError &&
    !namespaceError &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(annotations, "annotation").some(Boolean) &&
    hasValidRule;

  useEffect(() => {
    onChange(serialiseIngress(name, ns, labels, annotations, ingressClassName, rules, tls), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, annotations, ingressClassName, rules, tls]);

  const updateRule = (i: number, patch: Partial<IngRule>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const addRule = () => setRules([...rules, { host: "", paths: [newIngPath()] }]);

  const updatePath = (ri: number, pi: number, patch: Partial<IngPath>) =>
    setRules(
      rules.map((r, idx) =>
        idx !== ri ? r : { ...r, paths: r.paths.map((p, pidx) => (pidx === pi ? { ...p, ...patch } : p)) },
      ),
    );
  const removePath = (ri: number, pi: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, paths: r.paths.filter((_, pidx) => pidx !== pi) })));
  const addPath = (ri: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, paths: [...r.paths, newIngPath()] })));

  const updateTls = (i: number, patch: Partial<IngTlsEntry>) =>
    setTls(tls.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const removeTls = (i: number) => setTls(tls.filter((_, idx) => idx !== i));
  const addTls = () => setTls([...tls, { secretName: "", hosts: [] }]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-ingress" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <KeyValueField keyKind="annotation" label="Annotations" entries={annotations} onChange={setAnnotations} keyPlaceholder="key" valuePlaceholder="value" />
      <SelectField
        label="Ingress Class"
        value={ingressClassName}
        onChange={setIngressClassName}
        options={ingressClasses}
        loading={icLoading}
        allowCustom
        placeholder="(cluster default)"
      />
      <Section label="Rules" action={<AddButton onClick={addRule} label="add rule" />}>
        {rules.map((r, ri) => (
          <div key={ri} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <div className="flex-1">
                <TextField
                  label="Host"
                  value={r.host}
                  onChange={(v) => updateRule(ri, { host: v })}
                  placeholder="example.com (blank = catch-all)"
                  mono
                />
              </div>
              <RemoveButton onClick={() => removeRule(ri)} title="Remove rule" />
            </div>
            <Section label="Paths" action={<AddButton onClick={() => addPath(ri)} label="add path" />}>
              {r.paths.map((p, pi) => (
                <div key={pi} className="flex items-end gap-1.5 mb-1.5">
                  <div className="w-28">
                    <TextField label="Path" value={p.path} onChange={(v) => updatePath(ri, pi, { path: v })} placeholder="/" mono />
                  </div>
                  <div className="w-36">
                    <SelectField
                      label="Type"
                      value={p.pathType}
                      onChange={(v) => updatePath(ri, pi, { pathType: v })}
                      options={["Prefix", "Exact", "ImplementationSpecific"]}
                    />
                  </div>
                  <div className="flex-1">
                    <SelectField
                      label="Service"
                      value={p.serviceName}
                      onChange={(v) => updatePath(ri, pi, { serviceName: v })}
                      options={serviceNames}
                      allowCustom
                    />
                  </div>
                  <div className="w-20">
                    <NumberField label="Port" value={p.servicePort} onChange={(v) => updatePath(ri, pi, { servicePort: v })} placeholder="80" />
                  </div>
                  <RemoveButton onClick={() => removePath(ri, pi)} title="Remove path" />
                </div>
              ))}
            </Section>
          </div>
        ))}
      </Section>
      <Section label="TLS" action={<AddButton onClick={addTls} label="add tls" />}>
        {tls.map((t, i) => (
          <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <div className="flex-1">
                <SelectField
                  label="Secret"
                  value={t.secretName}
                  onChange={(v) => updateTls(i, { secretName: v })}
                  options={secretNames}
                  allowCustom
                />
              </div>
              <RemoveButton onClick={() => removeTls(i)} />
            </div>
            <StringListField label="Hosts" values={t.hosts} onChange={(v) => updateTls(i, { hosts: v })} placeholder="example.com" />
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── netpol ───────────────────────────────────────────────────────────────

type NetpolPeerKind = "podSelector" | "namespaceSelector" | "ipBlock";
type NetpolPeer = { kind: NetpolPeerKind; podSelector: Entry[]; namespaceSelector: Entry[]; cidr: string; except: string[] };
type NetpolPort = { port: string; protocol: string };
type NetpolRule = { peer: NetpolPeer; ports: NetpolPort[] };

function newNetpolRule(): NetpolRule {
  return { peer: { kind: "podSelector", podSelector: [], namespaceSelector: [], cidr: "", except: [] }, ports: [] };
}

// Three fixed peer branches, deliberately not generalised into a lookup —
// that generalisation is exactly the complexity this three-branch design
// exists to avoid.
function emitPeer(peer: NetpolPeer, indent: number): string[] {
  const keyCol = indent + 2;
  if (peer.kind === "ipBlock") {
    const lines = mergeDash(`${pad(indent)}- `, [`${pad(keyCol)}ipBlock:`]);
    lines.push(...kv("cidr", peer.cidr.trim(), keyCol + 2));
    lines.push(...emitList("except", peer.except.filter((e) => e.trim() !== ""), keyCol + 2));
    return lines;
  }
  const entries = peer.kind === "podSelector" ? peer.podSelector : peer.namespaceSelector;
  return mergeDash(`${pad(indent)}- `, emitMap(peer.kind, entries, keyCol));
}

function emitNetpolRule(rule: NetpolRule, peerKey: "from" | "to", indent: number): string[] {
  const fromCol = indent + 2;
  const lines = [`${pad(indent)}- ${peerKey}:`];
  lines.push(...emitPeer(rule.peer, fromCol + 2));
  const cleanPorts = rule.ports.filter((p) => p.port.trim() !== "");
  if (cleanPorts.length > 0) {
    lines.push(`${pad(fromCol)}ports:`);
    for (const p of cleanPorts) {
      lines.push(`${pad(fromCol + 2)}- port: ${p.port.trim()}`);
      const proto = p.protocol.trim().toUpperCase();
      if (proto && proto !== "TCP") lines.push(...kvRaw("protocol", proto, fromCol + 4)); // TCP is the k8s default
    }
  }
  return lines;
}

function serialiseNetpol(
  name: string,
  ns: string,
  labels: Entry[],
  podSelector: Entry[],
  ingressChecked: boolean,
  egressChecked: boolean,
  ingressRules: NetpolRule[],
  egressRules: NetpolRule[],
): string {
  const head = ["apiVersion: networking.k8s.io/v1", "kind: NetworkPolicy", ...metadata(name, ns, labels), "spec:"];
  // Empty podSelector correctly emits `podSelector: {}` (every pod in the
  // namespace) — intended, not a bug.
  const spec: string[] = [...emitMap("podSelector", podSelector, 2)];
  const types: string[] = [];
  if (ingressChecked) types.push("Ingress");
  if (egressChecked) types.push("Egress");
  spec.push(...emitList("policyTypes", types, 2));
  if (ingressChecked) {
    const lines = ingressRules.flatMap((r) => emitNetpolRule(r, "from", 4));
    spec.push(lines.length > 0 ? `${pad(2)}ingress:` : `${pad(2)}ingress: []`);
    spec.push(...lines);
  }
  if (egressChecked) {
    const lines = egressRules.flatMap((r) => emitNetpolRule(r, "to", 4));
    spec.push(lines.length > 0 ? `${pad(2)}egress:` : `${pad(2)}egress: []`);
    spec.push(...lines);
  }
  return doc([head, spec]);
}

function NetpolPortsField(p: { ports: NetpolPort[]; onChange: (v: NetpolPort[]) => void }) {
  const update = (i: number, patch: Partial<NetpolPort>) =>
    p.onChange(p.ports.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => p.onChange(p.ports.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.ports, { port: "", protocol: "TCP" }]);

  return (
    <Section label="Ports" action={<AddButton onClick={add} label="add port" />}>
      {p.ports.map((port, i) => (
        <div key={i} className="flex items-end gap-1.5 mb-1.5">
          <div className="w-24">
            <NumberField label="Port" value={port.port} onChange={(v) => update(i, { port: v })} placeholder="80" />
          </div>
          <div className="w-28">
            <SelectField label="Protocol" value={port.protocol} onChange={(v) => update(i, { protocol: v })} options={["TCP", "UDP", "SCTP"]} />
          </div>
          <RemoveButton onClick={() => remove(i)} />
        </div>
      ))}
    </Section>
  );
}

// Shared between the Ingress-Rules and Egress-Rules sections of NetpolForm —
// the spec calls out that egress is "the same shape" as ingress, so this is
// intra-file reuse of one kind's own two identical sub-sections, not
// cross-kind sharing.
function NetpolRulesField(p: { label: string; rules: NetpolRule[]; onChange: (r: NetpolRule[]) => void }) {
  const update = (i: number, patch: Partial<NetpolRule>) =>
    p.onChange(p.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => p.onChange(p.rules.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.rules, newNetpolRule()]);

  return (
    <Section label={p.label} action={<AddButton onClick={add} label="add rule" />}>
      {p.rules.map((r, i) => (
        <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <SelectField
                label="Peer kind"
                value={r.peer.kind}
                onChange={(v) => update(i, { peer: { ...r.peer, kind: v as NetpolPeerKind } })}
                options={["podSelector", "namespaceSelector", "ipBlock"]}
              />
            </div>
            <RemoveButton onClick={() => remove(i)} title="Remove rule" />
          </div>
          {r.peer.kind === "podSelector" && (
            <KeyValueField keyKind="label"
              label="Pod Selector"
              entries={r.peer.podSelector}
              onChange={(v) => update(i, { peer: { ...r.peer, podSelector: v } })}
              keyPlaceholder="key"
              valuePlaceholder="value"
            />
          )}
          {r.peer.kind === "namespaceSelector" && (
            <KeyValueField keyKind="label"
              label="Namespace Selector"
              entries={r.peer.namespaceSelector}
              onChange={(v) => update(i, { peer: { ...r.peer, namespaceSelector: v } })}
              keyPlaceholder="key"
              valuePlaceholder="value"
            />
          )}
          {r.peer.kind === "ipBlock" && (
            <>
              <TextField label="CIDR" value={r.peer.cidr} onChange={(v) => update(i, { peer: { ...r.peer, cidr: v } })} placeholder="10.0.0.0/24" mono />
              <StringListField
                label="Except"
                values={r.peer.except}
                onChange={(v) => update(i, { peer: { ...r.peer, except: v } })}
                placeholder="10.0.1.0/24"
              />
            </>
          )}
          <NetpolPortsField ports={r.ports} onChange={(v) => update(i, { ports: v })} />
        </div>
      ))}
    </Section>
  );
}

function NetpolForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [podSelector, setPodSelector] = useState<Entry[]>([]);
  const [ingressChecked, setIngressChecked] = useState(true);
  const [egressChecked, setEgressChecked] = useState(false);
  const [ingressRules, setIngressRules] = useState<NetpolRule[]>([]);
  const [egressRules, setEgressRules] = useState<NetpolRule[]>([]);

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const valid =
    !nameError &&
    !namespaceError &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(podSelector, "label").some(Boolean) &&
    (ingressChecked || egressChecked);

  useEffect(() => {
    onChange(
      serialiseNetpol(name, ns, labels, podSelector, ingressChecked, egressChecked, ingressRules, egressRules),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, podSelector, ingressChecked, egressChecked, ingressRules, egressRules]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="allow-frontend" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <KeyValueField keyKind="label"
        label="Pod Selector"
        entries={podSelector}
        onChange={setPodSelector}
        keyPlaceholder="key"
        valuePlaceholder="value"
      />
      <div className="flex items-center gap-4">
        <CheckField label="Ingress" value={ingressChecked} onChange={setIngressChecked} />
        <CheckField label="Egress" value={egressChecked} onChange={setEgressChecked} />
      </div>
      {ingressChecked && <NetpolRulesField label="Ingress Rules" rules={ingressRules} onChange={setIngressRules} />}
      {egressChecked && <NetpolRulesField label="Egress Rules" rules={egressRules} onChange={setEgressRules} />}
    </div>
  );
}

// ── gw ───────────────────────────────────────────────────────────────────

type GwListener = { name: string; protocol: string; port: string; hostname: string; certSecretName: string };

function emitListener(l: GwListener, indent: number): string[] {
  const keyCol = indent + 2;
  const lines = mergeDash(`${pad(indent)}- `, kv("name", l.name.trim(), keyCol));
  lines.push(...kvRaw("protocol", l.protocol, keyCol));
  lines.push(...kvRaw("port", l.port.trim(), keyCol));
  if (l.hostname.trim()) lines.push(...kv("hostname", l.hostname.trim(), keyCol));
  if ((l.protocol === "HTTPS" || l.protocol === "TLS") && l.certSecretName.trim()) {
    lines.push(`${pad(keyCol)}tls:`);
    lines.push(`${pad(keyCol + 2)}certificateRefs:`);
    lines.push(...mergeDash(`${pad(keyCol + 4)}- `, kv("name", l.certSecretName.trim(), keyCol + 6)));
  }
  return lines;
}

function serialiseGateway(name: string, ns: string, labels: Entry[], gatewayClassName: string, listeners: GwListener[]): string {
  const head = ["apiVersion: gateway.networking.k8s.io/v1", "kind: Gateway", ...metadata(name, ns, labels), "spec:"];
  const spec: string[] = [...kv("gatewayClassName", gatewayClassName.trim(), 2)];
  spec.push(`${pad(2)}listeners:`);
  for (const l of listeners) spec.push(...emitListener(l, 4));
  return doc([head, spec]);
}

function GwForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [gatewayClassName, setGatewayClassName] = useState("");
  const [listeners, setListeners] = useState<GwListener[]>([
    { name: "http", protocol: "HTTP", port: "80", hostname: "", certSecretName: "" },
  ]);

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  const { data: gatewayClasses = [], isLoading: gcLoading } = useGatewayClasses(context);
  const { data: secrets = [] } = useSecrets(context, ns);
  const secretNames = secrets.map((s) => s.name);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasValidListener = listeners.some((l) => l.name.trim() !== "" && l.port.trim() !== "");
  const valid =
    !nameError &&
    !namespaceError &&
    !entryErrors(labels, "label").some(Boolean) &&
    gatewayClassName.trim() !== "" &&
    hasValidListener;

  useEffect(() => {
    onChange(serialiseGateway(name, ns, labels, gatewayClassName, listeners), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, gatewayClassName, listeners]);

  const updateListener = (i: number, patch: Partial<GwListener>) =>
    setListeners(listeners.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeListener = (i: number) => setListeners(listeners.filter((_, idx) => idx !== i));
  const addListener = () =>
    setListeners([...listeners, { name: "", protocol: "HTTP", port: "", hostname: "", certSecretName: "" }]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-gateway" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <SelectField
        label="Gateway Class"
        value={gatewayClassName}
        onChange={setGatewayClassName}
        options={gatewayClasses}
        loading={gcLoading}
        allowCustom
      />
      <Section label="Listeners" action={<AddButton onClick={addListener} label="add listener" />}>
        {listeners.map((l, i) => (
          <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <div className="flex-1">
                <TextField label="Name" value={l.name} onChange={(v) => updateListener(i, { name: v })} placeholder="http" mono />
              </div>
              <div className="w-28">
                <SelectField
                  label="Protocol"
                  value={l.protocol}
                  onChange={(v) => updateListener(i, { protocol: v })}
                  options={["HTTP", "HTTPS", "TCP", "TLS", "UDP"]}
                />
              </div>
              <div className="w-20">
                <NumberField label="Port" value={l.port} onChange={(v) => updateListener(i, { port: v })} placeholder="80" />
              </div>
              <RemoveButton onClick={() => removeListener(i)} title="Remove listener" />
            </div>
            <TextField
              label="Hostname"
              value={l.hostname}
              onChange={(v) => updateListener(i, { hostname: v })}
              placeholder="(optional) example.com"
              mono
            />
            {(l.protocol === "HTTPS" || l.protocol === "TLS") && (
              <SelectField
                label="Certificate Secret"
                value={l.certSecretName}
                onChange={(v) => updateListener(i, { certSecretName: v })}
                options={secretNames}
                allowCustom
              />
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── httproute ────────────────────────────────────────────────────────────

type HttpParentRef = { name: string; sectionName: string };
type HttpBackendRef = { name: string; port: string; weight: string };
type HttpRule = { pathType: string; pathValue: string; backendRefs: HttpBackendRef[] };

function emitParentRef(pr: HttpParentRef, indent: number): string[] {
  const keyCol = indent + 2;
  const lines = mergeDash(`${pad(indent)}- `, kv("name", pr.name.trim(), keyCol));
  if (pr.sectionName.trim()) lines.push(...kv("sectionName", pr.sectionName.trim(), keyCol));
  return lines;
}

function emitBackendRef(b: HttpBackendRef, indent: number): string[] {
  const keyCol = indent + 2;
  const lines = mergeDash(`${pad(indent)}- `, kv("name", b.name.trim(), keyCol));
  lines.push(...kvRaw("port", b.port.trim(), keyCol));
  if (b.weight.trim()) lines.push(...kvRaw("weight", b.weight.trim(), keyCol));
  return lines;
}

function emitHttpRule(r: HttpRule, indent: number): string[] {
  const matchesKeyCol = indent + 2;
  const pathDashCol = matchesKeyCol + 2;
  const pathKeyCol = pathDashCol + 2;
  const typeValueCol = pathKeyCol + 2;
  const lines = [`${pad(indent)}- matches:`];
  lines.push(`${pad(pathDashCol)}- path:`);
  lines.push(...kvRaw("type", r.pathType, typeValueCol));
  lines.push(...kv("value", r.pathValue.trim() || "/", typeValueCol));
  lines.push(`${pad(matchesKeyCol)}backendRefs:`);
  for (const b of r.backendRefs) lines.push(...emitBackendRef(b, matchesKeyCol + 2));
  return lines;
}

function serialiseHttpRoute(
  name: string,
  ns: string,
  labels: Entry[],
  parentRefs: HttpParentRef[],
  hostnames: string[],
  rules: HttpRule[],
): string {
  const head = ["apiVersion: gateway.networking.k8s.io/v1", "kind: HTTPRoute", ...metadata(name, ns, labels), "spec:"];
  const spec: string[] = [`${pad(2)}parentRefs:`];
  for (const pr of parentRefs) spec.push(...emitParentRef(pr, 4));
  spec.push(...emitList("hostnames", hostnames.filter((h) => h.trim() !== ""), 2));
  spec.push(`${pad(2)}rules:`);
  for (const r of rules) spec.push(...emitHttpRule(r, 4));
  return doc([head, spec]);
}

function newHttpBackendRef(): HttpBackendRef {
  return { name: "", port: "80", weight: "" };
}

function HttpRouteForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [parentRefs, setParentRefs] = useState<HttpParentRef[]>([{ name: "", sectionName: "" }]);
  const [hostnames, setHostnames] = useState<string[]>([]);
  const [rules, setRules] = useState<HttpRule[]>([
    { pathType: "PathPrefix", pathValue: "/", backendRefs: [newHttpBackendRef()] },
  ]);

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  const { data: gateways = [] } = useGateways(context, ns);
  const { data: services = [] } = useServices(context, ns);
  const gatewayNames = gateways.map((g) => g.name);
  const serviceNames = services.map((s) => s.name);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasParent = parentRefs.some((p) => p.name.trim() !== "");
  const hasRule = rules.some((r) => r.backendRefs.some((b) => b.name.trim() !== "" && b.port.trim() !== ""));
  const valid = !nameError && !namespaceError && !entryErrors(labels, "label").some(Boolean) && hasParent && hasRule;

  useEffect(() => {
    onChange(serialiseHttpRoute(name, ns, labels, parentRefs, hostnames, rules), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, parentRefs, hostnames, rules]);

  const updateParentRef = (i: number, patch: Partial<HttpParentRef>) =>
    setParentRefs(parentRefs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeParentRef = (i: number) => setParentRefs(parentRefs.filter((_, idx) => idx !== i));
  const addParentRef = () => setParentRefs([...parentRefs, { name: "", sectionName: "" }]);

  const updateRule = (i: number, patch: Partial<HttpRule>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const addRule = () => setRules([...rules, { pathType: "PathPrefix", pathValue: "/", backendRefs: [newHttpBackendRef()] }]);

  const updateBackendRef = (ri: number, bi: number, patch: Partial<HttpBackendRef>) =>
    setRules(
      rules.map((r, idx) =>
        idx !== ri ? r : { ...r, backendRefs: r.backendRefs.map((b, bidx) => (bidx === bi ? { ...b, ...patch } : b)) },
      ),
    );
  const removeBackendRef = (ri: number, bi: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, backendRefs: r.backendRefs.filter((_, bidx) => bidx !== bi) })));
  const addBackendRef = (ri: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, backendRefs: [...r.backendRefs, newHttpBackendRef()] })));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-route" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <Section label="Parent Refs" action={<AddButton onClick={addParentRef} label="add parent" />}>
        {parentRefs.map((pr, i) => (
          <div key={i} className="flex items-end gap-1.5 mb-1.5">
            <div className="flex-1">
              <SelectField label="Gateway" value={pr.name} onChange={(v) => updateParentRef(i, { name: v })} options={gatewayNames} allowCustom />
            </div>
            <div className="flex-1">
              <TextField
                label="Section Name"
                value={pr.sectionName}
                onChange={(v) => updateParentRef(i, { sectionName: v })}
                placeholder="(optional)"
                mono
              />
            </div>
            <RemoveButton onClick={() => removeParentRef(i)} />
          </div>
        ))}
      </Section>
      <StringListField label="Hostnames" values={hostnames} onChange={setHostnames} placeholder="example.com" />
      <Section label="Rules" action={<AddButton onClick={addRule} label="add rule" />}>
        {rules.map((r, ri) => (
          <div key={ri} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <div className="w-40">
                <SelectField
                  label="Path Type"
                  value={r.pathType}
                  onChange={(v) => updateRule(ri, { pathType: v })}
                  options={["PathPrefix", "Exact", "RegularExpression"]}
                />
              </div>
              <div className="flex-1">
                <TextField label="Path Value" value={r.pathValue} onChange={(v) => updateRule(ri, { pathValue: v })} placeholder="/" mono />
              </div>
              <RemoveButton onClick={() => removeRule(ri)} title="Remove rule" />
            </div>
            <Section label="Backend Refs" action={<AddButton onClick={() => addBackendRef(ri)} label="add backend" />}>
              {r.backendRefs.map((b, bi) => (
                <div key={bi} className="flex items-end gap-1.5 mb-1.5">
                  <div className="flex-1">
                    <SelectField
                      label="Service"
                      value={b.name}
                      onChange={(v) => updateBackendRef(ri, bi, { name: v })}
                      options={serviceNames}
                      allowCustom
                    />
                  </div>
                  <div className="w-20">
                    <NumberField label="Port" value={b.port} onChange={(v) => updateBackendRef(ri, bi, { port: v })} placeholder="80" />
                  </div>
                  <div className="w-24">
                    <NumberField label="Weight" value={b.weight} onChange={(v) => updateBackendRef(ri, bi, { weight: v })} placeholder="(optional)" />
                  </div>
                  <RemoveButton onClick={() => removeBackendRef(ri, bi)} />
                </div>
              ))}
            </Section>
          </div>
        ))}
      </Section>
    </div>
  );
}

export const NETWORK_FORMS: Partial<Record<CreatableKind, CreateForm>> = {
  svc: SvcForm,
  ing: IngForm,
  netpol: NetpolForm,
  gw: GwForm,
  httproute: HttpRouteForm,
};
