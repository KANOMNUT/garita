import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { QueryClient, QueryClientProvider, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Eye, Terminal } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { DisabledReasonHost } from "./components/DisabledReasonHost";
import { ObservabilityDialogHost } from "./components/ObservabilityDialog";
import { requestObservabilityDialog, targetKey } from "./utils/observability";
import { TopBar } from "./components/TopBar";
import { ClusterOverview } from "./components/ClusterOverview";
import { NodeStrip } from "./components/NodeStrip";
import { PodTable } from "./components/PodTable";
import { DetailPanel } from "./components/DetailPanel";
import { ResourceDetailPanel } from "./components/ResourceDetailPanel";
import { ContextSwitcher } from "./components/ContextSwitcher";
import { PortForwardBar } from "./components/PortForwardBar";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { TurnOffReadOnlyConfirm } from "./components/ReadOnlyBadge";
import { canCompare } from "./utils/resourceCompare";
import { SettingsView, type SettingsSection } from "./components/SettingsView";
import { ResourceCreator } from "./components/ResourceCreator";
import { DeleteNamespaceConfirm } from "./components/DeleteNamespaceConfirm";
import { MergeFromFileModal } from "./components/MergeFromFileModal";
import { HelmInstallModal } from "./components/HelmInstallModal";
import {
  useKubeContexts, useClusterAccess,
  useNamespaces, useNamespaceRows, useCachedArgoCdApps, startLaunchArgs, fetchNamespacesOrNull, useClusterInfo, useNodeMetricsHistory, usePodMetricsHistory, usePods, useNodeCapacity,
  detectLegacyInstall,
} from "./hooks/useResources";
import { useActiveContext } from "./hooks/useActiveContext";
import {
  DeploymentView, StatefulSetView, DaemonSetView, JobView, CronJobView, HPAView,
  ServiceView, IngressView, ConfigMapView, SecretView,
  PVCView, PVView, NodeView, EventView, CRDView,
  ServiceAccountView, RoleView, ClusterRoleView, RoleBindingView, ClusterRoleBindingView,
  NetworkPolicyView, HelmView, StorageClassView, PDBView, ArgoCDView, CertificateView,
  FluxKustomizationView, FluxHelmReleaseView, GatewayView, HttpRouteView,
  ResourceQuotaView, LimitRangeView, PriorityClassView,
  ArgoCdAppSetView, ArgoCdProjectView, ArgoCdRepositoryView,
  EndpointsView, EndpointSliceView, ReplicaSetView,
  MutatingWebhookView, ValidatingWebhookView, VolumeSnapshotView, CRDInstanceView, NamespacesView,
} from "./components/ResourceViews";
import type { ClusterAccess, MapKind, Pod, ResourceType, SelectedResource, CRD } from "./types/k8s";
import { RESOURCE_QUERY_KEY, HEALTH_QUERY_KEY, HEALTH_PAGES, type HealthPage, type MainView } from "./utils/resourceQueryKey";
import { ProblemsPage } from "./components/health/ProblemsPage";
import { savedSearchKey } from "./utils/savedSearches";
import { proxyLabel } from "./utils/proxyLabel";
import { JournalPage } from "./components/JournalPage";
import { WhoCanPage } from "./components/WhoCanPage";
import { UnusedPage } from "./components/health/UnusedPage";
import { DeprecatedApisPage } from "./components/health/DeprecatedApisPage";
import { NodeCapacityPage } from "./components/health/NodeCapacityPage";
import { MapPage } from "./components/health/MapPage";
import type { MapMode } from "./components/health/NetpolView";
import { isModalOpen, isEditableTarget, isInTerminal } from "./utils/modalLayer";
import { useClusterIdentity, isIdentityStoreUnset, writeSeedIfUnset, isUpgradeNoticePending, dismissUpgradeNotice } from "./utils/clusterIdentity";
import { UPGRADE_NOTICE_BODY, UPGRADE_NOTICE_TITLE } from "./brand";
import { deferredLine, isEmptyLaunch, launchLines, launchMsg, namespaceLine, planChangesState, planLaunchArgs } from "./utils/launchArgs";
import type { LaunchArgs } from "./types/k8s";
import { NEW_RESOURCE_BLOCKED_ANNOUNCEMENT, readOnlyOnAnnouncement } from "./utils/guardrails";

// Views backed by list_api_presence (the §2.2 key table); the TopBar refresh re-checks presence on these.
const PRESENCE_VIEWS: ReadonlySet<string> = new Set([
  "flux-ks", "flux-hr", "gw", "httproute", "cert", "vs", "argocd", "argo-appsets", "argo-projects",
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
    // #33 (B-2): preview results and write variables (YAML text, stringData) must not outlive their dialog.
    mutations: { gcTime: 0 },
  },
});

// Trust-states banner (docs/plan-kubeconfig-and-parity.md §2.1). `check_cluster_access`
// returns Ok even for failures — state !== "ok" is the trigger, never `error`. An actual
// query `error` means something structurally broken (also true right now, mid-Phase-2,
// since the Rust command doesn't exist yet) and reads deliberately quieter than a real
// trust-state problem so it never looks like the thing this banner exists to report.
const ACCESS_BANNER_STYLE: Record<ClusterAccess["state"], string> = {
  ok: "",
  auth: "bg-warn/10 ring-warn/30 text-warn",
  forbidden: "bg-warn/10 ring-warn/30 text-warn",
  unreachable: "bg-bad/10 ring-bad/30 text-bad",
  unknown: "bg-bad/10 ring-bad/30 text-bad",
};

function ClusterAccessBanner({
  access, queryError, onDismiss, contextName, proxy,
}: {
  contextName: string;
  proxy: string | null | undefined;
  access: ClusterAccess | undefined;
  queryError: Error | null;
  onDismiss: () => void;
}) {
  const message = access && access.state !== "ok" ? access.message : queryError?.message ?? String(queryError);
  const cls = access && access.state !== "ok" ? ACCESS_BANNER_STYLE[access.state] : "bg-surface-tint/3 ring-edge text-mute";
  const viaProxy = access?.state === "unreachable" && !!access.via_proxy;
  const p = viaProxy ? proxyLabel(proxy) : null;
  const alert = access ? access.state === "unreachable" || access.state === "unknown" : !!queryError;
  return (
    <div role={alert ? "alert" : undefined} className={`mx-4 mt-3 shrink-0 px-3 py-2 rounded-lg ring-1 flex items-start gap-2.5 text-[12px] ${cls}`}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      {viaProxy ? (
        <div className="flex-1 whitespace-pre-wrap min-w-0">
          <p className="font-semibold wrap-break-word">
            Couldn't reach {contextName} through {p ? <>proxy <span className="mono break-all">{p.host}{p.port && `:${p.port}`}</span></> : "the proxy"}.
          </p>
          <p className="wrap-break-word">Check the proxy-url in your kubeconfig and your network.</p>
          <p className="mono wrap-break-word">{message}</p>
        </div>
      ) : (
        <p className="flex-1 whitespace-pre-wrap wrap-break-word">{message}</p>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

// RB-3b upgrade notice: ClusterAccessBanner strip, neutral variant. Copy: docs/ux/10-rebrand.md.
function UpgradeSeedBanner({ onDismiss, onOpenSwitcher }: { onDismiss: () => void; onOpenSwitcher: () => void }) {
  return (
    <div role="region" aria-label="Upgrade notice" className="mx-4 mt-3 shrink-0 px-3 py-2 rounded-lg ring-1 flex items-start gap-2.5 text-[12px] bg-surface-tint/3 ring-edge text-mute">
      <Eye size={14} className="shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-ink">{UPGRADE_NOTICE_TITLE}</p>
        <p>{UPGRADE_NOTICE_BODY}</p>
        <div className="mt-1.5 flex items-center gap-3">
          <button onClick={onDismiss} className="px-2 py-0.5 rounded-sm bg-accent/15 ring-1 ring-accent/30 text-accent">Got it</button>
          <button onClick={onOpenSwitcher} className="text-accent hover:underline">Open cluster switcher</button>
        </div>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

// v2.1.3 command-line notice: UpgradeSeedBanner strip, neutral variant. Copy: docs/ux/13-v2.1.3-preflight.md.
// `held` = a forwarded request deferred behind an open dialog; Go now is aria-disabled until none is open.
function LaunchNoticeStrip({ lines, held, blocked, onGo, onDismiss }: {
  lines: string[]; held: boolean; blocked: () => boolean; onGo: () => void; onDismiss: () => void;
}) {
  // isModalOpen() is not reactive: re-render while held so the button follows the dialog closing.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!held) return;
    const id = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [held]);
  const off = held && blocked();
  return (
    <div role="region" aria-label="Command-line request" className="mx-4 mt-3 shrink-0 px-3 py-2 rounded-lg ring-1 flex items-start gap-2.5 text-[12px] bg-surface-tint/3 ring-edge text-mute">
      <Terminal size={14} className="shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <div id="launch-notice-text">
          {lines.map((l, i) => <p key={i} className="wrap-break-word">{l}</p>)}
        </div>
        {held && (
          <div className="mt-1.5">
            <button
              onClick={() => { if (!blocked()) onGo(); }}
              aria-disabled={off}
              aria-describedby="launch-notice-text"
              title={off ? launchMsg.goNowReason : undefined}
              className={`px-2 py-0.5 rounded-sm bg-accent/15 ring-1 ring-accent/30 text-accent focus-visible:ring-2 focus-visible:ring-accent/70 ${off ? "opacity-50 cursor-not-allowed" : ""}`}
            >{launchMsg.goNow}</button>
          </div>
        )}
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm">✕</button>
    </div>
  );
}

const isPodViewForCompare = (r: ResourceType) => r === "pods";

function AppInner() {
  const [activeResource, setActiveResourceRaw] = useState<ResourceType>("pods");
  // Settings is app state, not a ResourceType (Q7). Esc does not leave it.
  // Health pages (A-6) are mainView "health" + a page, never ResourceType members (T4-9).
  const [mainView, setMainView] = useState<MainView>("resources");
  const [healthPage, setHealthPage] = useState<HealthPage>("problems");
  const [search, setSearch] = useState("");
  // #18: the object the Map page is narrowed to; scoped to its namespace so a picker change drops it.
  const [mapMode, setMapMode] = useState<MapMode>("resources");
  // Pod panel "Show on map": the pod whose group the netpol mode focuses (scoped like mapFocus).
  const [netpolPod, setNetpolPod] = useState<{ name: string; ns: string; ctx: string; enter: boolean } | null>(null);
  const [mapFocus, setMapFocus] = useState<{ kind: MapKind; name: string; ns: string; ctx: string; enter?: boolean } | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("diagnostics");
  // Bumped to focus the primary action of Settings → Updates (palette entry, Sidebar notice).
  const [focusUpdates, setFocusUpdates] = useState(0);
  const openUpdates = () => { setSettingsSection("updates"); setMainView("settings"); setFocusUpdates((n) => n + 1); };
  // UXP-23: ONE navigation wrapper used by EVERY entry point (Sidebar, CRD tree, NodeStrip
  // "view all", both panels' onNavigate, the palette). It resets mainView directly: an effect
  // on activeResource would never fire when the user re-picks the resource already active.
  const setActiveResource = useCallback((r: ResourceType) => {
    // A Health / Journal / Who can filter is not a resource search: drop it, or re-picking the resource
    // that is already active (no effect fires) would keep filtering the list by it.
    if (mainView !== "resources") setSearch("");
    setMainView("resources");
    setActiveResourceRaw(r);
  }, [mainView]);
  const [namespace, setNamespace] = useState("all");
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  // §4.5 — which CRD kind the "crd-instances" view is currently showing.
  // CRDResource has no detail panel, so this lives outside SelectedResource.
  const [crdTarget, setCrdTarget] = useState<CRD | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  // The namespace the typed delete confirm is open for (row trash on the Namespaces page, or the panel header trash).
  const [nsToDelete, setNsToDelete] = useState<string | null>(null);
  const [mergeFromFileOpen, setMergeFromFileOpen] = useState(false);
  const [helmInstallOpen, setHelmInstallOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const qc = useQueryClient();
  const [currentContext, setActiveContext] = useActiveContext();
  const identity = useClusterIdentity(currentContext);
  // The identity hook builds a new object each render; key the target on its string so NodeStrip stays memoised.
  const promTarget = identity.observability?.prometheus;
  const promKey = promTarget ? targetKey(promTarget) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePromTarget = useMemo(() => promTarget, [promKey]);
  // Read-only mode (#29): announcements go through one polite live region; a blocked ⌘N
  // bumps `blockedRing`, which shows the TopBar badge ring for 2 s (static, no motion).
  const [announcement, setAnnouncement] = useState("");
  const [blockedRing, setBlockedRing] = useState(0);
  const [readOnlyConfirm, setReadOnlyConfirm] = useState(false);
  const [compareNonce, setCompareNonce] = useState(0);
  const { data: contexts = [], isSuccess: contextsLoaded } = useKubeContexts();
  // RB-3b fail-closed seed. Needs the context list; if list_contexts fails nothing is written (next launch retries).
  const [seedNotice, setSeedNotice] = useState(isUpgradeNoticePending);
  const seedTried = useRef(false);
  const contextNames = JSON.stringify(contexts.map((c) => c.name));
  useEffect(() => {
    if (!contextsLoaded || contextNames === "[]" || seedTried.current || !isIdentityStoreUnset()) return;
    seedTried.current = true;
    const names: string[] = JSON.parse(contextNames);
    // A rejection means "could not tell": fail closed, same as true.
    detectLegacyInstall().catch(() => true).then((legacy) => {
      if (legacy && writeSeedIfUnset(names)) setSeedNotice(true);
    });
  }, [contextsLoaded, contextNames]);
  const prevContextRef = useRef(currentContext);
  // Namespace for a command-line context switch, valid only for that context (S1).
  const pendingLaunchNs = useRef<{ ctx: string; ns: string | null } | null>(null);
  const launchSeq = useRef(0);
  const navigateSearchRef = useRef<string | null>(null);
  const lastRefreshRef = useRef<number>(0);
  const { data: namespaces = [] } = useNamespaces(currentContext);
  // A Namespace is selected as a snapshot of its list row, and the page polls while one is Terminating. The panel reads the
  // live row (same query, no extra fetch) so it shows Terminating after a delete; a name that left the list keeps its snapshot.
  const { data: nsRows } = useNamespaceRows(currentContext);
  // Same for an ArgoCD Application: the panel follows the Applications list's cached row (a failed sync turns it Failed and
  // shows the reason without a reselect). This observer is disabled: it reads the cache, only the list view polls.
  const { data: argoApps } = useCachedArgoCdApps(currentContext);
  const { data: clusterAccess, error: clusterAccessError } = useClusterAccess(currentContext);
  const [accessBannerDismissed, setAccessBannerDismissed] = useState(false);
  const { data: clusterInfo } = useClusterInfo(currentContext);
  const { data: nodes = [], cpuHistory: nodeCpuHistory, memHistory: nodeMemHistory } = useNodeMetricsHistory(currentContext);
  const { cpuHistory: podCpuHistory, memHistory: podMemHistory, containerCpuHistory, containerMemHistory } = usePodMetricsHistory(currentContext, namespace);
  // NodeStrip's requests overlay (#12): progressive, so it only runs on the Pods view.
  const { data: nodeCapacity } = useNodeCapacity(currentContext, mainView === "resources" && activeResource === "pods");

  const {
    data: pods = [],
    isLoading: podsLoading,
    error: podsError,
  } = usePods(currentContext, namespace);

  const handleRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 2000) return;
    lastRefreshRef.current = now;

    if (mainView === "health") {
      // Prefix key: covers every namespace's report, so an open explain card refreshes too.
      qc.invalidateQueries({ queryKey: [HEALTH_QUERY_KEY[healthPage], currentContext] });
    } else if (mainView === "journal") {
      qc.invalidateQueries({ queryKey: ["journal"] });
    } else if (mainView === "whocan") {
      qc.invalidateQueries({ queryKey: ["who-can", currentContext] });
    } else if (mainView !== "resources") {
      return; // Settings must not fall into the active-resource branch (P8).
    } else if (activeResource === "pods") {
      qc.invalidateQueries({ queryKey: ["pods", currentContext, namespace] });
      qc.invalidateQueries({ queryKey: ["cluster-info", currentContext] });
      qc.invalidateQueries({ queryKey: ["nodes", currentContext] });
    } else {
      const key = RESOURCE_QUERY_KEY[activeResource];
      if (key) qc.invalidateQueries({ queryKey: [key, currentContext] });
      if (PRESENCE_VIEWS.has(activeResource)) qc.invalidateQueries({ queryKey: ["api-presence", currentContext] });
    }
    setLastUpdated(`Updated ${new Date().toLocaleTimeString()}`);
  }, [activeResource, currentContext, namespace, qc, mainView, healthPage]);

  // isFetching: use 2-element prefix key so cluster-scoped resources match correctly
  const activeQueryKey = mainView === "health"
    ? [HEALTH_QUERY_KEY[healthPage], currentContext]
    : mainView === "journal"
    ? ["journal"]
    : mainView === "whocan"
    ? ["who-can", currentContext]
    : activeResource === "pods"
    ? ["pods", currentContext, namespace]
    : [RESOURCE_QUERY_KEY[activeResource] ?? "", currentContext];
  const isFetchingCount = useIsFetching({ queryKey: activeQueryKey });
  const isFetching = isFetchingCount > 0;

  // Clear selections + search when namespace or resource type changes.
  // navigateSearchRef lets onNavigate pre-fill search through this effect.
  useEffect(() => {
    setSelectedPod(null);
    setSelectedResource(null);
    // §4.5: cleared when activeResource changes away from "crd-instances" —
    // set *before* this effect runs (see Sidebar's onSelectCrdInstance), so
    // this only ever clears it, never races the set.
    if (activeResource !== "crd-instances") setCrdTarget(null);
    if (navigateSearchRef.current !== null) {
      setSearch(navigateSearchRef.current);
      navigateSearchRef.current = null;
    } else {
      setSearch("");
    }
  }, [namespace, activeResource]);

  // Reset namespace + selections when context changes (e.g. after a switch)
  useEffect(() => {
    if (currentContext && currentContext !== prevContextRef.current) {
      prevContextRef.current = currentContext;
      setNamespace("all");
      // A command-line namespace for the new context lands after this reset (last setState wins).
      const pending = pendingLaunchNs.current;
      if (pending?.ns && pending.ctx === currentContext) setNamespace(pending.ns);
      setSelectedPod(null);
      setSelectedResource(null);
      setCrdTarget(null);
      setSearch("");
    }
    pendingLaunchNs.current = null; // consumed or stale: never leaks onto a later manual switch
    launchSeq.current++; // a launch still awaiting its namespace check must not undo this switch (M1)
  }, [currentContext]);

  // A dismissed banner should reappear on a fresh problem — context switch, or a
  // transition into/out of a non-"ok" state (e.g. recovers then fails again).
  useEffect(() => {
    setAccessBannerDismissed(false);
  }, [currentContext, clusterAccess?.state, !!clusterAccessError]);

  // Shared by ⌘N and the TopBar "New resource…" menu item so the two can
  // never disagree about what Helm's +New opens — Helm isn't a CreatableKind
  // (docs/plan-kubeconfig-and-parity.md §3.3), so its own install flow needs
  // a different modal instead of the generic YAML/form creator.
  const openCreator = useCallback(() => {
    // Non-resource views create nothing (A-6): inert, no error, no announcement.
    if (mainView !== "resources") return;
    if (identity.readOnly) {
      setAnnouncement(NEW_RESOURCE_BLOCKED_ANNOUNCEMENT);
      setBlockedRing((n) => n + 1);
      return;
    }
    if (activeResource === "helm") setHelmInstallOpen(true);
    else setCreatorOpen(true);
  }, [activeResource, identity.readOnly, mainView]);

  const openHealth = useCallback((page: HealthPage) => {
    setSearch("");
    setHealthPage(page);
    setMainView("health");
  }, []);
  // Panel "Map" action (UX 3.1 B): close the panel, re-scope to the object's namespace, map what is connected to it.
  const openMap = useCallback((kind: MapKind, ns: string, name: string) => {
    setSelectedResource(null);
    setSelectedPod(null);
    setSearch("");
    setNamespace(ns);
    setMapFocus({ kind, name, ns, ctx: currentContext, enter: true });
    setMapMode("resources");
    setHealthPage("map");
    setMainView("health");
  }, [currentContext]);
  // X6 palette entry and the pod panel's "Show on map": the Map page in Network policies (approximation) mode.
  const openNetpol = useCallback((ns?: string, podName?: string) => {
    setSelectedPod(null);
    setSearch("");
    if (ns) setNamespace(ns);
    setNetpolPod(ns && podName ? { name: podName, ns, ctx: currentContext, enter: true } : null);
    setMapMode("netpol");
    setHealthPage("map");
    setMainView("health");
  }, [currentContext]);
  const openWhoCan = useCallback(() => {
    setSearch("");
    setMainView("whocan");
  }, []);
  // Who can's Open: the namespace-setting navigation the panels use (P9), because the page is not scoped by the picker.
  const openObject = useCallback((kind: ResourceType, ns: string, name: string) => {
    setSelectedResource(null);
    setSelectedPod(null);
    const sameNs = !ns || ns === namespace;
    if (kind === activeResource && sameNs) { setMainView("resources"); setSearch(name); return; }
    navigateSearchRef.current = name;
    setActiveResource(kind);
    if (ns) setNamespace(ns);
  }, [activeResource, namespace, setActiveResource]);
  const openJournal = useCallback(() => {
    setSearch("");
    setMainView("journal");
  }, []);
  // A jump from a Health page (A-6, UX Q2): lists the object's kind filtered to its name and does
  // NOT touch the namespace picker. Same kind as the active list fires no effect, so set search here.
  const jumpFromHealth = useCallback((kind: ResourceType, _ns: string, name: string) => {
    setMainView("resources");
    setSelectedPod(null);
    setSelectedResource(null);
    if (kind === activeResource) setSearch(name);
    else { navigateSearchRef.current = name; setActiveResourceRaw(kind); }
  }, [activeResource]);

  // Palette entries for read-only mode (D3-4): turning it ON is immediate (the safe
  // direction); turning it OFF is always a confirm.
  const settingsActions: PaletteAction[] = [
    ...(Object.keys(HEALTH_PAGES) as HealthPage[]).map((p): PaletteAction => ({
      id: `health-${p}`, label: HEALTH_PAGES[p].label, section: "Health", run: () => openHealth(p),
    })),
    { id: "netpol-map", label: "Network policies (approximation)", section: "Health", keywords: "netpol networkpolicy map traffic", run: () => openNetpol() },
    { id: "settings", label: "Settings", section: "App", run: () => setMainView("settings") },
    { id: "journal", label: "Journal", section: "App", run: openJournal },
    { id: "whocan", label: "Who can…", section: "Access Control", run: openWhoCan },
    { id: "settings-appearance", label: "Settings: Appearance", section: "App", keywords: "theme dark light accent colour", run: () => { setSettingsSection("appearance"); setMainView("settings"); } },
    { id: "settings-updates", label: "Settings: Updates", section: "App", keywords: "update upgrade version release check", run: openUpdates },
    { id: "settings-command-line", label: "Settings: Command line", section: "App", keywords: "cli terminal garita path install", run: () => { setSettingsSection("command-line"); setMainView("settings"); } },
    { id: "settings-diagnostics", label: "Settings: Diagnostics", section: "App", run: () => { setSettingsSection("diagnostics"); setMainView("settings"); } },
    ...(currentContext
      ? [{ id: "observability", label: `Observability: configure for ${identity.label || currentContext}`, section: "App", keywords: "prometheus loki victorialogs metrics logs history", run: () => requestObservabilityDialog(currentContext) } satisfies PaletteAction]
      : []),
  ];
  // #8: offered only while a compare-eligible resource is selected (never pods).
  const compareActions: PaletteAction[] =
    selectedResource && !isPodViewForCompare(activeResource) && canCompare(selectedResource.kind)
      ? [{
          id: "compare",
          label: `Compare ${selectedResource.kind} ${selectedResource.item.name} with…`,
          section: "App",
          run: () => setCompareNonce((n) => n + 1),
        }]
      : [];
  const paletteActions: PaletteAction[] = currentContext
    ? [
        identity.readOnly
          ? { id: "read-only-off", label: "Turn off read-only mode…", section: "App", run: () => setReadOnlyConfirm(true) }
          : {
              id: "read-only-on",
              label: "Turn on read-only mode",
              section: "App",
              run: () => {
                identity.setIdentity({ readOnly: true });
                setAnnouncement(readOnlyOnAnnouncement(identity.label || currentContext));
              },
            },
        ...compareActions,
        ...settingsActions,
      ]
    : [...compareActions, ...settingsActions];

  // Keyboard shortcuts — layered (docs/ux/00-overview.md KEYMAP K1-K3).
  // A ConfirmModal / PodTable bulk dialog registers a modal layer and owns Esc,
  // `r`, ⌘K and ⌘N while it is open: Esc over a detail panel closes only the
  // dialog, and ⌘K / ⌘N can't stack a second overlay on top of it.
  const overlayOpen = switcherOpen || paletteOpen || creatorOpen || mergeFromFileOpen || helmInstallOpen;

  // ── Command-line launch args (v2.1.3). Pulled via startLaunchArgs (listener before first pull). ──
  const [launchNotice, setLaunchNotice] = useState<{ lines: string[]; held: LaunchArgs | null } | null>(null);
  const launchQueue = useRef<{ a: LaunchArgs; source: "startup" | "forwarded" } | null>(null);
  const launchReady = contextsLoaded && !!currentContext;
  const dialogOpen = () => isModalOpen() || overlayOpen;
  // N1: the strip mounts with its text, which screen readers may not announce; the persistent polite region does.
  const showLaunch = (lines: string[], held: LaunchArgs | null) => {
    setLaunchNotice({ lines, held });
    setAnnouncement(lines.join(" "));
  };
  const applyLaunch = async (a: LaunchArgs, source: "startup" | "forwarded") => {
    if (isEmptyLaunch(a)) return;
    const seq = ++launchSeq.current;
    // The context list and the active context resolve after mount: queue until both are known.
    if (!launchReady) { launchQueue.current = { a, source }; return; }
    const plan = planLaunchArgs(a, contexts.map((c) => c.name), currentContext, source, activeResource);
    // Forwarded only; nothing is open at startup. Context, namespace and kind are held together.
    if (source === "forwarded" && planChangesState(plan) && dialogOpen()) {
      showLaunch([deferredLine(plan), ...(plan.ignoredLine ? [plan.ignoredLine] : [])], a);
      return;
    }
    let ns = plan.namespace;
    let nsLine: string | null = null;
    if (ns) {
      const target = plan.context ?? currentContext;
      const known = await fetchNamespacesOrNull(qc, target);
      // The await is a race window: a newer request supersedes this one; a dialog may have opened.
      if (seq !== launchSeq.current) return;
      if (dialogOpen()) { showLaunch([deferredLine(plan), ...(plan.ignoredLine ? [plan.ignoredLine] : [])], a); return; }
      nsLine = namespaceLine(ns, known, target, plan.context ? "all" : namespace);
      if (nsLine) ns = null;
    }
    if (plan.context) { pendingLaunchNs.current = { ctx: plan.context, ns }; setActiveContext(plan.context); }
    else if (ns) setNamespace(ns);
    if (plan.kind) setActiveResource(plan.kind);
    const lines = launchLines(plan, nsLine);
    if (lines.length) showLaunch(lines, null);
    else setLaunchNotice(null);
  };
  const applyLaunchRef = useRef(applyLaunch);
  applyLaunchRef.current = applyLaunch;
  useEffect(() => startLaunchArgs((a, source) => applyLaunchRef.current(a, source)), []);
  useEffect(() => {
    if (!launchReady || !launchQueue.current) return;
    const q = launchQueue.current;
    launchQueue.current = null;
    applyLaunchRef.current(q.a, q.source);
  }, [launchReady]);
  // A held request is dropped when the user switches context themselves.
  useEffect(() => { setLaunchNotice((n) => (n?.held ? null : n)); }, [currentContext]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isModalOpen()) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        openCreator();
      }
      // ⌘, / Ctrl+, opens Settings. Palette and switcher are not modal layers, so the
      // overlay check is needed too or Settings would open underneath them (UXP-23).
      if ((e.metaKey || e.ctrlKey) && e.key === "," && !overlayOpen) {
        e.preventDefault();
        setMainView("settings");
      }
      if (e.key === "Escape") {
        // Esc inside the shell terminal belongs to the terminal (vim, readline…).
        if (isInTerminal(e.target)) return;
        if (overlayOpen) {
          // Overlays only — the panel behind them stays put.
          setSwitcherOpen(false);
          setPaletteOpen(false);
          setCreatorOpen(false);
          setMergeFromFileOpen(false);
          setHelmInstallOpen(false);
        } else {
          // Esc in a text field belongs to that field (clear it, or blur it) — it
          // must not close the detail panel behind it. Overlays above are exempt:
          // the switcher/palette close from their own inputs.
          if (isEditableTarget(e.target)) return;
          setSelectedPod(null);
          setSelectedResource(null);
        }
      }
      // Single-letter shortcuts ignore anything the user types into (input,
      // textarea, select, contenteditable) and the terminal's hidden textarea.
      if (
        e.key === "r" && !e.metaKey && !e.ctrlKey &&
        !isEditableTarget(document.activeElement) && !isEditableTarget(e.target)
      ) {
        handleRefresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRefresh, openCreator, overlayOpen]);

  const isPodView = activeResource === "pods";
  const panelResource = useMemo<SelectedResource | null>(() => {
    if (selectedResource?.kind === "ns") {
      const live = nsRows?.find((r) => r.name === selectedResource.item.name);
      return live ? { kind: "ns", item: live } : selectedResource;
    }
    if (selectedResource?.kind === "argocd") {
      const { name, namespace } = selectedResource.item;
      const live = argoApps?.find((r) => r.name === name && r.namespace === namespace);
      return live ? { kind: "argocd", item: live, ns: selectedResource.ns } : selectedResource;
    }
    return selectedResource;
  }, [selectedResource, nsRows, argoApps]);

  return (
    <div className="w-full h-full overflow-hidden grain bg-base flex flex-col">
      <DisabledReasonHost />
      <ObservabilityDialogHost />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          active={mainView !== "resources" ? ("" as ResourceType) : activeResource}
          healthActive={mainView === "health" ? healthPage : null}
          onOpenHealth={openHealth}
          setActive={setActiveResource}
          onOpenSettings={() => setMainView("settings")}
          onOpenUpdates={openUpdates}
          settingsActive={mainView === "settings"}
          onOpenJournal={openJournal}
          onOpenWhoCan={openWhoCan}
          whoCanActive={mainView === "whocan"}
          journalActive={mainView === "journal"}
          currentContext={currentContext}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          crdTarget={crdTarget}
          onSelectCrdInstance={(crd) => { setCrdTarget(crd); setActiveResource("crd-instances"); }}
        />

        <main tabIndex={-1} className="flex-1 min-w-0 flex flex-col">
          <TopBar
            ns={namespace}
            setNs={setNamespace}
            activeResource={activeResource}
            mainView={mainView}
            healthPage={healthPage}
            crdNamespaced={crdTarget?.scope === "Namespaced"}
            savedSearchKey={savedSearchKey(activeResource, crdTarget?.name)}
            savedSearchLabel={activeResource === "crd-instances" ? crdTarget?.name : undefined}
            currentContext={currentContext}
            isFetching={isFetching}
            onOpenSwitcher={() => setSwitcherOpen(true)}
            onRefresh={handleRefresh}
            lastUpdated={lastUpdated}
            search={search}
            onSearch={setSearch}
            onCreateResource={mainView === "resources" ? openCreator : undefined}
            onMergeFromFile={mainView === "resources" ? () => { if (!identity.readOnly) setMergeFromFileOpen(true); } : undefined}
            onManageNamespaces={() => setActiveResource("ns")}
            blockedRing={blockedRing}
          />

          {!accessBannerDismissed && ((clusterAccess && clusterAccess.state !== "ok") || clusterAccessError) && (
            <ClusterAccessBanner
              access={clusterAccess}
              contextName={currentContext}
              proxy={contexts.find((c) => c.name === currentContext)?.proxy}
              queryError={clusterAccessError}
              onDismiss={() => setAccessBannerDismissed(true)}
            />
          )}

          {seedNotice && <UpgradeSeedBanner onDismiss={() => { dismissUpgradeNotice(); setSeedNotice(false); }} onOpenSwitcher={() => setSwitcherOpen(true)} />}

          {launchNotice && (
            <LaunchNoticeStrip
              lines={launchNotice.lines}
              held={!!launchNotice.held}
              blocked={dialogOpen}
              onGo={() => { const h = launchNotice.held; setLaunchNotice(null); if (h) applyLaunch(h, "forwarded"); }}
              onDismiss={() => setLaunchNotice(null)}
            />
          )}

          {mainView === "settings" && (
            <SettingsView section={settingsSection} onSectionChange={setSettingsSection} onOpenSwitcher={() => setSwitcherOpen(true)} focusUpdates={focusUpdates} />
          )}
          {mainView === "journal" && <JournalPage search={search} onClearSearch={() => setSearch("")} />}
          {/* Hidden mount: the form and the last result survive leaving; the query runs only while visible. */}
          <WhoCanPage context={currentContext} visible={mainView === "whocan"} search={search} onOpen={openObject} />
          {/* Hidden mount (Q3): filters and expansion survive leaving; the query runs only while visible. */}
          <ProblemsPage
            context={currentContext}
            namespace={namespace}
            visible={mainView === "health" && healthPage === "problems"}
            search={search}
            onOpenObject={jumpFromHealth}
          />
          <UnusedPage
            context={currentContext}
            namespace={namespace}
            visible={mainView === "health" && healthPage === "unused"}
            search={search}
            onOpenObject={jumpFromHealth}
          />
          <DeprecatedApisPage
            context={currentContext}
            namespace={namespace}
            visible={mainView === "health" && healthPage === "deprecations"}
            search={search}
            onOpenObject={jumpFromHealth}
          />
          <MapPage
            context={currentContext}
            namespace={namespace}
            namespaces={namespaces}
            visible={mainView === "health" && healthPage === "map"}
            search={search}
            focus={mapFocus && mapFocus.ns === namespace && mapFocus.ctx === currentContext ? mapFocus : null}
            onFocusChange={(f) => setMapFocus(f && { ...f, ns: namespace, ctx: currentContext })}
            onOpenObject={jumpFromHealth}
            onPickNamespace={setNamespace}
            mode={mapMode}
            onModeChange={setMapMode}
            netpolPod={netpolPod && netpolPod.ns === namespace && netpolPod.ctx === currentContext ? netpolPod.name : null}
            netpolEnter={!!netpolPod?.enter && netpolPod.ns === namespace && netpolPod.ctx === currentContext}
            // The one-shot "focus lands on the node" request is consumed by the page that honoured it.
            onEntered={(which) => (which === "map"
              ? setMapFocus((f) => (f && f.enter ? { ...f, enter: false } : f))
              : setNetpolPod((p) => (p && p.enter ? { ...p, enter: false } : p)))}
          />
          <NodeCapacityPage
            context={currentContext}
            visible={mainView === "health" && healthPage === "capacity"}
            search={search}
            onOpenNode={(name) => jumpFromHealth("nodes", "", name)}
          />
          <div className={`flex flex-1 min-h-0 ${mainView !== "resources" ? "hidden" : ""}`}>
            <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-hidden">
              {isPodView && (
                <>
                  <ClusterOverview clusterInfo={clusterInfo} onOpenProblems={() => openHealth("problems")} />
                  <NodeStrip nodes={nodes} capacity={nodeCapacity} context={currentContext} target={stablePromTarget} onViewAll={() => setActiveResource("nodes")} cpuHistory={nodeCpuHistory} memHistory={nodeMemHistory} />
                  <PodTable
                    pods={pods}
                    selected={selectedPod}
                    setSelected={setSelectedPod}
                    isLoading={podsLoading && pods.length === 0}
                    error={podsError}
                    ns={namespace}
                    onRetry={() => qc.invalidateQueries({ queryKey: ["pods", currentContext, namespace] })}
                    context={currentContext}
                    search={search}
                    cpuHistory={podCpuHistory}
                    memHistory={podMemHistory}
                  />
                </>
              )}

              {activeResource === "deploy" && (
                <DeploymentView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "deploy" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "deploy", item, ns: item.namespace })} />
              )}
              {activeResource === "sts" && (
                <StatefulSetView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "sts" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "sts", item, ns: item.namespace })} />
              )}
              {activeResource === "ds" && (
                <DaemonSetView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "ds" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "ds", item, ns: item.namespace })} />
              )}
              {activeResource === "jobs" && (
                <JobView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "jobs" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "jobs", item, ns: item.namespace })} />
              )}
              {activeResource === "cron" && (
                <CronJobView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "cron" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "cron", item, ns: item.namespace })} />
              )}
              {activeResource === "hpa" && (
                <HPAView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "hpa" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "hpa", item, ns: item.namespace })} />
              )}
              {activeResource === "svc" && (
                <ServiceView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "svc" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "svc", item, ns: item.namespace })} />
              )}
              {activeResource === "ing" && (
                <IngressView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "ing" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "ing", item, ns: item.namespace })} />
              )}
              {activeResource === "cm" && (
                <ConfigMapView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "cm" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "cm", item, ns: item.namespace })} />
              )}
              {activeResource === "sec" && (
                <SecretView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "sec" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "sec", item, ns: item.namespace })} />
              )}
              {activeResource === "pvc" && (
                <PVCView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "pvc" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "pvc", item, ns: item.namespace })} />
              )}
              {activeResource === "pv" && (
                <PVView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "pv" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "pv", item })} />
              )}
              {activeResource === "sc" && (
                <StorageClassView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "sc" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "sc", item })} />
              )}
              {activeResource === "cert" && (
                <CertificateView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "cert" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "cert", item, ns: item.namespace })} />
              )}
              {activeResource === "nodes" && (
                <NodeView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "nodes" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "nodes", item })} />
              )}
              {activeResource === "events" && <EventView context={currentContext} namespace={namespace} />}
              {activeResource === "ns" && (
                <NamespacesView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "ns" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "ns", item })}
                  onRequestDelete={setNsToDelete} />
              )}
              {activeResource === "crd" && (
                <CRDView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "crd" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "crd", item })} />
              )}
              {activeResource === "netpol" && (
                <NetworkPolicyView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "netpol" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "netpol", item, ns: item.namespace })} />
              )}
              {activeResource === "sa" && (
                <ServiceAccountView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "sa" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "sa", item, ns: item.namespace })} />
              )}
              {activeResource === "roles" && (
                <RoleView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "roles" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "roles", item, ns: item.namespace })} />
              )}
              {activeResource === "croles" && (
                <ClusterRoleView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "croles" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "croles", item })} />
              )}
              {activeResource === "rbindings" && (
                <RoleBindingView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "rbindings" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "rbindings", item, ns: item.namespace })} />
              )}
              {activeResource === "crbindings" && (
                <ClusterRoleBindingView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "crbindings" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "crbindings", item })} />
              )}
              {activeResource === "helm" && (
                <HelmView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "helm" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "helm", item, ns: item.namespace })} />
              )}
              {activeResource === "pdb" && (
                <PDBView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "pdb" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "pdb", item, ns: item.namespace })} />
              )}
              {activeResource === "argocd" && (
                <ArgoCDView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "argocd" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "argocd", item, ns: item.namespace })} />
              )}
              {activeResource === "argo-appsets" && (
                <ArgoCdAppSetView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "argo-appsets" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "argo-appsets", item, ns: item.namespace })} />
              )}
              {activeResource === "argo-projects" && (
                <ArgoCdProjectView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "argo-projects" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "argo-projects", item, ns: item.namespace })} />
              )}
              {activeResource === "argo-repos" && (
                <ArgoCdRepositoryView context={currentContext} search={search} />
              )}
              {activeResource === "flux-ks" && (
                <FluxKustomizationView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "flux-ks" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "flux-ks", item, ns: item.namespace })} />
              )}
              {activeResource === "flux-hr" && (
                <FluxHelmReleaseView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "flux-hr" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "flux-hr", item, ns: item.namespace })} />
              )}
              {activeResource === "gw" && (
                <GatewayView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "gw" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "gw", item, ns: item.namespace })} />
              )}
              {activeResource === "httproute" && (
                <HttpRouteView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "httproute" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "httproute", item, ns: item.namespace })} />
              )}
              {activeResource === "rq" && (
                <ResourceQuotaView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "rq" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "rq", item, ns: item.namespace })} />
              )}
              {activeResource === "lr" && (
                <LimitRangeView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "lr" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "lr", item, ns: item.namespace })} />
              )}
              {activeResource === "pc" && (
                <PriorityClassView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "pc" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "pc", item })} />
              )}
              {activeResource === "ep" && (
                <EndpointsView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "ep" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "ep", item, ns: item.namespace })} />
              )}
              {activeResource === "eps" && (
                <EndpointSliceView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "eps" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "eps", item, ns: item.namespace })} />
              )}
              {activeResource === "rs" && (
                <ReplicaSetView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "rs" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "rs", item, ns: item.namespace })} />
              )}
              {activeResource === "mwc" && (
                <MutatingWebhookView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "mwc" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "mwc", item })} />
              )}
              {activeResource === "vwc" && (
                <ValidatingWebhookView context={currentContext} search={search}
                  selectedKey={selectedResource?.kind === "vwc" ? selectedResource.item.name : null}
                  onSelect={(item) => setSelectedResource({ kind: "vwc", item })} />
              )}
              {activeResource === "vs" && (
                <VolumeSnapshotView context={currentContext} namespace={namespace} search={search}
                  selectedKey={selectedResource?.kind === "vs" ? `${selectedResource.item.namespace}/${selectedResource.item.name}` : null}
                  onSelect={(item) => setSelectedResource({ kind: "vs", item, ns: item.namespace })} />
              )}
              {activeResource === "crd-instances" && (
                crdTarget ? (
                  <CRDInstanceView context={currentContext} crd={crdTarget} namespace={namespace} search={search} />
                ) : (
                  // Reachable after a context switch clears crdTarget while
                  // activeResource stays "crd-instances" (that effect doesn't
                  // touch activeResource) — without this branch the content
                  // area renders nothing with no way out but the sidebar.
                  <div className="py-16 flex flex-col items-center gap-3">
                    <Boxes size={32} className="text-dim" />
                    <p className="text-[13px] text-mute">Select a custom resource from the sidebar</p>
                  </div>
                )
              )}
            </div>

            {selectedPod && isPodView && (
              <DetailPanel
                pod={selectedPod}
                context={currentContext}
                podsList={pods}
                containerCpuHistory={containerCpuHistory}
                containerMemHistory={containerMemHistory}
                onOpenProblems={() => openHealth("problems")}
                problemsVisible={mainView === "resources"}
                onOpenMap={openNetpol}
                onClose={() => setSelectedPod(null)}
                onNavigate={(kind, ns, name) => {
                  navigateSearchRef.current = name;
                  setActiveResource(kind);
                  if (ns) setNamespace(ns);
                  setSelectedPod(null);
                }}
              />
            )}
            {panelResource && !isPodView && (
              <ResourceDetailPanel
                resource={panelResource}
                compareNonce={compareNonce}
                onOpenProblems={() => openHealth("problems")}
                problemsVisible={mainView === "resources"}
                onOpenMap={openMap}
                onRequestNamespaceDelete={setNsToDelete}
                context={currentContext}
                onClose={() => setSelectedResource(null)}
                onNavigate={(kind, ns, name) => {
                  navigateSearchRef.current = name;
                  setActiveResource(kind);
                  if (ns) setNamespace(ns);
                  setSelectedResource(null);
                }}
              />
            )}
          </div>
        </main>
      </div>

      <PortForwardBar />
      <ContextSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        contexts={contexts}
        currentContext={currentContext}
        onSwitch={(name) => {
          setActiveContext(name);
          setSwitcherOpen(false);
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <TurnOffReadOnlyConfirm context={currentContext} open={readOnlyConfirm} onClose={() => setReadOnlyConfirm(false)} />
      {/* Beside the other confirms, outside the TopBar <header> (a ConfirmModal has no portal and the header starts a window drag). */}
      <DeleteNamespaceConfirm
        context={currentContext}
        name={nsToDelete}
        onClose={() => setNsToDelete(null)}
        onDeleted={(n) => { if (n === namespace) setNamespace("all"); }}
      />
      <CommandPalette
        actions={paletteActions}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        context={currentContext}
        onSelect={(resource) => {
          setActiveResource(resource);
          setPaletteOpen(false);
        }}
        onNavigate={(kind, ns, name) => {
          navigateSearchRef.current = name;
          setActiveResource(kind);
          if (ns) setNamespace(ns);
          setPaletteOpen(false);
        }}
      />
      <ResourceCreator
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        context={currentContext}
        resourceType={activeResource}
        namespace={namespace}
      />
      <MergeFromFileModal
        open={mergeFromFileOpen}
        onClose={() => setMergeFromFileOpen(false)}
        context={currentContext}
      />
      <HelmInstallModal
        open={helmInstallOpen}
        onClose={() => setHelmInstallOpen(false)}
        context={currentContext}
        namespace={namespace}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
