import { describe, expect, it } from "vitest";
import { CARD_MIN_PX, stripColumns } from "./nodeStrip";

describe("stripColumns", () => {
  it("gives six cards a minimum width each", () => {
    expect(stripColumns(6)).toBe(`repeat(6, minmax(${CARD_MIN_PX}px, 1fr))`);
  });

  it("lets the columns of missing cards collapse, so three nodes keep their one-sixth width", () => {
    expect(stripColumns(3)).toBe(`repeat(3, minmax(${CARD_MIN_PX}px, 1fr)) repeat(3, minmax(0, 1fr))`);
  });

  it("caps at six columns, as the strip shows at most six nodes", () => {
    expect(stripColumns(21)).toBe(stripColumns(6));
  });

  it("keeps six collapsible columns for zero or invalid counts", () => {
    expect(stripColumns(0)).toBe("repeat(6, minmax(0, 1fr))");
    expect(stripColumns(-2)).toBe("repeat(6, minmax(0, 1fr))");
    expect(stripColumns(2.7)).toBe(`repeat(2, minmax(${CARD_MIN_PX}px, 1fr)) repeat(4, minmax(0, 1fr))`);
  });
});
