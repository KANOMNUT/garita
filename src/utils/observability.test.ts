import { describe, expect, it } from "vitest";
// @ts-expect-error no @types/node in this repo; vitest runs in node
import { readFileSync } from "node:fs";
import {
  LOG_LABEL_PRESETS, METRIC_RANGES, draftErrors, draftsToObservability, emptyLogsDraft, emptyServiceDraft, hintLine, isForbidden,
  logsDraft, logsTarget, metricsDraft, metricsTarget, observabilitySummary, onObservabilityDialogRequest, probeKey, probeLine,
  rangeWindow, requestObservabilityDialog, samePlotExceptRange, skippedLine, targetKey, validLabelName, validNamespace,
  validPathPrefix, validPort, validTenant, withFlavour,
} from "./observability";

describe("validators (vectors from the Rust tests)", () => {
  it("namespace and service", () => {
    expect(validNamespace("monitoring") && validNamespace("a") && validNamespace("a-1")).toBe(true);
    for (const bad of ["Bad_NS", "a/b", "", "-a", "a-", "a".repeat(64)]) expect(validNamespace(bad)).toBe(false);
  });
  it("port", () => {
    expect(validPort("http-web") && validPort("9090") && validPort("65535")).toBe(true);
    for (const bad of ["a_b", "65536", "99999", "0", "", "a".repeat(16)]) expect(validPort(bad)).toBe(false);
  });
  it("path prefix", () => {
    expect(validPathPrefix("") && validPathPrefix("/prometheus/") && validPathPrefix("/a-b.c_d~e")).toBe(true);
    for (const bad of ["rel", "/a/../b", "/..", "/a%2e%2e", "/a?b", "/a b", "/a#"]) expect(validPathPrefix(bad)).toBe(false);
  });
  it("label name", () => {
    expect(validLabelName("kubernetes.pod_name") && validLabelName("pod") && validLabelName("_x")).toBe(true);
    for (const bad of ['a"b', "1a", "", "a".repeat(129)]) expect(validLabelName(bad)).toBe(false);
  });
  it("tenant", () => {
    for (const ok of ["tenant-1", "a.b_c", "x".repeat(150)]) expect(validTenant(ok)).toBe(true);
    for (const bad of ["", "a\nb", "a b", "a|b", "x".repeat(151)]) expect(validTenant(bad)).toBe(false);
  });
});

describe("LOG_LABEL_PRESETS", () => {
  it("equal Rust's label_preset", () => {
    const rs: string = readFileSync("src-tauri/src/commands/logs_backend.rs", "utf8");
    for (const f of ["loki", "victorialogs"] as const) {
      const p = LOG_LABEL_PRESETS[f];
      expect(rs).toContain(`"${f}" => Some(m("${p.namespace}", "${p.pod}", "${p.container}"))`);
    }
  });
});

describe("keys and ranges", () => {
  const t = { namespace: "m", service: "p", port: "9090" };
  it("targetKey defaults", () => {
    expect(targetKey(t)).toBe("m/p:9090|http||");
    expect(targetKey({ ...t, scheme: "https", path_prefix: "/x", tenant: "t" })).toBe("m/p:9090|https|/x|t");
  });
  it("probeKey tells apart the backend and every target field", () => {
    const k = probeKey("loki", t);
    expect(k).toBe("loki|m/p:9090|http||");
    for (const other of [probeKey("victorialogs", t), probeKey("loki", { ...t, namespace: "n" }), probeKey("loki", { ...t, tenant: "x" }), probeKey("loki", { ...t, scheme: "https" })]) expect(other).not.toBe(k);
    expect(probeKey("loki", { ...t })).toBe(k);
  });
  it("rangeWindow aligns to the step and stays under the point cap", () => {
    for (const r of ["1h", "6h", "24h", "7d"] as const) {
      const { start, end, stepSeconds } = rangeWindow(r, 1_000_007);
      expect(end % stepSeconds).toBe(0);
      expect(end).toBeLessThanOrEqual(1_000_007);
      expect((end - start) / stepSeconds + 1).toBeLessThanOrEqual(1100);
      expect(end - start).toBe(METRIC_RANGES[r].span);
    }
    expect(METRIC_RANGES["24h"].step).toBe(300);
  });
  it("samePlotExceptRange keeps only a range change", () => {
    const k = (over: Partial<Record<string, string>> = {}) => ["metric-range", over.c ?? "c1", over.t ?? "tk", over.tpl ?? "pod-cpu", over.ns ?? "n", over.name ?? "p", over.r ?? "1h"];
    expect(samePlotExceptRange(k(), k({ r: "6h" }))).toBe(true);
    expect(samePlotExceptRange(k(), k({ name: "q" }))).toBe(false);
    expect(samePlotExceptRange(k(), k({ c: "c2" }))).toBe(false);
    expect(samePlotExceptRange(k(), k({ t: "other" }))).toBe(false);
    expect(samePlotExceptRange(k(), k({ tpl: "pod-mem" }))).toBe(false);
    expect(samePlotExceptRange(k(), k().slice(1))).toBe(false);
  });
  it("isForbidden", () => {
    expect(isForbidden("No access to services/proxy: x")).toBe(true);
    expect(isForbidden("Failed to query metrics: No access to services/proxy")).toBe(false);
  });
});

describe("copy", () => {
  const t = { namespace: "monitoring", service: "prom", port: "9090" };
  it("summary", () => {
    expect(observabilitySummary(undefined)).toEqual({ metrics: "Not set", logs: "Not set" });
    const o = observabilitySummary({ prometheus: t, logs: { service: { ...t, service: "loki", port: "80", tenant: "secret" }, flavour: "loki", labels: LOG_LABEL_PRESETS.loki } });
    expect(o).toEqual({ metrics: "Prometheus: monitoring/prom:9090", logs: "Loki: monitoring/loki:80" });
  });
  it("probe lines", () => {
    expect(probeLine({ state: "ok", message: "", version: "2.53.1" }, "prometheus", t)).toBe("Reachable: monitoring/prom:9090. Prometheus 2.53.1.");
    expect(probeLine({ state: "ok", message: "", version: null }, "loki", t)).toBe("Reachable: monitoring/prom:9090.");
    expect(probeLine({ state: "unreachable", message: "boom", version: null }, "loki", t)).toBe("Couldn't reach the service. Check the namespace, service and port. boom");
    expect(probeLine({ state: "forbidden", message: "x", version: null }, "loki", t)).toBe("No access to services/proxy in monitoring. x");
    const f = (message: string | null) => probeLine({ state: "forbidden", message, version: null } as never, "loki", t);
    expect(f('No access to services/proxy: services "p" is forbidden')).toBe('No access to services/proxy in monitoring. services "p" is forbidden');
    expect(f("No access to services/proxy:")).toBe("No access to services/proxy in monitoring.");
    expect(f("")).toBe("No access to services/proxy in monitoring.");
    expect(probeLine({ state: "wrong-service", message: "x", version: null }, "victorialogs", t)).toContain("doesn't look like VictoriaLogs");
  });
  it("hint and skipped", () => {
    expect(hintLine("m", false)).toBe("Hint: needs permission to get services/proxy in m.");
    expect(hintLine("m", true)).toContain("may not be allowed");
    expect(skippedLine([{ source: "*", reason: "forbidden" }])).toBe("Couldn't list Services in every namespace (forbidden). The list may be incomplete.");
  });
});

describe("drafts", () => {
  const filled = { ...emptyServiceDraft(), namespace: "monitoring", service: "prom", port: "9090" };
  it("unset is not an error; partial is", () => {
    expect(draftErrors(emptyServiceDraft())).toEqual({});
    expect(Object.keys(draftErrors({ ...emptyServiceDraft(), namespace: "m" })).sort()).toEqual(["port", "service"]);
    expect(draftErrors(filled)).toEqual({});
  });
  it("tenant is checked only for the logs group", () => {
    expect(draftErrors({ ...filled, tenant: "a b" })).toEqual({});
    expect(draftErrors({ ...emptyLogsDraft(), ...filled, tenant: "a b" }).tenant).toBeDefined();
  });
  it("custom labels are validated, preset ones are not", () => {
    const l = { ...emptyLogsDraft(), ...filled, labelMode: "custom" as const, custom: { namespace: "", pod: "1a", container: "ok" } };
    expect(draftErrors(l)).toEqual({ label_namespace: "Enter a label name.", label_pod: expect.any(String) });
    expect(draftErrors({ ...l, labelMode: "preset" })).toEqual({});
  });
  it("metrics target drops the tenant and empty prefix", () => {
    expect(metricsTarget({ ...filled, tenant: "t" })).toEqual({ namespace: "monitoring", service: "prom", port: "9090", scheme: "http" });
  });
  it("logs round trip: preset stores the explicit names and reads back as preset", () => {
    const d = { ...emptyLogsDraft(), ...filled, path_prefix: "/x", tenant: "t1" };
    const t = logsTarget(withFlavour(d, "victorialogs"));
    expect(t.labels).toEqual(LOG_LABEL_PRESETS.victorialogs);
    expect(t.service.tenant).toBe("t1");
    const back = logsDraft(t);
    expect(back.labelMode).toBe("preset");
    expect(back.flavour).toBe("victorialogs");
    expect(logsDraft({ ...t, labels: { namespace: "a", pod: "b", container: "c" } }).labelMode).toBe("custom");
  });
  it("draftsToObservability: both unset is null, one group is kept", () => {
    expect(draftsToObservability(emptyServiceDraft(), emptyLogsDraft())).toBeNull();
    const o = draftsToObservability(filled, emptyLogsDraft());
    expect(o?.prometheus?.service).toBe("prom");
    expect(o?.logs).toBeUndefined();
    expect(metricsDraft(o?.prometheus)).toEqual(filled);
  });
});

describe("dialog requests", () => {
  it("delivers to listeners and stops after unsubscribe", () => {
    const seen: string[] = [];
    const off = onObservabilityDialogRequest((c) => seen.push(c));
    requestObservabilityDialog("a");
    off();
    requestObservabilityDialog("b");
    expect(seen).toEqual(["a"]);
  });
});
