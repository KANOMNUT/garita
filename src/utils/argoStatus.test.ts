import { describe, expect, it } from "vitest";
import {
  ARGO_CHIP_CLS, ARGO_NEUTRAL_CLS, HEALTH_FILTERS, SYNC_FILTERS,
  ARGO_OPERATION_MESSAGE_MAX_CHARS, argoHealthCount, argoHealthPill, argoOperationNote, argoPhasePill, argoSortScore, argoSyncCount, argoSyncPill,
  filterArgoResources, isArgoHealthy, isArgoOperationMessageCut, isDegradedOrMissing, visibleHealthFilters,
} from "./argoStatus";

const res = (health_status: string, sync_status: string) => ({ health_status, sync_status });

// One of each combination that matters: drift is normal and healthy, Missing is not Degraded.
const LIST = [
  res("Healthy", "Synced"),
  res("Healthy", "OutOfSync"),
  res("Degraded", "Synced"),
  res("Missing", "OutOfSync"),
  res("Progressing", "Synced"),
  res("Healthy", "Synced"),
];

describe("pills", () => {
  it("names every health, sync and phase status the tabs filter or show", () => {
    for (const s of HEALTH_FILTERS) expect(argoHealthPill(s).label).toBe(s);
    for (const s of SYNC_FILTERS) expect(argoSyncPill(s).label).toBe(s);
    for (const s of ["Succeeded", "Running", "Failed", "Error"]) expect(argoPhasePill(s).label).toBe(s);
  });

  it("gives Suspended, Unknown and a status it does not list the neutral style", () => {
    expect(argoHealthPill("Suspended").cls).toBe(ARGO_NEUTRAL_CLS);
    expect(argoHealthPill("Unknown").cls).toBe(ARGO_NEUTRAL_CLS);
    expect(argoSyncPill("Unknown").cls).toBe(ARGO_NEUTRAL_CLS);
    expect(argoHealthPill("Odd")).toEqual({ label: "Odd", icon: "?", cls: ARGO_NEUTRAL_CLS });
    expect(argoSyncPill("Odd")).toEqual({ label: "Odd", icon: "?", cls: ARGO_NEUTRAL_CLS });
    expect(argoPhasePill("Terminating")).toEqual({ label: "Terminating", icon: "?", cls: ARGO_NEUTRAL_CLS });
  });

  it("an empty status reads Unknown", () => {
    expect(argoHealthPill("").label).toBe("Unknown");
    expect(argoSyncPill("").label).toBe("Unknown");
  });

  it("does not resolve inherited object keys to a pill", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(argoHealthPill(k).cls, k).toBe(ARGO_NEUTRAL_CLS);
      expect(argoSyncPill(k).label, k).toBe(k);
    }
  });

  it("never sets text in dim or in faded status text (contrast)", () => {
    const classes = [
      ...HEALTH_FILTERS.map((s) => argoHealthPill(s).cls),
      ...SYNC_FILTERS.map((s) => argoSyncPill(s).cls),
      ...["Succeeded", "Running", "Failed", "Error"].map((s) => argoPhasePill(s).cls),
      ...Object.values(ARGO_CHIP_CLS).flatMap((c) => [c.on, c.off]),
    ];
    for (const c of classes) {
      expect(c).not.toMatch(/text-dim/);
      expect(c).not.toMatch(/text-[a-z-]+\/\d+/);
    }
  });
});

describe("Health and Sync are independent", () => {
  it("the header's Healthy reads Health alone", () => {
    expect(isArgoHealthy("Healthy")).toBe(true);
    for (const h of ["Degraded", "Progressing", "Missing", "Suspended", "Unknown", ""]) expect(isArgoHealthy(h), h).toBe(false);
  });

  it("a Healthy but OutOfSync resource counts under Healthy and under OutOfSync", () => {
    const one = [res("Healthy", "OutOfSync")];
    expect(argoHealthCount(one, "Healthy")).toBe(1);
    expect(argoSyncCount(one, "OutOfSync")).toBe(1);
    expect(argoSyncCount(one, "Synced")).toBe(0);
  });

  it("counts are per status: Missing is not Degraded", () => {
    expect(argoHealthCount(LIST, "Degraded")).toBe(1);
    expect(argoHealthCount(LIST, "Missing")).toBe(1);
    expect(argoHealthCount(LIST, "Healthy")).toBe(3);
    expect(argoHealthCount(LIST, "Progressing")).toBe(1);
    expect(argoHealthCount(LIST, "Suspended")).toBe(0);
    expect(argoSyncCount(LIST, "Synced")).toBe(4);
    expect(argoSyncCount(LIST, "OutOfSync")).toBe(2);
  });
});

describe("filterArgoResources", () => {
  it("returns everything while both groups are off", () => {
    expect(filterArgoResources(LIST, "all", "all")).toEqual(LIST);
  });

  it("the Healthy chip keeps a Healthy but OutOfSync resource", () => {
    const healthy = filterArgoResources(LIST, "Healthy", "all");
    expect(healthy).toHaveLength(3);
    expect(healthy).toContainEqual(res("Healthy", "OutOfSync"));
  });

  it("each group filters on its own", () => {
    expect(filterArgoResources(LIST, "Degraded", "all")).toEqual([res("Degraded", "Synced")]);
    expect(filterArgoResources(LIST, "all", "OutOfSync")).toEqual([res("Healthy", "OutOfSync"), res("Missing", "OutOfSync")]);
  });

  it("the two groups combine with AND", () => {
    expect(filterArgoResources(LIST, "Healthy", "OutOfSync")).toEqual([res("Healthy", "OutOfSync")]);
    expect(filterArgoResources(LIST, "Degraded", "OutOfSync")).toEqual([]);
  });

  it("keeps the extra fields of the rows it returns", () => {
    const rows = [{ ...res("Healthy", "Synced"), name: "a" }, { ...res("Missing", "Synced"), name: "b" }];
    expect(filterArgoResources(rows, "Missing", "all").map((r) => r.name)).toEqual(["b"]);
  });
});

describe("visibleHealthFilters", () => {
  const ALWAYS = ["Healthy", "Progressing", "Degraded", "Missing"];

  it("always lists the four main health chips, in order, even with no resources", () => {
    expect(visibleHealthFilters([], "all")).toEqual(ALWAYS);
    expect(visibleHealthFilters(LIST, "all")).toEqual(ALWAYS);
  });

  it("adds Suspended and Unknown only while a resource has that status", () => {
    expect(visibleHealthFilters([res("Suspended", "Synced")], "all")).toEqual([...ALWAYS, "Suspended"]);
    expect(visibleHealthFilters([res("Unknown", "Synced"), res("Suspended", "Synced")], "all")).toEqual([...ALWAYS, "Suspended", "Unknown"]);
  });

  it("keeps an active chip visible at count 0, so the filter can be turned off", () => {
    expect(visibleHealthFilters(LIST, "Unknown")).toEqual([...ALWAYS, "Unknown"]);
  });
});

describe("problem rows", () => {
  it("Degraded and Missing are the attention states", () => {
    expect(isDegradedOrMissing(res("Degraded", "Synced"))).toBe(true);
    expect(isDegradedOrMissing(res("Missing", "Synced"))).toBe(true);
    for (const h of ["Healthy", "Progressing", "Suspended", "Unknown"]) expect(isDegradedOrMissing(res(h, "Synced")), h).toBe(false);
  });

  it("sorts Degraded and Missing, then OutOfSync, then Progressing, then the rest", () => {
    const sorted = [...LIST].sort((a, b) => argoSortScore(a) - argoSortScore(b));
    expect(sorted.slice(0, 2).map((r) => r.health_status).sort()).toEqual(["Degraded", "Missing"]);
    expect(sorted[2]).toEqual(res("Healthy", "OutOfSync"));
    expect(sorted[3]).toEqual(res("Progressing", "Synced"));
    expect(argoSortScore(res("Healthy", "Synced"))).toBe(3);
  });

  it("a Degraded and OutOfSync resource ranks as Degraded", () => {
    expect(argoSortScore(res("Degraded", "OutOfSync"))).toBe(0);
  });
});

describe("chip classes", () => {
  it("has an on and an off style for every filter chip", () => {
    for (const s of [...HEALTH_FILTERS, ...SYNC_FILTERS]) {
      expect(ARGO_CHIP_CLS[s].on, s).toBeTruthy();
      expect(ARGO_CHIP_CLS[s].off, s).toBeTruthy();
      expect(ARGO_CHIP_CLS[s].on).not.toBe(ARGO_CHIP_CLS[s].off);
    }
  });
});

describe("argoOperationNote", () => {
  const REFUSAL = "one or more objects failed to apply, reason: Deployment.apps \"web\" is invalid:\n  spec.replicas: Invalid value: -1";

  it("gives a failed note for Failed and Error, with the text unchanged", () => {
    expect(argoOperationNote("Failed", REFUSAL)).toEqual({ text: REFUSAL, failed: true });
    expect(argoOperationNote("Error", "ComparisonError: repository not found")).toEqual({
      text: "ComparisonError: repository not found", failed: true,
    });
  });

  it("gives a neutral note for Running and Terminating (a retrying sync is still Running)", () => {
    const retry = "one or more objects failed to apply, reason: x. Retrying attempt #2 at 3:04PM.";
    expect(argoOperationNote("Running", retry)).toEqual({ text: retry, failed: false });
    expect(argoOperationNote("Terminating", "Operation terminated")).toEqual({ text: "Operation terminated", failed: false });
  });

  it("gives nothing for an empty or whitespace-only message, whatever the phase", () => {
    for (const phase of ["Failed", "Error", "Running", "Terminating"]) {
      expect(argoOperationNote(phase, ""), phase).toBeNull();
      expect(argoOperationNote(phase, " \n\t "), phase).toBeNull();
    }
  });

  it("gives nothing for Succeeded, even with upstream's sentence", () => {
    expect(argoOperationNote("Succeeded", "successfully synced (all tasks run)")).toBeNull();
  });

  it("gives nothing for no phase, a dash, a phase the table does not list, or a differently cased phase", () => {
    for (const phase of ["", "—", "Odd", "failed", "running"]) {
      expect(argoOperationNote(phase, "some text"), phase).toBeNull();
    }
  });

  it("does not resolve inherited object keys as a phase", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(argoOperationNote(k, "some text"), k).toBeNull();
    }
  });

  it("keeps line breaks and indentation of the text", () => {
    expect(argoOperationNote("Failed", "a\n\n  b")?.text).toBe("a\n\n  b");
  });
});

describe("isArgoOperationMessageCut", () => {
  const n = ARGO_OPERATION_MESSAGE_MAX_CHARS;

  it("is true for the limit plus the ellipsis the backend adds", () => {
    expect(isArgoOperationMessageCut("x".repeat(n) + "…")).toBe(true);
  });

  it("counts characters, not UTF-16 units: 2000 four-byte characters plus the ellipsis are cut", () => {
    expect(isArgoOperationMessageCut("😀".repeat(n) + "…")).toBe(true);
  });

  it("is false for a message of the limit or less, with or without a trailing ellipsis", () => {
    expect(isArgoOperationMessageCut("x".repeat(n))).toBe(false);
    expect(isArgoOperationMessageCut("x".repeat(n - 1) + "…")).toBe(false);
    expect(isArgoOperationMessageCut("waiting for…")).toBe(false);
    expect(isArgoOperationMessageCut("")).toBe(false);
  });

  it("is false for a long text that does not end with the ellipsis", () => {
    expect(isArgoOperationMessageCut("x".repeat(n + 5))).toBe(false);
  });
});
