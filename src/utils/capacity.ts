import type { NodeCapacity } from "../types/k8s";

/** One threshold pair for every capacity bar in the app (X7): amber from 65%, red from 85%. */
export const CAPACITY_MID = 65;
export const CAPACITY_HIGH = 85;
export type CapacityLevel = "low" | "mid" | "high";

export function capacityLevel(pct: number): CapacityLevel {
  return pct >= CAPACITY_HIGH ? "high" : pct >= CAPACITY_MID ? "mid" : "low";
}

/** Whole percent of `of`, or null when `of` is unknown or zero. Never clamped: limits may exceed 100. */
export function share(n: number, of: number | null): number | null {
  return of === null || of <= 0 ? null : Math.round((n / of) * 100);
}

export const fmtCpu = (m: number): string => `${m}m`;
export const fmtMem = (mi: number): string => (mi >= 1024 ? `${trim(mi / 1024)} Gi` : `${mi} Mi`);
const trim = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Requests, limits and usage of one resource on one node, all against allocatable. */
export interface ResourceCell {
  allocatable: number;
  requests: number;
  limits: number;
  usage: number | null;
  reqPct: number;
  limPct: number;
  usagePct: number | null;
  level: CapacityLevel;
}

export interface CapacityRow {
  node: string;
  /** null = allocatable unavailable for that resource: no bar, no percentage. */
  cpu: ResourceCell | null;
  mem: ResourceCell | null;
  pods: number;
  podsAllocatable: number | null;
  noLimits: number;
}

function cell(alloc: number | null, requests: number, limits: number, usage: number | null): ResourceCell | null {
  if (alloc === null || alloc <= 0) return null;
  const reqPct = share(requests, alloc) ?? 0;
  return {
    allocatable: alloc, requests, limits, usage,
    reqPct, limPct: share(limits, alloc) ?? 0,
    usagePct: usage === null ? null : share(usage, alloc),
    level: capacityLevel(reqPct),
  };
}

export function capacityRow(c: NodeCapacity): CapacityRow {
  return {
    node: c.node,
    cpu: cell(c.cpu_allocatable_m, c.cpu_requests_m, c.cpu_limits_m, c.cpu_usage_m),
    mem: cell(c.mem_allocatable_mi, c.mem_requests_mi, c.mem_limits_mi, c.mem_usage_mi),
    pods: c.pods,
    podsAllocatable: c.pods_allocatable,
    noLimits: c.pods_without_limits,
  };
}

export interface CapacityTotals {
  nodes: number;
  /** Nodes whose cpu or memory allocatable is unknown: excluded from that resource's sum. */
  withoutAllocatable: number;
  cpuRequestsM: number; cpuAllocatableM: number; cpuPct: number | null;
  memRequestsMi: number; memAllocatableMi: number; memPct: number | null;
}

export function totals(rows: CapacityRow[]): CapacityTotals {
  const t: CapacityTotals = {
    nodes: rows.length, withoutAllocatable: 0,
    cpuRequestsM: 0, cpuAllocatableM: 0, cpuPct: null,
    memRequestsMi: 0, memAllocatableMi: 0, memPct: null,
  };
  for (const r of rows) {
    if (!r.cpu || !r.mem) t.withoutAllocatable++;
    if (r.cpu) { t.cpuRequestsM += r.cpu.requests; t.cpuAllocatableM += r.cpu.allocatable; }
    if (r.mem) { t.memRequestsMi += r.mem.requests; t.memAllocatableMi += r.mem.allocatable; }
  }
  t.cpuPct = share(t.cpuRequestsM, t.cpuAllocatableM);
  t.memPct = share(t.memRequestsMi, t.memAllocatableMi);
  return t;
}

export type CapacitySort = "node" | "cpu" | "mem" | "pods" | "noLimits";

const sortValue = (r: CapacityRow, key: CapacitySort): number | string | null =>
  key === "node" ? r.node : key === "cpu" ? r.cpu?.reqPct ?? null : key === "mem" ? r.mem?.reqPct ?? null
  : key === "pods" ? r.pods : r.noLimits;

/** Rows without a value sort last in either direction. Ties fall back to the node name. */
export function sortRows(rows: CapacityRow[], key: CapacitySort, asc: boolean): CapacityRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    if (va === null || vb === null) return va === vb ? a.node.localeCompare(b.node) : va === null ? 1 : -1;
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return d !== 0 ? (asc ? d : -d) : a.node.localeCompare(b.node);
  });
}

export function filterRows(rows: CapacityRow[], search: string): CapacityRow[] {
  const q = search.trim().toLowerCase();
  return q ? rows.filter((r) => r.node.toLowerCase().includes(q)) : rows;
}

const cores = (m: number): string => trim(m / 1000);

export function totalsLine(t: CapacityTotals): string {
  const nodes = `${t.nodes} ${t.nodes === 1 ? "node" : "nodes"}${t.withoutAllocatable > 0 ? ` (${t.withoutAllocatable} without allocatable data)` : ""}`;
  const cpu = t.cpuPct === null ? "" : ` · CPU requests ${cores(t.cpuRequestsM)} of ${cores(t.cpuAllocatableM)} cores (${t.cpuPct}%)`;
  const mem = t.memPct === null ? "" : ` · Memory requests ${fmtMem(t.memRequestsMi)} of ${fmtMem(t.memAllocatableMi)} (${t.memPct}%)`;
  return nodes + cpu + mem;
}

/** NodeStrip REQ row: "cpu 94% · mem 77%", with "—" for an unreadable allocatable. */
export function reqLine(r: CapacityRow): { text: string; high: boolean } {
  const p = (c: ResourceCell | null) => (c ? `${c.reqPct}%` : "—");
  return { text: `cpu ${p(r.cpu)} · mem ${p(r.mem)}`, high: r.cpu?.level === "high" || r.mem?.level === "high" };
}
