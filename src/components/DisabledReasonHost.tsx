import { useSyncExternalStore } from "react";
import { disabledReasonId, registeredDisabledReasons, subscribeDisabledReasons } from "../utils/guardrails";

/**
 * UXA-8: renders the sr-only text that `aria-describedby` on every disabled control points at
 * (see `disabledAttrs`). Mounted once in App; ids are global, so controls inside portalled
 * dialogs resolve too.
 */
export function DisabledReasonHost() {
  const reasons = useSyncExternalStore(subscribeDisabledReasons, registeredDisabledReasons, registeredDisabledReasons);
  return (
    <div className="sr-only">
      {reasons.map((r) => <span key={r} id={disabledReasonId(r)}>{r}</span>)}
    </div>
  );
}
