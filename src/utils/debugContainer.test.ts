import { describe, expect, it } from "vitest";
import {
  DEBUG_IMAGE_SUGGESTIONS, debugCard, defaultImage, exitedText, generateDebugName, isFinishedPodStatus,
  isNoShellError, isPsaRejection, parseKubeVersion, parseRecentImages, pullFailingText, pushRecentImage,
  rejectionPlainLine, rejectionStatus, stripStartPrefix, supportsEphemeralContainers, validateDebugName,
  validateImage, waitingText,
} from "./debugContainer";
import type { EphemeralContainerInfo } from "../types/k8s";

const eph = (p: Partial<EphemeralContainerInfo>): EphemeralContainerInfo => ({
  name: "debugger-abcde", image: "busybox:1.36", target_container: null, state: "waiting", reason: null,
  message: null, exit_code: null, started_at: null, ...p,
});

describe("name and image", () => {
  it("generates debugger- plus five [a-z0-9] characters that pass validation", () => {
    for (let i = 0; i < 50; i++) {
      const n = generateDebugName();
      expect(n).toMatch(/^debugger-[a-z0-9]{5}$/);
      expect(validateDebugName(n)).toBeNull();
    }
    expect(generateDebugName(() => 0)).toBe("debugger-aaaaa");
    expect(generateDebugName(() => 0.9999)).toBe("debugger-99999");
  });
  it("validates DNS-1123 labels", () => {
    expect(validateDebugName("Debugger")).not.toBeNull();
    expect(validateDebugName("-a")).not.toBeNull();
    expect(validateDebugName("a-")).not.toBeNull();
    expect(validateDebugName("a".repeat(64))).not.toBeNull();
    expect(validateDebugName("a".repeat(63))).toBeNull();
  });
  it("rejects an empty image or one with whitespace", () => {
    expect(validateImage("")).toBe("Enter an image name.");
    expect(validateImage("   ")).toBe("Enter an image name.");
    expect(validateImage("busy box")).not.toBeNull();
    expect(validateImage("registry.example.com:5000/team/tool:1.2")).toBeNull();
  });
  it("offers exactly the four suggested images", () => {
    expect(DEBUG_IMAGE_SUGGESTIONS).toEqual(["busybox:1.36", "nicolaka/netshoot:v0.13", "alpine:3.20", "ubuntu:24.04"]);
  });
});

describe("recent images", () => {
  it("keeps the latest five, most recent first, without duplicates", () => {
    let list: string[] = [];
    for (const i of ["a", "b", "c", "d", "e", "f"]) list = pushRecentImage(list, i);
    expect(list).toEqual(["f", "e", "d", "c", "b"]);
    expect(pushRecentImage(list, "c")).toEqual(["c", "f", "e", "d", "b"]);
    expect(pushRecentImage(list, "bad image")).toEqual(list);
  });
  it("parses tolerantly and defaults to the last used, else the first suggestion", () => {
    expect(parseRecentImages(null)).toEqual([]);
    expect(parseRecentImages("{nope")).toEqual([]);
    expect(parseRecentImages('{"a":1}')).toEqual([]);
    expect(parseRecentImages('["x", 3, "bad img", "y"]')).toEqual(["x", "y"]);
    expect(defaultImage(["mine"])).toBe("mine");
    expect(defaultImage([])).toBe("busybox:1.36");
  });
});

describe("backend text", () => {
  it("strips only the exact start prefix", () => {
    expect(stripStartPrefix("Failed to start debug container: pods \"x\" is forbidden")).toBe('pods "x" is forbidden');
    expect(stripStartPrefix("Failed to connect: x")).toBe("Failed to connect: x");
  });
  it("shows the PSA line only when the message looks like PSA or an admission webhook", () => {
    expect(isPsaRejection('violates PodSecurity "restricted:latest"')).toBe(true);
    expect(isPsaRejection("denied by Pod Security policy")).toBe(true);
    expect(isPsaRejection('admission webhook "x" denied the request')).toBe(true);
    expect(isPsaRejection("pods is forbidden")).toBe(false);
    expect(rejectionPlainLine("pods is forbidden")).toBe("Nothing was added to the pod.");
    expect(rejectionPlainLine("PodSecurity violation")).toContain("Pod Security Admission");
    expect(rejectionStatus("Failed to start debug container: nope")).toBe("The API server rejected this debug container: nope");
  });
  it("classifies a missing shell by its substrings", () => {
    expect(isNoShellError('OCI runtime exec failed: exec failed: unable to start container process: exec: "sh": executable file not found in $PATH')).toBe(true);
    expect(isNoShellError("fork/exec /bin/sh: no such file or directory")).toBe(true);
    expect(isNoShellError("pods is forbidden: User cannot create pods/exec")).toBe(false);
    expect(isNoShellError("connection refused")).toBe(false);
  });
});

describe("capability and finished pods", () => {
  it("parses real server versions", () => {
    expect(parseKubeVersion("v1.29.3-gke.100")).toEqual({ major: 1, minor: 29 });
    expect(parseKubeVersion("v1.27.4+k3s1")).toEqual({ major: 1, minor: 27 });
    expect(parseKubeVersion("1.22")).toEqual({ major: 1, minor: 22 });
    expect(parseKubeVersion("garbage")).toBeNull();
    expect(parseKubeVersion(null)).toBeNull();
  });
  it("disables only below 1.23 and fails open on anything unparseable", () => {
    expect(supportsEphemeralContainers("v1.22.9")).toBe(false);
    expect(supportsEphemeralContainers("v1.23.0")).toBe(true);
    expect(supportsEphemeralContainers("v1.29.3-gke.100")).toBe(true);
    expect(supportsEphemeralContainers("v2.0.0")).toBe(true);
    expect(supportsEphemeralContainers("weird")).toBe(true);
    expect(supportsEphemeralContainers(null)).toBe(true);
  });
  it("treats Succeeded, Failed and Terminating as finished", () => {
    for (const s of ["Succeeded", "Failed", "Terminating"]) expect(isFinishedPodStatus(s)).toBe(true);
    for (const s of ["Running", "Pending", "CrashLoopBackOff"]) expect(isFinishedPodStatus(s)).toBe(false);
  });
});

describe("debugCard", () => {
  it("pod gone wins", () => {
    expect(debugCard(true, eph({ state: "running" }))).toEqual({ kind: "pod-gone" });
  });
  it("maps the container state", () => {
    expect(debugCard(false, undefined)).toEqual({ kind: "pending" });
    expect(debugCard(false, eph({ state: "pending" }))).toEqual({ kind: "pending" });
    expect(debugCard(false, eph({ state: "running" }))).toEqual({ kind: "running" });
    expect(debugCard(false, eph({ state: "terminated", exit_code: 0 }))).toEqual({ kind: "exited", exitCode: 0 });
    expect(debugCard(false, eph({ state: "waiting", reason: "ContainerCreating" }))).toEqual({ kind: "waiting", reason: "ContainerCreating" });
  });
  it("detects an image pull failure", () => {
    const c = debugCard(false, eph({ state: "waiting", reason: "ImagePullBackOff", message: "back-off pulling image" }));
    expect(c.kind).toBe("pull-failing");
    if (c.kind === "pull-failing") expect(pullFailingText(c)).toBe('Waiting: ImagePullBackOff. Kubernetes can\'t pull "busybox:1.36": back-off pulling image');
  });
  it("words the exit and waiting lines", () => {
    expect(exitedText("debugger-x", 0)).toBe("debugger-x exited (code 0). A debug container can't be restarted.");
    expect(exitedText("debugger-x", null)).toBe("debugger-x exited. A debug container can't be restarted.");
    expect(waitingText(12, "ErrImagePull")).toBe("Waiting for container (pulling image, 12s)");
  });
});
