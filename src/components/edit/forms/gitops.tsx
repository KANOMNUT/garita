// OWNED BY THE GITOPS PHASE-B AGENT. Exactly: argocd (Tier 1), flux-ks,
// flux-hr (Tier 2). See docs/plan-guided-edit.md §5 and, critically, §6 —
// the ArgoCD write contract this form must never disturb.
//
// ── The ArgoCD invariant (§6) ────────────────────────────────────────────
// Sync goes through a top-level `.operation` key; refresh goes through the
// `metadata.annotations["argocd.argoproj.io/refresh"]` key (both confirmed
// against src-tauri/src/commands/argocd.rs's sync_argocd_app /
// refresh_argocd_app). ArgoCdEditForm below NEVER reads or writes
// `next.operation` or `next.metadata` at all — the only paths it touches are
// `spec.source`, `spec.destination`, `spec.syncPolicy.automated`. Because
// merge patch merges maps by key, a patch confined to `spec` structurally
// cannot remove a sibling top-level key or a sibling annotation even if it
// tried. Do NOT add a labels/annotations editor to this form — that is the
// one change that would put `next.metadata` back in play.
//
// ── spec.sources[] (multi-source Applications) ───────────────────────────
// Some Applications use `spec.sources` (plural) instead of `spec.source`.
// This form never touches `spec.sources` and, when it detects a non-empty
// `spec.sources`, also skips `spec.source` entirely and shows a hint instead
// — writing to `spec.source` on a multi-source Application would introduce
// a field ArgoCD ignores in favor of `sources`, silently doing nothing
// useful. Declining is safer than guessing which of N sources was meant.
//
// ── Optional-field phantom-diff guard ────────────────────────────────────
// Several fields here are Go `omitempty` in the real API types (ArgoCD's
// `ApplicationSource.Path`/`TargetRevision`, `SyncPolicyAutomated.Prune`/
// `SelfHeal`; Flux's `Kustomization.Spec.Path`, both kinds' `Suspend`) and
// are commonly ABSENT rather than present-with-zero-value on a real live
// object. Unconditionally writing "" / false for an untouched field would
// make mergePatch see a spurious change (key added) even though the user
// touched nothing. setOptionalString/setBoolField below preserve absence.
import { useEffect, useState } from "react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { Section, TextField, CheckField } from "../../create/fields";

function setOptionalString(target: Record<string, unknown>, key: string, value: string) {
  const v = value.trim();
  if (v !== "") target[key] = v;
  else delete target[key]; // matches "absent" whether it started absent or the user cleared it
}

// `true` is always written explicitly. `false` is written explicitly only
// when the original object already had the key (preserving its own
// explicit-false convention); otherwise the key is left absent, matching
// what "unset" already meant.
function setBoolField(target: Record<string, unknown>, orig: Record<string, unknown> | undefined, key: string, value: boolean) {
  if (value) target[key] = true;
  else if (orig && key in orig) target[key] = false;
  else delete target[key];
}

// Matches the Flux CRDs' own kubebuilder pattern for `interval`
// (`^([0-9]+(\.[0-9]+)?(ms|s|m|h))+$`) exactly — no ns/us/µs, which the CRD
// itself would reject even though Go's time.ParseDuration accepts them.
const DURATION_RE = /^([0-9]+(\.[0-9]+)?(ms|s|m|h))+$/;
function isValidGoDuration(s: string): boolean {
  return s.trim() !== "" && DURATION_RE.test(s.trim());
}

// ─── ArgoCD Application ─────────────────────────────────────────────────────

function ArgoCdEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const isMultiSource = Array.isArray(live.spec?.sources) && live.spec.sources.length > 0;

  const [repoURL, setRepoURL] = useState<string>(() => live.spec?.source?.repoURL ?? "");
  const [path, setPath] = useState<string>(() => live.spec?.source?.path ?? "");
  const [targetRevision, setTargetRevision] = useState<string>(() => live.spec?.source?.targetRevision ?? "");

  const [automated, setAutomated] = useState<boolean>(() => !!live.spec?.syncPolicy?.automated);
  const [prune, setPrune] = useState<boolean>(() => !!live.spec?.syncPolicy?.automated?.prune);
  const [selfHeal, setSelfHeal] = useState<boolean>(() => !!live.spec?.syncPolicy?.automated?.selfHeal);

  const [destServer, setDestServer] = useState<string>(() => live.spec?.destination?.server ?? "");
  const [destNamespace, setDestNamespace] = useState<string>(() => live.spec?.destination?.namespace ?? "");

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};

    if (!isMultiSource) {
      next.spec.source ??= {};
      next.spec.source.repoURL = repoURL; // required, non-omitempty — always assign
      setOptionalString(next.spec.source, "path", path);
      setOptionalString(next.spec.source, "targetRevision", targetRevision);
    }

    next.spec.destination ??= {};
    setOptionalString(next.spec.destination, "server", destServer);
    setOptionalString(next.spec.destination, "namespace", destNamespace);

    // Mutate only the `.automated` subkey of syncPolicy, in place, on the
    // clone — syncPolicy may carry syncOptions/retry/etc. this form doesn't
    // model, and mutating the automated object in place (rather than
    // replacing it wholesale) also preserves fields like `allowEmpty` that
    // aren't modelled here either.
    next.spec.syncPolicy ??= {};
    if (automated) {
      const automatedObj: Record<string, unknown> =
        next.spec.syncPolicy.automated && typeof next.spec.syncPolicy.automated === "object"
          ? next.spec.syncPolicy.automated
          : {};
      const origAutomated = live.spec?.syncPolicy?.automated as Record<string, unknown> | undefined;
      setBoolField(automatedObj, origAutomated, "prune", prune);
      setBoolField(automatedObj, origAutomated, "selfHeal", selfHeal);
      next.spec.syncPolicy.automated = automatedObj;
    } else {
      delete next.spec.syncPolicy.automated;
    }
    // Only collapse an empty syncPolicy back to "absent" when it was
    // genuinely absent on the live object — if live already had an explicit
    // `syncPolicy: {}` (or one that's now empty only because we removed
    // `automated`), leave the clone's `{}` as-is so it deep-equals live's
    // own `{}` and produces no diff, instead of emitting a spurious
    // `syncPolicy: null` deletion on a form the user never touched here.
    if (Object.keys(next.spec.syncPolicy).length === 0 && !("syncPolicy" in (live.spec ?? {}))) {
      delete next.spec.syncPolicy;
    }

    // INVARIANT (see file header, §6): never touch next.operation or
    // next.metadata here. Structurally guaranteed — nothing above reads or
    // writes either.
    onChange(next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoURL, path, targetRevision, automated, prune, selfHeal, destServer, destNamespace]);

  return (
    <div className="flex flex-col gap-3">
      {isMultiSource ? (
        <p className="text-[11.5px] text-dim rounded-lg bg-card/50 ring-1 ring-edge p-2">
          This Application uses <span className="mono">spec.sources</span> (multi-source) — edit sources via the YAML tab.
        </p>
      ) : (
        <Section label="Source">
          <div className="flex flex-col gap-2">
            <TextField label="Repo URL" value={repoURL} onChange={setRepoURL} placeholder="https://github.com/org/repo.git" mono />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Path" value={path} onChange={setPath} placeholder="." mono />
              <TextField label="Target Revision" value={targetRevision} onChange={setTargetRevision} placeholder="HEAD" mono />
            </div>
          </div>
        </Section>
      )}

      <Section label="Destination">
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Server" value={destServer} onChange={setDestServer} placeholder="https://kubernetes.default.svc" mono />
          <TextField label="Namespace" value={destNamespace} onChange={setDestNamespace} placeholder="default" mono />
        </div>
      </Section>

      <Section label="Sync Policy">
        <div className="flex flex-col gap-1.5">
          <CheckField label="Automated sync" value={automated} onChange={setAutomated} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 ml-5">
            <CheckField label="Prune" value={prune} onChange={setPrune} disabled={!automated} />
            <CheckField label="Self Heal" value={selfHeal} onChange={setSelfHeal} disabled={!automated} />
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── Flux Kustomization ──────────────────────────────────────────────────────

function FluxKsEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const [suspend, setSuspend] = useState<boolean>(() => !!live.spec?.suspend);
  const [interval, setInterval_] = useState<string>(() => String(live.spec?.interval ?? ""));
  const [path, setPath] = useState<string>(() => String(live.spec?.path ?? ""));
  const [prune, setPrune] = useState<boolean>(() => !!live.spec?.prune);

  const intervalError = isValidGoDuration(interval) ? "" : "Must be a Go duration, e.g. 5m0s or 1h";
  const valid = !intervalError;

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    setBoolField(next.spec, live.spec, "suspend", suspend);
    next.spec.interval = interval; // required, non-omitempty
    setOptionalString(next.spec, "path", path);
    setBoolField(next.spec, live.spec, "prune", prune);
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspend, interval, path, prune]);

  return (
    <div className="flex flex-col gap-3">
      <CheckField label="Suspend reconciliation" value={suspend} onChange={setSuspend} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Interval" value={interval} onChange={setInterval_} placeholder="5m0s" error={intervalError} mono />
        <TextField label="Path" value={path} onChange={setPath} placeholder="./deploy" mono />
      </div>
      <CheckField label="Prune (garbage-collect removed resources)" value={prune} onChange={setPrune} />
    </div>
  );
}

// ─── Flux HelmRelease ────────────────────────────────────────────────────────

function FluxHrEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const hasChart = !!live.spec?.chart?.spec;
  const [suspend, setSuspend] = useState<boolean>(() => !!live.spec?.suspend);
  const [interval, setInterval_] = useState<string>(() => String(live.spec?.interval ?? ""));
  const [version, setVersion] = useState<string>(() => String(live.spec?.chart?.spec?.version ?? ""));

  const intervalError = isValidGoDuration(interval) ? "" : "Must be a Go duration, e.g. 5m0s or 1h";
  const valid = !intervalError;

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    setBoolField(next.spec, live.spec, "suspend", suspend);
    next.spec.interval = interval; // required, non-omitempty
    // Only newer Flux HelmReleases can point at an OCIRepository via
    // spec.chartRef instead of an inline spec.chart — if there's no
    // spec.chart.spec to begin with, don't construct one from nothing;
    // that would be introducing a field the resource never had rather than
    // editing what it does have.
    if (hasChart) {
      next.spec.chart ??= {};
      next.spec.chart.spec ??= {};
      setOptionalString(next.spec.chart.spec, "version", version);
    }
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspend, interval, version]);

  return (
    <div className="flex flex-col gap-3">
      <CheckField label="Suspend reconciliation" value={suspend} onChange={setSuspend} />
      <TextField label="Interval" value={interval} onChange={setInterval_} placeholder="5m0s" error={intervalError} mono />
      {hasChart ? (
        <TextField label="Chart Version" value={version} onChange={setVersion} placeholder="1.2.3 or >=1.0.0 <2.0.0" mono />
      ) : (
        <p className="text-[11.5px] text-dim rounded-lg bg-card/50 ring-1 ring-edge p-2">
          This HelmRelease uses <span className="mono">spec.chartRef</span> instead of an inline chart spec — edit the chart
          version via the YAML tab.
        </p>
      )}
    </div>
  );
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const GITOPS_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  argocd: ArgoCdEditForm,
  "flux-ks": FluxKsEditForm,
  "flux-hr": FluxHrEditForm,
};
