import { describe, expect, it } from "vitest";
import type { CertExpiryFact, Finding, ProblemReport, ProblemSource, ResourceType } from "../types/k8s";
import {
  allFindings, cardModel, certFindings, COVERED_KINDS, countsByRule, countsBySeverity, filterFindings,
  loadedAnnouncement, pageState, reasonWord, relevantSkips, rulesBlockedBy, skipNote, worstSeverity,
} from "./problems";

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "crashloop/pods/shop/api-1/api", rule: "crashloop", severity: "critical", kind: "pods",
    namespace: "shop", name: "api-1", container: "api", summary: "Container \"api\" is in CrashLoopBackOff.",
    evidence: [], ...over,
  };
}
const skip = (source: ProblemSource) => ({ source, reason: "forbidden: nope" });
const report = (over: Partial<ProblemReport> = {}): ProblemReport => ({ findings: [], cert_expiry: [], skipped: [], ...over });

describe("certFindings (A-4)", () => {
  const fact = (not_after: string, not_before: string | null = null, kind: "cert" | "sec" = "cert"): CertExpiryFact =>
    ({ kind, namespace: "shop", name: "web-tls", not_after, not_before });

  it("expired is critical cert-expired, with a past label", () => {
    const [f] = certFindings([fact(iso(-3 * DAY - 1000))]);
    expect(f.rule).toBe("cert-expired");
    expect(f.severity).toBe("critical");
    expect(f.summary).toBe('Certificate "web-tls" expired 3d ago.');
  });
  it("inside the expiry window is a warning cert-expiring", () => {
    const [f] = certFindings([fact(iso(3 * DAY + 1000))]);
    expect(f.rule).toBe("cert-expiring");
    expect(f.severity).toBe("warning");
    expect(f.summary).toBe('Certificate "web-tls" expires in 3d.');
  });
  it("outside the window is not a finding (one expiry rule, no second threshold)", () => {
    expect(certFindings([fact(iso(200 * DAY))])).toEqual([]);
  });
  it("TLS Secret wording, and not-valid-before evidence when known", () => {
    const [f] = certFindings([fact(iso(2 * DAY + 1000), iso(-30 * DAY), "sec")]);
    expect(f.summary).toBe('TLS Secret "web-tls" expires in 2d.');
    expect(f.evidence.map((e) => e.path)).toEqual(["Not valid after", "Not valid before"]);
  });
});

describe("allFindings", () => {
  it("merges cert findings and sorts by severity", () => {
    const r = report({
      findings: [finding({ id: "w", severity: "info", rule: "missing-probes", kind: "deploy" }), finding()],
      cert_expiry: [{ kind: "cert", namespace: "a", name: "c", not_after: iso(-DAY), not_before: null }],
    });
    expect(allFindings(r).map((f) => f.severity)).toEqual(["critical", "critical", "info"]);
  });
});

describe("pageState (X2)", () => {
  it("pods skipped with zero findings is No access", () => expect(pageState(0, [skip("pods")])).toBe("no-access"));
  it("any other skip with zero findings is partial-nothing", () => expect(pageState(0, [skip("nodes")])).toBe("nothing-partial"));
  it("events-only skip with zero findings is partial-nothing, never a clean 'nothing'", () =>
    expect(pageState(0, [skip("events")])).toBe("nothing-partial"));
  it("no findings and no skips is nothing", () => expect(pageState(0, [])).toBe("nothing"));
  it("findings with a skip keep the list and show the strip", () => expect(pageState(2, [skip("pods")])).toBe("partial"));
  it("findings without a skip is the plain list", () => expect(pageState(2, [])).toBe("list"));
});

describe("source-to-rules (A-3)", () => {
  it("events block no rule", () => expect(rulesBlockedBy("events")).toEqual([]));
  it("deployments and statefulsets feed workload-unavailable and missing-probes", () => {
    for (const s of ["deployments", "statefulsets"] as const) {
      expect(rulesBlockedBy(s)).toEqual(expect.arrayContaining(["workload-unavailable", "missing-probes"]));
    }
  });
  it("certificates and secrets block the cert rules", () => {
    expect(rulesBlockedBy("certificates")).toEqual(["cert-expired", "cert-expiring"]);
    expect(rulesBlockedBy("secrets")).toEqual(["cert-expired", "cert-expiring"]);
  });
  it("services need endpointslices too", () => expect(rulesBlockedBy("endpointslices")).toEqual(["service-no-endpoints"]));
});

describe("covered kinds (A-5)", () => {
  it("are exactly the namespaced kinds a rule reports on", () => {
    expect([...COVERED_KINDS].sort()).toEqual(["deploy", "ds", "jobs", "pods", "pvc", "sts", "svc"]);
  });
  it("nodes, certificates and secrets are not covered", () => {
    for (const k of ["nodes", "cert", "sec", "cm"]) expect(COVERED_KINDS.has(k)).toBe(false);
  });
});

describe("relevantSkips", () => {
  it("a forbidden secrets list never marks a pod's card", () =>
    expect(relevantSkips("pods", [skip("secrets"), skip("certificates")])).toEqual([]));
  it("events matters for pods and pvc only", () => {
    expect(relevantSkips("pods", [skip("events")])).toEqual(["events"]);
    expect(relevantSkips("pvc", [skip("events")])).toEqual(["events"]);
    expect(relevantSkips("deploy", [skip("events")])).toEqual([]);
  });
  it("a deployment cares about deployments, not daemonsets", () =>
    expect(relevantSkips("deploy", [skip("daemonsets"), skip("deployments")])).toEqual(["deployments"]));
});

describe("cardModel", () => {
  const ask = (kind: ResourceType, r: ProblemReport | undefined, error: string | null = null) =>
    cardModel(kind, "shop", "api-1", { report: r, error });

  it("uncovered kinds get no card", () => {
    expect(ask("cm", report())).toBeNull();
    expect(ask("nodes", report())).toBeNull();
  });
  it("checking until a report arrives", () => expect(ask("pods", undefined)).toEqual({ kind: "checking" }));
  it("error without a report", () => expect(ask("pods", undefined, "boom")).toEqual({ kind: "error", message: "boom" }));
  it("a stale report wins over a refetch error", () => expect(ask("pods", report(), "boom")?.kind).toBe("clear"));
  it("lists this object's findings only", () => {
    const m = ask("pods", report({ findings: [finding(), finding({ id: "x", name: "other" })] }));
    expect(m?.kind === "findings" && m.findings.length).toBe(1);
  });
  it("nothing found is clear on a covered kind", () => expect(ask("pods", report())).toEqual({ kind: "clear", partial: [] }));
  it("pods skipped and nothing found is unavailable", () =>
    expect(ask("pods", report({ skipped: [skip("pods")] }))).toEqual({ kind: "unavailable", skipped: [skip("pods")] }));
  it("events skipped with nothing found is still clear, with the events partial note", () =>
    expect(ask("pods", report({ skipped: [skip("events")] }))).toEqual({ kind: "clear", partial: ["events"] }));
  it("an unrelated skip is ignored", () =>
    expect(ask("pods", report({ skipped: [skip("secrets")] }))).toEqual({ kind: "clear", partial: [] }));
});

describe("counts, filter, announcement", () => {
  const fs = allFindings(report({
    findings: [
      finding(),
      finding({ id: "b", rule: "oom-killed", name: "worker-1" }),
      finding({ id: "c", rule: "job-failed", severity: "warning", kind: "jobs", name: "nightly", summary: "Job failed." }),
    ],
  }));
  it("counts by severity and rule", () => {
    expect(countsBySeverity(fs)).toEqual({ critical: 2, warning: 1, info: 0 });
    expect(countsByRule(fs)).toEqual({ crashloop: 1, "oom-killed": 1, "job-failed": 1 });
  });
  it("filters by severity, rule and search (kind, namespace, name, summary)", () => {
    expect(filterFindings(fs, { severity: "critical", rule: null, search: "" })).toHaveLength(2);
    expect(filterFindings(fs, { severity: null, rule: "job-failed", search: "" })).toHaveLength(1);
    expect(filterFindings(fs, { severity: null, rule: null, search: "WORKER" })).toHaveLength(1);
    expect(filterFindings(fs, { severity: null, rule: null, search: "jobs" })).toHaveLength(1);
    expect(filterFindings(fs, { severity: null, rule: null, search: "shop" })).toHaveLength(3);
    expect(filterFindings(fs, { severity: null, rule: null, search: "crashloopbackoff" })).toHaveLength(2);
  });
  it("announces counts, singular and plural", () => {
    expect(loadedAnnouncement(fs)).toBe("Problems loaded. 3 findings, 2 critical.");
    expect(loadedAnnouncement(fs.slice(0, 1))).toBe("Problems loaded. 1 finding, 1 critical.");
  });
});

describe("reasonWord", () => {
  it("reads the backend prefix", () => {
    expect(reasonWord("forbidden: pods is forbidden")).toBe("forbidden");
    expect(reasonWord("unauthorized: token")).toBe("unauthorized");
    expect(reasonWord("connection refused")).toBe("error");
  });
});

describe("skipNote", () => {
  it("rules note covers non-events skips only; events add their own sentence", () => {
    expect(skipNote([skip("pods")])).toBe("Rules that need them didn't run.");
    expect(skipNote([skip("pods"), skip("events")])).toBe("Rules that need them didn't run. Event evidence is missing.");
    expect(skipNote([skip("events")])).toBe("Event evidence is missing.");
    expect(skipNote([])).toBe("");
  });
});

describe("worstSeverity", () => {
  it("picks critical, then warning, then info", () => {
    expect(worstSeverity([{ severity: "info" }, { severity: "critical" }])).toBe("critical");
    expect(worstSeverity([{ severity: "info" }, { severity: "warning" }])).toBe("warning");
    expect(worstSeverity([{ severity: "info" }])).toBe("info");
  });
});
