// Run: node scripts/check-emit.ts
//
// Node 24's native TS type-stripping runs this directly — no build step, no
// test framework. tsconfig.json's `include: ["src"]` means this file is
// invisible to `tsc`, so these are the only checks these behaviours get.
//
// Asserts the empirically-found YAML emission behaviours in
// src/components/create/emit.ts (see docs/plan-tls-cert-and-context-new.md
// §7-8, R7/R8) that a type checker cannot see.

import assert from "node:assert/strict";
import {
  blockScalar,
  kv,
  kvRaw,
  metadata,
  doc,
  emitSecret,
  dockerConfigJson,
  emitDataBlock,
  validateKey,
  validateLabelKey,
  emitResources,
} from "../src/components/create/emit.ts";
import { mergePatch, applyMergePatch } from "../src/components/edit/patch.ts";
import { quantityToBytes, splitQuantity, unitMultiplier, validateQuantity } from "../src/components/edit/quantity.ts";
import { previewRows } from "../src/utils/mergePreview.ts";
import {
  summarizePreview, requiresTypedConfirm, drainOutcome, runCounts, countsSentence, sortRows,
  type DrainRow,
} from "../src/utils/drain.ts";
import type { DrainPodPreview, DrainPreview } from "../src/types/k8s.ts";

// ── 1. blockScalar preserves leading whitespace on the first content line ──
{
  const lines = blockScalar("foo", "  leading spaces\nsecond line", 2);
  assert.deepEqual(lines, [
    "  foo: |2-",
    " ".repeat(4) + "  leading spaces",
    " ".repeat(4) + "second line",
  ]);
  // This is the entire reason for the explicit "|2-" indicator: a bare
  // "|-" auto-detects its strip width from the first content line's OWN
  // indentation (6 here), which would fold this value's leading whitespace
  // into the detected width and strip it right back out.
}

// ── 2. embedded ":" and "\n" ──
{
  const lines = blockScalar("msg", "a: b\nc: d", 2);
  assert.deepEqual(lines, ["  msg: |2-", " ".repeat(4) + "a: b", " ".repeat(4) + "c: d"]);
}

// ── 3. second line less indented than the first ──
{
  const lines = blockScalar("x", "    deep\n  shallow", 2);
  assert.deepEqual(lines, [
    "  x: |2-",
    " ".repeat(4) + "    deep",
    " ".repeat(4) + "  shallow",
  ]);
  // The classic bare "|-" failure case: strip width is detected from the
  // FIRST line (8 spaces), so a later, less-indented line either loses its
  // meaning or fails to parse depending on the implementation.
}

// ── 4. kv on "" ──
{
  assert.deepEqual(kv("k", "", 0), ['k: ""']);
}

// ── 5. kv on bool/numeric lookalikes stays a string; a real bare value stays bare ──
{
  // The REQUIREMENT is that these never reach the parser as a bool or an
  // int. Double-quoting satisfies it (YAML reads `"true"` as the string) and
  // reads far better than a two-line block scalar for a 4-character value.
  // Asserting the exact output rather than the requirement is a compromise
  // — there is no YAML parser here to round-trip through without adding a
  // dependency — so if you change the quoting mechanism, check the intent
  // above rather than just re-baselining these strings.
  assert.deepEqual(kv("k", "true", 0), ['k: "true"']);
  assert.deepEqual(kv("k", "123", 0), ['k: "123"']);
  assert.deepEqual(kv("k", "hello", 0), ["k: hello"]);
}

// ── 6. metadata() namespace line ──
{
  assert.deepEqual(metadata("x", null), ["metadata:", "  name: x"]);
  assert.deepEqual(metadata("x", "foo"), ["metadata:", "  name: x", "  namespace: foo"]);
}

// ── 7. cm/sec round-trip — byte-identical to the pre-refactor shipped serialiser ──
{
  // Verbatim copy of ResourceCreator.tsx's pre-refactor serialiseKeyValue,
  // frozen here as the oracle. Do not "fix" divergences in this copy — if
  // it disagrees with the pipeline below, the pipeline is wrong, not this.
  function shippedSerialiseKeyValue(
    name: string,
    namespace: string,
    entries: { key: string; value: string }[],
    dataKey: "data" | "stringData",
  ): string {
    const clean = entries.filter((e) => e.key);
    const lines = [
      "apiVersion: v1",
      `kind: ${dataKey === "data" ? "ConfigMap" : "Secret"}`,
      "metadata:",
      `  name: ${name}`,
      `  namespace: ${namespace}`,
    ];
    if (dataKey === "stringData") lines.push("type: Opaque");
    if (clean.length === 0) {
      lines.push(`${dataKey}: {}`);
    } else {
      lines.push(`${dataKey}:`);
      for (const { key, value } of clean) {
        if (value === "") {
          lines.push(`  ${key}: ""`);
        } else {
          lines.push(`  ${key}: |2-`);
          for (const line of value.split("\n")) {
            lines.push(line === "" ? "" : `    ${line}`);
          }
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  // What src/components/create/forms/keyvalue.tsx does, using only emit.ts
  // exports — reproduced here (rather than imported) because that file is
  // .tsx and Node's type-stripper does not transform JSX, so it cannot be
  // loaded by this plain script. Keep this in lockstep with keyvalue.tsx's
  // own serialiseConfigMap() (Secret's Opaque path is now exercised
  // directly against the real emitSecret() in case 10 below) — if you
  // change one, change both.
  function newPipeline(
    name: string,
    namespace: string,
    entries: { key: string; value: string }[],
    dataKey: "data" | "stringData",
  ): string {
    const clean = entries.filter((e) => e.key);
    const head = [
      "apiVersion: v1",
      `kind: ${dataKey === "data" ? "ConfigMap" : "Secret"}`,
      "metadata:",
      `  name: ${name}`,
      `  namespace: ${namespace}`,
      ...(dataKey === "stringData" ? ["type: Opaque"] : []),
    ];
    const body =
      clean.length === 0
        ? [`${dataKey}: {}`]
        : [
            `${dataKey}:`,
            ...clean.flatMap(({ key, value }) =>
              value === "" ? [`  ${key}: ""`] : blockScalar(key, value, 2),
            ),
          ];
    return doc([head, body]);
  }

  const entries = [
    { key: "simple", value: "bar" },
    { key: "multi", value: "  leading\nsome: colon\n\ntrailing" },
    { key: "empty", value: "" },
  ];

  const shippedCm = shippedSerialiseKeyValue("my-config", "default", entries, "data");
  const freshCm = newPipeline("my-config", "default", entries, "data");
  assert.equal(freshCm, shippedCm);

  const shippedSec = shippedSerialiseKeyValue("my-secret", "default", entries, "stringData");
  const freshSec = newPipeline("my-secret", "default", entries, "stringData");
  assert.equal(freshSec, shippedSec);
}

// ── Case 8: kvRaw must never emit a structural newline ───────────────────
// NumberField is a plain text input feeding kvRaw, so a pasted newline is
// reachable. In block context a newline is the only way a value can break
// out of its line and open a sibling key, so this is the whole vector.
{
  const injected = kvRaw("replicas", "1\n  hostNetwork: true", 2);
  // Falls back to kv(), which sends multi-line content to a block scalar.
  // That is safe for a different reason than quoting: every content line is
  // indented DEEPER than the key, so the pasted text becomes part of the
  // replicas string rather than a sibling mapping key. The property to hold
  // is therefore "no line after the first sits at or above the key's own
  // indent", not "exactly one line".
  assert.ok(injected[0].startsWith("  replicas:"), "first line is the key");
  for (const line of injected.slice(1)) {
    if (line === "") continue;
    const indent = line.length - line.trimStart().length;
    assert.ok(indent > 2, `injected line "${line}" escaped to sibling indent`);
  }
  // A legitimate literal is still emitted verbatim, unquoted.
  assert.deepEqual(kvRaw("replicas", "2", 2), ["  replicas: 2"]);
  assert.deepEqual(kvRaw("suspend", "true", 2), ["  suspend: true"]);
}

// ── Case 9: single-line non-bare values get a quoted flow scalar ─────────
// Three form agents independently reported cron schedules, quota values and
// paths spilling into `|2-` block scalars, which reads as broken in the YAML
// toggle. Block scalars are for genuinely multi-line content only.
{
  assert.deepEqual(kv("schedule", "*/5 * * * *", 2), ['  schedule: "*/5 * * * *"']);
  assert.deepEqual(kv("requests.cpu", "4", 4), ['    requests.cpu: "4"']);
  // A leading slash is a safe plain scalar — "/" is not a YAML indicator.
  assert.deepEqual(kv("path", "/mnt/data/example-pv", 2), ["  path: /mnt/data/example-pv"]);
  assert.deepEqual(kv("path", "/", 2), ["  path: /"]);
  // Genuinely multi-line still goes to a block scalar.
  assert.ok(kv("body", "one\ntwo", 2)[0].endsWith("|2-"));
  // And the type-preservation guarantee is untouched.
  assert.deepEqual(kv("flag", "true", 0), ['flag: "true"']);
}

// ── Case 10 — Secret Opaque byte-identity against the real emitSecret() ──
// Same oracle and entries fixture as case 7, duplicated here rather than
// shared (case 7's block-scoped consts aren't reachable from outside it,
// and cases 1-9 must stay untouched) — now testing emitSecret() itself
// instead of hand-reproducing its pipeline, since emit.ts now owns the
// real serialiser.
{
  function shippedSerialiseKeyValue(
    name: string,
    namespace: string,
    entries: { key: string; value: string }[],
    dataKey: "data" | "stringData",
  ): string {
    const clean = entries.filter((e) => e.key);
    const lines = [
      "apiVersion: v1",
      `kind: ${dataKey === "data" ? "ConfigMap" : "Secret"}`,
      "metadata:",
      `  name: ${name}`,
      `  namespace: ${namespace}`,
    ];
    if (dataKey === "stringData") lines.push("type: Opaque");
    if (clean.length === 0) {
      lines.push(`${dataKey}: {}`);
    } else {
      lines.push(`${dataKey}:`);
      for (const { key, value } of clean) {
        if (value === "") {
          lines.push(`  ${key}: ""`);
        } else {
          lines.push(`  ${key}: |2-`);
          for (const line of value.split("\n")) {
            lines.push(line === "" ? "" : `    ${line}`);
          }
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  const entries = [
    { key: "simple", value: "bar" },
    { key: "multi", value: "  leading\nsome: colon\n\ntrailing" },
    { key: "empty", value: "" },
  ];

  const expected = shippedSerialiseKeyValue("my-secret", "default", entries, "stringData");
  const actual = emitSecret("my-secret", "default", { type: "Opaque", entries });
  assert.equal(actual, expected);
}

// ── Case 11 — kubernetes.io/tls ──────────────────────────────────────────
{
  const crt = "  -----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
  const tlsKey = "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----";

  const noCa = emitSecret("my-tls", "default", { type: "kubernetes.io/tls", crt, key: tlsKey, ca: "" });
  assert.ok(noCa.includes("\ntype: kubernetes.io/tls\n"));
  assert.ok(!noCa.includes("ca.crt"), "ca.crt must be absent entirely when blank");
  assert.ok(noCa.includes("  tls.crt: |2-\n"));
  assert.ok(noCa.includes("  tls.key: |2-\n"));
  // The case-1 property (leading whitespace on the first content line
  // survives the explicit "|2-" indicator), now on a real tls payload.
  assert.ok(noCa.includes("    " + "  -----BEGIN CERTIFICATE-----"));

  const ca = "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----";
  const withCa = emitSecret("my-tls", "default", { type: "kubernetes.io/tls", crt, key: tlsKey, ca });
  assert.ok(withCa.includes("  ca.crt: |2-\n"), "ca.crt present when set");
  assert.ok(
    withCa.includes("    -----BEGIN CERTIFICATE-----\n    MIIC...\n    -----END CERTIFICATE-----"),
    "ca.crt content indented 4",
  );
}

// ── Case 12 — kubernetes.io/dockerconfigjson ─────────────────────────────
{
  const json1 = dockerConfigJson("registry.example.com", "u", "p", "");
  const parsed1 = JSON.parse(json1);
  assert.ok(typeof parsed1 === "object" && parsed1 !== null && !Array.isArray(parsed1));
  assert.ok("auths" in parsed1);
  // Check the known constant, not a value recomputed with the same
  // function under test: base64("u:p") === "dTpw".
  assert.equal(parsed1.auths["registry.example.com"].auth, "dTpw");
  assert.equal("email" in parsed1.auths["registry.example.com"], false);

  const json2 = dockerConfigJson("registry.example.com", "u", "p", "me@example.com");
  const parsed2 = JSON.parse(json2);
  assert.equal(parsed2.auths["registry.example.com"].email, "me@example.com");

  // The emitted block scalar has exactly ONE content line.
  const doc1 = emitSecret("my-regcred", "default", { type: "kubernetes.io/dockerconfigjson", json: json1 });
  const lines1 = doc1.split("\n");
  const idx1 = lines1.findIndex((l) => l.trim() === ".dockerconfigjson: |2-");
  assert.ok(idx1 >= 0, "block scalar key line present");
  assert.equal(lines1[idx1 + 1].trim(), json1);
  assert.equal(lines1[idx1 + 2], "", "no second content line — doc() trailing newline is next");

  // Non-ASCII password: bare btoa() would throw InvalidCharacterError here.
  // Must not throw, and must round-trip byte-for-byte through UTF-8.
  const json3 = dockerConfigJson("registry.example.com", "u", "pässwörd", "");
  const parsed3 = JSON.parse(json3);
  const authBytes = Uint8Array.from(atob(parsed3.auths["registry.example.com"].auth), (c) => c.charCodeAt(0));
  assert.equal(new TextDecoder().decode(authBytes), "u:pässwörd");
}

// ── Case 13 — kubernetes.io/service-account-token ────────────────────────
{
  const out = emitSecret("my-sa-token", "default", {
    type: "kubernetes.io/service-account-token",
    serviceAccount: "my-sa",
  });
  assert.ok(out.includes("  annotations:\n"));
  assert.ok(out.includes("    kubernetes.io/service-account.name: my-sa\n"));
  assert.ok(out.includes("\ntype: kubernetes.io/service-account-token\n"));
  // No data/stringData block at all — the token controller populates it.
  assert.ok(!/\n\s*data:/.test(out));
  assert.ok(!/\n\s*stringData:/.test(out));
}

// ── Case 14 — structural injection guard, all four free-text paths ──────
// Case 8's property ("no line after a key sits at or above that key's own
// indent"), applied to every free-text field a pasted newline can reach
// across all four Secret types.
{
  const injected = "line one\nfoo: bar\n  nested: true";
  const injectedLines = injected.split("\n");

  // tls.crt — routes through blockScalar via emitDataBlock; content always
  // lands at indent 4 regardless of what the value contains.
  {
    const out = emitSecret("t", "default", { type: "kubernetes.io/tls", crt: injected, key: "k", ca: "" });
    const lines = out.split("\n");
    let idx = lines.findIndex((l) => l.trim() === "tls.crt: |2-");
    assert.ok(idx >= 0);
    for (const line of injectedLines) assert.equal(lines[++idx], "    " + line);
  }

  // Registry server / username / password — go through JSON.stringify
  // inside dockerConfigJson first, so an embedded newline becomes the two
  // characters "\n" inside one JSON string, never a real line break.
  for (const field of ["server", "username", "password"] as const) {
    const args: [string, string, string, string] = ["registry.example.com", "u", "p", ""];
    args[{ server: 0, username: 1, password: 2 }[field]] = injected;
    const json = dockerConfigJson(...args);
    const out = emitSecret("d", "default", { type: "kubernetes.io/dockerconfigjson", json });
    const lines = out.split("\n");
    const idx = lines.findIndex((l) => l.trim() === ".dockerconfigjson: |2-");
    assert.ok(idx >= 0, field);
    assert.ok(!lines[idx + 1].includes("\n"), `${field}: content line has no raw newline`);
    assert.equal(lines[idx + 2], "", `${field}: exactly one content line`);
  }

  // ServiceAccount name — routes through kv() inside the annotation map;
  // falls back to a block scalar, content indented at 6, deeper than the
  // annotation key's own indent of 4.
  {
    const out = emitSecret("s", "default", {
      type: "kubernetes.io/service-account-token",
      serviceAccount: injected,
    });
    const lines = out.split("\n");
    let idx = lines.findIndex((l) => l.trim() === "kubernetes.io/service-account.name: |2-");
    assert.ok(idx >= 0);
    for (const line of injectedLines) assert.equal(lines[++idx], "      " + line);
    assert.ok(!out.includes("\ndata:") && !out.includes("\nstringData:"));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// mergePatch / applyMergePatch (docs/plan-guided-edit.md §4.1, §7.1)
//
// "The patch contains only changed fields" is necessary but not sufficient —
// it does not catch a list sent whole with an element silently dropped. That
// is the exact failure mode these oracles guard: for each fixture below,
// applyMergePatch(live, mergePatch(live, next)) must reproduce `next`
// EXACTLY, including every field neither the patch nor the "form" touched.
// ═══════════════════════════════════════════════════════════════════════════

// ── Case 15 — small, isolated properties (the §7.1 checklist, literally) ──
{
  // No-op: deep-equal clone produces no patch, and it's `undefined`, not `{}`
  // — callers must be able to distinguish "no change" from "empty object".
  assert.equal(mergePatch({ a: 1, b: { c: 2 } }, structuredClone({ a: 1, b: { c: 2 } })), undefined);

  // Map-key removal emits the RFC 7386 null sentinel, never omission.
  assert.deepEqual(mergePatch({ a: 1, b: 2 }, { a: 1 }), { b: null });

  // The other intuitive way a form clears a field — `next.spec.foo =
  // undefined` instead of `delete next.spec.foo` — must behave IDENTICALLY:
  // JSON has no `undefined`, so treating it as "key present" would produce
  // `patch[k] = undefined`, which JSON serialization silently drops at the
  // Tauri IPC boundary, leaving the field untouched on the server with no
  // error anywhere. Both spellings must emit the null sentinel.
  assert.deepEqual(mergePatch({ a: 1 }, { a: undefined }), { a: null });
  assert.deepEqual(mergePatch({ b: 2 }, { a: undefined, b: 2 }), undefined, "a brand-new key explicitly set to undefined must contribute nothing");

  // A nested object that ends up unchanged is omitted entirely from the
  // parent patch (not emitted as `{}`) — mergePatch's own no-patch-for-equal
  // rule must apply recursively, not just at the top level.
  assert.deepEqual(mergePatch({ a: { x: 1 }, b: 2 }, { a: { x: 1 }, b: 3 }), { b: 3 });

  // Array with one changed element: the WHOLE array is emitted, and a
  // sibling element's unmodelled field ("extra") rides along untouched.
  const origArr = [{ id: 1, x: 1, extra: "keep" }, { id: 2, x: 2, extra: "also keep" }];
  const nextArr = structuredClone(origArr);
  nextArr[0].x = 99;
  const arrPatch = mergePatch({ list: origArr }, { list: nextArr });
  assert.deepEqual(arrPatch, { list: nextArr });
  assert.deepEqual((arrPatch as any).list[1], origArr[1], "untouched sibling element must be byte-identical");

  // applyMergePatch round-trip on the same fixture.
  assert.deepEqual(applyMergePatch({ list: origArr }, arrPatch), { list: nextArr });

  // A type change (object -> scalar) replaces wholesale rather than
  // attempting to recurse into a non-object.
  assert.deepEqual(mergePatch({ a: { x: 1 } }, { a: "gone" }), { a: "gone" });
}

// ── Case 16 — Deployment data-loss oracle ─────────────────────────────────
// A realistic Deployment carrying fields NO edit form models: a sidecar
// container, tolerations, affinity, a webhook-injected annotation, and
// ownerReferences. Changing one container's `image` via clone-and-mutate
// (the ONLY sanctioned way to build `next` — see docs/plan-guided-edit.md
// §1.1) must leave every one of those fields — including sibling fields on
// the SAME container that was edited — completely intact.
{
  const deploymentLive = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "web",
      namespace: "default",
      annotations: {
        "kubectl.kubernetes.io/last-applied-configuration": "{...}",
        "sidecar.istio.io/status": '{"injected":true}',
      },
      ownerReferences: [
        {
          apiVersion: "apps/v1",
          kind: "ReplicaSet",
          name: "web-abc123",
          uid: "11111111-1111-1111-1111-111111111111",
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    spec: {
      replicas: 3,
      selector: { matchLabels: { app: "web" } },
      template: {
        metadata: { labels: { app: "web" } },
        spec: {
          containers: [
            {
              name: "web",
              image: "myapp:1.0.0",
              ports: [{ containerPort: 8080 }],
              resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
              volumeMounts: [{ name: "config", mountPath: "/etc/config", readOnly: true }],
              securityContext: { readOnlyRootFilesystem: true, runAsNonRoot: true, capabilities: { drop: ["ALL"] } },
            },
            {
              name: "istio-proxy",
              image: "istio/proxyv2:1.20.0",
              ports: [{ containerPort: 15090, name: "http-envoy-prom" }],
              resources: { requests: { cpu: "10m", memory: "40Mi" } },
            },
          ],
          tolerations: [{ key: "node-role.kubernetes.io/edge", operator: "Exists", effect: "NoSchedule" }],
          affinity: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [{ matchExpressions: [{ key: "zone", operator: "In", values: ["us-east-1a"] }] }],
              },
            },
          },
          volumes: [{ name: "config", configMap: { name: "web-config" } }],
          serviceAccountName: "web-sa",
        },
      },
    },
  };

  // The ONLY sanctioned way to build `next`: clone, then touch exactly the
  // one modelled leaf a container-image field would touch.
  const deploymentNext = structuredClone(deploymentLive);
  deploymentNext.spec.template.spec.containers[0].image = "myapp:2.0.0";

  assert.equal(mergePatch(deploymentLive, structuredClone(deploymentLive)), undefined);

  const patch = mergePatch(deploymentLive, deploymentNext);
  const applied = applyMergePatch(deploymentLive, patch) as any;

  // Assert every unmodelled field individually, so a failure names the lost
  // field rather than a generic deep-equal mismatch.
  assert.deepEqual(applied.metadata.annotations, deploymentLive.metadata.annotations, "webhook-injected annotations must survive");
  assert.deepEqual(applied.metadata.ownerReferences, deploymentLive.metadata.ownerReferences, "ownerReferences must survive");
  assert.deepEqual(applied.spec.template.spec.tolerations, deploymentLive.spec.template.spec.tolerations, "tolerations must survive");
  assert.deepEqual(applied.spec.template.spec.affinity, deploymentLive.spec.template.spec.affinity, "affinity must survive");
  assert.deepEqual(applied.spec.template.spec.volumes, deploymentLive.spec.template.spec.volumes, "volumes must survive");
  assert.equal(applied.spec.template.spec.serviceAccountName, deploymentLive.spec.template.spec.serviceAccountName, "serviceAccountName must survive");
  assert.deepEqual(applied.spec.template.spec.containers[1], deploymentLive.spec.template.spec.containers[1], "the sidecar container must survive completely untouched");
  assert.deepEqual(applied.spec.template.spec.containers[0].volumeMounts, deploymentLive.spec.template.spec.containers[0].volumeMounts, "the EDITED container's volumeMounts must survive");
  assert.deepEqual(applied.spec.template.spec.containers[0].securityContext, deploymentLive.spec.template.spec.containers[0].securityContext, "the EDITED container's securityContext must survive");
  assert.deepEqual(applied.spec.template.spec.containers[0].ports, deploymentLive.spec.template.spec.containers[0].ports, "the EDITED container's ports must survive");
  assert.deepEqual(applied.spec.template.spec.containers[0].resources, deploymentLive.spec.template.spec.containers[0].resources, "the EDITED container's resources must survive");
  assert.equal(applied.spec.template.spec.containers[0].image, "myapp:2.0.0", "the actual edit must take effect");
  assert.deepEqual(applied, deploymentNext, "round-trip: applyMergePatch(orig, mergePatch(orig, next)) must equal next exactly");
}

// ── Case 17 — ConfigMap: map-shaped oracle ────────────────────────────────
{
  const cmLive = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "app-config", namespace: "default", labels: { app: "web" }, annotations: { "meta.helm.sh/release-name": "myapp" } },
    data: { "app.properties": "key=value", "log.level": "info", "feature.flag": "true" },
  };
  const cmNext = structuredClone(cmLive);
  delete (cmNext.data as any)["log.level"];
  cmNext.data["app.properties"] = "key=value2";
  (cmNext.data as any)["new.key"] = "added";

  const cmPatch = mergePatch(cmLive, cmNext) as any;
  assert.equal(cmPatch.data["log.level"], null, "removed key must emit the null sentinel, not omission");
  assert.equal(cmPatch.data["app.properties"], "key=value2");
  assert.equal(cmPatch.data["new.key"], "added");
  assert.ok(!("feature.flag" in cmPatch.data), "an untouched key must be omitted from the patch entirely");

  const cmApplied = applyMergePatch(cmLive, cmPatch) as any;
  assert.deepEqual(cmApplied, cmNext, "round-trip");
  assert.deepEqual(cmApplied.metadata.labels, cmLive.metadata.labels, "untouched sibling field must survive");
  assert.deepEqual(cmApplied.metadata.annotations, cmLive.metadata.annotations, "untouched sibling field must survive");
  assert.equal(mergePatch(cmLive, structuredClone(cmLive)), undefined);
}

// ── Case 18 — RoleBinding: list-of-objects oracle ─────────────────────────
{
  const rbLive = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: { name: "read-pods", namespace: "default", annotations: { "meta.helm.sh/release-name": "myapp" } },
    subjects: [
      { kind: "ServiceAccount", name: "sa-a", namespace: "default" },
      { kind: "User", name: "alice", apiGroup: "rbac.authorization.k8s.io" },
    ],
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "pod-reader" },
  };
  const rbNext = structuredClone(rbLive);
  rbNext.subjects.push({ kind: "ServiceAccount", name: "sa-b", namespace: "default" });

  const rbPatch = mergePatch(rbLive, rbNext) as any;
  assert.deepEqual(rbPatch.subjects, rbNext.subjects, "an array with one changed element must emit the WHOLE array");
  assert.ok(!("roleRef" in rbPatch), "roleRef is immutable and never touched by the form, so it must never appear in the patch");

  const rbApplied = applyMergePatch(rbLive, rbPatch) as any;
  assert.deepEqual(rbApplied.subjects[0], rbLive.subjects[0], "sibling subject's fields must be intact");
  assert.deepEqual(rbApplied.subjects[1], rbLive.subjects[1], "sibling subject's fields must be intact");
  assert.deepEqual(rbApplied.roleRef, rbLive.roleRef, "untouched immutable field must survive");
  assert.deepEqual(rbApplied.metadata.annotations, rbLive.metadata.annotations, "untouched sibling field must survive");
  assert.deepEqual(rbApplied, rbNext, "round-trip");
}

// ── Case 19 — Secret: the read/write asymmetry (docs/plan-guided-edit.md §3.4) ──
// Clone-and-mutate does NOT work naively for Secrets: `live.data` is
// base64, an edited/added key must land in `stringData` (cleartext — the
// server merges it into `data` before validation), and a deleted key must
// go through `data: { key: null }` — deletion cannot go through
// `stringData`. This fixture edits one key AND deletes another in the same
// patch, simulating what a correctly-written Secret edit form's
// clone-and-mutate must produce.
{
  const secretLive = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "my-secret", namespace: "default", labels: { app: "web" } },
    type: "Opaque",
    data: {
      username: btoa("alice"),
      password: btoa("hunter2"),
      config: btoa("key=value"),
    },
  };

  // A well-behaved form's transform: edit "username" -> stringData
  // (cleartext, NOT re-encoded into `data`); delete "password" -> delete
  // the `data` key directly (the generic null-sentinel path handles this,
  // no Secret-specific code needed in mergePatch); "config" untouched.
  const secretNext = structuredClone(secretLive);
  delete (secretNext.data as any).password;
  (secretNext as any).stringData = { username: "alice2" };

  const secretPatch = mergePatch(secretLive, secretNext) as any;
  assert.equal(secretPatch.data.password, null, "the deleted key must emit the null sentinel in `data`");
  assert.ok(!("username" in secretPatch.data), "an EDITED key must not be rewritten into `data` — it belongs in stringData");
  assert.ok(!("config" in secretPatch.data), "an untouched key must never appear in the patch");
  assert.deepEqual(secretPatch.stringData, { username: "alice2" }, "the edit must land in stringData, cleartext");

  // applyMergePatch is a pure RFC 7386 oracle — it has no Secret-specific
  // knowledge that `stringData` semantically merges into `data` (that
  // merge happens server-side, outside merge-patch mechanics). It only
  // proves the merge-patch MACHINERY is correct: the deletion channel and
  // the edit channel both land, independently, and nothing untouched is
  // lost.
  const secretApplied = applyMergePatch(secretLive, secretPatch) as any;
  assert.equal(secretApplied.data.password, undefined, "the deletion must take effect");
  assert.equal(secretApplied.data.config, secretLive.data.config, "the untouched key must survive byte-for-byte");
  assert.equal(secretApplied.data.username, secretLive.data.username, "data.username is untouched by this patch — the edit lives in stringData instead");
  assert.deepEqual(secretApplied.stringData, { username: "alice2" });
  assert.deepEqual(secretApplied.metadata.labels, secretLive.metadata.labels, "untouched sibling field must survive");
  assert.deepEqual(secretApplied, secretNext, "round-trip");
}

// ── Case 20 — GitOps safety: a form's patch must never touch .operation or ──
// ── the ArgoCD refresh annotation (docs/plan-guided-edit.md §6) ────────────
{
  const argoLive = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name: "my-app", namespace: "argocd", annotations: {} },
    spec: {
      source: { repoURL: "https://github.com/x/y", path: "manifests", targetRevision: "main" },
      destination: { server: "https://kubernetes.default.svc", namespace: "default" },
      syncPolicy: { automated: { prune: false, selfHeal: false } },
    },
    operation: { sync: { revision: "HEAD" } },
  };
  const argoNext = structuredClone(argoLive);
  argoNext.spec.source.targetRevision = "release-1.2";
  argoNext.spec.syncPolicy.automated.prune = true;

  const argoPatch = mergePatch(argoLive, argoNext) as any;
  assert.ok(!("operation" in argoPatch), "an edit form's patch must never touch .operation — sync is a separate write path");
  assert.ok(
    !argoPatch.metadata || !("annotations" in argoPatch.metadata),
    "an edit form's patch must never touch the argocd.argoproj.io/refresh annotation key",
  );

  const argoApplied = applyMergePatch(argoLive, argoPatch) as any;
  assert.deepEqual(argoApplied.operation, argoLive.operation, ".operation must survive untouched — merge patch merges maps by key");
  assert.deepEqual(argoApplied.metadata.annotations, argoLive.metadata.annotations, "the refresh annotation slot must survive untouched");
  assert.deepEqual(argoApplied, argoNext, "round-trip");
}

// ── Case 21 — PVC grow-only: Quantity compare must be BYTE-based ───────────
// A PVC's storage request is the one field the pvc edit form can change, and
// upstream allows growth only (ValidatePersistentVolumeClaimUpdate:
// "field can not be less than previous value"). The floor therefore has to be
// computed by decoding the Quantity, not by comparing strings — "1500" < "2"
// lexicographically, and 1Gi != 1G. Both directions are asserted because
// getting either backwards silently permits a shrink or blocks a legal grow.
{
  const bytes = (q: string) => quantityToBytes(q);

  // binary suffixes
  assert.equal(bytes("1Ki"), 1024);
  assert.equal(bytes("1Mi"), 1024 ** 2);
  assert.equal(bytes("1Gi"), 1024 ** 3);
  assert.equal(bytes("1.5Gi"), 1.5 * 1024 ** 3);
  // decimal suffixes are NOT the same magnitude as binary ones
  assert.equal(bytes("1G"), 1e9);
  assert.ok(bytes("1Gi")! > bytes("1G")!, "1Gi must exceed 1G");
  // bare byte count
  assert.equal(bytes("10"), 10);

  // the lexicographic trap: "1500Mi" -> "2Gi" is a GROW even though "1500" > "2"
  assert.ok(bytes("2Gi")! > bytes("1500Mi")!, "2Gi > 1500Mi (grow must be allowed)");
  // and the reverse is a SHRINK that must be caught
  assert.ok(bytes("1500Mi")! < bytes("2Gi")!, "1500Mi < 2Gi (shrink must be blocked)");
  // mixed binary/decimal shrink
  assert.ok(bytes("1G")! < bytes("1Gi")!, "1Gi -> 1G is a shrink");

  // unparseable inputs return null. Callers use `?? 0`, i.e. no floor — this
  // fails OPEN so the API server rejects with a clear message rather than the
  // client blocking a legal grow on a value it couldn't read.
  assert.equal(bytes("1e9"), null, "exponent form is not parsed (documented ceiling)");
  assert.equal(bytes("10 Gi"), null, "internal space is not a legal Quantity");
  assert.equal(bytes(""), null);

  // splitQuantity only seeds the picker for binary suffixes; anything else
  // starts blank rather than silently coercing a unit.
  assert.deepEqual(splitQuantity("10Gi"), { amount: "10", unit: "Gi" });
  assert.deepEqual(splitQuantity("1G"), { amount: "", unit: "Gi" }, "decimal suffix must not seed as binary");
  assert.deepEqual(splitQuantity("512"), { amount: "", unit: "Gi" });
  // the picker's own math must agree with the parser
  assert.equal(10 * unitMultiplier("Gi"), quantityToBytes("10Gi"));
}

// ── Case 22 — Service ports: whole-array replace must carry server fields ──
// RFC 7386 has no array merge, so changing one port resends spec.ports whole.
// The networking edit form mutates the CLONED element in place rather than
// rebuilding it, so controller-assigned fields (nodePort) and unmodelled ones
// (appProtocol) ride along. Rebuilding the element from form state is the
// data-loss bug this case exists to catch.
{
  const live = {
    apiVersion: "v1", kind: "Service",
    metadata: { name: "web", namespace: "default" },
    spec: {
      type: "NodePort",
      clusterIP: "10.3.240.11",
      ipFamilies: ["IPv4"],
      selector: { app: "web" },
      ports: [
        { name: "http", port: 80, targetPort: 8080, protocol: "TCP", nodePort: 31234, appProtocol: "http" },
        { name: "metrics", port: 9090, targetPort: 9090, protocol: "TCP", nodePort: 31999 },
      ],
    },
  };

  // edit ONLY the first port's port number, in place on the clone
  const next = structuredClone(live);
  next.spec.ports[0].port = 8081;

  const patch = mergePatch(live, next) as any;
  assert.deepEqual(Object.keys(patch), ["spec"], "only spec changed");
  assert.deepEqual(Object.keys(patch.spec), ["ports"], "only spec.ports changed");
  assert.equal(patch.spec.ports.length, 2, "merge patch resends the WHOLE array");

  const applied = applyMergePatch(live, patch) as any;
  assert.equal(applied.spec.ports[0].port, 8081, "the edit landed");
  assert.equal(applied.spec.ports[0].nodePort, 31234, "controller-assigned nodePort survived");
  assert.equal(applied.spec.ports[0].appProtocol, "http", "unmodelled appProtocol survived");
  assert.deepEqual(applied.spec.ports[1], live.spec.ports[1], "the untouched port is byte-identical");
  // clusterIP is immutable and the form renders it read-only — it must never
  // appear in a patch, otherwise a type change is rejected outright.
  assert.ok(!("clusterIP" in patch.spec), "clusterIP must never be patched");
  assert.ok(!("ipFamilies" in patch.spec), "ipFamilies must never be patched");
  assert.equal(applied.spec.clusterIP, live.spec.clusterIP);

  // removing a port drops it from the resent array without disturbing the other
  const removed = structuredClone(live);
  removed.spec.ports.splice(1, 1);
  const rPatch = mergePatch(live, removed) as any;
  const rApplied = applyMergePatch(live, rPatch) as any;
  assert.equal(rApplied.spec.ports.length, 1);
  assert.deepEqual(rApplied.spec.ports[0], live.spec.ports[0], "survivor keeps nodePort/appProtocol");
}

// ── Case 23 — Ingress: two-level nested array (rules[].http.paths[]) ───────
// The only fixture with nesting on both levels. Mutating a path's `path` must
// not disturb sibling paths, sibling rules, or unmodelled per-path fields.
{
  const live = {
    apiVersion: "networking.k8s.io/v1", kind: "Ingress",
    metadata: { name: "site", namespace: "default", annotations: { "nginx.ingress.kubernetes.io/rewrite-target": "/" } },
    spec: {
      ingressClassName: "nginx",
      tls: [{ secretName: "site-tls", hosts: ["a.example.com"] }],
      rules: [
        { host: "a.example.com", http: { paths: [
          { path: "/api", pathType: "Prefix", backend: { service: { name: "api", port: { number: 80 } } } },
          { path: "/web", pathType: "Prefix", backend: { service: { name: "web", port: { number: 80 } } } },
        ] } },
        { host: "b.example.com", http: { paths: [
          { path: "/", pathType: "Prefix", backend: { service: { name: "other", port: { number: 8080 } } } },
        ] } },
      ],
    },
  };

  const next = structuredClone(live);
  next.spec.rules[0].http.paths[0].path = "/api/v2";

  const patch = mergePatch(live, next) as any;
  assert.deepEqual(Object.keys(patch.spec), ["rules"], "tls and ingressClassName untouched");

  const applied = applyMergePatch(live, patch) as any;
  assert.equal(applied.spec.rules[0].http.paths[0].path, "/api/v2", "the edit landed");
  // The EDITED element must keep the fields the form does not model. Asserting
  // only siblings (and `applied deepEqual next`) is circular — it cannot catch a
  // `next` that was itself built lossily, which is the exact bug class here.
  assert.deepEqual(
    applied.spec.rules[0].http.paths[0].backend,
    live.spec.rules[0].http.paths[0].backend,
    "edited path kept its unmodelled backend block",
  );
  assert.equal(applied.spec.rules[0].http.paths[0].pathType, "Prefix", "edited path kept pathType");
  assert.equal(applied.spec.rules[0].host, "a.example.com", "edited rule kept its host");
  assert.deepEqual(applied.spec.rules[0].http.paths[1], live.spec.rules[0].http.paths[1], "sibling path intact");
  assert.deepEqual(applied.spec.rules[1], live.spec.rules[1], "sibling rule intact");
  assert.deepEqual(applied.spec.tls, live.spec.tls, "tls block intact");
  assert.deepEqual(applied.metadata.annotations, live.metadata.annotations, "webhook annotation intact");
  assert.deepEqual(applied, next, "round-trip");
}

// ── Case 24 — RBAC: a non-resource rule must not gain resource fields ─────
// Found during Phase B. ValidatePolicyRule makes nonResourceURLs and
// apiGroups/resources mutually exclusive, so writing apiGroups/resources onto
// every rule corrupts a pre-existing non-resource rule (e.g. a ClusterRole
// granting /healthz) into an invalid mixed rule. Because rules[] resends the
// whole array, that fires on ANY edit to the object — not just that rule.
{
  const live = {
    apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole",
    metadata: { name: "mixed" },
    rules: [
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
      { nonResourceURLs: ["/healthz", "/version"], verbs: ["get"] },
    ],
  };

  // edit the FIRST (resource) rule's verbs only
  const next = structuredClone(live);
  next.rules[0].verbs = ["get", "list", "watch"];

  const patch = mergePatch(live, next) as any;
  assert.deepEqual(Object.keys(patch), ["rules"]);
  assert.equal(patch.rules.length, 2, "whole-array resend");

  // the non-resource rule must come back through byte-identical — no
  // apiGroups/resources keys grafted on, no verbs disturbed
  assert.deepEqual(patch.rules[1], live.rules[1], "non-resource rule resent verbatim");
  assert.ok(!("apiGroups" in patch.rules[1]), "non-resource rule must not gain apiGroups");
  assert.ok(!("resources" in patch.rules[1]), "non-resource rule must not gain resources");

  const applied = applyMergePatch(live, patch) as any;
  assert.deepEqual(applied.rules[0].verbs, ["get", "list", "watch"], "the edit landed");
  assert.deepEqual(applied.rules[1], live.rules[1]);
  assert.deepEqual(applied, next, "round-trip");
}

// ── Case 25 — validateKey: ConfigMap/Secret DATA key grammar ──────────────
// IsConfigMapKey: `[-._a-zA-Z0-9]+`, max 253, plus hasChDirPrefix (not ".",
// not "..", must not start with "..").
{
  assert.equal(validateKey("key.name"), "");
  assert.equal(validateKey("KEY_NAME"), "");
  assert.equal(validateKey("key-name"), "");
  assert.notEqual(validateKey("a/b"), "", "'/' is not part of the data-key charset");
  assert.notEqual(validateKey("."), "", "'.' is a reserved chdir token");
  assert.notEqual(validateKey(".."), "", "'..' is a reserved chdir token");
  assert.notEqual(validateKey("..foo"), "", "must not start with '..'");
  assert.notEqual(validateKey("a".repeat(254)), "", "254 chars exceeds the 253 cap");
  assert.equal(validateKey("a".repeat(253)), "", "253 chars is exactly the cap");
}

// ── Case 26 — validateLabelKey: label/annotation qualified-name grammar ───
// content.IsLabelKey: optional DNS-1123-subdomain prefix (max 253) + "/",
// then a name part (max 63, must start/end alphanumeric). No reserved-prefix
// rule. Annotation keys are validated case-INSENSITIVELY (the whole key is
// lowercased first); label keys are case-sensitive.
{
  // must accept — the exact convention Bug 1 broke
  for (const k of ["app.kubernetes.io/name", "argocd.argoproj.io/tracking-id", "kubectl.kubernetes.io/last-applied-configuration"]) {
    assert.equal(validateLabelKey(k, false), "", `label: ${k}`);
    assert.equal(validateLabelKey(k, true), "", `annotation: ${k}`);
  }
  for (const k of ["MyName", "my.name", "123-abc", "a_b"]) {
    assert.equal(validateLabelKey(k, false), "", `label: ${k}`);
  }

  // must reject
  assert.notEqual(validateLabelKey("a/b/c", false), "", "more than one '/'");
  assert.notEqual(validateLabelKey("/name", false), "", "empty prefix");
  assert.notEqual(validateLabelKey("-bad", false), "", "name must not start with '-'");
  assert.notEqual(validateLabelKey("bad-", false), "", "name must not end with '-'");
  assert.notEqual(validateLabelKey(".bad", false), "", "name must not start with '.'");
  assert.notEqual(validateLabelKey("a".repeat(64), false), "", "64-char name part exceeds the 63 cap");
  assert.equal(validateLabelKey("a".repeat(63), false), "", "63-char name part is exactly the cap");
  assert.notEqual(validateLabelKey(`${"a".repeat(254)}/name`, false), "", "254-char prefix exceeds the 253 cap");
  assert.notEqual(validateLabelKey("", false), "", "empty key");

  // the case distinction — this is the assertion that proves (B) was
  // implemented: upstream lowercases the WHOLE key for the annotation check
  // only, so a mixed-case prefix is legal there but illegal for a label.
  assert.notEqual(validateLabelKey("Foo.com/bar", false), "", "label keys are case-sensitive — 'F' fails labelKeyFmt");
  assert.equal(validateLabelKey("Foo.com/bar", true), "", "annotation keys are lowercased before validation");

  // ResourceQuota `hard` genuinely needs the '/' this grammar allows.
  assert.equal(validateLabelKey("count/deployments.apps", false), "");
}

// ── Case 27 — validateQuantity: full Quantity BNF, minus the negative case ─
{
  for (const q of ["100m", "0.1", "1", "128Mi", "1Gi", "1e3", "1.5", ".5", "1.", "500M", "2k", "1Ei"]) {
    assert.equal(validateQuantity(q), "", `accept: ${q}`);
  }
  for (const q of ["100mm", "abc", "100 m", "-1", "1Ki2", "Mi"]) {
    assert.notEqual(validateQuantity(q), "", `reject: ${q}`);
  }
  assert.equal(validateQuantity(""), "", "blank means omit this key, not an error");
}

// ── Case 28 — quantity round-trip: the actual 1000x regression oracle ─────
// ResourcesField used to wire CPU/memory to NumberField (digits-only), which
// silently stripped the unit suffix — "100m" became "100" (100 WHOLE cores,
// 1000x the intended 100 millicores). This proves the suffix survives from
// field state to emitted YAML.
{
  const lines = emitResources({ cpuReq: "100m", memReq: "128Mi", cpuLim: "500m", memLim: "256Mi" }, 0);
  const out = lines.join("\n");
  assert.ok(out.includes("cpu: 100m"), "cpu request suffix must survive unquoted");
  assert.ok(out.includes("memory: 128Mi"), "memory request suffix must survive unquoted");
  assert.ok(out.includes("cpu: 500m"), "cpu limit suffix must survive unquoted");
  assert.ok(out.includes("memory: 256Mi"), "memory limit suffix must survive unquoted");

  // the pre-existing quoting rule (a bare numeric quantity is a string, not
  // a YAML int) must still hold — this bug fix must not touch it.
  const bare = emitResources({ cpuReq: "4", memReq: "", cpuLim: "", memLim: "" }, 0);
  assert.ok(bare.join("\n").includes('cpu: "4"'), 'a pure-numeric quantity is still quoted, e.g. cpu: "4"');
}

// ── Case 29 — every system-managed annotation key must pass its own validator ──
// fields.tsx's KeyValueField renders a SYSTEM_MANAGED_ANNOTATION_KEYS row
// disabled with NO delete button (Bug 1b — read-only in place). If one of
// those keys ever failed validateLabelKey, the row would be both invalid AND
// physically unfixable by the user — bug #1's failure mode reintroduced in a
// form that can never be corrected. Duplicated here rather than imported
// (the Set lives in fields.tsx, which is JSX and unimportable by this
// Node-type-stripped script) — keep this list in sync with fields.tsx's.
{
  const systemManagedAnnotationKeys = [
    "kubectl.kubernetes.io/last-applied-configuration",
    "argocd.argoproj.io/tracking-id",
    "deployment.kubernetes.io/revision",
    "meta.helm.sh/release-name",
    "meta.helm.sh/release-namespace",
  ];
  for (const k of systemManagedAnnotationKeys) {
    assert.equal(validateLabelKey(k, true), "", `system-managed annotation key must validate clean: ${k}`);
  }
}

// ── Case 30 — merge-from-file preview: arrays are never diffed element-wise ──
// docs/plan-kubeconfig-and-parity.md §3.1: a JSON merge patch replaces an
// array wholesale, so a differing `containers` array must report as
// "replaced", never "changed" (which would imply the UI thinks individual
// elements get merged — they don't).
{
  const live = {
    spec: { containers: [{ name: "app", image: "old:1" }] },
  };
  const desired = {
    spec: { containers: [{ name: "app", image: "new:2" }, { name: "sidecar", image: "envoy:1" }] },
  };
  const rows = previewRows(live, desired);
  const containersRow = rows.find((r) => r.path === "spec.containers");
  assert.ok(containersRow, "spec.containers must appear as one leaf row, not per-element rows");
  assert.equal(containersRow.state, "replaced", "a differing array must be 'replaced', never 'changed'");

  // An unchanged array is still a leaf (not recursed into) and reports
  // "unchanged" rather than "replaced" — nothing will actually change here.
  const same = previewRows(
    { spec: { containers: [{ name: "app", image: "same:1" }] } },
    { spec: { containers: [{ name: "app", image: "same:1" }] } },
  );
  assert.equal(same.find((r) => r.path === "spec.containers")?.state, "unchanged");

  // A key present in desired but entirely absent from live is "added", and
  // recurses into nested objects rather than reporting the whole subtree as
  // one opaque row — metadata.labels is a plain object, so its keys should
  // flatten individually.
  const added = previewRows({}, { metadata: { labels: { app: "x" } } });
  assert.deepEqual(
    added.find((r) => r.path === "metadata.labels.app"),
    { path: "metadata.labels.app", from: null, to: "x", state: "added" },
  );
}

// ── Case 31 — drain preview summary: disjoint buckets that sum to the total ──
// v1.2.1. The chips and the sections are built from the same lists, so the
// numbers must add up; "to evict" excludes "may be blocked" or one pod would be
// counted twice.
{
  const pod = (
    name: string,
    category: "evict" | "daemonset" | "mirror",
    extra: Partial<DrainPodPreview> = {},
  ): DrainPodPreview => ({
    namespace: "shop", name, category,
    owner_kind: "Deployment", owner_name: "api",
    unmanaged: false, has_empty_dir: false, pdbs: [], may_be_blocked: false,
    ...extra,
  });
  const preview: DrainPreview = {
    node: "worker-3", unschedulable: false, node_ready: true, pdb_lookup_errors: [],
    pods: [
      pod("a", "evict"),
      pod("b", "evict"),
      pod("c", "evict", { may_be_blocked: true, pdbs: [{ name: "checkout-pdb", disruptions_allowed: 0 }] }),
      pod("d", "evict", { unmanaged: true, owner_kind: null, owner_name: null, has_empty_dir: true }),
      pod("e", "daemonset", { owner_kind: "DaemonSet", owner_name: "agent" }),
      pod("f", "daemonset", { owner_kind: "DaemonSet", owner_name: "agent" }),
      pod("g", "mirror", { owner_kind: null, owner_name: null }),
    ],
  };
  const s = summarizePreview(preview);
  assert.deepEqual(s, { toEvict: 3, mayBeBlocked: 1, daemonset: 2, mirror: 1, unmanaged: 1, emptyDir: 1 });
  assert.equal(s.toEvict + s.mayBeBlocked + s.daemonset + s.mirror, preview.pods.length,
    "the four buckets are disjoint and must sum to the pod count");

  // An unmanaged flag on a pod that is never evicted must not demand a typed confirm.
  const skippedOnly: DrainPreview = {
    ...preview,
    pods: [pod("x", "daemonset", { unmanaged: true }), pod("y", "mirror", { unmanaged: true }), pod("z", "evict")],
  };
  assert.equal(summarizePreview(skippedOnly).unmanaged, 0);
  assert.equal(requiresTypedConfirm(skippedOnly), false);
}

// ── Case 32 — typed confirm rule (D1-1) ──
{
  const base: DrainPreview = { node: "n", unschedulable: false, node_ready: true, pdb_lookup_errors: [], pods: [] };
  assert.equal(requiresTypedConfirm(null), true, "a failed preview cannot show whether unmanaged pods exist");
  assert.equal(requiresTypedConfirm(base), false);
  assert.equal(
    requiresTypedConfirm({
      ...base,
      pods: [{
        namespace: "d", name: "p", category: "evict", owner_kind: null, owner_name: null,
        unmanaged: true, has_empty_dir: false, pdbs: [], may_be_blocked: false,
      }],
    }),
    true,
    "an unmanaged pod that will be evicted is deleted for good",
  );
}

// ── Case 33 — honest drain outcome ──
// "Node drained" (complete) only when blocked = 0, failed = 0 and the run was
// not stopped; `gone` (HTTP 404) never blocks it and is never folded into
// `evicted`.
{
  const row = (key: string, status: DrainRow["status"]): DrainRow => ({
    key, namespace: "shop", name: key, owner: null, unmanaged: false, pdbs: [], status, message: "",
  });
  const ok = [row("a", "evicted"), row("b", "evicted"), row("c", "gone")];
  assert.equal(drainOutcome({ rows: ok, stopped: false, cordonFailed: false }), "complete");
  assert.equal(drainOutcome({ rows: [], stopped: false, cordonFailed: false }), "complete", "nothing to evict");
  assert.equal(drainOutcome({ rows: ok, stopped: true, cordonFailed: false }), "stopped");
  assert.equal(drainOutcome({ rows: [...ok, row("d", "blocked")], stopped: false, cordonFailed: false }), "incomplete");
  assert.equal(drainOutcome({ rows: [...ok, row("d", "failed")], stopped: false, cordonFailed: false }), "incomplete");
  assert.equal(drainOutcome({ rows: [...ok, row("d", "waiting")], stopped: false, cordonFailed: false }), "incomplete",
    "a pod never attempted is not drained");
  assert.equal(drainOutcome({ rows: ok, stopped: false, cordonFailed: true }), "failed");
  assert.equal(drainOutcome({ rows: ok, stopped: true, cordonFailed: true }), "failed", "cordon failure outranks stop");

  const c = runCounts([...ok, row("d", "blocked"), row("e", "failed"), row("f", "evicting"), row("g", "waiting")]);
  assert.deepEqual(c, { total: 7, evicted: 2, gone: 1, forced: 0, evicting: 1, deleting: 0, waiting: 1, blocked: 1, failed: 1, done: 5 });

  // "0 evicted" is always spelled out; every other count only when non-zero;
  // `gone` is its own number.
  assert.equal(countsSentence(runCounts([row("a", "gone")]), { daemonset: 0, mirror: 0 }), "0 evicted · 1 already gone");
  assert.equal(
    countsSentence(runCounts([row("a", "evicted"), row("b", "blocked"), row("c", "failed")]), { daemonset: 4, mirror: 1 }),
    "1 evicted · 1 blocked by a PodDisruptionBudget · 1 failed · 4 DaemonSet and 1 static pods skipped",
  );

  // Row order: blocked/failed → evicting → waiting → done.
  assert.deepEqual(
    sortRows([row("d", "evicted"), row("c", "waiting"), row("b", "evicting"), row("a", "blocked")]).map((r) => r.status),
    ["blocked", "evicting", "waiting", "evicted"],
  );
}

console.log("check-emit: all assertions passed");
