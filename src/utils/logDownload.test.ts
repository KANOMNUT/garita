import { describe, expect, it } from "vitest";
import { downloadMenuItems, downloadText, multiFilename, singleFilename } from "./logDownload";

describe("downloadText", () => {
  it("writes the raw lines, joined by newlines", () => {
    expect(downloadText([{ raw: "a" }, { raw: "b" }])).toBe("a\nb");
  });
  it("prefixes the full pod name in multi-pod mode", () => {
    expect(downloadText([{ raw: "2026-10-03T14:02:11Z hi", pod: "api-7d9f8c-xk2lp" }])).toBe(
      "api-7d9f8c-xk2lp 2026-10-03T14:02:11Z hi",
    );
  });
});

describe("filenames", () => {
  it("single viewer", () => {
    expect(singleFilename("api-1", "app", false, false)).toBe("api-1-app.log");
    expect(singleFilename("api-1", "app", true, false)).toBe("api-1-app-previous.log");
    expect(singleFilename("api-1", "app", false, true)).toBe("api-1-app-filtered.log");
    expect(singleFilename("api-1", "app", true, true)).toBe("api-1-app-previous-filtered.log");
  });
  it("multi viewer", () => {
    expect(multiFilename("shop", "app", 12, false)).toBe("shop-app-12pods.log");
    expect(multiFilename("shop", "app", 12, true)).toBe("shop-app-12pods-filtered.log");
  });
});

describe("downloadMenuItems", () => {
  it("is a single button (null) with no filter active", () => {
    expect(downloadMenuItems(5000, 5000, false)).toBeNull();
  });
  it("is a two-item menu with real counts once a filter is active", () => {
    expect(downloadMenuItems(5000, 37, true)).toEqual([
      { id: "all", label: "All loaded lines (5,000)" },
      { id: "visible", label: "Visible lines (37)" },
    ]);
  });
});
