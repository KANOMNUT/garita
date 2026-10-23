import { useEffect, useState } from "react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import {
  validateName,
  validateNamespace,
  entryErrors,
  metadata,
  doc,
  emitDataBlock,
  dockerConfigJson,
  emitSecret,
  type Entry,
  type SecretPayload,
} from "../emit";
import { TextField, SelectField, KeyValueField } from "../fields";
import { useNamespaces, useServiceAccounts } from "../../../hooks/useResources";

// ─── ConfigMap ──────────────────────────────────────────────────────────────
// ConfigMap and Secret used to share one parameterised component (same
// name+namespace+string-map shape). Secret has since grown three more Secret
// types that don't share that shape at all — see SecretForm below — so this
// is now ConfigMap's own component. It still shares emitDataBlock() with
// Secret's Opaque branch (in emit.ts), which is the part that actually is
// identical between the two.
function serialiseConfigMap(name: string, namespace: string, entries: Entry[]): string {
  const head = ["apiVersion: v1", "kind: ConfigMap", ...metadata(name, namespace)];
  return doc([head, emitDataBlock("data", entries)]);
}

function ConfigMapForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [entries, setEntries] = useState<Entry[]>([{ key: "", value: "" }]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasKeyError = entryErrors(entries, "data").some(Boolean);
  const valid = !nameError && !namespaceError && !hasKeyError;

  useEffect(() => {
    onChange(serialiseConfigMap(name, ns, entries), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, entries]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-config" error={name ? nameError : ""} mono />
        <SelectField
          label="Namespace"
          value={ns}
          onChange={setNs}
          options={namespaces}
          loading={nsLoading}
          allowCustom
        />
      </div>
      <KeyValueField keyKind="data"
        label="Data"
        entries={entries}
        onChange={setEntries}
        multiline
        addLabel="add key"
        keyPlaceholder="key"
        valuePlaceholder="value"
      />
    </div>
  );
}

// ─── Secret ─────────────────────────────────────────────────────────────────
// One component owning name+namespace+type, switching over four inline
// field-set blocks — NOT four exported components, NOT one parameterised
// body with a kind switch inside its emitters. The shared part (name/
// namespace, the emitted head, the serialise tail) is real and small; the
// four bodies are 10-25 lines each with zero shared affordances, so forcing
// them through one shape would be the Rancher trap CLAUDE.md warns about.
//
// Per-type state is kept separate and is NOT reset when the type changes —
// switching back and forth preserves whatever was typed in each branch.
const SECRET_TYPES: SecretPayload["type"][] = [
  "Opaque",
  "kubernetes.io/tls",
  "kubernetes.io/dockerconfigjson",
  "kubernetes.io/service-account-token",
];

type SecretFields = {
  entries: Entry[];
  crt: string;
  tlsKey: string;
  ca: string;
  server: string;
  username: string;
  password: string;
  email: string;
  saName: string;
};

// Exhaustive switch, no `default` — an unhandled SecretPayload["type"]
// member makes tsc flag this function's declared `SecretPayload` return
// type as unsatisfied on every path, so a fifth type added later can't
// silently fall through unimplemented.
function secretPayloadFrom(type: SecretPayload["type"], f: SecretFields): SecretPayload {
  switch (type) {
    case "Opaque":
      return { type, entries: f.entries };
    case "kubernetes.io/tls":
      return { type, crt: f.crt, key: f.tlsKey, ca: f.ca };
    case "kubernetes.io/dockerconfigjson":
      return { type, json: dockerConfigJson(f.server.trim(), f.username.trim(), f.password.trim(), f.email.trim()) };
    case "kubernetes.io/service-account-token":
      return { type, serviceAccount: f.saName.trim() };
  }
}

// Deliberately STRICTER than upstream's existence-only check for tls (a
// Secret with `stringData: {tls.crt: "", tls.key: ""}` would pass
// ValidateSecret but do nothing useful). No PEM structure validation — the
// server doesn't do that either.
function secretTypeValid(type: SecretPayload["type"], f: SecretFields): boolean {
  switch (type) {
    case "Opaque":
      return !entryErrors(f.entries, "data").some(Boolean);
    case "kubernetes.io/tls":
      return f.crt.trim() !== "" && f.tlsKey.trim() !== "";
    case "kubernetes.io/dockerconfigjson":
      return f.server.trim() !== "" && f.username.trim() !== "" && f.password.trim() !== "";
    case "kubernetes.io/service-account-token":
      return f.saName.trim() !== "" && !validateName(f.saName.trim());
  }
}

function SecretForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [type, setType] = useState<SecretPayload["type"]>("Opaque");

  // Opaque
  const [entries, setEntries] = useState<Entry[]>([{ key: "", value: "" }]);
  // kubernetes.io/tls
  const [crt, setCrt] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [ca, setCa] = useState("");
  // kubernetes.io/dockerconfigjson — kubectl's own default registry
  const [server, setServer] = useState("https://index.docker.io/v1/");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  // kubernetes.io/service-account-token
  const [saName, setSaName] = useState("");

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  // Driven by this form's OWN `ns` state, not the `namespace` prop — the
  // token controller resolves the ServiceAccount in the Secret's own
  // namespace, so a mismatch here is exactly the silent-delete trap.
  const { data: serviceAccounts = [], isLoading: saLoading } = useServiceAccounts(context, ns);
  const serviceAccountNames = serviceAccounts.map((s) => s.name);

  const fields: SecretFields = { entries, crt, tlsKey, ca, server, username, password, email, saName };
  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const valid = !nameError && !namespaceError && secretTypeValid(type, fields);

  useEffect(() => {
    onChange(emitSecret(name, ns, secretPayloadFrom(type, fields)), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, type, entries, crt, tlsKey, ca, server, username, password, email, saName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="my-secret" error={name ? nameError : ""} mono />
        <SelectField
          label="Namespace"
          value={ns}
          onChange={setNs}
          options={namespaces}
          loading={nsLoading}
          allowCustom
        />
      </div>
      <SelectField label="Type" value={type} onChange={(v) => setType(v as SecretPayload["type"])} options={SECRET_TYPES} />

      {type === "Opaque" && (
        <KeyValueField keyKind="data"
          label="Data"
          entries={entries}
          onChange={setEntries}
          multiline
          addLabel="add key"
          keyPlaceholder="key"
          valuePlaceholder="value"
        />
      )}

      {type === "kubernetes.io/tls" && (
        <div className="flex flex-col gap-3">
          <TextField label="tls.crt" value={crt} onChange={setCrt} placeholder="-----BEGIN CERTIFICATE-----" mono multiline />
          <TextField label="tls.key" value={tlsKey} onChange={setTlsKey} placeholder="-----BEGIN PRIVATE KEY-----" mono multiline />
          <TextField
            label="ca.crt — optional"
            value={ca}
            onChange={setCa}
            placeholder="-----BEGIN CERTIFICATE-----"
            mono
            multiline
          />
        </div>
      )}

      {type === "kubernetes.io/dockerconfigjson" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Registry server" value={server} onChange={setServer} placeholder="https://index.docker.io/v1/" mono />
          <TextField label="Username" value={username} onChange={setUsername} mono />
          <TextField label="Password" value={password} onChange={setPassword} mono />
          <TextField label="Email — optional" value={email} onChange={setEmail} mono />
        </div>
      )}

      {type === "kubernetes.io/service-account-token" && (
        <div className="flex flex-col gap-2">
          <SelectField
            label="ServiceAccount"
            value={saName}
            onChange={setSaName}
            options={serviceAccountNames}
            loading={saLoading}
            allowCustom
          />
          <p className="text-[10.5px] text-dim">
            Legacy mechanism — since Kubernetes v1.24 these tokens are not auto-created. Prefer the TokenRequest API
            or a projected volume for pod-to-API auth.
          </p>
          {!saLoading && saName.trim() !== "" && !serviceAccountNames.includes(saName.trim()) && (
            <p className="text-[10.5px] text-bad">
              ServiceAccount "{saName.trim()}" was not found in this namespace — if it still doesn't exist when this
              Secret is created, the token controller will delete it automatically.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const KV_FORMS: Partial<Record<CreatableKind, CreateForm>> = { cm: ConfigMapForm, sec: SecretForm };
