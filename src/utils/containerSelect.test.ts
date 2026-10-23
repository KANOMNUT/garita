import { describe, it, expect } from "vitest";
import type { ContainerStatus } from "../types/k8s";
import {
  findFailing,
  isRunning,
  logOptionLabel,
  relativeAgo,
  selectLogContainer,
  selectShellContainer,
  shellOptions,
  SHELL_NOT_RUNNING_REASON,
  type SelectablePod,
} from "./containerSelect";

const NOW = Date.parse("2026-10-03T12:00:00Z");

const st = (name: string, over: Partial<ContainerStatus> = {}): ContainerStatus => ({
  name,
  restart_count: 0,
  current_state: "running",
  ...over,
});

const pod = (over: Partial<SelectablePod> = {}): SelectablePod => ({
  containers: [{ name: "app" }, { name: "sidecar" }],
  containers_status: [st("app"), st("sidecar")],
  ...over,
});

describe("selectLogContainer: precedence", () => {
  it("3. first non-init container, no hint", () => {
    const p = pod({ containers: [{ name: "migrate", is_init: true }, { name: "app" }, { name: "sidecar" }] });
    const s = selectLogContainer(p, NOW);
    expect(s.container).toBe("app"); // init containers are listed FIRST by the backend; they must be skipped
    expect(s.hint).toBeNull();
    expect(s.alternative).toBeNull();
    expect(s.openPrevious).toBe(false);
  });

  it("2. the default-container annotation beats the first container, with a hint and an override", () => {
    const s = selectLogContainer(pod({ default_container: "sidecar" }), NOW);
    expect(s.container).toBe("sidecar");
    expect(s.hint).toBe("Selected: this pod's default container (annotation)");
    expect(s.alternative).toBe("app");
  });

  it("an annotation naming a container that does not exist is ignored silently", () => {
    const s = selectLogContainer(pod({ default_container: "ghost" }), NOW);
    expect(s.container).toBe("app");
    expect(s.hint).toBeNull();
  });

  it("an empty annotation is ignored", () => {
    expect(selectLogContainer(pod({ default_container: "" }), NOW).container).toBe("app");
    expect(selectLogContainer(pod({ default_container: null }), NOW).container).toBe("app");
  });

  it("1. a failing container beats the annotation", () => {
    const p = pod({
      default_container: "app",
      containers_status: [
        st("app"),
        st("sidecar", { current_state: "terminated", current_reason: "OOMKilled", last_exit_code: 137, last_finished_at: "2026-10-03T11:57:00Z", restart_count: 2 }),
      ],
    });
    const s = selectLogContainer(p, NOW);
    expect(s.container).toBe("sidecar");
    expect(s.hint).toBe("Selected: last crashed (OOMKilled, exit 137, 3m ago)");
    expect(s.alternative).toBe("app");
    expect(s.failing).toEqual(["sidecar"]);
  });
});

describe("failing detection", () => {
  it("CrashLoopBackOff is failing, waiting, and opens previous when a previous run exists", () => {
    const p = pod({
      containers_status: [
        st("app", { current_state: "waiting", current_reason: "CrashLoopBackOff", restart_count: 5, last_state: "terminated", last_exit_code: 1 }),
        st("sidecar"),
      ],
    });
    const s = selectLogContainer(p, NOW);
    expect(s.container).toBe("app");
    expect(s.hint).toBe("Selected: crash looping (CrashLoopBackOff, 5 restarts)");
    expect(s.openPrevious).toBe(true);
    expect(s.previousHint).toBe("Showing the previous run: the current one is waiting (CrashLoopBackOff, 5 restarts).");
  });

  it("singular restart", () => {
    const p = pod({ containers_status: [st("app", { current_state: "waiting", current_reason: "CrashLoopBackOff", restart_count: 1, last_state: "terminated" }), st("sidecar")] });
    expect(selectLogContainer(p, NOW).hint).toContain("1 restart)");
  });

  it("ImagePullBackOff is failing but does NOT open previous (it never ran)", () => {
    const p = pod({ containers_status: [st("app", { current_state: "waiting", current_reason: "ImagePullBackOff" }), st("sidecar")] });
    const s = selectLogContainer(p, NOW);
    expect(s.container).toBe("app");
    expect(s.hint).toBe("Selected: can't pull its image (ImagePullBackOff)");
    expect(s.openPrevious).toBe(false);
  });

  it("ErrImagePull and CreateContainerError count", () => {
    expect(findFailing(pod({ containers_status: [st("app", { current_state: "waiting", current_reason: "ErrImagePull" }), st("sidecar")] }))).toHaveLength(1);
    expect(findFailing(pod({ containers_status: [st("app", { current_state: "waiting", current_reason: "CreateContainerError" }), st("sidecar")] }))).toHaveLength(1);
  });

  it("other waiting reasons (ContainerCreating, PodInitializing) are not failing", () => {
    expect(findFailing(pod({ containers_status: [st("app", { current_state: "waiting", current_reason: "ContainerCreating" }), st("sidecar")] }))).toEqual([]);
  });

  it("terminated Completed is not failing; terminated Error is", () => {
    expect(findFailing(pod({ containers_status: [st("app", { current_state: "terminated", current_reason: "Completed" }), st("sidecar")] }))).toEqual([]);
    expect(findFailing(pod({ containers_status: [st("app", { current_state: "terminated", current_reason: "Error" }), st("sidecar")] }))).toHaveLength(1);
  });

  it("a failed init container is chosen, labelled, and bridges the init: prefix", () => {
    const p: SelectablePod = {
      containers: [{ name: "migrate", is_init: true }, { name: "app" }],
      containers_status: [
        st("init:migrate", { current_state: "terminated", current_reason: "Error", last_exit_code: 1 }),
        st("app", { current_state: "waiting", current_reason: "PodInitializing" }),
      ],
    };
    const s = selectLogContainer(p, NOW);
    expect(s.container).toBe("migrate");
    expect(s.hint).toBe('Selected: init container "migrate" failed (exit 1)');
    expect(s.alternative).toBe("app");
  });

  it("most recently finished wins; ties go to spec order", () => {
    const p = pod({
      containers_status: [
        st("app", { current_state: "terminated", current_reason: "Error", last_finished_at: "2026-10-03T11:00:00Z" }),
        st("sidecar", { current_state: "terminated", current_reason: "Error", last_finished_at: "2026-10-03T11:30:00Z" }),
      ],
    });
    expect(selectLogContainer(p, NOW).container).toBe("sidecar");
    const tie = pod({
      containers_status: [
        st("app", { current_state: "terminated", current_reason: "Error", last_finished_at: "2026-10-03T11:00:00Z" }),
        st("sidecar", { current_state: "terminated", current_reason: "Error", last_finished_at: "2026-10-03T11:00:00Z" }),
      ],
    });
    expect(selectLogContainer(tie, NOW).container).toBe("app");
  });

  it("with no containers_status at all, nothing is failing", () => {
    expect(findFailing({ containers: [{ name: "app" }] })).toEqual([]);
  });
});

describe("relativeAgo", () => {
  it("formats seconds, minutes, hours, days", () => {
    expect(relativeAgo("2026-10-03T11:59:30Z", NOW)).toBe("30s ago");
    expect(relativeAgo("2026-10-03T11:57:00Z", NOW)).toBe("3m ago");
    expect(relativeAgo("2026-10-03T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeAgo("2026-10-01T12:00:00Z", NOW)).toBe("2d ago");
  });
  it("null for missing or unparseable", () => {
    expect(relativeAgo(undefined, NOW)).toBeNull();
    expect(relativeAgo("nope", NOW)).toBeNull();
  });
});

describe("logOptionLabel", () => {
  it("marks failing, default and init in text", () => {
    const p: SelectablePod = {
      containers: [{ name: "migrate", is_init: true }, { name: "app" }, { name: "sidecar" }],
      default_container: "sidecar",
      containers_status: [st("init:migrate", { current_state: "terminated", current_reason: "Completed" }), st("app", { current_state: "terminated", current_reason: "Error" }), st("sidecar")],
    };
    const sel = selectLogContainer(p, NOW);
    expect(logOptionLabel(p, p.containers[0], sel)).toBe("[init] migrate");
    expect(logOptionLabel(p, p.containers[1], sel)).toBe("app (crashed)");
    expect(logOptionLabel(p, p.containers[2], sel)).toBe("sidecar (default)");
  });
});

describe("shell selection", () => {
  it("annotation first, when that container is running", () => {
    expect(selectShellContainer(pod({ default_container: "sidecar" }))).toBe("sidecar");
  });
  it("a non-running annotated container is skipped", () => {
    const p = pod({ default_container: "sidecar", containers_status: [st("app"), st("sidecar", { current_state: "waiting" })] });
    expect(selectShellContainer(p)).toBe("app");
  });
  it("failing does not apply: a crashed first container is not picked for a shell", () => {
    const p = pod({ containers_status: [st("app", { current_state: "terminated", current_reason: "Error" }), st("sidecar")] });
    expect(selectShellContainer(p)).toBe("sidecar");
  });
  it("prefers a running non-init container over a running init one", () => {
    const p: SelectablePod = {
      containers: [{ name: "init1", is_init: true }, { name: "app" }],
      containers_status: [st("init:init1"), st("app")],
    };
    expect(selectShellContainer(p)).toBe("app");
  });
  it("nothing running falls back to the first non-init container", () => {
    const p = pod({ containers_status: [st("app", { current_state: "waiting" }), st("sidecar", { current_state: "waiting" })] });
    expect(selectShellContainer(p)).toBe("app");
  });
  it("falls back to Container.status when containers_status is absent", () => {
    const p: SelectablePod = { containers: [{ name: "app", status: "Running" }] };
    expect(isRunning(p, p.containers[0])).toBe(true);
  });
  it("non-running options are disabled with the reason, in text", () => {
    const p = pod({ containers_status: [st("app", { current_state: "waiting" }), st("sidecar")] });
    const opts = shellOptions(p);
    expect(opts[0]).toEqual({ name: "app", label: "app (not running)", disabled: true, reason: SHELL_NOT_RUNNING_REASON });
    expect(opts[1]).toEqual({ name: "sidecar", label: "sidecar", disabled: false });
  });
});
