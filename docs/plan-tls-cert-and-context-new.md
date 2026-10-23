# Implementation Plan — TLS Certificate Detail + Context-Aware `+New`

Status: PLAN ONLY. No code written. Two features, dispatchable in parallel.

Baseline: `main` @ `3402953` (v0.9.3) with ~1,230 uncommitted insertions across 16 files from the
ArgoCD parity work. Both agents will edit files that already carry uncommitted changes
(`ResourceViews.tsx` +457, `ResourceDetailPanel.tsx` +164, `useResources.ts` +110, `k8s.ts` +46).
That is expected. **Neither agent may `git stash`, `git checkout --`, or revert anything.**

---

## 0. Decisions made up front (do not relitigate)

| # | Decision | Reason |
|---|---|---|
| D1 | Feature 1 is a **new lazy command + new detail tab**, not a new resource type. The 9-step resource checklist does **not** apply — no `ResourceType` entry, no `SelectedResource` arm, no `get_resource_yaml`/`apply_resource_yaml` match arms, no Sidebar nav, no `App.tsx` route. | A TLS cert is a *view onto an existing Secret*, not a listable kind. |
| D2 | The cert command **fetches the Secret from the cluster itself**; it does not accept PEM from the frontend. | Keeps the `context`-first convention, and leaves the door open to later remove `data` from `list_secrets` without breaking this tab. |
| D3 | Crate: **`x509-parser = "0.18"`** + **`sha2 = "0.10"`**. | `rustls-webpki` (already in the lock) can only *validate* a chain — it exposes no API to enumerate issuer/subject/serial/SAN for display. `rustls-pki-types 1.14.1` (in the lock) is type wrappers only. `x509-parser` is pure-Rust, nom-based, oss-fuzzed, and covers every requested field. Latest is **0.18.1**, MSRV **1.67.1** — comfortably under our `rust-version = "1.77.2"`. `sha2 0.10.9` is **already in `Cargo.lock`** transitively, so declaring it costs zero new compilation. |
| D4 | Feature 2: **YAML template for every creatable kind** (pure data) + **guided form for `cm` and `sec` only**. | See §4 scoping call. |
| D5 | **No schema-driven form engine.** | See §4. |
| D6 | Form → YAML is **one-way**. YAML → Form is blocked once the YAML is edited. | **Rationale corrected by research — see §0.1.** Cost, not safety: bidirectional needs a frontend YAML *parser*, i.e. a new dep (D8). |
| D7 | The Secret form emits **`stringData:`**, not base64 `data:`. | The API server does the encoding. Avoids `btoa()` (which throws on non-Latin1) and makes ConfigMap and Secret forms the *same* component with a different key name. |
| D8 | No new frontend dependency. Form values are emitted as YAML **block scalars** (`\|-`). | A block scalar is literal — it needs no quoting or escaping for any content. This is not a corner cut; it is the correct emitter for a fixed skeleton + a string→string map. |
| D9 | Naming: `TlsCertInfo` / `get_tls_certificate_info` / tab label **"TLS"**. | `Certificate`, `cert`, and the label "Certificate" are **already taken** by the cert-manager CRD (`k8s.ts:` `interface Certificate`, `ResourceType` `"cert"`, `SelectedResource` `{ kind: "cert" }`, `certmanager.rs`). Colliding here would break both agents and confuse the UI. |

### Pre-existing exposure — noted, out of scope

`list_secrets` (`config_storage.rs:57`) already returns `data: HashMap<String, String>` — the base64
value of **every key of every Secret**, including `tls.key`. `SecretRowControlled` in
`ResourceDetailPanel.tsx` already decodes and copies it behind a reveal toggle. So the private key is
at the frontend **today**.

This plan does not create that exposure and **must not widen it**. If the user wants it closed, that
is a separate change (drop `data` from `list_secrets`, add a per-key `get_secret_value` command) —
D2 was chosen specifically so that change would not break the TLS tab. Out of scope here.

### 0.1 D6, honestly restated

My original reason — *"round-tripping is where every other tool loses data"* — is **half wrong**, and
the research says so. Rancher loses data (one-way, with a red *"You will lose any changes made to the
YAML"* modal). **Headlamp does not**, and its whole mechanism is one guard:
`if (parsed !== null) setFormResource(parsed)` — invalid YAML is skipped, so half-typed text never
clobbers form state.

The real reason to stay one-way is therefore **cost, not safety**: parsing YAML back into form state
needs a frontend YAML *parser*, and block scalars cannot be hand-rolled. That means adding `js-yaml` +
`@types/js-yaml` to a manifest with 6 runtime dependencies (D8), for a flow — edit the YAML, then go
*back* to the form — that is rare on a resource whose form is name + namespace + key/value pairs.

**Holding D6 on those grounds**, with the upgrade path stated so it is a one-step change rather than a
redesign: add `js-yaml`, replace the `yamlDirty` guard with Headlamp's `if (parsed !== null)`, drop the
disabled-button state. **Flagged rather than buried** — if you would rather pay one dependency for a
genuinely better toggle, say so and it goes into Phase 2 at roughly 15 lines.

---

## 1. FROZEN IPC CONTRACTS

Both agents build against this section. It does not change without a new message from the lead.

### 1.1 Feature 1 — Rust struct

New file `src-tauri/src/commands/tls_cert.rs`:

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct TlsCertInfo {
    /// Which Secret key this block came from: "tls.crt" or "ca.crt".
    pub source_key: String,
    /// 0-based position of this PEM block within source_key.
    pub index: usize,
    /// "" when the block parsed cleanly. Non-empty means EVERY other field is a
    /// type default and the UI must render this entry as a parse failure.
    pub parse_error: String,

    pub subject: String,            // full RDN, e.g. "CN=example.com, O=Acme, C=US"
    pub subject_cn: String,         // "" if absent
    pub issuer: String,
    pub issuer_cn: String,
    pub serial: String,             // uppercase hex, colon-separated
    pub not_before: String,         // RFC3339
    pub not_after: String,          // RFC3339
    pub dns_names: Vec<String>,     // bare hostnames from SAN dNSName
    pub other_sans: Vec<String>,    // prefixed: "IP:10.0.0.1", "EMAIL:a@b.c", "URI:..."
                                    // IPs MUST be dotted-quad / RFC5952 - NEVER hex (R13)
    pub signature_algorithm: String,
    pub key_algorithm: String,      // "RSA" | "EC" | "Ed25519" | "DSA" | "unknown"
    pub key_size_bits: Option<u32>, // None where the algorithm has no meaningful size
    pub sha256_fingerprint: String, // uppercase hex, colon-separated, over the DER bytes
    pub is_ca: bool,                // BasicConstraints CA:TRUE
    pub self_signed: bool,          // issuer RDN == subject RDN
}
```

**Deliberately absent** (cut list §7): `key_usage`, `ext_key_usage`, `version`, raw PEM/DER,
anything derived from `tls.key`.

**Also deliberately absent — `days_until_expiry` and `expired`.** `relativeFromIso()` already exists
at `ResourceViews.tsx:46` returning `{ label: "in 3 days", deltaMs }` — the project's existing
convention for exactly this, already used by `certColumns`. Deriving in the frontend keeps the
countdown **live** rather than frozen at fetch time, drops two mirrored fields, and forces the new tab
and the existing cert-manager column to share one threshold rule. See §5.0.

### 1.2 Feature 1 — Tauri command

```rust
#[tauri::command]
pub async fn get_tls_certificate_info(
    context: String,
    namespace: String,
    name: String,
) -> Result<Vec<TlsCertInfo>, String>
```

**Behaviour contract — this is the part `cargo check` and `tsc` cannot verify:**

| Situation | Result |
|---|---|
| Secret not found / RBAC denied | `Err(format!("Failed to fetch secret: {}", e))` |
| Neither `tls.crt` nor `ca.crt` key present | `Err("Secret has no tls.crt or ca.crt key".into())` |
| `tls.crt` present but contains **zero** `CERTIFICATE` PEM blocks | `Ok(vec![])` — means *unambiguously* "no certificate blocks". The UI renders this as an explicit message, **never** as a blank panel. |
| N PEM blocks, some unparseable | `Ok(vec)` of length **N**. Unparseable blocks appear with `parse_error` set. |
| `ca.crt` also present | Its blocks are appended, `source_key: "ca.crt"`, `index` restarting at 0. |

**Invariant: `result.len() == number of PEM CERTIFICATE blocks found.` Never silently drop a block.**
Dropping unparseable blocks would reproduce exactly the silently-empty-table failure this project
was bitten by earlier this session with `Ok(vec![])` on 404.

Order: `tls.crt` blocks in file order (leaf first by convention), then `ca.crt` blocks. Do not sort
or attempt to reorder into a validated chain — the leaf/intermediate labelling is the frontend's job
and is presentational.

### 1.3 Feature 1 — TypeScript mirror

Append to `src/types/k8s.ts`. **Mirroring rule: a concrete Rust type mirrors as required; only a
genuine `Option<T>` mirrors as optional.** Exactly one field is optional here.

```ts
export interface TlsCertInfo {
  source_key: string;
  index: number;
  parse_error: string;
  subject: string;
  subject_cn: string;
  issuer: string;
  issuer_cn: string;
  serial: string;
  not_before: string;
  not_after: string;
  dns_names: string[];
  other_sans: string[];
  signature_algorithm: string;
  key_algorithm: string;
  key_size_bits?: number | null;
  sha256_fingerprint: string;
  is_ca: boolean;
  self_signed: boolean;
}
```

No `SelectedResource` arm, no `ResourceType` entry (D1).

### 1.4 Feature 1 — React Query hook

Append to `src/hooks/useResources.ts`:

```ts
export function useTlsCertificateInfo(
  context: string, namespace: string, name: string, enabled: boolean,
) {
  return useQuery<TlsCertInfo[], Error>({
    queryKey: ["tls-cert-info", context, namespace, name],
    queryFn: () => invoke<TlsCertInfo[]>("get_tls_certificate_info", { context, namespace, name }),
    enabled: enabled && !!context && !!namespace && !!name,
    staleTime: 60_000,
    retry: false,
  });
}
```

One-shot lazy fetch on tab open → `retry: false`, `staleTime`, no `refetchInterval`. Same shape as
`useResourceYaml` / `useHelmValues` (`ResourceDetailPanel.tsx:2372,2375`).

### 1.5 Feature 2 — no IPC change

`create_resource_from_yaml` (`resource_create.rs:18`) is already generic and its signature is
unchanged. The only backend work is the `kind_to_plural` consolidation in §3.2, which is a
correctness prerequisite for the templates, not a contract change.

---

## 2. Competitive research — findings

Complete. Source-level, not doc-level, for every open-source claim. Three findings changed the design;
they are marked **CHANGED**. Gaps are stated, not filled.

**The feature is a differentiator, not table stakes.** Of the inspectable tools only three parse X.509
at all: Aptakube, Rancher Dashboard, and a third-party Lens *extension*. Lens core, Headlamp, k9s and
Octant base64-decode and hand you raw PEM. k9s **declined it outright** — issue #3092 closed
`not_planned`. Headlamp is dependency-confirmed clean (no `pkijs`/`node-forge`/`jsrsasign`).

**CHANGED — F1a. A 30-day absolute threshold is wrong, and we already ship a conflicting one.**
Let's Encrypt 6-day certs are generally available; a 6-day cert is never more than ~6.7 days from
expiry, so a 30-day rule paints it permanently red. cert-manager's own model is proportional
(renew at 2/3 of duration, `spec.renewBeforePercentage`). CA/B ballot SC-081v3 drops the industry max
to 47 days by 2029. **And Watchtower already has `SEVEN_DAYS_MS` at `ResourceViews.tsx:1930` used at
`:1963`** — a one-stage red at 7 days on the cert-manager column. Two thresholds in one app is the
real defect. → §5.0 unifies them into one function with a proportional rule.

**CHANGED — F1b. Render every PEM block *and* label its computed role.** Leaf-only is where both
shipped implementations broke: Rancher's `certs[0]` produced issue #7898 (displayed *"ISRG Root X1"*
instead of the subscriber cert on a Let's Encrypt `fullchain.pem`) and #6595 (wrong expiry on k3s's
multi-cert `k3s-serving`); `kubectl view-cert` discards `pem.Decode`'s remainder identically, in an
independent codebase. Rendering all blocks (which this plan already did) is only half the fix —
`step certificate inspect` computes a **role** per cert and that is what stops users reading the wrong
one. → §5.1 adds the role label.

**CHANGED — F1c. IP-type SANs are a known shipped bug.** Aptakube changelog 1.14.0, under Bugs Fixed:
*"The TLS Certificate view on Secrets now use human friendly formats for IPv4/IPv6 instead of Hex."*
x509-parser hands us raw bytes, so this is our bug to make too. → §3.1 step 9.

**SANs: put them at the top.** Sharpest divergence in the survey, and burying them is the majority
mistake — Rancher shows only a count (`example.com +3 more`), openssl puts them at line ~36 of 38
inside extensions, and `cmctl`'s parsed block has **no SANs at all**. Only `step --short` (merged into
the Subject block, CN first) and the Lens extension (position 2, one per line) get it right. Aptakube
shipped *without* SANs and added them a week later (1.11.3 → 1.11.4). Our card order already puts them
third; that stands. Note `certColumns` already does the `+N more` truncation — the detail view must
show the full list instead of repeating it.

**Fingerprints are unusual — keeping them anyway.** Zero GUIs show them; the Lens extension has
`.fingerprint256` available and deliberately ignores it. Only `cmctl` shows Key Usage / EKU. The user
asked for a SHA-256 fingerprint by name, so it stays — an explicit requirement outranks convention.
This does retroactively justify cutting `key_usage`/`ext_key_usage`.

**Full DN confirmed correct.** Rancher reduces both Subject and Issuer to a CN substring via
`slice(indexOf('CN=') + 3)`, so O/OU/C are never visible. openssl and the Lens extension both show the
full DN. Our contract carries both `subject` and `subject_cn` — right call, cheapest win in the survey.

**Q2 — the premise in the brief is wrong: Headlamp, not Aptakube, has the polished creation UX.**
Aptakube has **no guided form for any kind**; creation is a plain YAML modal with thin per-kind
templates, and issue #271 — *"Current version has limited support for templates when creating
resources"* — is open **filed by the maintainer**. Its Deployment template is the upstream k8s-docs
nginx manifest, byte-for-byte the same one Lens ships.

**Nobody agrees which kinds deserve forms, and the two who tried picked disjoint sets.** Lens: exactly
8, **no workloads** (quotas, secrets, namespaces, SAs, roles/bindings). Headlamp: exactly 8, **almost
all workloads** (Pod, Deployment, DaemonSet, ReplicaSet, Job, CronJob, StatefulSet, PVC). Rancher: 43
form dirs, one shared form for all seven workload kinds — and its **absent** list is more instructive
than its present one (rolebindings, resourcequota, limitrange, priorityclass, CRDs generally, Gateway
API, Flux, ArgoCD Applications — much of what Watchtower already ships). No tool forms more than a
handful. **This corroborates D4.** Two of them at 8 kinds does not argue for 30.

**F2a. Rancher proves the cost of form-reuse-across-kinds.** Issue #10171: *"The pod now has
`spec.template.spec.containers` defined instead of `spec.containers` and creation fails… There appear
to be some shenanigans going on behind-the-scenes with pod creation/editing in order to use the same
form as workloads."* The fix is now a pinned code comment. Our `KeyValueForm` shares one component
across `cm` and `sec` — safe **only** because they are genuinely the same shape (name + ns + string
map) rather than a coerced fit. Do not extend that component to a third kind on convenience.

**F2b — this contradicts my stated reason for D6.** Headlamp round-trips form↔YAML bidirectionally,
and the entire mechanism is one guard:
`const parsed = parseEditorObject(newValue); if (parsed !== null) setFormResource(parsed);`
— in-code comment: *"skips the update on invalid YAML so incomplete edits don't wipe the form state."*
Rancher chose the opposite and pays for it with a red modal reading *"You will lose any changes made to
the YAML."* So "round-tripping is where every tool loses data" was **half wrong** — see the corrected
D6 rationale in §0.1.

**F2c. Server-side dry-run is rated above forms.** Headlamp ships it (`applyFunc(..., {dryRun: true})`)
and it is the direct answer to Lens's real failure mode — issue #8019, where an invalid PVC yields only
*"Unknown error occured while creating resource"* while kubectl reports
`spec.resources[storage]: Required value`. Lens and Aptakube both validate **YAML syntax only**; no
tool surveyed does schema validation in the editor. → §3.5, optional.

**Private-key handling — Headlamp is the best of anyone**, and worth knowing given our pre-existing
exposure: `SecretField` masked by default (`type="password"`, `readOnly={!showPassword}`), eye toggle,
plus a copy button that copies the *decoded* value. Octant is strictest: its detail Data table is
`NewTableCols("Key")` — key names only, value reachable *solely* via clipboard, never rendered.

**Gaps — stated, not filled.** Aptakube's ordered cert field list is **unknown** (`/docs` and
`/features` both 404; only Algorithm and SAN confirmed present) and its expiry/threshold, fingerprint,
chain and key-masking behaviour: **no evidence found**. `kubectl view-cert`'s *printer* was never read,
only its parser — which fields it actually displays is unverified. Current closed-source Lens Desktop
is unverifiable (the OSS repo is now a retired-README stub; all Lens claims are v6.3.0-era).
Kubernetic: **no evidence either way** on cert display, and no evidence its create Preview is editable.

## 3. rust-engineer tasks

Runs fully in parallel with §5. No dependency on frontend work.

### 3.1 Feature 1 — new command

**New file: `src-tauri/src/commands/tls_cert.rs`**

1. `Cargo.toml` — add under `[dependencies]`, after `flate2 = "1"`:
   - `x509-parser = "0.18"` — 0.18.1 is current, MSRV 1.67.1, verified compatible with our
     `rust-version = "1.77.2"`. It is **not** in `Cargo.lock` today and brings a new subtree
     (`nom`, `asn1-rs`, `der-parser`, `oid-registry` and their macro crates — none currently
     present). Run `cargo tree -p x509-parser` and **report the added crate count** before
     proceeding; if it exceeds ~10 crates, stop and flag it rather than proceeding silently.
   - `sha2 = "0.10"` — `sha2 0.10.9` is already in `Cargo.lock` transitively, so declaring it adds
     no build time and no new crate.
2. Fetch: `client_for_context(&context)` (`utils.rs`), then
   `Api::<K8sSecret>::namespaced(client, &namespace).get(&name)`.
3. Read `tls.crt`, then `ca.crt`, from `secret.data`. kube-rs already strips the outer K8s base64
   layer, so `ByteString.0` is the raw PEM bytes — **do not base64-decode again**. (Same trap as the
   Helm release secret path documented in CLAUDE.md.)
4. Split PEM blocks with `x509_parser::pem::Pem::iter_from_buffer`. Count only blocks whose label is
   `CERTIFICATE`; skip other labels **without** counting them (a `PRIVATE KEY` block accidentally
   pasted into `tls.crt` is not a cert and must not appear as a parse-failure row).
5. Per block: `X509Certificate::from_der` → populate `TlsCertInfo`. On `Err`, push an entry with
   `parse_error` set and every other field `Default::default()`.
6. Fingerprint: `Sha256::digest(&pem.contents)` over the **DER** bytes, formatted uppercase
   colon-separated hex.
7. `self_signed`: compare the full issuer and subject RDN strings.
8. **No expiry arithmetic in Rust.** Emit `not_before` / `not_after` as RFC3339 and stop; the
   countdown and its colour are derived in the frontend (§5.0) so they stay live and share one
   threshold with the existing cert-manager column.
9. **IP-type SANs must be formatted, not dumped.** `x509-parser` hands you
   `GeneralName::IPAddress(&[u8])` — **raw bytes**, 4 for IPv4 and 16 for IPv6. Format as dotted-quad
   / RFC5952 (`std::net::Ipv4Addr::from` / `Ipv6Addr::from` on a length-checked array — length-check,
   do **not** index). A wrong-length slice yields `IP:<invalid>`, never a panic. Emitting the bytes
   via `{:?}` or hex is a **shipped bug in Aptakube** (changelog 1.14.0: *"now use human friendly
   formats for IPv4/IPv6 instead of Hex"*). Add a test case with a 4-byte and a 16-byte IP SAN.

**Fail-safe requirement — `panic = "abort"` is set in the release profile
(`Cargo.toml [profile.release]`), so there is NO unwind and `catch_unwind` is useless. A panic in the
parser is a hard crash of the whole app on a cert an attacker controls.**

Therefore, in the entire parse path:

- No `unwrap()`, no `expect()`, no slice indexing (`[i]`, `[a..b]`), no integer arithmetic that can
  overflow on attacker-chosen input.
- Every `x509-parser` accessor propagates. `from_der` returning `Result` is not the risk — the risk
  is **downstream**: `public_key().parsed()`, `subject_alternative_name()` (returns
  `Result<Option<_>>` — both layers must be handled), the `validity().not_after.to_datetime()`
  conversion, and RDN iteration (`.iter_common_name().next()` → `Option`, then `.as_str()` →
  `Result`).
- Non-UTF-8 RDN attribute values must degrade to a placeholder, not error the whole request.
- **`parse_error` content is itself a trust-boundary surface.** It carries only the parser's own
  error description (`e.to_string()`). It must **never** embed input bytes: no `{:?}`/`{}` on
  `pem.contents` or any slice of it, no hex dumps, no "…at offset N: <bytes>". Same rule for the
  `Err(String)` returned by the command. This is the user's explicit "never in an error message"
  requirement — a `tls.key` block accidentally sitting in `tls.crt` must not be echoed back.

**Required check (ponytail rule — non-trivial parser leaves one runnable check):** a
`#[cfg(test)] mod tests` in `tls_cert.rs` with a pure function `parse_pem_bundle(&[u8], &str) ->
Vec<TlsCertInfo>` factored out of the command so it is testable without a cluster. Assert on:

| Input | Expected |
|---|---|
| a real self-signed PEM (inline literal) | `len()==1`, `parse_error==""`, `self_signed==true`, non-empty `sha256_fingerprint`, `dns_names` populated |
| `b""` | `len()==0` |
| `b"not pem at all"` | `len()==0` |
| valid PEM header/footer, body truncated mid-DER | `len()==1`, `parse_error != ""`, no panic |
| a `-----BEGIN PRIVATE KEY-----` block | `len()==0` (skipped, not counted) |
| two concatenated certs | `len()==2`, `index` 0 and 1 |
| ~1 MiB of `A` inside a CERTIFICATE block | returns, no panic, no OOM |

`cargo test` must pass. This test is the **only** real verification of feature 1 — `cargo check`
cannot see any of it.

### 3.2 Feature 2 — `kind_to_plural` consolidation (prerequisite, not cleanup)

Every YAML template's success depends on this. There are **two** copies and both are wrong for kinds
we are about to ship templates for:

| Location | Bug | Hit by a template? |
|---|---|---|
| `resource_create.rs:7` | `y` → `ies` rule turns `Gateway` into `gatewaies` → 404 on create. This is the function `create_resource_from_yaml` **actually calls today**, so it is the live bug. | **yes** — `gw` template |
| `argocd.rs:266` | `+s` fallback turns `PriorityClass` into `priorityclasss` | **yes** — `pc` template |

Task:

1. Move the function to `src-tauri/src/commands/utils.rs` as `pub(crate) fn kind_to_plural(&str) -> String`
   (alongside `parse_cpu_millis` / `parse_mem_mib` at `utils.rs:209,215` — same precedent from v0.9.0).
2. Start from the **`argocd.rs:266` version** (explicit irregular arms + `+s` fallback). Do **not**
   carry over the `resource_create.rs` `y`→`ies` rule — it is the Gateway bug.
3. Add the missing arm. **Cross-check already done by the lead** — every `kind:` in the §5.2
   template set was run against the `argocd.rs:266` algorithm. Result: exactly **one** kind is
   wrong, and it needs exactly one new arm:

   ```
   "PriorityClass" => "priorityclasses"    // fallback gives "priorityclasss"
   ```

   All 29 others resolve correctly (`Gateway` → `gateways` and `HTTPRoute` → `httproutes` are fine
   under the `+s` fallback — `Gateway` is only broken by the `y`→`ies` rule in
   `resource_create.rs:7`, which step 2 deletes). Do not add speculative arms for kinds we ship no
   template for. If you later add a template for a new kind, re-run this check.
4. Delete both local copies; update `resource_create.rs:61` and `argocd.rs` call sites.
5. While in there: grep for the inline `Certificate` `ApiResource` constructions at
   `pods.rs:639`, `pods.rs:781`, `pods.rs:1114` and route them through the shared helper if they
   hand-roll a plural. Do not change their behaviour otherwise.

### 3.3 Registration

`src-tauri/src/lib.rs`:
- Add `pub mod tls_cert;` to the module list (alphabetical — between `shell` and `utils`; the list is
  in `src-tauri/src/commands/mod.rs`).
- Add the `use` import next to `config_storage::{...}` (`lib.rs:97`).
- Add `get_tls_certificate_info` to `tauri::generate_handler![]` (`lib.rs:144`), under a
  `// tls certs` comment near `list_certificates` (`lib.rs:228`).

### 3.4 OPTIONAL — server-side dry-run (research F2c; ~5 lines; NOT in the original ask)

Research rates this **above forms** in value, and it directly mitigates R5 and R6 — the two risks in
this plan I rated as having no compile-time detection. Lens's real-world failure mode is issue #8019:
an invalid PVC yields *"Unknown error occured while creating resource"* while kubectl reports
`spec.resources[storage]: Required value`. Dry run makes a bad template a two-second correction instead
of a confusing rejection.

Additive contract change, frozen now so it can be dropped without touching anything else:

```rust
#[tauri::command]
pub async fn create_resource_from_yaml(
    context: String,
    yaml: String,
    dry_run: bool,          // NEW - defaults false from the frontend
) -> Result<String, String>
```

Implementation is `PostParams { dry_run, ..Default::default() }` at `resource_create.rs:84`, and
`Ok(format!("{}/{} would be created (dry run)", kind, name))` when set. Frontend: a secondary
"Dry run" button next to Apply, result shown in the same status line.

**This is an addition to what was asked for.** Cut it if you want the smaller diff — everything else in
the plan stands unchanged, since the parameter is additive and the frontend can simply always pass
`false`.

### 3.5 Verification

```bash
cd <repo>/src-tauri
cargo check
cargo test          # the tls_cert parse tests MUST pass
cargo clippy --all-targets 2>&1 | grep -iE "unwrap|expect|panic|index" || true
```

Convention gate before handing back: `async`, `Result<T, String>`, `context: String` first,
`format!("Failed to …: {}", e)`, zero `unwrap()` in the command path.

---

## 4. SCOPING CALL — Feature 2 (decided)

**Ship: per-kind YAML template for all creatable kinds + guided form for `cm` and `sec` only.**

**Reject: a generic schema-driven form engine.** Building one means fetching OpenAPI v3 schemas from
the API server, a widget registry, and handling `oneOf`/`anyOf`/`x-kubernetes-preserve-unknown-fields`
and CRD schemas that are frequently incomplete or absent. That is several hundred lines of engine
plus an ongoing maintenance tail, and it produces a **worse** experience than a good template for
~28 of 30 kinds — a generated Deployment form is a wall of 60 inputs nobody wants to fill in, when
what people actually want is a known-good manifest they can edit three lines of. This is the classic
over-build. Not doing it.

**Which kinds get a form, and why exactly these two:**

| Kind | Form? | Reason |
|---|---|---|
| `cm` ConfigMap | **yes** | name + namespace + N key/value pairs. Multi-line values in YAML mean hand-managing block-scalar indentation — genuinely miserable. A form is strictly better. |
| `sec` Secret | **yes** | same shape, and YAML additionally forces you to base64 every value by hand. The single largest form win in the app. |
| everything else | no | a form would just be a worse YAML editor. |

Note `Namespace` — the obvious third candidate — has **no resource page**, so it has no `+New`
button to be context-aware about. It is already served by the existing `create_namespace` command
from the Sidebar. Excluded, no work needed.

Because `cm` and `sec` are the same shape, they are **one** component (`KeyValueForm`) parameterised
by the data key (`data:` vs `stringData:`) and an optional `type: Opaque` line — not two components.

**Upgrade path for adding a form later:** add the `ResourceType` to the `HAS_FORM` set and add one
branch in `ResourceCreator`'s mode switch that renders the new form component. No engine, no
registry, no refactor. The template stays as the YAML-mode fallback for that kind either way. If a
kind's form is not *clearly* better than its template, it does not get one.

---

## 5. frontend-engineer tasks

Runs fully in parallel with §3. Feature 1's UI builds against §1.3/§1.4 and can be developed against
a hardcoded `TlsCertInfo[]` fixture before the Rust command exists — the interface is frozen, so
there is no wait state.

### 5.0 Shared expiry rule — new file `src/utils/expiry.ts` (do this FIRST)

Research finding F1a: a 30-day absolute threshold is wrong (Let's Encrypt 6-day certs would be
permanently red), and **we already ship a conflicting one** — `SEVEN_DAYS_MS` at
`ResourceViews.tsx:1930`, used at `:1963`. Two thresholds in one app is the actual defect, so fix it
once in a shared helper rather than adding a third.

**Move** `relativeFromIso` (`ResourceViews.tsx:46`, currently module-private) into
`src/utils/expiry.ts` and add one function beside it:

```ts
// Proportional, per cert-manager's renewal model (2/3 of duration), capped so a
// long-lived internal CA doesn't sit amber for years, floored so a 6-day
// Let's Encrypt cert still gets a warning window.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function expiryState(notAfter: string, notBefore?: string) {
  const { label, deltaMs } = relativeFromIso(notAfter);
  if (deltaMs === null) return { label, cls: "text-dim" };
  const lifetime = notBefore ? Date.parse(notAfter) - Date.parse(notBefore) : NaN;
  const threshold = Number.isFinite(lifetime) && lifetime > 0
    ? Math.min(lifetime / 3, THIRTY_DAYS_MS)
    : 7 * 24 * 60 * 60 * 1000;          // preserves today's certColumns behaviour
  return { label, cls: deltaMs < threshold ? "text-bad" : "text-dim" };
}
```

Then **repoint `certColumns` at it** (`ResourceViews.tsx:1962`–`:1963`): delete `SEVEN_DAYS_MS` and the
inline `expiringSoon` comparison, call `expiryState(c.not_after)`. The cert-manager `Certificate` type
has no `not_before`, so it takes the 7-day fallback branch — **behaviour unchanged there**, which is
why this is a safe move rather than a redesign. The TLS tab passes both dates and gets the
proportional rule.

Two states only (bad / normal), matching what `certColumns` does today. **No amber tier** — a third
state is a presentational choice nobody asked for, and Rancher's two-stage amber→red is the outlier
(the Lens extension has no pre-expiry state at all).

`relativeFromIso` is module-private today, so moving it means updating its other call sites in
`ResourceViews.tsx` to import from `../utils/expiry`. Grep first: it is used by `certColumns` and
possibly other views. **This file has +457 uncommitted lines — re-grep, do not trust line numbers.**

### 5.1 The TLS tab

**`src/types/k8s.ts`** — add `interface TlsCertInfo` exactly as §1.3. Insert near
`interface Secret` (`k8s.ts:230`). Do **not** touch `ResourceType` (`k8s.ts:474`) or
`SelectedResource` (`k8s.ts:487`).

**`src/hooks/useResources.ts`** — add `useTlsCertificateInfo` exactly as §1.4, next to `useSecrets`
(`useResources.ts:171`).

**`src/components/ResourceDetailPanel.tsx`:**

1. `Tab` union (`:1308`) — add `| "TLS"`.
2. `tabsFor()` (`:2179`) — the `sec` case becomes conditional. `tabsFor` already receives the full
   `SelectedResource`, so `resource.item.type_` is in scope; **no new prop needed**:
   ```
   if (resource.kind === "sec" && resource.item.type_ === "kubernetes.io/tls")
     return ["Overview", "TLS", "Summary", "Events", "YAML"];
   ```
   Placed second so it is the first thing after Overview — it is the reason you opened this Secret.
3. **BUG FIX, required, do not skip.** `:2363`–`:2365` is
   `useEffect(() => { if (!tabs.includes(tab)) setTab("Overview"); }, [resource.kind]);`
   (`const tabs = tabsFor(resource)` is at `:2358`, `const name = resourceName(resource)` at `:2367`,
   and `function resourceName` is a module-level declaration at `:1296` — all verified.)
   The deps are `[resource.kind]` only. Clicking from a TLS Secret to an Opaque Secret keeps
   `kind === "sec"`, so the effect never fires and the stale `"TLS"` tab stays selected on a Secret
   that has no cert — rendering an empty panel. The invariant to hold is "the selected tab must be
   in `tabs`", and the fix is to add the resource identity to the deps.

   **Do not write `[resource.kind, name]` — it will not compile.** `const name = resourceName(resource)`
   is declared *below* this effect, so referencing it in the deps array puts it in TDZ (TS2448,
   "used before its declaration"). Use one of these two, and prefer the first:

   - **Preferred:** `}, [resource.kind, resourceName(resource)]);` — `resourceName` is a hoisted
     `function` declaration, so it is callable here. Smallest diff.
   - Alternative: move the whole `useEffect` to below `const name` / `const ns`. Safe — neither is a
     hook, so hook ordering is unaffected.

   **Neither `tsc` nor `cargo check` can see the underlying bug** (only the TDZ mistake above).
4. Hook call — alongside the existing lazy tab hooks (`:2372`–`:2386`):
   ```
   const { data: tlsCerts = [], isLoading: tlsLoading, error: tlsError } =
     useTlsCertificateInfo(context, ns, name, resource.kind === "sec" && tab === "TLS");
   ```
5. Render branch next to the others (`:2499`–`:2657`): `{tab === "TLS" && ( <TlsTab … /> )}`.

**New component `TlsTab` — put it in `ResourceDetailPanel.tsx`** alongside `SecretOverview` (fewest
files; it is a detail-panel tab like every other one and has no other consumer).

States it must render — **all five explicitly, none as a blank panel**:

| State | Render |
|---|---|
| `tlsLoading` | skeleton, matching existing tabs |
| `tlsError` | `(tlsError as any)?.message ?? String(tlsError)` in `text-bad` |
| `tlsCerts.length === 0` | explicit copy: *"`tls.crt` contains no PEM certificate blocks."* — **this is the silently-empty-table trap; it must be a visible message.** |
| an entry with `parse_error !== ""` | a card showing **only** `source_key`, `index`, and the error, in `text-warn`. Do not hide it — and **branch on `parse_error` before rendering anything else**. The Rust side derives `Default`, so a failed row carries empty `not_before`/`not_after` strings; `relativeFromIso("")` returns `{ label: "—", deltaMs: null }`, so an unguarded expiry block renders a bare `—` styled as if it were a real reading. Nothing derived from the defaulted fields may appear on a failure card. |
| parsed entries | the card below |

Per-cert card layout (revise from research §2 if it contradicts):

1. **Header** — `subject_cn` (or `subject` when CN is empty), plus a **computed role badge**
   (research F1b — this is what stops users reading the wrong cert out of a chain):
   ```ts
   const role = !c.is_ca ? "TLS" : c.self_signed ? "Root CA" : "Intermediate CA";
   ```
   Derived in the frontend from two fields already in the contract — no Rust change. `step certificate
   inspect` uses a real self-signature verification here; issuer-RDN == subject-RDN is the cheap
   equivalent and differs only on a pathological self-issued-but-not-self-signed cert.
2. **Expiry, most prominent** — `expiryState(not_after, not_before)` from §5.0 gives both the label
   (`in 3 days` / `3 days ago`) and the colour. Then `not_before` → `not_after` as absolute dates.
3. **SANs** — `dns_names` as wrapped monospace chips, then `other_sans` on a secondary line.
   Empty `dns_names` renders `—`, not nothing.
4. **Issuer** — `issuer_cn`, full `issuer` on hover/second line.
5. **Crypto** — `key_algorithm` + `key_size_bits` (`key_size_bits == null` → algorithm alone),
   `signature_algorithm`, `serial`.
6. **Fingerprint** — `sha256_fingerprint`, monospace, wrapping, with a copy button (reuse the copy
   pattern from `SecretRowControlled`).

Chain: when `tlsCerts.length > 1`, first entry expanded, the rest collapsed (reuse the accordion
pattern from the DetailPanel Containers tab, not a new mechanism).

Reuse `KV`, badge, and copy helpers already in `ResourceDetailPanel.tsx`. Do not introduce new
primitives.

**Optional, only if free:** an expiry chip in `secColumns` (`ResourceViews.tsx:547`). **Do not build
it** — see cut list §7. The list command has no cert data and adding a per-row cert parse to
`list_secrets` would parse every Secret in the namespace on a 60s interval.

### 5.2 Feature 2 — context-aware `+New`

**New file `src/utils/resourceTemplates.ts`** — pure data, sits next to `resourceQueryKey.ts`:

```ts
import type { ResourceType } from "../types/k8s";

type Template = { kind: string; yaml: (ns: string) => string };

export const RESOURCE_TEMPLATE: Partial<Record<ResourceType, Template>> = { /* … */ };
export const HAS_FORM: ReadonlySet<ResourceType> = new Set(["cm", "sec"]);
```

`{ kind, yaml }` rather than a bare string so the modal title (`New ConfigMap`) needs no second
label map — `ResourceDetailPanel`'s kind-label map (`:1240` region) is not exported and must not be.

Template rules:
- Namespaced kinds interpolate `namespace: ${ns}`. **Cluster-scoped kinds
  (`pv`, `sc`, `nodes`, `crd`, `croles`, `crbindings`, `pc`) emit no `namespace:` line at all.**
- Every template must be a *realistic working manifest* — an actually-appliable example, not a stub
  with `<placeholder>` angle brackets that fails validation on apply.
- Placeholder names use a clear convention (`my-config`, `example-app`) so it is obvious what to edit.
- Every template's `kind:` must survive `kind_to_plural` (§3.2). That cross-check is **already done**
  (§3.2 step 3): with the one added `PriorityClass` arm, all 30 kinds resolve correctly. If you add a
  template for a kind not in the list below, re-run the check and tell rust-engineer.

Kinds getting a template: `pods, deploy, sts, ds, jobs, cron, hpa, pdb, svc, ing, netpol, gw,
httproute, cm, sec, pvc, pv, sc, cert, rq, lr, pc, sa, roles, croles, rbindings, crbindings,
argocd, flux-ks, flux-hr`.

No template (correctly absent from the map, so `+New` falls back to the current blank editor):
`nodes` (not user-creatable), `events` (not user-creatable), `helm` (installs are a
`helm.rs` shell-out, not a manifest apply), `argo-appsets`/`argo-projects`/`argo-repos`
(see cut list).

**`src/components/ResourceCreator.tsx` — rewrite, currently 103 lines, target ~280.** Props change
from `{ open, onClose, context }` to:

```ts
interface ResourceCreatorProps {
  open: boolean;
  onClose: () => void;
  context: string;
  resourceType: ResourceType;  // NEW — the active page
  namespace: string;           // NEW — pre-fills templates and forms
}
```

Both new props **required** — `App.tsx` always has them.

Behaviour:
- `const tpl = RESOURCE_TEMPLATE[resourceType]`.
- `mode` state: `"form"` when `HAS_FORM.has(resourceType)`, else `"yaml"`. Reset on `open`
  (extend the existing `useEffect` at `:16`).
- Header: `New ${tpl?.kind ?? "Resource"}`. Mode toggle (`Form` / `YAML`) shown only when
  `HAS_FORM.has(resourceType)`.
- YAML mode seeds the textarea from `tpl.yaml(namespace)` on open; when there is no template, keeps
  today's empty textarea + placeholder (`:70`).
- **Form → YAML:** serialise current form state into the textarea, set `mode = "yaml"`. Track
  `yamlDirty`; once the user edits the YAML, the `Form` button is **disabled** with
  `title="YAML has been edited — switch back would discard your changes"`. One-way, no round-trip
  engine (D6).
- Submit: both modes produce a YAML string and call the **unchanged**
  `invoke("create_resource_from_yaml", { context, yaml })`. Form mode serialises first, using the
  *same* serialiser the toggle uses — so there is exactly one code path and the toggle can never
  disagree with submit.
- **Invalidate on success (pre-existing bug, fold it in):** `ResourceCreator` currently invalidates
  nothing, so a created resource does not appear until the next `refetchInterval`. Add
  `useQueryClient()` and, on success,
  `qc.invalidateQueries({ queryKey: [RESOURCE_QUERY_KEY[resourceType], context] })` — 2-element
  prefix, matching the `handleRefresh` convention in `App.tsx:80`. Reuse the existing
  `RESOURCE_QUERY_KEY` from `src/utils/resourceQueryKey.ts`; do not duplicate it.
- Error display stays `(e as any)?.message ?? String(e)` (`:46`).

**`KeyValueForm` — new component, also inside `ResourceCreator.tsx`** (fewest files; it has no other
consumer). Serves both `cm` and `sec`.

- Fields: `name`, `namespace` (pre-filled from the prop), and a repeatable key/value list with
  add/remove. Values are `<textarea>` — multi-line is the whole point.
- Validate `name` as DNS-1123 (`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, ≤253) and each key as
  `^[-._a-zA-Z0-9]+$` — the same rules the API server enforces. This is a trust-boundary-adjacent
  input; validate it client-side so the user gets an inline error instead of a raw API rejection.
- Serialiser: fixed skeleton + `data:` (ConfigMap) or `stringData:` (Secret, per D7) with **every
  value emitted as a `|-` block scalar at 4-space indent**. A block scalar is literal, so no value
  can break the YAML regardless of content — colons, leading spaces, quotes, newlines, unicode
  (D8). Empty value emits `""`. Keys are pre-validated so they never need quoting.
- Secret variant adds `type: Opaque`.
- Disable Apply while validation fails.

**`src/App.tsx`:**
- `:435` — pass the two new props:
  `resourceType={activeResource}` and `namespace={namespace}`.
- No change to the ⌘N handler (`:126`) or `onCreateResource` (`:173`) — they already open the modal
  and `activeResource` is already in scope.

**`src/components/TopBar.tsx`:**
- `:177` — the `title` is hardcoded `"Create resource from YAML (⌘N)"`, which is now wrong for form
  kinds. It is more honest and simpler to make it kind-agnostic: `"Create resource (⌘N)"`.
  `TopBar` already receives `activeResource` (`TopBarProps`), so a kind-specific tooltip is possible
  — but that means importing the template map into `TopBar` for a tooltip. Not worth it; keep it
  generic.

### 5.3 Frontend verification

```bash
cd <repo>
npx tsc --noEmit
npm run build
grep -rn "DAYS_MS" src/    # must return exactly ONE definition, in src/utils/expiry.ts (R14)
```

Manual, because neither command can catch it:
1. TLS Secret → TLS tab renders. Then click a **non-TLS** Secret in the same list → tab list loses
   "TLS" and the panel shows Overview (verifies the §5.1.3 deps fix).
2. `+New` on the ConfigMap page → form mode, prefilled namespace. Toggle to YAML → the YAML matches
   the form. Edit the YAML → the Form button greys out.
3. `+New` on the Deployment page → YAML mode, template prefilled with the current namespace.
4. Apply from each of the two paths → the new row appears **immediately** (verifies invalidation).
5. `+New` on the Nodes page → falls back to the blank editor, does not crash.

---

## 6. Phasing and parallelism

| Phase | rust-engineer | frontend-engineer | Blocking? |
|---|---|---|---|
| **0** | read §0–§1 | read §0–§1 | contracts frozen; no work |
| **1** | §3.1 `tls_cert.rs` + `Cargo.toml` + tests | §5.1 types, hook, `TlsTab`, deps fix | **fully parallel** — frontend builds against the frozen §1.3 interface with a fixture |
| **2** | §3.2 `kind_to_plural` + §3.3 registration | §5.2 templates, `ResourceCreator`, `KeyValueForm` | **fully parallel** — no shared file |
| **3** | `cargo check` + `cargo test` + clippy grep | `npx tsc --noEmit` + `npm run build` | parallel |
| **4** | — | manual checks §5.3 | **only hard dependency**: needs Phase 1 Rust merged, plus a cluster with a real `kubernetes.io/tls` Secret |

Shared files: **none.** The only overlap is `src/types/k8s.ts` and `src/hooks/useResources.ts`, both
touched by frontend-engineer alone. rust-engineer owns `src-tauri/**` exclusively.

The single hard dependency in the whole plan is Phase 4 manual verification of the TLS tab.
Everything else is genuinely concurrent.

---

## 7. Cut list

| Cut | Reason |
|---|---|
| Schema-driven / OpenAPI form engine | Hundreds of lines and a maintenance tail to produce a worse UX than a template for ~28 of 30 kinds. The over-build. |
| Guided forms for anything but `cm`/`sec` | A form for a Deployment is a worse YAML editor. Upgrade path in §4. |
| `Namespace` form | No resource page, so no `+New` to be context-aware about. Already covered by `create_namespace`. |
| TLS-typed variant of the Secret form | Pasting a PEM into a form field is not better than pasting it into YAML. |
| Kind picker dropdown inside the create modal | The template follows the page you are on; to create another kind, change page. Add when someone asks. |
| Expiry column / chip on the Secret list | `list_secrets` has no cert data. Adding it means parsing every Secret in the namespace on a 60s `refetchInterval`. Detail tab only. |
| `key_usage`, `ext_key_usage`, cert `version` | Not in the ask. Add when someone debugging `serverAuth` asks. |
| Returning raw `tls.crt` PEM from the new command | The frontend already has it via `list_secrets.data` — a copy-PEM button can use that. No reason to widen the surface. |
| Chain **validation** (does the leaf chain to the CA, is the CA trusted) | Real work, needs a trust store, and answers a different question than "what is in this secret". Display only. |
| Bare-DER fallback when `tls.crt` has no PEM armor | Kubernetes requires PEM for `kubernetes.io/tls`. The explicit empty-state message covers it. |
| Templates for `argo-appsets` / `argo-projects` / `argo-repos` | Hand-writing an ApplicationSet generator or a repo Secret in a modal is not a real workflow; these are ArgoCD-console operations. |
| Form ↔ YAML two-way round-trip | **Reason corrected (§0.1):** Headlamp round-trips safely in one line, so "every tool loses data" was wrong. Cut on cost — it needs a frontend YAML parser (new dep). Upgrade path stated. |
| Amber tier on expiry (three states) | Two states match what `certColumns` ships today. Rancher's amber→red is the survey outlier; the Lens extension has no pre-expiry state at all. |
| RBAC-gated create buttons (Headlamp's `AuthVisible authVerb="create"`) | Needs a SelfSubjectAccessReview round-trip per kind. The API error on Apply already tells the user. |
| Monaco / YAML schema validation in the create modal | No tool surveyed validates against a schema in-editor — Lens and Aptakube both do YAML syntax only. Dry-run (§3.4) buys the same value for ~5 lines. |
| Real self-signature verification for the role badge | Issuer-RDN == subject-RDN is the cheap equivalent; differs only on a pathological self-issued-but-not-self-signed cert. |
| `catch_unwind` around the parser | `panic = "abort"` in the release profile makes it a no-op. Correctness in the parse path is the only defence. |

---

## 8. Risk register — what `cargo check` and `tsc` cannot catch

Ordered by likelihood × damage. The first four are the same class of bug as the `Ok(vec![])`-on-404
silently-empty tables from earlier this session.

| # | Risk | Detection / mitigation |
|---|---|---|
| **R1** | **Silently empty TLS panel.** A cert parses but every field comes back empty (unusual RDN encoding, non-UTF-8 attribute, missing SAN extension), and the UI renders a card of blanks that looks like a bug in the cluster. | Contract §1.2 forces `len() == block count`; the `TlsTab` must render `—` for every empty field, never nothing; the §3.1 test asserts non-empty fingerprint + `dns_names` on a known-good cert. |
| **R2** | **Blocks dropped instead of reported.** An implementation that `filter_map`s away parse failures produces a short array and the user never learns a cert was unreadable. | The `parse_error` field exists precisely to make this impossible; the truncated-DER test case asserts `len()==1` **with** `parse_error != ""`. Review the diff for `filter_map`/`flatten`/`ok()` in the block loop. |
| **R3** | **Panic = app crash.** `panic = "abort"` means any panic in `x509-parser` downstream accessors kills Watchtower with no recovery, on input from the cluster. | §3.1 rules (no unwrap/expect/index), the malformed + oversized test inputs, and the clippy grep. |
| **R4** | **Stale `"TLS"` tab on a non-TLS Secret.** `useEffect` deps `[resource.kind]` at `:2364` do not fire when switching between two Secrets. | §5.1.3 deps fix + manual check §5.3.1. Silent — `tsc` cannot see it. |
| **R5** | **A template is valid YAML but rejected by the API server** — a required field omitted, or a `namespace:` line on a cluster-scoped kind (or missing on a namespaced one). The plural half of this risk is **closed** (§3.2 cross-check done: one arm, `PriorityClass`). | No compile-time detection exists. Only mitigation is applying each template once against a real cluster — add that to the Phase 4 manual pass for at least `cm`, `sec`, `deploy`, `svc`, `pc` (cluster-scoped), `gw` (CRD). Residual risk accepted: the modal surfaces the API error string. |
| **R6** | **apiVersion drift on CRD-backed kinds.** A template pinned to `gateway.networking.k8s.io/v1` fails on a `v1beta1` cluster; same for Flux `v2beta2` vs `v2`, and cert-manager versions. | **Not a bug — do not cut these templates.** The modal surfaces the API error and the user edits one line. Documented here so nobody files it later. |
| **R7** | Form→YAML disagreement — the toggle shows YAML that differs from what submit sends. | Structurally prevented: one serialiser, both paths (§5.2). Verify in review that submit does not build its own object. |
| **R8** | Block-scalar indentation bug in `KeyValueForm` — a value containing a line that is *less* indented than the scalar's indicator breaks the document. | Fixed 4-space indent applied to every line of every value, uniformly. Covered by manual check §5.3.2 with a multi-line value containing a `:` and a leading space. |
| **R9** | `key_size_bits` mis-mirrored. `Option<u32>` arrives as `null`, and `if (c.key_size_bits)` treats a legitimate `0` or `null` identically. | §1.3 marks it as the **only** optional field. Render with an explicit `== null` check, not truthiness. |
| **R10** | RBAC: the user can `list` Secrets (so the row is visible) but not `get` a specific one — the TLS tab errors on a Secret that renders fine in the table. | `retry: false` + the error state in `TlsTab`. Do not swallow this into an empty state; an RBAC error must read as an error. |
| **R11** | `x509-parser` drags in a larger tree than expected. MSRV is **verified fine** (1.67.1 vs our 1.77.2), but `nom`/`asn1-rs`/`der-parser`/`oid-registry` are **not** in `Cargo.lock` today, so this is genuinely new dependency surface in a project with a deliberately lean manifest. | §3.1: run `cargo tree -p x509-parser`, report the added crate count, stop and flag if > ~10. |
| **R13** | **IP-type SANs rendered as hex or `{:?}` bytes.** x509-parser hands raw bytes; this is a *shipped* bug in Aptakube (fixed only in changelog 1.14.0). Compiles fine, looks plausible, is wrong. | §3.1 step 9 + a test case with a 4-byte and a 16-byte IP SAN. |
| **R14** | **Expiry threshold divergence.** If §5.0 is skipped and `TlsTab` gets its own threshold, the app ships three rules (7-day `certColumns`, whatever the tab picks, and the 30-day text in this plan's earlier draft). Nothing detects it. | §5.0 is ordered **first** in the frontend task list and requires deleting `SEVEN_DAYS_MS`. Review gate: `grep -rn "DAYS_MS" src/` must return exactly one definition, in `src/utils/expiry.ts`. |
| **R15** | **Moving `relativeFromIso` out of `ResourceViews.tsx` breaks an unnoticed call site.** `tsc` **does** catch this one — listed because the file carries +457 uncommitted lines, so the move is riskier than it looks. | Grep all call sites before moving; `npx tsc --noEmit` is the gate. |
| **R12** | Merge friction with the uncommitted ArgoCD work in `ResourceDetailPanel.tsx` (+164) and `ResourceViews.tsx` (+457). | Line anchors in this plan are from the **working tree**, not HEAD. Both agents must re-grep before editing rather than trusting a line number. Do not stash or revert. |
