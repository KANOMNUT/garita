import type { HelmRelease } from "../types/k8s";

interface Props {
  release: HelmRelease;
  context: string;
  onClose: () => void;
}

export function HelmDetailPanel({ release, context: _context, onClose }: Props) {
  return (
    <aside className="shrink-0 w-[480px] bg-panel/95 border-l border-edge flex flex-col">
      <div className="px-4 pt-3 pb-3 border-b border-edge flex items-center justify-between">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-dim mb-0.5">Helm Release</div>
          <h3 className="mono text-[14px]">{release.name}</h3>
        </div>
        <button
          onClick={onClose}
          className="h-7 w-7 rounded-md hover:bg-surface-tint/6 text-mute hover:text-ink flex items-center justify-center"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
          <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Details</div>
          <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60">
            <span className="text-[11px] text-dim w-[110px] shrink-0">Chart</span>
            <span className="mono text-[12px] text-ink truncate">{release.chart}</span>
          </div>
          <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60">
            <span className="text-[11px] text-dim w-[110px] shrink-0">App version</span>
            <span className="mono text-[12px] text-ink truncate">{release.app_version}</span>
          </div>
          <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60">
            <span className="text-[11px] text-dim w-[110px] shrink-0">Status</span>
            <span className="mono text-[12px] text-ink truncate">{release.status}</span>
          </div>
          <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60">
            <span className="text-[11px] text-dim w-[110px] shrink-0">Revision</span>
            <span className="mono text-[12px] text-ink truncate">{release.revision}</span>
          </div>
          <div className="flex items-baseline gap-3 py-1.5">
            <span className="text-[11px] text-dim w-[110px] shrink-0">Updated</span>
            <span className="mono text-[12px] text-ink truncate">{release.updated.split(".")[0]}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
