import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { type Entry, entryErrors } from "../../create/emit";
import { TextField, NumberField, SelectField, KeyValueField, StringListField, PortListField, Section } from "../../create/fields";
import { useServices, useSecrets, useIngressClasses } from "../../../hooks/useResources";
import { seedServicePorts, buildServiceNext, type ServicePortRow } from "../transforms";

// OWNED BY THIS AGENT (Phase B — networking): svc, ing. See
// docs/plan-guided-edit.md §5 Tier 1 and the header comment in ../registry.ts
// for the frozen contract both forms below follow.
//
// THE HARD PART, per the task brief: both kinds are array-shaped
// (spec.ports[] / spec.rules[].http.paths[]), and RFC 7386 replaces arrays
// wholesale (see ../patch.ts). So every row keeps track of which index in
// the ORIGINAL live array it came from (`_origIndex` / `origIndex` /
// `origPathIndex`). On every change we rebuild the array from the live
// object's own cloned elements:
//   - a row with a known original index MUTATES that cloned element's
//     modelled fields in place — nodePort/appProtocol/anything else on that
//     element rides along untouched;
//   - a row with no original index (added by the user) gets a fresh minimal
//     object containing only the fields this form models;
//   - a row the user removed simply isn't in the row list, so it's absent
//     from the rebuilt array.
// This is NOT "rebuild the array from the form's own model" (the trap
// docs/plan-guided-edit.md §1.1 exists to close) — every surviving element
// is the server's own object with only its modelled leaves overwritten.

// ─── local UI helpers (mirrors create/forms/networking.tsx's private ones) ─

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

function mapToEntries(m: unknown): Entry[] {
  if (!m || typeof m !== "object") return [];
  return Object.entries(m as Record<string, string>).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

// ── svc ──────────────────────────────────────────────────────────────────

export function ServiceEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const [type, setType] = useState<string>(() => live.spec?.type ?? "ClusterIP");
  const [sessionAffinity, setSessionAffinity] = useState<string>(() => live.spec?.sessionAffinity ?? "None");
  const [selector, setSelector] = useState<Entry[]>(() => mapToEntries(live.spec?.selector));
  const [ports, setPorts] = useState<ServicePortRow[]>(() => seedServicePorts(live));

  const selectorValid = !entryErrors(selector, "label").some(Boolean);
  // Blank port rows (an "add port" the user hasn't filled in yet) are
  // dropped at emit time below, so they don't block validity here — only a
  // NON-blank port value that isn't a plain integer does.
  const portsValid = ports.every((row) => row.port.trim() === "" || /^\d+$/.test(row.port.trim()));
  const valid = selectorValid && portsValid;

  useEffect(() => {
    const next = buildServiceNext(live, { type, sessionAffinity, selector, ports });
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sessionAffinity, selector, ports]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Cluster IP"
          value={live.spec?.clusterIP ?? ""}
          onChange={() => {}}
          disabled
          hint="Immutable once assigned by the cluster."
          mono
        />
        <SelectField
          label="Type"
          value={type}
          onChange={setType}
          options={["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]}
        />
      </div>
      <SelectField label="Session Affinity" value={sessionAffinity} onChange={setSessionAffinity} options={["None", "ClientIP"]} />
      <KeyValueField keyKind="label" label="Selector" entries={selector} onChange={setSelector} keyPlaceholder="app" valuePlaceholder="value" />
      <PortListField label="Ports" ports={ports} onChange={(p) => setPorts(p as ServicePortRow[])} shape="service" />
    </div>
  );
}

// ── ing ──────────────────────────────────────────────────────────────────

type IngPathRow = {
  origPathIndex: number | null;
  path: string;
  pathType: string;
  serviceName: string;
  servicePort: string;
};
type IngRuleRow = {
  origIndex: number | null;
  host: string;
  paths: IngPathRow[];
};
type IngTlsRow = { secretName: string; hosts: string[] };

function newPathRow(): IngPathRow {
  return { origPathIndex: null, path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" };
}
function newRuleRow(): IngRuleRow {
  return { origIndex: null, host: "", paths: [newPathRow()] };
}

function seedRules(live: Record<string, any>): IngRuleRow[] {
  const rules = Array.isArray(live.spec?.rules) ? live.spec.rules : [];
  return rules.map((r: any, ri: number) => ({
    origIndex: ri,
    host: r.host ?? "",
    paths: (Array.isArray(r.http?.paths) ? r.http.paths : []).map((p: any, pi: number) => ({
      origPathIndex: pi,
      path: p.path ?? "",
      pathType: p.pathType ?? "Prefix",
      serviceName: p.backend?.service?.name ?? "",
      servicePort:
        p.backend?.service?.port?.number != null
          ? String(p.backend.service.port.number)
          : (p.backend?.service?.port?.name ?? ""),
    })),
  }));
}

function seedTls(live: Record<string, any>): IngTlsRow[] {
  const tls = Array.isArray(live.spec?.tls) ? live.spec.tls : [];
  return tls.map((t: any) => ({
    secretName: t.secretName ?? "",
    hosts: Array.isArray(t.hosts) ? [...t.hosts] : [],
  }));
}

export function IngressEditForm({ context, namespace, name: _name, live, onChange }: EditFormProps) {
  const [ingressClassName, setIngressClassName] = useState<string>(() => live.spec?.ingressClassName ?? "");
  const [rules, setRules] = useState<IngRuleRow[]>(() => seedRules(live));
  const [tls, setTls] = useState<IngTlsRow[]>(() => seedTls(live));

  const { data: ingressClasses = [], isLoading: icLoading } = useIngressClasses(context);
  const { data: services = [] } = useServices(context, namespace);
  const { data: secrets = [] } = useSecrets(context, namespace);
  const serviceNames = services.map((s) => s.name);
  const secretNames = secrets.map((s) => s.name);

  const hasValidRule = rules.some((r) => r.paths.some((p) => p.serviceName.trim() !== "" && p.servicePort.trim() !== ""));
  const valid = hasValidRule;

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};

    if (ingressClassName.trim()) next.spec.ingressClassName = ingressClassName.trim();
    else delete next.spec.ingressClassName;

    const origRules: any[] = Array.isArray(next.spec.rules) ? next.spec.rules : [];
    const rebuiltRules = rules
      .map((ruleRow) => {
        const validPaths = ruleRow.paths.filter((p) => p.serviceName.trim() !== "" && p.servicePort.trim() !== "");
        if (validPaths.length === 0) return null;

        const oi = ruleRow.origIndex;
        // Existing rule: mutate the SAME cloned element in place (so e.g. an
        // unmodelled field elsewhere on the rule survives). New rule: fresh.
        const ruleEl: Record<string, any> = oi != null && origRules[oi] ? origRules[oi] : {};
        if (ruleRow.host.trim()) ruleEl.host = ruleRow.host.trim();
        else delete ruleEl.host;

        ruleEl.http ??= {};
        // Captured BEFORE ruleEl.http.paths is reassigned below — this is
        // what origPathIndex indexes into.
        const origPaths: any[] = Array.isArray(ruleEl.http.paths) ? ruleEl.http.paths : [];
        ruleEl.http.paths = validPaths.map((pathRow) => {
          const pi = pathRow.origPathIndex;
          // Existing path: mutate path/pathType/backend.service.{name,port}
          // in place on the server's own element — do NOT rebuild it, or a
          // custom `backend.resource` / other unmodelled field on this path
          // silently disappears. New path: minimal fresh object.
          const pathEl: Record<string, any> = pi != null && origPaths[pi] ? origPaths[pi] : {};
          pathEl.path = pathRow.path.trim() || "/";
          pathEl.pathType = pathRow.pathType || "Prefix";
          pathEl.backend ??= {};
          pathEl.backend.service ??= {};
          pathEl.backend.service.name = pathRow.serviceName.trim();
          pathEl.backend.service.port ??= {};
          const portVal = pathRow.servicePort.trim();
          if (/^\d+$/.test(portVal)) {
            pathEl.backend.service.port.number = Number(portVal);
            delete pathEl.backend.service.port.name;
          } else {
            pathEl.backend.service.port.name = portVal;
            delete pathEl.backend.service.port.number;
          }
          return pathEl;
        });
        return ruleEl;
      })
      .filter((r): r is Record<string, any> => r !== null);

    if (rebuiltRules.length > 0 || origRules.length > 0) next.spec.rules = rebuiltRules;
    else delete next.spec.rules;

    // IngressTLS has exactly two fields (secretName, hosts) — nothing else
    // upstream, so unlike ports/rules there is no unmodelled-sibling-field
    // risk and a fresh rebuild every time is safe.
    const tlsClean = tls
      .filter((t) => t.secretName.trim() !== "")
      .map((t) => {
        const hosts = t.hosts.filter((h) => h.trim() !== "");
        return hosts.length > 0 ? { secretName: t.secretName.trim(), hosts } : { secretName: t.secretName.trim() };
      });
    if (tlsClean.length > 0) next.spec.tls = tlsClean;
    else delete next.spec.tls;

    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingressClassName, rules, tls]);

  const updateRule = (i: number, patch: Partial<IngRuleRow>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const addRule = () => setRules([...rules, newRuleRow()]);

  const updatePath = (ri: number, pi: number, patch: Partial<IngPathRow>) =>
    setRules(
      rules.map((r, idx) =>
        idx !== ri ? r : { ...r, paths: r.paths.map((p, pidx) => (pidx === pi ? { ...p, ...patch } : p)) },
      ),
    );
  const removePath = (ri: number, pi: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, paths: r.paths.filter((_, pidx) => pidx !== pi) })));
  const addPath = (ri: number) =>
    setRules(rules.map((r, idx) => (idx !== ri ? r : { ...r, paths: [...r.paths, newPathRow()] })));

  const updateTls = (i: number, patch: Partial<IngTlsRow>) => setTls(tls.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const removeTls = (i: number) => setTls(tls.filter((_, idx) => idx !== i));
  const addTls = () => setTls([...tls, { secretName: "", hosts: [] }]);

  return (
    <div className="flex flex-col gap-3">
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

export const NETWORKING_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  svc: ServiceEditForm,
  ing: IngressEditForm,
};
