import { useMemo, useState, useEffect, memo, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import markSvg from "../assets/garita-mark.svg?raw";
import {
  Boxes, Layers, Package, List, Clock, Briefcase,
  Network, Globe, FileCode, Lock, Database, Server, Activity,
  ChevronsUpDown, TrendingUp, Puzzle,
  Shield, ShieldCheck, GitBranch, Anchor, ShieldAlert, FolderGit2, FolderTree,
  Waypoints, Split, Copy, Webhook, Camera, ChevronRight, ChevronDown, Settings, History, HeartPulse, Gauge, Search, Archive, FileWarning,
} from "lucide-react";
import type { ResourceType, CRD } from "../types/k8s";
import { HEALTH_PAGES, type HealthPage } from "../utils/resourceQueryKey";
import { useClusterIdentity, CLUSTER_COLOR_CLASSES } from "../utils/clusterIdentity";
import { useAppUpdate, useCRDs } from "../hooks/useResources";
import { noticeLabel } from "../utils/updateState";
import { ReadOnlyChip } from "./ReadOnlyBadge";
import { PRODUCT_NAME } from "../brand";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem = memo(function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2.5 mx-2 px-2 h-7 rounded-md text-[12.5px] transition-colors
        ${active
          ? "bg-accent/12 text-ink ring-1 ring-accent/25"
          : "text-mute hover:bg-surface-tint/4 hover:text-ink"
        }`}
    >
      <span className={active ? "text-accent" : "text-mute group-hover:text-ink"}>
        {icon}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
    </button>
  );
});

const SidebarSection = memo(function SidebarSection({ label, children }: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="px-3 mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-dim">{label}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
});

interface SidebarProps {
  active: ResourceType;
  setActive: (v: ResourceType) => void;
  currentContext: string;
  onOpenSwitcher: () => void;
  crdTarget?: CRD | null;
  onSelectCrdInstance?: (crd: CRD) => void;
  /** F6: the gear in the footer opens Settings (a main view, not a resource). */
  onOpenSettings?: () => void;
  /** v2.1.0: the update notice opens Settings → Updates and focuses its primary action. */
  onOpenUpdates?: () => void;
  settingsActive?: boolean;
  /** #31: the Journal entry beside Settings. */
  onOpenJournal?: () => void;
  /** #32: "Who can…" under Access Control. */
  onOpenWhoCan?: () => void;
  whoCanActive?: boolean;
  journalActive?: boolean;
  /** HEALTH section: the active page (its own state, since `active` is a ResourceType) and the opener. No count badges. */
  healthActive?: HealthPage | null;
  onOpenHealth?: (page: HealthPage) => void;
}

export function Sidebar({
  active, setActive, currentContext, onOpenSwitcher,
  crdTarget, onSelectCrdInstance, onOpenSettings, onOpenUpdates, settingsActive, onOpenJournal, journalActive, onOpenWhoCan, whoCanActive, healthActive, onOpenHealth,
}: SidebarProps) {
  const [appVersion, setAppVersion] = useState("");
  const [expandedCrdGroups, setExpandedCrdGroups] = useState<Set<string>>(new Set());
  const upd = useAppUpdate();
  const notice = noticeLabel(upd.state, upd.dismissed);
  const noticeVersion = "version" in upd.state ? upd.state.version : null;
  const identity = useClusterIdentity(currentContext);
  const { data: crds = [] } = useCRDs(currentContext);
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Grouped by CRD group, kinds sorted (§4.5) — a plain array sorted twice is
  // simpler than a Map for a list this small (dozens of CRDs, not thousands).
  const crdGroups = useMemo(() => {
    const groups = new Map<string, CRD[]>();
    for (const c of crds) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    }
    return [...groups.entries()]
      .map(([group, list]): [string, CRD[]] => [group, [...list].sort((a, b) => a.kind.localeCompare(b.kind))])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [crds]);

  const toggleCrdGroup = useCallback((group: string) => {
    setExpandedCrdGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  const initials = useMemo(() => {
    const parts = currentContext.split("-");
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  }, [currentContext]);

  return (
    <aside className="w-[280px] shrink-0 bg-panel/80 border-r border-edge flex flex-col">
      {/* product mark */}
      <div
        className="h-[80px] pl-4 pr-3 flex items-end pb-4 gap-2 border-b border-edge cursor-default select-none"
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("button, input, a")) {
            e.preventDefault();
            void getCurrentWindow().startDragging();
          }
        }}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, input, a")) {
            void getCurrentWindow().toggleMaximize();
          }
        }}
      >
        <div className="flex-1" />
        <span aria-hidden className="pointer-events-none shrink-0 w-[19px] h-[22px] text-ink [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: markSvg }} />
        <span title={PRODUCT_NAME} className="min-w-0 truncate text-[16px] font-semibold tracking-tight pointer-events-none">{PRODUCT_NAME}</span>
        {appVersion && (
          <span className="mono text-[12px] text-dim pointer-events-none">v{appVersion}</span>
        )}
      </div>

      {/* v2.1.0 update notice (docs/ux/05 §9.5): its own row, outside the drag region above. Calm: no ring, badge or pulse. */}
      {notice && (
        <div className="mx-2 mt-2 flex items-center gap-1 text-[11.5px]">
          <button
            type="button" onClick={onOpenUpdates}
            className="flex-1 min-w-0 h-6 px-2 rounded-sm text-left truncate text-mute hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <span aria-hidden className="text-status-progress mr-1.5">↻</span>{notice}
          </button>
          {upd.state.s !== "ready" && noticeVersion && (
            <button
              type="button" onClick={() => upd.dismiss(noticeVersion)} aria-label={`Dismiss update notice for ${noticeVersion}`}
              className="shrink-0 h-6 w-6 rounded-sm text-mute hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
      )}

      {/* context switcher */}
      <button
        onClick={onOpenSwitcher}
        className="mx-2 mt-2 group flex items-center gap-2.5 px-2.5 h-[42px] rounded-lg bg-card/70 ring-1 ring-edge hover:ring-edge2 transition"
      >
        <span className={`h-7 w-7 rounded-md ring-1 flex items-center justify-center text-[10px] font-bold mono ${
          currentContext ? `${CLUSTER_COLOR_CLASSES[identity.color].chipBg} ${CLUSTER_COLOR_CLASSES[identity.color].chipRing} ${CLUSTER_COLOR_CLASSES[identity.color].text}` : "bg-linear-to-br from-accent/30 to-purple/20 ring-accent/30 text-accent"
        }`}>
          {initials || "K8"}
        </span>
        <span className="flex-1 text-left min-w-0">
          <span className="block text-[12px] font-medium leading-tight truncate">
            {currentContext || "No context"}
          </span>
          <span className="block text-[10.5px] text-dim mono truncate">
            {identity.readOnly && currentContext ? <ReadOnlyChip className="px-1! py-0! ring-0! bg-transparent!" /> : currentContext ? "kubeconfig" : "—"}
          </span>
        </span>
        <ChevronsUpDown size={14} className="text-mute" />
      </button>

      <div className="flex-1 overflow-y-auto pb-3">
        {onOpenHealth && (
          <SidebarSection label="Health">
            <NavItem icon={<HeartPulse size={15} />} label={HEALTH_PAGES.problems.label} active={healthActive === "problems"} onClick={() => onOpenHealth("problems")} />
            <NavItem icon={<Gauge size={15} />} label={HEALTH_PAGES.capacity.label} active={healthActive === "capacity"} onClick={() => onOpenHealth("capacity")} />
            <NavItem icon={<Archive size={15} />} label={HEALTH_PAGES.unused.label} active={healthActive === "unused"} onClick={() => onOpenHealth("unused")} />
            <NavItem icon={<FileWarning size={15} />} label={HEALTH_PAGES.deprecations.label} active={healthActive === "deprecations"} onClick={() => onOpenHealth("deprecations")} />
            <NavItem icon={<Network size={15} />} label={HEALTH_PAGES.map.label} active={healthActive === "map"} onClick={() => onOpenHealth("map")} />
          </SidebarSection>
        )}

        <SidebarSection label="Workloads">
          <NavItem icon={<Boxes size={15} />}      label="Pods"                active={active === "pods"}   onClick={() => setActive("pods")} />
          <NavItem icon={<Layers size={15} />}     label="Deployments"         active={active === "deploy"} onClick={() => setActive("deploy")} />
          <NavItem icon={<Package size={15} />}    label="StatefulSets"        active={active === "sts"}    onClick={() => setActive("sts")} />
          <NavItem icon={<List size={15} />}       label="DaemonSets"          active={active === "ds"}     onClick={() => setActive("ds")} />
          <NavItem icon={<Briefcase size={15} />}  label="Jobs"                active={active === "jobs"}   onClick={() => setActive("jobs")} />
          <NavItem icon={<Clock size={15} />}      label="CronJobs"            active={active === "cron"}   onClick={() => setActive("cron")} />
          <NavItem icon={<TrendingUp size={15} />} label="HPAs"                active={active === "hpa"}    onClick={() => setActive("hpa")} />
          <NavItem icon={<ShieldAlert size={15} />}label="PodDisruptionBudgets"active={active === "pdb"}    onClick={() => setActive("pdb")} />
          <NavItem icon={<Copy size={15} />}       label="ReplicaSets"         active={active === "rs"}     onClick={() => setActive("rs")} />
        </SidebarSection>

        <SidebarSection label="Networking">
          <NavItem icon={<Network size={15} />}  label="Services"         active={active === "svc"}       onClick={() => setActive("svc")} />
          <NavItem icon={<Globe size={15} />}    label="Ingresses"        active={active === "ing"}       onClick={() => setActive("ing")} />
          <NavItem icon={<Shield size={15} />}   label="Network Policies" active={active === "netpol"}    onClick={() => setActive("netpol")} />
          <NavItem icon={<Globe size={15} />}    label="Gateways"         active={active === "gw"}        onClick={() => setActive("gw")} />
          <NavItem icon={<Globe size={15} />}    label="HTTPRoutes"       active={active === "httproute"} onClick={() => setActive("httproute")} />
          <NavItem icon={<Waypoints size={15} />}label="Endpoints"        active={active === "ep"}        onClick={() => setActive("ep")} />
          <NavItem icon={<Split size={15} />}    label="EndpointSlices"   active={active === "eps"}       onClick={() => setActive("eps")} />
        </SidebarSection>

        <SidebarSection label="Config & Storage">
          <NavItem icon={<FileCode size={15} />}    label="ConfigMaps"      active={active === "cm"}   onClick={() => setActive("cm")} />
          <NavItem icon={<Lock size={15} />}        label="Secrets"         active={active === "sec"}  onClick={() => setActive("sec")} />
          <NavItem icon={<Database size={15} />}    label="PVCs"            active={active === "pvc"}  onClick={() => setActive("pvc")} />
          <NavItem icon={<Database size={15} />}    label="PVs"             active={active === "pv"}   onClick={() => setActive("pv")} />
          <NavItem icon={<Database size={15} />}    label="Storage Classes" active={active === "sc"}   onClick={() => setActive("sc")} />
          <NavItem icon={<ShieldCheck size={15} />} label="Certificates"    active={active === "cert"} onClick={() => setActive("cert")} />
          <NavItem icon={<Database size={15} />}    label="Resource Quotas" active={active === "rq"}   onClick={() => setActive("rq")} />
          <NavItem icon={<Database size={15} />}    label="Limit Ranges"    active={active === "lr"}   onClick={() => setActive("lr")} />
          <NavItem icon={<Camera size={15} />}      label="Volume Snapshots" active={active === "vs"}  onClick={() => setActive("vs")} />
        </SidebarSection>

        <SidebarSection label="Access Control">
          <NavItem icon={<ShieldCheck size={15} />} label="Service Accounts"     active={active === "sa"}         onClick={() => setActive("sa")} />
          <NavItem icon={<Lock size={15} />}        label="Roles"                active={active === "roles"}      onClick={() => setActive("roles")} />
          <NavItem icon={<Lock size={15} />}        label="Cluster Roles"        active={active === "croles"}     onClick={() => setActive("croles")} />
          <NavItem icon={<GitBranch size={15} />}   label="Role Bindings"        active={active === "rbindings"}  onClick={() => setActive("rbindings")} />
          <NavItem icon={<GitBranch size={15} />}   label="Cluster Role Bindings"active={active === "crbindings"} onClick={() => setActive("crbindings")} />
          {onOpenWhoCan && <NavItem icon={<Search size={15} />} label="Who can…" active={!!whoCanActive} onClick={onOpenWhoCan} />}
        </SidebarSection>

        <SidebarSection label="Cluster">
          <NavItem icon={<FolderTree size={15} />} label="Namespaces"     active={active === "ns"}     onClick={() => setActive("ns")} />
          <NavItem icon={<Server size={15} />}   label="Nodes"            active={active === "nodes"}  onClick={() => setActive("nodes")} />
          <NavItem icon={<Activity size={15} />} label="Events"           active={active === "events"} onClick={() => setActive("events")} />
          <NavItem icon={<Puzzle size={15} />}   label="CRDs"             active={active === "crd"}    onClick={() => setActive("crd")} />
          <NavItem icon={<List size={15} />}     label="Priority Classes" active={active === "pc"}     onClick={() => setActive("pc")} />
          <NavItem icon={<Webhook size={15} />}  label="Mutating Webhooks"   active={active === "mwc"} onClick={() => setActive("mwc")} />
          <NavItem icon={<Webhook size={15} />}  label="Validating Webhooks" active={active === "vwc"} onClick={() => setActive("vwc")} />
        </SidebarSection>

        {crdGroups.length > 0 && (
          <SidebarSection label="Custom Resources">
            {crdGroups.map(([group, list]) => (
              <div key={group} className="flex flex-col">
                <button
                  onClick={() => toggleCrdGroup(group)}
                  className="flex items-center gap-1.5 mx-2 px-2 h-6 rounded-md text-[11px] text-dim hover:text-ink hover:bg-surface-tint/4 transition-colors"
                >
                  {expandedCrdGroups.has(group) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span className="flex-1 text-left truncate mono">{group || "core"}</span>
                  <span className="text-dim">{list.length}</span>
                </button>
                {expandedCrdGroups.has(group) && list.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => onSelectCrdInstance?.(c)}
                    className={`group flex items-center gap-2.5 mx-2 pl-7 pr-2 h-7 rounded-md text-[12.5px] transition-colors
                      ${active === "crd-instances" && crdTarget?.name === c.name
                        ? "bg-accent/12 text-ink ring-1 ring-accent/25"
                        : "text-mute hover:bg-surface-tint/4 hover:text-ink"
                      }`}
                  >
                    <span className="flex-1 text-left truncate">{c.kind}</span>
                  </button>
                ))}
              </div>
            ))}
          </SidebarSection>
        )}

        <SidebarSection label="Helm">
          <NavItem icon={<Anchor size={15} />} label="Releases" active={active === "helm"} onClick={() => setActive("helm")} />
        </SidebarSection>

        <SidebarSection label="GitOps">
          <NavItem icon={<GitBranch size={15} />} label="ArgoCD Apps"         active={active === "argocd"}       onClick={() => setActive("argocd")} />
          <NavItem icon={<Boxes size={15} />}     label="ApplicationSets"     active={active === "argo-appsets"} onClick={() => setActive("argo-appsets")} />
          <NavItem icon={<FolderGit2 size={15} />}label="Projects"            active={active === "argo-projects"}onClick={() => setActive("argo-projects")} />
          <NavItem icon={<GitBranch size={15} />} label="Repositories"        active={active === "argo-repos"}   onClick={() => setActive("argo-repos")} />
          <NavItem icon={<GitBranch size={15} />} label="Flux Kustomizations" active={active === "flux-ks"}      onClick={() => setActive("flux-ks")} />
          <NavItem icon={<GitBranch size={15} />} label="Flux HelmReleases"   active={active === "flux-hr"}      onClick={() => setActive("flux-hr")} />
        </SidebarSection>

      </div>

      {/* footer: always visible, below the scrolling nav */}
      <div className="shrink-0 border-t border-edge px-2 py-2 flex items-center">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          aria-current={settingsActive ? "page" : undefined}
          title="Settings (⌘,)"
          className={`flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] transition-colors ${settingsActive ? "bg-accent/12 text-ink ring-1 ring-accent/25" : "text-mute hover:bg-surface-tint/4 hover:text-ink"}`}
        >
          <Settings size={14} /> Settings
        </button>
        {onOpenJournal && (
          <button
            type="button"
            onClick={onOpenJournal}
            aria-current={journalActive ? "page" : undefined}
            title="Journal: actions performed from this app"
            className={`flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] transition-colors ${journalActive ? "bg-accent/12 text-ink ring-1 ring-accent/25" : "text-mute hover:bg-surface-tint/4 hover:text-ink"}`}
          >
            <History size={14} /> Journal
          </button>
        )}
      </div>
    </aside>
  );
}
