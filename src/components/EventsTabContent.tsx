import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { K8sEvent } from "../types/k8s";

/**
 * The Events tab body shared by the resource panel and the Pod panel: loading, a load error with Retry, the empty
 * state, a Warnings-only filter, and severity as a glyph plus a word (never colour alone).
 */
export function EventsTabContent({
  events, isLoading, error, onRetry, kind, scopedToKind, childEventsNote = true,
}: {
  events: K8sEvent[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Display Kind for the empty state ("No events for this Deployment."). */
  kind: string;
  /** False for Helm and Pod: events are matched on name (and namespace) only, so the "this Kind only" note would be untrue. */
  scopedToKind: boolean;
  /** False drops the sentence about pods and ReplicaSets (custom resources). */
  childEventsNote?: boolean;
}) {
  const [eventFilter, setEventFilter] = useState<"all" | "warning">("all");

  const displayed = eventFilter === "warning" ? events.filter(e => e.type_ === "Warning") : events;
  const warningCount = events.filter(e => e.type_ === "Warning").length;
  const hiddenNormal = events.length - warningCount;

  return (
    <div className="p-4 flex flex-col gap-1">
      {!isLoading && !error && events.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => setEventFilter("all")}
            aria-pressed={eventFilter === "all"}
            className={`px-2 py-0.5 rounded text-[10.5px] ring-1 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${
              eventFilter === "all" ? "bg-surface-tint/8 text-ink ring-edge-raw/60" : "text-mute ring-edge hover:text-ink"
            }`}
          >
            All
            <span className="ml-1 mono text-mute text-[10.5px]">{events.length}</span>
          </button>
          {warningCount > 0 && (
            <button
              type="button"
              onClick={() => setEventFilter(f => f === "warning" ? "all" : "warning")}
              aria-pressed={eventFilter === "warning"}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] ring-1 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${
                eventFilter === "warning" ? "bg-warn/20 text-warn ring-warn/40" : "bg-warn/10 text-warn ring-warn/30 hover:bg-warn/20 hover:text-warn"
              }`}
            >
              Warnings only
              <span className="mono px-1 py-px rounded-full bg-warn/20 text-warn text-[10.5px]">{warningCount}</span>
            </button>
          )}
        </div>
      )}
      {isLoading ? (
        <div role="status" aria-label="Loading events.">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2.5 py-2 border-b border-edge-raw/60">
              <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-surface-tint/4 animate-pulse shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-32" />
                <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="py-12 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] text-bad wrap-break-word max-w-full">
            Couldn&apos;t load events: {(error as any)?.message ?? String(error)}.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div role="status" className="py-12 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[13px] text-mute">No events for this {kind}.</p>
          <p className="text-[12px] text-mute">Kubernetes keeps events for about 1 hour, so older causes may not appear.</p>
        </div>
      ) : displayed.length === 0 ? (
        <div role="status" className="py-12 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 size={24} className="text-ok" />
          <p className="text-[13px] text-mute">No warning events.</p>
          <p className="text-[12px] text-mute">{hiddenNormal} normal {hiddenNormal === 1 ? "event is" : "events are"} hidden.</p>
          <button
            type="button"
            onClick={() => setEventFilter("all")}
            className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Show all
          </button>
        </div>
      ) : (
        <>
          {displayed.map((e, i) => (
            <div key={i} className={`flex gap-2.5 py-2 border-b border-edge-raw/60 last:border-b-0 rounded-sm px-1 ${e.type_ === "Warning" ? "bg-warn/3" : ""}`}>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${e.type_ === "Warning" ? "bg-warn" : "bg-mute/60"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Severity is glyph + word, never colour alone. */}
                  <span className={`text-[10.5px] uppercase tracking-wider shrink-0 ${e.type_ === "Warning" ? "text-warn" : "text-mute"}`}>
                    <span aria-hidden>{e.type_ === "Warning" ? "⚠ " : "● "}</span>
                    {e.type_ === "Warning" ? "Warning" : "Normal"}
                  </span>
                  <span className={`text-[11px] font-semibold ${e.type_ === "Warning" ? "text-warn" : "text-mute"}`}>
                    {e.reason}
                  </span>
                  <span className="mono text-[10.5px] text-mute">{e.source}</span>
                  {e.count > 1 && (
                    <span className="mono text-[10.5px] px-1.5 py-px rounded-full bg-surface-tint/5 text-mute shrink-0">
                      ×{e.count}
                    </span>
                  )}
                  <span className="ml-auto mono text-[10.5px] text-mute">{e.age}</span>
                </div>
                <div className="text-[11.5px] text-ink/85 mt-0.5">{e.message}</div>
              </div>
            </div>
          ))}
          <p className="mt-3 pt-2 border-t border-edge-raw/60 text-[11px] text-mute">
            {scopedToKind ? `Events about this ${kind} only. ${childEventsNote ? "Its pods and ReplicaSets have their own events. " : ""}` : ""}
            Kubernetes keeps events for about 1 hour.
          </p>
        </>
      )}
    </div>
  );
}
