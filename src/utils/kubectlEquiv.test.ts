import { describe, expect, it } from "vitest";
import {
  argoDeleteEquiv, argoRefreshEquiv, argoRollbackEquiv, argoSyncEquiv, deleteEquiv, deletePodsEquiv,
  forceDeleteEquiv, helmInstallEquiv, kubeconfigFootnote, maskSecretPatch, mergeFromFileEquiv, patchEquiv,
  quotePosix, quotePowerShell, renderCommand, renderCopyText, replaceEquiv, scaleEquiv, truncateForDisplay,
} from "./kubectlEquiv";

const W = { context: "prod-eu-1", namespace: "shop" };
const posix = (eq: ReturnType<typeof deleteEquiv>) => renderCopyText(eq, "posix");

describe("deleteEquiv", () => {
  it("carries --context and -n, and --cascade only for owner kinds", () => {
    expect(posix(deleteEquiv({ ...W, kind: "deploy", name: "api" })))
      .toBe("kubectl delete deployment api -n shop --context prod-eu-1 --cascade=background");
    expect(posix(deleteEquiv({ ...W, kind: "sts", name: "db", propagation: "orphan" })))
      .toContain("--cascade=orphan");
    for (const kind of ["cm", "sec", "svc", "pvc", "sa", "argocd"]) {
      expect(posix(deleteEquiv({ ...W, kind, name: "x" }))).not.toContain("--cascade");
    }
  });
  it("omits -n for cluster-scoped kinds", () => {
    expect(posix(deleteEquiv({ ...W, kind: "pv", name: "pv-1" }))).toBe("kubectl delete pv pv-1 --context prod-eu-1");
    expect(posix(deleteEquiv({ ...W, kind: "crbindings", name: "x" }))).not.toContain("-n ");
  });
  it("names several pods in one command", () => {
    expect(posix(deletePodsEquiv({ ...W, names: ["a", "b"] }))).toBe("kubectl delete pod a b -n shop --context prod-eu-1");
  });
});

describe("ArgoCD", () => {
  it("never renders --cascade on a delete", () => {
    for (const cascade of [true, false]) {
      expect(posix(argoDeleteEquiv({ ...W, name: "app", cascade }))).not.toContain("--cascade");
    }
  });
  it("renders keep-resources as two commands: clear finalizers, then delete", () => {
    const eq = argoDeleteEquiv({ ...W, name: "app", cascade: false });
    expect(eq.commands).toHaveLength(2);
    expect(renderCommand(eq.commands[0], "posix")).toContain(`{"metadata":{"finalizers":[]}}`);
    expect(renderCommand(eq.commands[1], "posix")).toMatch(/^kubectl delete applications\.argoproj\.io app/);
    expect(argoDeleteEquiv({ ...W, name: "app", cascade: true }).commands).toHaveLength(1);
  });
  it("builds the sync operation patch, adding revision only when passed", () => {
    const base = renderCommand(argoSyncEquiv({ ...W, name: "app" }).commands[0], "posix");
    expect(base).toContain(`"operation":{"sync":{"prune":false,"dryRun":false,"syncStrategy":{"hook":{"force":false}}}}`);
    expect(base).not.toContain("revision");
    const rev = renderCommand(argoSyncEquiv({ ...W, name: "app", prune: true, force: true, revision: "v1" }).commands[0], "posix");
    expect(rev).toContain(`"prune":true`);
    expect(rev).toContain(`"revision":"v1"`);
  });
  it("renders refresh as an annotation and rollback with a placeholder source", () => {
    expect(posix(argoRefreshEquiv({ ...W, name: "app", hard: true }))).toContain("argocd.argoproj.io/refresh=hard --overwrite");
    const rb = argoRollbackEquiv({ ...W, name: "app", historyId: 7 });
    expect(posix(rb)).toContain("<source of history id 7>");
    expect(rb.footnotes.join(" ")).toContain("history entry");
  });
});

describe("patchEquiv", () => {
  it("masks Secret values but keeps keys and null removals", () => {
    const eq = patchEquiv({ ...W, kind: "sec", name: "creds", patch: { stringData: { password: "hunter2" }, data: { old: null } } });
    const text = posix(eq);
    expect(text).not.toContain("hunter2");
    expect(text).toContain(`"password":"<redacted>"`);
    expect(text).toContain(`"old":null`);
    expect(eq.footnotes.join(" ")).toContain("<redacted>");
  });
  it("does not touch a ConfigMap patch", () => {
    const eq = patchEquiv({ ...W, kind: "cm", name: "c", patch: { data: { k: "v" } } });
    expect(posix(eq)).toContain(`"k":"v"`);
    expect(eq.footnotes).toHaveLength(0);
  });
  it("maskSecretPatch reports whether anything was masked", () => {
    expect(maskSecretPatch({ data: { a: null } }).didMask).toBe(false);
    expect(maskSecretPatch({ metadata: {} }).didMask).toBe(false);
  });
});

describe("quoting", () => {
  const patch = { spec: { replicas: 3 }, metadata: { annotations: { note: "it's" } } };
  it("POSIX single-quotes a JSON patch and escapes embedded quotes", () => {
    expect(quotePosix(JSON.stringify(patch))).toBe(`'{"spec":{"replicas":3},"metadata":{"annotations":{"note":"it'\\''s"}}}'`);
  });
  it("PowerShell single-quotes and escapes double quotes for the native command line", () => {
    const q = quotePowerShell(JSON.stringify({ a: 1, b: "x'y" }));
    expect(q).toBe(`'{\\"a\\":1,\\"b\\":\\"x''y\\"}'`);
  });
  it("leaves safe tokens bare and quotes the empty string", () => {
    expect(quotePosix("app-1")).toBe("app-1");
    expect(quotePowerShell("a/b:c")).toBe("a/b:c");
    expect(quotePosix("")).toBe("''");
  });
  it("never quotes raw placeholders", () => {
    expect(renderCommand(replaceEquiv(W).commands[0], "posix")).toBe("kubectl replace -f <your-edited-yaml> --context prod-eu-1");
  });
});

describe("misc builders", () => {
  it("scale uses the real verb and noun", () => {
    expect(posix(scaleEquiv({ ...W, kind: "sts", name: "db", replicas: 0 })))
      .toBe("kubectl scale statefulset/db --replicas=0 -n shop --context prod-eu-1");
  });
  it("force delete is one command per namespace", () => {
    const eq = forceDeleteEquiv({ context: "c", pods: [{ namespace: "b", name: "p2" }, { namespace: "a", name: "p1" }, { namespace: "b", name: "p3" }] });
    expect(eq.commands.map((c) => renderCommand(c, "posix"))).toEqual([
      "kubectl delete pod p1 -n a --context c",
      "kubectl delete pod p2 p3 -n b --context c",
    ]);
  });
  it("merge from file is an explanation, never a kubectl apply", () => {
    const eq = mergeFromFileEquiv();
    expect(eq.commands).toHaveLength(0);
    expect(eq.note).toContain("no single kubectl equivalent");
    expect(renderCopyText(eq, "posix")).not.toContain("apply -f");
  });
  it("helm install adds the optional flags only when filled", () => {
    const min = renderCommand(helmInstallEquiv({ context: "c", namespace: "n", release: "r", chart: "bitnami/nginx" }).commands[0], "posix");
    expect(min).toBe("helm install r bitnami/nginx --namespace n --kube-context c");
    const full = renderCommand(helmInstallEquiv({ context: "c", namespace: "n", release: "r", chart: "x", version: "1.2.3", createNamespace: true, dryRun: true, hasValues: true }).commands[0], "posix");
    expect(full).toContain("--version 1.2.3 --create-namespace --dry-run --values <values.yaml>");
  });
  it("truncates only commands over 1000 chars", () => {
    expect(truncateForDisplay("x".repeat(1000)).truncated).toBe(false);
    const long = truncateForDisplay("x".repeat(1001));
    expect(long.truncated).toBe(true);
    expect(long.shown).toHaveLength(301);
  });
});

describe("kubeconfigFootnote", () => {
  it("fires only when the context source differs from the default kubeconfig", () => {
    expect(kubeconfigFootnote("c", "/home/me/.kube/config", "/home/me/.kube/config")).toBeNull();
    expect(kubeconfigFootnote("c", "C:\\Users\\me\\.kube\\config", "C:/Users/me/.kube/config")).toBeNull();
    expect(kubeconfigFootnote("c", undefined, "/x")).toBeNull();
    expect(kubeconfigFootnote("c", "/x", undefined)).toBeNull();
    const note = kubeconfigFootnote("prod-eu-1", "/home/me/kube/work-clusters.yaml", "/home/me/.kube/config");
    expect(note).toBe(`Context "prod-eu-1" is defined in work-clusters.yaml. Add --kubeconfig /home/me/kube/work-clusters.yaml, or include that file in KUBECONFIG.`);
  });
});
