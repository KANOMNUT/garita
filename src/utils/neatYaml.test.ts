import { describe, it, expect } from "vitest";
import { neatNote, NEAT_HIDDEN_PATHS } from "./neatYaml";

describe("neatNote", () => {
  it("counts only the fields beyond managedFields and status", () => {
    const hidden = [
      "metadata.managedFields",
      "metadata.annotations.kubectl.kubernetes.io/last-applied-configuration",
      "status",
      "metadata.uid",
      "metadata.resourceVersion",
    ];
    expect(neatNote(hidden)).toBe("Hiding managedFields, status and 3 other fields. Display only; editing shows the full object.");
  });

  it("names exactly what was hidden when status is absent", () => {
    expect(neatNote(["metadata.managedFields", "metadata.uid"])).toBe(
      "Hiding managedFields and 1 other field. Display only; editing shows the full object.",
    );
  });

  it("managedFields and status only", () => {
    expect(neatNote(["metadata.managedFields", "status"])).toBe(
      "Hiding managedFields and status. Display only; editing shows the full object.",
    );
  });

  it("nothing hidden", () => {
    expect(neatNote([])).toContain("Nothing to hide");
  });

  it("the closed list is the contract's seven paths, in order", () => {
    expect(NEAT_HIDDEN_PATHS).toHaveLength(7);
    expect(NEAT_HIDDEN_PATHS[0]).toBe("metadata.managedFields");
    expect(NEAT_HIDDEN_PATHS[2]).toBe("status");
  });
});
