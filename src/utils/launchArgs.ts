import type { LaunchArgs, ResourceType } from "../types/k8s";
import { RESOURCE_LABELS } from "./kindToResourceType";
import { viewHidesNamespacePicker } from "./scope";

/** What to apply, in order context -> namespace -> kind, plus the strip lines known without I/O. */
export interface LaunchPlan {
  context: string | null;
  namespace: string | null;
  kind: ResourceType | null;
  /** Context lines (switched / not found). The ignored line is separate so the namespace line can sit between. */
  lines: string[];
  ignoredLine: string | null;
}

const NAME_CAP = 64; // K9: Rust does not cap context/namespace; display only.
const capName = (s: string) => (s.length > NAME_CAP ? `${s.slice(0, NAME_CAP)}...` : s);

// All user-facing copy (docs/ux/13-v2.1.3-preflight.md copy table).
export const launchMsg = {
  switched: (x: string) => `Switched to '${capName(x)}' (from the command line).`,
  contextNotFound: (x: string, current: string) => `Context '${capName(x)}' not found; staying on '${capName(current)}'.`,
  namespaceNotFound: (x: string, ctx: string, current: string) =>
    `Namespace '${capName(x)}' not found in '${capName(ctx)}'; staying on ${current === "all" ? "All namespaces" : `'${capName(current)}'`}.`,
  deferred: (parts: string[]) => `The command line asked for ${parts.join(", ")}. Close the open dialog first.`,
  ignored: (tokens: string[]) => {
    const shown = tokens.slice(0, 3).map(capName).join(", ");
    return tokens.length > 3 ? `Ignored: ${shown} and ${tokens.length - 3} more.` : `Ignored: ${shown}.`;
  },
  goNow: "Go now",
  goNowReason: "Close the open dialog first.",
};

/** `LaunchArgs::default()`: nothing to apply. */
export const isEmptyLaunch = (a: LaunchArgs): boolean => !a.context && !a.namespace && !a.kind && a.ignored.length === 0;

/**
 * Plan for CLI args. Context validity is the useActiveContext rule: name must be in list_contexts().
 * Namespace is dropped silently when the resulting view has no namespace picker (kubectl ignores -n there too).
 * A kind Rust sent but the frontend lacks goes into the Ignored line.
 */
export function planLaunchArgs(
  args: LaunchArgs,
  knownContexts: string[],
  currentContext: string,
  source: "startup" | "forwarded",
  currentView?: ResourceType,
): LaunchPlan {
  const lines: string[] = [];
  let context: string | null = null;
  if (args.context) {
    if (!knownContexts.includes(args.context)) lines.push(launchMsg.contextNotFound(args.context, currentContext));
    else if (args.context !== currentContext) {
      context = args.context;
      if (source === "forwarded") lines.push(launchMsg.switched(args.context));
    }
  }
  const kind = args.kind && Object.prototype.hasOwnProperty.call(RESOURCE_LABELS, args.kind) ? (args.kind as ResourceType) : null;
  const view = kind ?? currentView;
  const namespace = args.namespace && !(view && viewHidesNamespacePicker(view)) ? args.namespace : null;
  const ignored = args.kind && !kind ? [...args.ignored, args.kind] : args.ignored;
  return { context, namespace, kind, lines, ignoredLine: ignored.length ? launchMsg.ignored(ignored) : null };
}

/**
 * K10: fail open. `known` null (list errored / forbidden) or containing the name -> no line, apply as typed.
 * `current` is the namespace the app is on after the context step ("all" when none).
 */
export function namespaceLine(ns: string, known: string[] | null, ctx: string, current: string): string | null {
  return known && !known.includes(ns) ? launchMsg.namespaceNotFound(ns, ctx, current) : null;
}

/** Strip text in display order: context lines, namespace line, ignored line. */
export const launchLines = (p: LaunchPlan, nsLine: string | null): string[] =>
  [...p.lines, ...(nsLine ? [nsLine] : []), ...(p.ignoredLine ? [p.ignoredLine] : [])];

/** True when the plan changes app state (context, namespace or kind). */
export const planChangesState = (p: LaunchPlan): boolean => !!(p.context || p.namespace || p.kind);

/** Deferral line listing only the parts present: context, namespace, kind. */
export function deferredLine(p: LaunchPlan): string {
  const parts: string[] = [];
  if (p.context) parts.push(`context '${capName(p.context)}'`);
  if (p.namespace) parts.push(`namespace '${capName(p.namespace)}'`);
  if (p.kind) parts.push(RESOURCE_LABELS[p.kind].replace(/^./, (c) => c.toUpperCase()));
  return launchMsg.deferred(parts);
}
