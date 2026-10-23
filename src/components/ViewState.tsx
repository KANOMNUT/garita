import { PackageX, ShieldOff, Circle, AlertCircle } from "lucide-react";
import type { ViewStateResult } from "../utils/viewState";

interface Props {
  state: ViewStateResult;
  /** Plural display name, e.g. "Flux Kustomizations". */
  things: string;
  /** API group shown for not-installed, e.g. "kustomize.toolkit.fluxcd.io". */
  group?: string;
  /** Raw list error text, shown for the error state. */
  message?: string;
  /** Icon for nothing-here when the caller has a better one. */
  emptyIcon?: React.ReactNode;
  onRetry: () => void;
}

/** One renderer for the #15 states of CRD-backed views. Never icon-only: always copy. */
export function ViewState({ state, things, group, message, emptyIcon, onRetry }: Props) {
  let icon: React.ReactNode;
  let title: string;
  let body: string | undefined;
  let retry = false;
  switch (state.kind) {
    case "not-installed":
      icon = <PackageX size={32} />;
      title = `${things} aren't installed on this cluster.`;
      body = group ? `The ${group} API group isn't available.` : undefined;
      break;
    case "no-access":
      icon = <ShieldOff size={32} />;
      title = `You don't have access to ${things}.`;
      body = "Your account can't list this resource. Ask a cluster admin for the list permission.";
      break;
    case "error":
      icon = <AlertCircle size={32} className="text-bad" />;
      title = `Couldn't load ${things}.`;
      body = message;
      retry = true;
      break;
    default:
      icon = emptyIcon ?? <Circle size={32} />;
      title = `No ${things} found.`;
      body = state.unconfirmed ? `Couldn't confirm whether ${things} are installed.` : undefined;
  }
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-center">
      <div className="text-dim">{icon}</div>
      <p className="text-[13px] text-mute">{title}</p>
      {body && <p className="text-[11.5px] text-dim max-w-md whitespace-pre-wrap">{body}</p>}
      {retry && (
        <button onClick={onRetry} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">
          Retry
        </button>
      )}
    </div>
  );
}
