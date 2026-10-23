import { describe, expect, it } from "vitest";
import { retentionLine } from "./diagnostics";

describe("retentionLine", () => {
  it("is built from the supplied numbers", () => {
    expect(retentionLine({ max_files: 5, max_file_bytes: 5_242_880 })).toBe("Keeps up to 5 files of 5 MiB each. Older files are deleted.");
    expect(retentionLine({ max_files: 3, max_file_bytes: 1_572_864 })).toBe("Keeps up to 3 files of 1.5 MiB each. Older files are deleted.");
  });
});
