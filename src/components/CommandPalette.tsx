import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import type { ResourceType, SearchResult } from "../types/k8s";
import { useSearchResources } from "../hooks/useResources";

interface NavItem {
  id: ResourceType;
  label: string;
  section: string;
  icon?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "pods",       label: "Pods",                  section: "Workloads" },
  { id: "deploy",     label: "Deployments",           section: "Workloads" },
  { id: "sts",        label: "StatefulSets",          section: "Workloads" },
  { id: "ds",         label: "DaemonSets",            section: "Workloads" },
  { id: "jobs",       label: "Jobs",                  section: "Workloads" },
  { id: "cron",       label: "CronJobs",              section: "Workloads" },
  { id: "hpa",        label: "HPAs",                  section: "Workloads" },
  { id: "pdb",        label: "PodDisruptionBudgets",  section: "Workloads" },
  { id: "rs",         label: "ReplicaSets",           section: "Workloads" },
  { id: "svc",        label: "Services",              section: "Networking" },
  { id: "ing",        label: "Ingresses",             section: "Networking" },
  { id: "netpol",     label: "Network Policies",      section: "Networking" },
  { id: "gw",         label: "Gateways",              section: "Networking" },
  { id: "httproute",  label: "HTTPRoutes",            section: "Networking" },
  { id: "ep",         label: "Endpoints",             section: "Networking" },
  { id: "eps",        label: "EndpointSlices",        section: "Networking" },
  { id: "cm",         label: "ConfigMaps",            section: "Config & Storage" },
  { id: "sec",        label: "Secrets",               section: "Config & Storage" },
  { id: "pvc",        label: "PVCs",                  section: "Config & Storage" },
  { id: "pv",         label: "PVs",                   section: "Config & Storage" },
  { id: "sc",         label: "Storage Classes",       section: "Config & Storage" },
  { id: "cert",       label: "Certificates",          section: "Config & Storage" },
  { id: "rq",         label: "Resource Quotas",       section: "Config & Storage" },
  { id: "lr",         label: "Limit Ranges",          section: "Config & Storage" },
  { id: "vs",         label: "Volume Snapshots",      section: "Config & Storage" },
  { id: "sa",         label: "Service Accounts",      section: "Access Control" },
  { id: "roles",      label: "Roles",                 section: "Access Control" },
  { id: "croles",     label: "Cluster Roles",         section: "Access Control" },
  { id: "rbindings",  label: "Role Bindings",         section: "Access Control" },
  { id: "crbindings", label: "Cluster Role Bindings", section: "Access Control" },
  { id: "ns",         label: "Namespaces",            section: "Cluster" },
  { id: "nodes",      label: "Nodes",                 section: "Cluster" },
  { id: "events",     label: "Events",                section: "Cluster" },
  { id: "crd",        label: "CRDs",                  section: "Cluster" },
  { id: "pc",         label: "Priority Classes",      section: "Cluster" },
  { id: "mwc",        label: "Mutating Webhooks",     section: "Cluster" },
  { id: "vwc",        label: "Validating Webhooks",   section: "Cluster" },
  { id: "helm",       label: "Helm Releases",         section: "Helm" },
  { id: "argocd",     label: "ArgoCD Apps",           section: "GitOps" },
  { id: "argo-appsets",  label: "ApplicationSets",    section: "GitOps" },
  { id: "argo-projects", label: "AppProjects",        section: "GitOps" },
  { id: "argo-repos",    label: "Repositories",       section: "GitOps" },
  { id: "flux-ks",    label: "Flux Kustomizations",   section: "GitOps" },
  { id: "flux-hr",    label: "Flux HelmReleases",     section: "GitOps" },
];

/**
 * A non-navigation palette entry (read-only on/off, Settings, Compare…). A disabled entry
 * stays visible with its reason (DISABLE-PRECEDENCE). The palette closes BEFORE `run()`, so a
 * ConfirmModal opened by an action never sits over a live palette (the palette is not a
 * modal layer).
 */
export interface PaletteAction {
  id: string;
  label: string;
  section: string;
  disabledReason?: string;
  /** Extra words the palette also matches (not shown). */
  keywords?: string;
  run: () => void;
}

type Entry =
  | { key: string; label: string; section: string; nav: ResourceType }
  | { key: string; label: string; section: string; action: PaletteAction; keywords?: string };

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (resource: ResourceType) => void;
  context?: string;
  onNavigate?: (kind: ResourceType, ns: string, name: string) => void;
  actions?: PaletteAction[];
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-tint/6 text-mute ring-1 ring-edge">
      {children}
    </kbd>
  );
}

export function CommandPalette({ open, onClose, onSelect, context = "", onNavigate, actions = [] }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const showSearch = query.length >= 2 && !!context;
  const { data: searchResults = [], isFetching: searchLoading } = useSearchResources(
    context, query, showSearch && open,
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const entries: Entry[] = [
    ...NAV_ITEMS.map((n): Entry => ({ key: n.id, label: n.label, section: n.section, nav: n.id })),
    ...actions.map((a): Entry => ({ key: `action:${a.id}`, label: a.label, section: a.section, action: a, keywords: a.keywords })),
  ];
  const filtered = entries.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      ("keywords" in item && !!item.keywords?.toLowerCase().includes(query.toLowerCase())) ||
      item.section.toLowerCase().includes(query.toLowerCase())
  );

  function activate(entry: Entry) {
    if ("action" in entry) {
      if (entry.action.disabledReason) return;
      onClose();
      entry.action.run();
      return;
    }
    onSelect(entry.nav);
    onClose();
  }

  // In search mode, total items = search results first, then nav items
  const totalItems = showSearch ? searchResults.length + filtered.length : filtered.length;

  const sections = Array.from(new Set(filtered.map((item) => item.section)));

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (showSearch && selectedIndex < searchResults.length) {
        const r = searchResults[selectedIndex];
        if (onNavigate) {
          onNavigate(r.resource_type as ResourceType, r.namespace ?? "", r.name);
          onClose();
        }
      } else {
        const navIndex = showSearch ? selectedIndex - searchResults.length : selectedIndex;
        if (filtered[navIndex]) activate(filtered[navIndex]);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-scrim/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full mx-4 bg-panel rounded-xl ring-1 ring-edge shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-edge relative">
          <Search size={13} className="text-dim shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to resource or search by name…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 py-3 bg-transparent text-[13px] text-ink placeholder:text-dim focus:outline-hidden"
          />
          {searchLoading && showSearch
            ? <Loader2 size={13} className="text-dim animate-spin shrink-0" />
            : <Kbd>⌘K</Kbd>
          }
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {/* Search results section — shown when query >= 2 chars */}
          {showSearch && searchResults.length > 0 && (
            <div>
              <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-dim flex items-center gap-1.5">
                Search Results
                <span className="text-[9.5px] text-dim/60">({searchResults.length})</span>
              </div>
              {searchResults.map((r: SearchResult, i: number) => {
                const isActive = i === selectedIndex;
                return (
                  <button
                    key={`${r.resource_type}/${r.namespace ?? ""}/${r.name}`}
                    data-active={isActive}
                    className={`w-full flex items-center gap-3 px-4 h-9 text-[13px] text-left transition-colors ${
                      isActive ? "bg-accent/8 text-ink" : "text-ink hover:bg-accent/8"
                    }`}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => {
                      if (onNavigate) {
                        onNavigate(r.resource_type as ResourceType, r.namespace ?? "", r.name);
                      }
                      onClose();
                    }}
                  >
                    <span className="flex-1 min-w-0 truncate mono text-[12px]">{r.name}</span>
                    <span className="mono text-[10.5px] text-dim shrink-0">{r.kind}</span>
                    {r.namespace && (
                      <span className="mono text-[10.5px] text-dim/60 shrink-0">{r.namespace}</span>
                    )}
                  </button>
                );
              })}
              {filtered.length > 0 && <div className="my-0.5 border-t border-edge-raw/40" />}
            </div>
          )}

          {/* No results state */}
          {(!showSearch || searchResults.length === 0) && sections.length === 0 && !searchLoading && (
            <div className="px-4 py-6 text-center text-[12px] text-dim mono">
              No results
            </div>
          )}

          {/* Nav items */}
          {sections.map((section) => {
            const sectionItems = filtered.filter((item) => item.section === section);
            return (
              <div key={section}>
                <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-dim">
                  {section}
                </div>
                {sectionItems.map((item) => {
                  const flatIndex = filtered.indexOf(item);
                  const adjustedIndex = showSearch ? searchResults.length + flatIndex : flatIndex;
                  const isActive = adjustedIndex === selectedIndex;
                  return (
                    <button
                      key={item.key}
                      data-active={isActive}
                      aria-disabled={"action" in item && item.action.disabledReason ? true : undefined}
                      className={`w-full flex items-center gap-3 px-4 h-9 text-[13px] text-left transition-colors ${
                        isActive
                          ? "bg-accent/8 text-ink"
                          : "text-ink hover:bg-accent/8"
                      } ${"action" in item && item.action.disabledReason ? "opacity-60 cursor-not-allowed" : ""}`}
                      onMouseEnter={() => setSelectedIndex(adjustedIndex)}
                      onClick={() => activate(item)}
                    >
                      <span className="flex-1 min-w-0 truncate">{item.label}</span>
                      {"action" in item && item.action.disabledReason && (
                        <span className="text-[10.5px] text-dim shrink-0 max-w-[60%] truncate" title={item.action.disabledReason}>
                          {item.action.disabledReason}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="border-t border-edge px-4 h-8 flex items-center gap-3 text-[10.5px] text-dim">
          <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
          <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}
