/** Narrowest node card that fits the usage bar, the percentage and the 48 px sparkline on one line. */
export const CARD_MIN_PX = 184;

/**
 * `grid-template-columns` for the Pods page node strip: six columns, as before, but an occupied column never
 * shrinks below CARD_MIN_PX, so a wide detail panel makes the strip scroll sideways instead of pushing the
 * sparklines and the REQ line into the next card. Empty columns (fewer than six nodes) still collapse to
 * nothing, so a small cluster never scrolls for cards it does not have.
 */
export function stripColumns(cards: number): string {
  const used = Math.max(0, Math.min(Math.floor(cards), 6));
  const empty = 6 - used;
  return [
    used ? `repeat(${used}, minmax(${CARD_MIN_PX}px, 1fr))` : "",
    empty ? `repeat(${empty}, minmax(0, 1fr))` : "",
  ].filter(Boolean).join(" ");
}
