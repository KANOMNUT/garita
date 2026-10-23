import { AlertTriangle, Info } from "lucide-react";
import type { Container } from "../types/k8s";
import { collectingText, hintText, HINT_TAIL, P95_TAIL, SAMPLES_TOOLTIP, sizingHints, withSessionFallback, type P95Result, type SizingHint as Hint } from "../utils/rightSizing";

interface Props {
  container: Container;
  /** This container's usage ring (ns/pod/container); undefined when metrics never answered for it. */
  cpu: number[] | undefined;
  mem: number[] | undefined;
  /** Presence `metrics` is absent: say so instead of waiting for samples that will never come. */
  metricsAbsent: boolean;
  /** Hints from the 24 h percentile (p95Hints). null/undefined = none usable: the session path runs. */
  p95?: P95Result | null;
}

const quiet = "text-[11px] text-dim";

/** HINT-ROW (#13): advisory only, always labelled "Hint", never a suggested value. Not for init containers. */
export function SizingHint({ container, cpu, mem, metricsAbsent, p95 }: Props) {
  let r: { state: "ready"; hints: Hint[] } | null = null;
  if (p95) {
    r = { state: "ready", hints: withSessionFallback(p95, container, cpu, mem) };
  }
  if (!r && metricsAbsent) return <p className={`${quiet} mt-2`}>Hints need metrics-server, which isn't installed on this cluster.</p>;
  const res = r ?? sizingHints(container, cpu, mem);
  if (res.state === "unavailable") return <p className={`${quiet} mt-2`}>Current usage isn't available right now.</p>;
  if (res.state === "collecting") return <p className={`${quiet} mt-2`} title={SAMPLES_TOOLTIP}>{collectingText(res.samples)}</p>;
  return (
    <>
      {res.hints.map((h) => (
        <div
          key={`${h.resource}-${h.kind}`}
          title={h.p95 ? undefined : SAMPLES_TOOLTIP}
          className="mt-2 flex items-start gap-2 rounded-md bg-surface-tint/3 ring-1 ring-edge px-2.5 py-1.5 text-[11.5px] text-mute"
        >
          {h.kind === "undersized" ? <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> : <Info size={12} className="mt-0.5 shrink-0" aria-hidden />}
          <p><span className="font-semibold text-ink">Hint</span> {hintText(h)} {h.p95 ? P95_TAIL : HINT_TAIL}</p>
        </div>
      ))}
    </>
  );
}
