import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types/k8s";
import { filterJournal, journalKind, journalOptions, journalResourceType, NO_FILTERS, relativeTime } from "./journal";

const e = (p: Partial<JournalEntry>): JournalEntry => ({
  ts: "2026-10-08T10:00:00.000Z", context: "prod", verb: "scale", kind: "deploy", namespace: "shop", name: "api",
  summary: "replicas=5", result: "ok", message: "", ...p,
});

describe("journalKind", () => {
  it("labels the three spellings", () => {
    expect(journalKind("sec")).toBe("secrets");
    expect(journalKind("Secret")).toBe("secrets");
    expect(journalKind("Deployment")).toBe("deployments");
  });
  it("merges pod/pods and maps the singular nouns", () => {
    expect(journalKind("pod")).toBe(journalKind("pods"));
    expect(journalKind("node")).toBe("nodes");
    expect(journalKind("cronjob")).toBe("cronjobs");
    expect(journalKind("service")).toBe("services");
    expect(journalKind("helmrelease")).toBe("helm releases");
  });
  it("shows unknown kinds verbatim, including prototype names", () => {
    expect(journalKind("namespace")).toBe("namespace");
    expect(journalKind("portforward")).toBe("portforward");
    expect(journalKind("constructor")).toBe("constructor");
  });
});

describe("journalResourceType", () => {
  it("maps the three spellings to one ResourceType and unknown kinds to null", () => {
    expect(["deploy", "Deployment", "deployment"].map(journalResourceType)).toEqual(["deploy", "deploy", "deploy"]);
    expect(journalResourceType("helmrelease")).toBe("helm");
    expect(journalResourceType("argocd")).toBe("argocd");
    expect(journalResourceType("namespace")).toBeNull();
    expect(journalResourceType("constructor")).toBeNull();
  });
});

describe("filterJournal", () => {
  const rows = [e({}), e({ context: "stg", kind: "Secret", result: "error", name: "db", verb: "patch" }), e({ kind: "pod", name: "p1" })];
  it("filters by cluster, kind label and result", () => {
    expect(filterJournal(rows, { ...NO_FILTERS, context: "stg" })).toHaveLength(1);
    expect(filterJournal(rows, { ...NO_FILTERS, kind: "secrets" })).toHaveLength(1);
    expect(filterJournal(rows, { ...NO_FILTERS, result: "error" })).toHaveLength(1);
  });
  it("searches loaded fields case-insensitively", () => {
    expect(filterJournal(rows, { ...NO_FILTERS, search: "PATCH" })).toHaveLength(1);
    expect(filterJournal(rows, { ...NO_FILTERS, search: "p1 shop" })).toHaveLength(0);
    expect(filterJournal(rows, { ...NO_FILTERS, search: "p1" })).toHaveLength(1);
  });
  it("offers one Kind option for pod and pods", () => {
    expect(journalOptions([e({ kind: "pod" }), e({ kind: "pods" })]).kinds).toEqual(["pods"]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-08T10:00:00.000Z");
  it("buckets", () => {
    expect(relativeTime("2026-10-08T09:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-08T09:57:00.000Z", now)).toBe("3m ago");
    expect(relativeTime("2026-10-08T07:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-10-06T10:00:00.000Z", now)).toBe("2d ago");
    expect(relativeTime("garbage", now)).toBe("garbage");
  });
});
