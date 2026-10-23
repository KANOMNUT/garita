import { describe, expect, it } from "vitest";
import {
  ariaStep, canCheck, checkDisabledReason, formatBytes, formatChecked, noticeLabel, parsePrefs, percent, reduce, updateMode,
  type UpdateEvent, type UpdateState,
} from "./updateState";

const run = (s: UpdateState, ...es: UpdateEvent[]) => es.reduce(reduce, s);
const idle: UpdateState = { s: "idle" };
const avail: UpdateState = { s: "available", version: "2.1.1", notes: "", checkedAt: 1 };

describe("updateMode", () => {
  it("dev is unavailable; macOS installs; Linux and Windows get the notice", () => {
    expect(updateMode("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true)).toBe("unavailable");
    expect(updateMode("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false)).toBe("notice");
    expect(updateMode("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", false)).toBe("app");
    expect(updateMode("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15", false)).toBe("notice");
  });
});

describe("reduce", () => {
  it("unavailable ignores every event", () => {
    expect(run({ s: "unavailable" }, { t: "check-start" })).toEqual({ s: "unavailable" });
  });
  it("check -> found -> download -> ready -> installing", () => {
    const s = run(idle, { t: "check-start" }, { t: "found", version: "2.1.1", notes: "n", at: 5 },
      { t: "download-start", version: "2.1.1" }, { t: "progress", chunk: 10, total: 100 }, { t: "progress", chunk: 15 });
    expect(s).toEqual({ s: "downloading", version: "2.1.1", received: 25, total: 100 });
    expect(run(s, { t: "downloaded" }, { t: "install-start" })).toEqual({ s: "installing", version: "2.1.1" });
  });
  it("up to date records the time", () => {
    expect(run(idle, { t: "check-start" }, { t: "none", at: 9 })).toEqual({ s: "up-to-date", checkedAt: 9 });
  });
  it("an automatic failure restores the previous state; a manual one shows the failure", () => {
    const up: UpdateState = { s: "up-to-date", checkedAt: 3 };
    expect(run(up, { t: "check-start" }, { t: "check-failed", message: "x", manual: false, prev: up })).toEqual(up);
    expect(run(up, { t: "check-start" }, { t: "check-failed", message: "x", manual: true, prev: up }))
      .toEqual({ s: "failed", phase: "check", version: null, message: "x" });
  });
  it("a manual failure keeps a pending update", () => {
    expect(run(avail, { t: "check-start" }, { t: "check-failed", message: "x", manual: true, prev: avail })).toEqual(avail);
  });
  it("download and install failures keep the version and retry the download", () => {
    const f = run(avail, { t: "download-start", version: "2.1.1" }, { t: "download-failed", message: "boom" });
    expect(f).toEqual({ s: "failed", phase: "download", version: "2.1.1", message: "boom" });
    expect(run(f, { t: "download-start", version: "2.1.1" }).s).toBe("downloading");
    const i = run(avail, { t: "download-start", version: "2.1.1" }, { t: "downloaded" }, { t: "install-start" }, { t: "install-failed", message: "no" });
    expect(i).toMatchObject({ s: "failed", phase: "install", version: "2.1.1" });
    expect(run(i, { t: "download-start", version: "2.1.1" }).s).toBe("downloading");
  });
  it("a check failure cannot start a download; install needs ready", () => {
    const f = run(idle, { t: "check-start" }, { t: "check-failed", message: "x", manual: true, prev: idle });
    expect(run(f, { t: "download-start", version: "9" })).toEqual(f);
    expect(run(avail, { t: "install-start" })).toEqual(avail);
  });
  it("no check while downloading, installing or ready", () => {
    for (const s of [{ s: "downloading", version: "1", received: 0, total: null }, { s: "ready", version: "1" }, { s: "installing", version: "1" }] as UpdateState[]) {
      expect(canCheck(s)).toBe(false);
      expect(reduce(s, { t: "check-start" })).toEqual(s);
    }
  });
});

describe("failed download/install and relaunch", () => {
  it("a failed download or install can be checked again (the 24h tick must not skip)", () => {
    for (const phase of ["download", "install"] as const) {
      const f: UpdateState = { s: "failed", phase, version: "2.1.1", message: "x" };
      expect(canCheck(f)).toBe(true);
      expect(reduce(f, { t: "check-start" })).toEqual({ s: "checking" });
      expect(run(f, { t: "check-start" }, { t: "check-failed", message: "x", manual: true, prev: f })).toEqual(f);
    }
  });
  it("relaunch failure after install is installed, not install-failed", () => {
    const s = run(avail, { t: "download-start", version: "2.1.1" }, { t: "downloaded" }, { t: "install-start" }, { t: "relaunch-failed" });
    expect(s).toEqual({ s: "installed", version: "2.1.1" });
    expect(canCheck(s)).toBe(false);
    expect(noticeLabel(s, null)).toBeNull();
    expect(reduce(avail, { t: "relaunch-failed" })).toEqual(avail);
  });
});

describe("checkDisabledReason", () => {
  it("names the reason, null when allowed", () => {
    expect(checkDisabledReason(idle)).toBeNull();
    expect(checkDisabledReason({ s: "checking" })).toBe("A check is already running.");
    expect(checkDisabledReason({ s: "downloading", version: "1", received: 0, total: null })).toBe("Downloading. This can't be cancelled.");
    expect(checkDisabledReason({ s: "unavailable" })).toBe("Updates aren't available in this build.");
  });
});

describe("noticeLabel", () => {
  it("shows for a pending version, hides when dismissed, never hides ready", () => {
    expect(noticeLabel(idle, null)).toBeNull();
    expect(noticeLabel(avail, null)).toBe("Update available");
    expect(noticeLabel(avail, "2.1.1")).toBeNull();
    expect(noticeLabel(avail, "2.1.0")).toBe("Update available");
    expect(noticeLabel({ s: "ready", version: "2.1.1" }, "2.1.1")).toBe("Ready to install");
    expect(noticeLabel({ s: "downloading", version: "2.1.1", received: 0, total: null }, null)).toBe("Downloading update");
  });
  it("failed shows only after a found version", () => {
    expect(noticeLabel({ s: "failed", phase: "check", version: null, message: "" }, null)).toBeNull();
    expect(noticeLabel({ s: "failed", phase: "download", version: "2.1.1", message: "" }, null)).toBe("Update available");
  });
});

describe("progress and formatting", () => {
  it("percent clamps; unknown total is null", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(500, 200)).toBe(100);
    expect(percent(5, null)).toBeNull();
    expect(percent(5, 0)).toBeNull();
  });
  it("aria steps by 10", () => {
    expect(ariaStep(0)).toBe(0);
    expect(ariaStep(42)).toBe(40);
    expect(ariaStep(100)).toBe(100);
  });
  it("bytes", () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe("12.4 MB");
    expect(formatBytes(2048)).toBe("2 KB");
  });
  it("formatChecked: today vs another day", () => {
    const now = new Date(2026, 9, 10, 15, 0).getTime();
    expect(formatChecked(new Date(2026, 9, 10, 14, 2).getTime(), now)).toBe("today at 14:02");
    expect(formatChecked(new Date(2026, 9, 9, 8, 5).getTime(), now)).toBe("on 9 Oct at 08:05");
  });
});

describe("parsePrefs", () => {
  it("defaults on missing or corrupt input", () => {
    for (const raw of [null, "", "{nope", "5", "null", "[]"]) expect(parsePrefs(raw)).toEqual({ autoCheck: true, dismissed: null });
  });
  it("falls back per field", () => {
    expect(parsePrefs('{"autoCheck":false,"dismissed":"2.1.1"}')).toEqual({ autoCheck: false, dismissed: "2.1.1" });
    expect(parsePrefs('{"autoCheck":"no","dismissed":5}')).toEqual({ autoCheck: true, dismissed: null });
    expect(parsePrefs('{"autoCheck":false}')).toEqual({ autoCheck: false, dismissed: null });
  });
});
