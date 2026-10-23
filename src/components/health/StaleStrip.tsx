/** HH:MM:SS for a React Query `dataUpdatedAt`, shared by the Health pages. */
export const clock = (ms: number): string => new Date(ms).toLocaleTimeString();

/** A refetch failed but earlier results stay on screen: say so, with when they are from. */
export function StaleStrip({ at }: { at: number }) {
  return (
    <p className="rounded-lg bg-warn/10 ring-1 ring-warn/30 text-warn text-[11.5px] px-3 py-2">
      Couldn't refresh. Showing results from {clock(at)}.
    </p>
  );
}
