import { describe, expect, it } from "vitest";
import { POD_STATUS_STYLE, podStatusStyle } from "./podStatus";

// Every string `pod_status` in src-tauri/src/commands/pods.rs can return.
const BACKEND_STATUSES = [
  "Terminating", "CrashLoopBackOff", "ImagePullBackOff", "Pending", "Running", "Succeeded", "Failed", "Unknown",
];

describe("podStatusStyle", () => {
  it("maps every status the backend emits to its own entry", () => {
    for (const s of BACKEND_STATUSES) {
      expect(POD_STATUS_STYLE[s], s).toBeDefined();
      expect(podStatusStyle(s)).toBe(POD_STATUS_STYLE[s]);
    }
  });

  it("never shows a failing status as green", () => {
    for (const s of ["CrashLoopBackOff", "ImagePullBackOff", "Failed", "Unknown", "Terminating"]) {
      expect(podStatusStyle(s).text, s).not.toBe("text-ok");
      expect(podStatusStyle(s).dot, s).not.toBe("bg-ok");
    }
    expect(podStatusStyle("Running").text).toBe("text-ok");
  });

  it("colours Failed like CrashLoopBackOff, steady", () => {
    expect(podStatusStyle("Failed")).toEqual({ ...podStatusStyle("CrashLoopBackOff"), pulse: false });
  });

  it("gives an unknown string the neutral style, not Running", () => {
    const neutral = podStatusStyle("SomethingNew");
    expect(neutral).toEqual({ dot: "bg-mute", text: "text-mute", bg: "bg-surface-tint/5", ring: "ring-edge", pulse: false });
    expect(neutral).not.toBe(POD_STATUS_STYLE.Running);
    expect(podStatusStyle("")).toEqual(neutral);
  });

  it("does not resolve inherited object keys to a style", () => {
    for (const s of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(podStatusStyle(s).text, s).toBe("text-mute");
    }
  });

  it("uses no dim colour as text (WCAG, X-2)", () => {
    for (const s of Object.values(POD_STATUS_STYLE)) {
      expect(s.text).not.toMatch(/dim/);
      expect(s.bg).not.toMatch(/dim/);
      expect(s.ring).not.toMatch(/dim/);
    }
  });

  it("only the transient statuses pulse", () => {
    const pulsing = Object.entries(POD_STATUS_STYLE).filter(([, v]) => v.pulse).map(([k]) => k).sort();
    expect(pulsing).toEqual(["CrashLoopBackOff", "ImagePullBackOff", "Pending", "Terminating"]);
  });
});
