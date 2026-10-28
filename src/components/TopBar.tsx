import { useRef, useState, useEffect, memo, useCallback } from "react";
import { Search, ChevronDown, ChevronsUpDown, Plus, RotateCw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ResourceType } from "../types/k8s";
import { useClusterIdentity, CLUSTER_COLOR_CLASSES } from "../utils/clusterIdentity";
import { disabledAttrs, pickDisabledReason, readOnlyBadgePopover } from "../utils/guardrails";
import { viewHidesNamespacePicker } from "../utils/scope";
import { RESOURCE_LABELS } from "../utils/kindToResourceType";
import { HEALTH_PAGES, type HealthPage, type MainView } from "../utils/resourceQueryKey";
import { Popover } from "./Popover";
import { NamespacePicker } from "./NamespacePicker";
import { SavedSearchMenu } from "./SavedSearchMenu";
import { ReadOnlyChip, TurnOffReadOnlyConfirm } from "./ReadOnlyBadge";

interface TopBarProps {
  ns: string;
  setNs: (ns: string) => void;
  activeResource: ResourceType;
  /** Non-resource views (A-6): Health pages and Settings hide New; Health also renames the breadcrumb and search. */
  mainView?: MainView;
  healthPage?: HealthPage;
  crdNamespaced?: boolean;
  /** #40: ResourceType, or `crd-instances:<crd name>`; null/absent = no saved-search button. */
  savedSearchKey?: string | null;
  /** Menu title noun when the key is a CRD ("widgets.acme.io"); defaults to the resource label. */
  savedSearchLabel?: string;
  currentContext: string;
  isFetching: boolean;
  onOpenSwitcher: () => void;
  onRefresh: () => void;
  lastUpdated: string;
  search: string;
  onSearch: (s: string) => void;
  onCreateResource?: () => void;
  onMergeFromFile?: () => void;
  /** The picker's "Manage namespaces" footer link: opens the Namespaces page. Absent: no link. */
  onManageNamespaces?: () => void;
  /** Bumped by App when ⌘N is pressed while read-only: the badge shows a static 2 s ring (no motion). */
  blockedRing?: number;
}

const Kbd = memo(function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-tint/6 text-mute ring-1 ring-edge">
      {children}
    </kbd>
  );
});

export const TopBar = memo(function TopBar({
  ns, setNs, activeResource, mainView = "resources", healthPage = "problems", crdNamespaced, savedSearchKey, savedSearchLabel, currentContext,
  isFetching, onOpenSwitcher, onRefresh, lastUpdated, search, onSearch, onCreateResource, onMergeFromFile, onManageNamespaces, blockedRing = 0,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const identity = useClusterIdentity(currentContext);
  const [roPopover, setRoPopover] = useState(false);
  const [roConfirm, setRoConfirm] = useState(false);
  const [ringOn, setRingOn] = useState(false);
  const roBadgeRef = useRef<HTMLButtonElement>(null);
  const newReason = pickDisabledReason({ readOnly: identity.readOnly });
  useEffect(() => {
    if (!blockedRing) return;
    setRingOn(true);
    const t = window.setTimeout(() => setRingOn(false), 2000);
    return () => window.clearTimeout(t);
  }, [blockedRing]);
  const health = mainView === "health" ? HEALTH_PAGES[healthPage] : null;
  // Journal and Who can are app views, not ResourceTypes: the last resource must not decide the picker (P8).
  const appView = mainView === "journal" ? "journal" : mainView === "whocan" ? "who can" : null;
  const clusterScoped = health ? !health.nsPicker : appView ? true : viewHidesNamespacePicker(activeResource, crdNamespaced);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value),
    [onSearch],
  );

  useEffect(() => {
    if (!newOpen) return;
    const handler = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) {
        setNewOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [newOpen]);

  return (
    <>
    <header
      className="h-[80px] shrink-0 flex items-end pb-4 gap-2 pl-4 pr-3 border-b border-edge bg-panel/60"
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
      {/* cluster identity rule — prod-accident guard, matches the Sidebar chip / ContextSwitcher swatch */}
      {currentContext && (
        <span className={`w-1 self-stretch rounded-full shrink-0 ${CLUSTER_COLOR_CLASSES[identity.color].dot}`} />
      )}

      {/* breadcrumbs */}
      <div className="flex items-center gap-2 text-[12.5px]">
        <button
          onClick={onOpenSwitcher}
          className="group flex items-center gap-1.5 px-1.5 py-1 -ml-1.5 rounded-sm hover:bg-surface-tint/4"
        >
          <span className="h-2 w-2 rounded-full bg-ok ring-[3px] ring-ok/18" />
          <span className="font-medium">{currentContext || "No context"}</span>
          <ChevronsUpDown size={12} className="text-dim" />
        </button>
        {identity.readOnly && currentContext && (
          <div className="relative">
            <button
              ref={roBadgeRef}
              type="button"
              onClick={() => setRoPopover((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={roPopover}
              className={`rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 ${ringOn ? "ring-2 ring-accent/60" : ""}`}
            >
              <ReadOnlyChip />
            </button>
            <Popover
              open={roPopover}
              onClose={() => setRoPopover(false)}
              triggerRef={roBadgeRef}
              label="Read-only mode"
              className="left-0 top-8 w-72 p-3 flex flex-col gap-2.5"
            >
              <p className="text-[12px] text-mute">{readOnlyBadgePopover(identity.label || currentContext)}</p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setRoPopover(false)}
                  className="px-2.5 py-1 rounded-md text-[11.5px] text-mute ring-1 ring-edge hover:text-ink"
                >
                  Keep on
                </button>
                <button
                  type="button"
                  onClick={() => { setRoPopover(false); setRoConfirm(true); }}
                  className="px-2.5 py-1 rounded-md text-[11.5px] text-accent ring-1 ring-accent/30 hover:bg-accent/10"
                >
                  Turn off…
                </button>
              </div>
            </Popover>
          </div>
        )}
        {!clusterScoped && (
          <>
            <span className="text-dim">/</span>
            <NamespacePicker context={currentContext} ns={ns} setNs={setNs} onManage={onManageNamespaces} />
          </>
        )}
        <span className="text-dim">/</span>
        <span className="mono text-[12px] text-ink">{health ? health.breadcrumb : appView ?? RESOURCE_LABELS[activeResource]}</span>
      </div>

      <div className="flex-1" />

      <button
        onClick={onRefresh}
        disabled={isFetching}
        aria-label="Refresh"
        aria-busy={isFetching}
        title={lastUpdated ? `Refresh · ${lastUpdated} · (r)` : "Refresh · (r)"}
        className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 text-dim hover:text-ink hover:bg-surface-tint/6 transition-colors duration-150 focus:outline-hidden focus:ring-1 focus:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
      >
        <RotateCw size={14} className={isFetching ? "animate-spin" : ""} />
      </button>

      {/* search */}
      <div className="relative">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim">
          <Search size={13} />
        </div>
        <input
          ref={searchRef}
          value={search}
          onChange={handleSearchChange}
          placeholder={health ? health.placeholder : mainView === "journal" ? "Filter journal…" : mainView === "whocan" ? "Filter subjects…" : "Search resources, names, labels…"}
          title={mainView === "journal" ? "Filters the entries loaded so far" : undefined}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          className="bg-card/80 ring-1 ring-edge focus:ring-accent/40 focus:outline-hidden rounded-md pl-8 pr-16 h-8 w-[340px] text-[12.5px] placeholder:text-dim mono"
        />
        {search ? (
          <button
            onClick={() => onSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink mono text-[10.5px] px-1"
          >
            ✕
          </button>
        ) : (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
        )}
      </div>

      {/* Resource lists only: Health pages, Journal, Who can and Settings save nothing (B-16). */}
      {mainView === "resources" && savedSearchKey && (
        <SavedSearchMenu
          viewKey={savedSearchKey}
          label={savedSearchLabel ?? RESOURCE_LABELS[activeResource].replace(/^./, (c) => c.toUpperCase())}
          search={search}
          onPick={onSearch}
        />
      )}

      {(onCreateResource || onMergeFromFile) && (
        <div ref={newRef} className="relative shrink-0">
          <button
            onClick={() => { if (newReason) return; setNewOpen((v) => !v); }}
            {...(newReason ? disabledAttrs(newReason) : { title: "Create (⌘N)" })}
            className={`h-8 px-3 rounded-md bg-accent/12 hover:bg-accent/20 text-accent ring-1 ring-accent/30 text-[12.5px] font-medium flex items-center gap-1.5 transition-colors ${newReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Plus size={13} />
            New
            <ChevronDown size={11} className={`transition-transform ${newOpen ? "rotate-180" : ""}`} />
          </button>
          {newOpen && (
            <div className="absolute right-0 top-9 z-20 w-56 rounded-lg bg-panel border border-edge shadow-xl py-1">
              {onCreateResource && (
                <button
                  onClick={() => { setNewOpen(false); onCreateResource(); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-ink hover:bg-surface-tint/6 flex items-center justify-between gap-2"
                >
                  <span>{activeResource === "helm" ? "Install release…" : activeResource === "ns" ? "New namespace…" : "New resource…"}</span>
                  <span className="mono text-[10px] text-dim">⌘N</span>
                </button>
              )}
              {onMergeFromFile && (
                <button
                  onClick={() => { setNewOpen(false); onMergeFromFile(); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-ink hover:bg-surface-tint/6"
                >
                  Merge from file…
                </button>
              )}
            </div>
          )}
        </div>
      )}

    </header>
    {/* Outside the header: its mousedown handler starts a window drag. */}
    <TurnOffReadOnlyConfirm context={currentContext} open={roConfirm} onClose={() => setRoConfirm(false)} />
    </>
  );
});
