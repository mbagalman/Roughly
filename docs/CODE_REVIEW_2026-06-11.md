# Uncommitted changes code review (2026-06-11)

Scope: all current tracked and untracked changes in the working tree.

## Findings

### P1 - Oversized hashes are decoded before any size limit is applied

`roughly/roughly.html:408-415` decodes the complete base64 payload, allocates a byte
array, converts it to UTF-8, and parses the full JSON document. The new limits are only
applied later in `init()` (`roughly/roughly.html:799-800`), after that work has already
happened. Consequently, a crafted or corrupt share URL can still make page startup
allocate and parse an arbitrarily large payload, despite the comment that restored state
cannot cause unbounded allocation.

Add a maximum encoded-token length in `readHashState()` before calling `decodeState()`.
The normal links are small, so a conservative limit can reject pathological input well
before `atob()` and `JSON.parse()`.

### P1 - The 100-step restore cap still permits a long main-thread stall

`MAX_STEPS` is 100 (`roughly/roughly.html:432`), and `init()` immediately performs the
10,000-trial simulation synchronously (`roughly/roughly.html:825`). That permits
1,000,000 step-trial calculations during page startup. The new cap regression test took
about 1.63 seconds in the bundled Node runtime; a slower mobile browser may be blocked for
substantially longer by a shared link.

Use a product-realistic cap, likely 20-25 steps, or move unusually large simulations off
the startup path. The test should also assert a specific maximum rather than only
`steps.length <= 100`.

### P2 - The vendored page assembly is not exercised by the automated tests

`tests/engine.test.mjs:24-30` deliberately extracts only the application script. It never
parses or executes the newly vendored Alpine bundle, and it does not verify that Alpine
starts, removes `x-cloak`, binds the component, or renders the precompiled Tailwind
classes. The `?test` smoke block also runs before Alpine initialization and only checks
the parser/math engine. A script-ordering, truncation, or generated-CSS regression can
therefore leave the shipped page unusable while all 49 tests remain green.

Add one assembled-page browser smoke test that loads the HTML without network access and
checks that the initial result and controls render. A smaller static test can additionally
assert that there are no external script/stylesheet URLs and that the Alpine bundle
follows the application script.

### P3 - Step-description edits still schedule a Monte Carlo run

The problem title correctly uses `saveMeta()`, but the step-description input still calls
`save()` (`roughly/roughly.html:109`). Changing a description cannot affect the estimate,
yet it schedules the same 10,000-trial recomputation as a numeric edit. Reordering steps
also schedules a recompute through `save()` even though multiplication/division order does
not change the result.

Use the metadata-only persistence/hash path for description edits and row reordering.
This preserves the debounce improvement while avoiding unnecessary main-thread work.

## Verification

- `git diff --check`: passed.
- `node --test tests/engine.test.mjs`: 49 passed, 0 failed.
- `npm test` could not be invoked because `npm` is not available on this shell's `PATH`;
  the same test file was run directly with the bundled Node executable.
- A browser smoke test could not be completed because this environment blocked both
  `file://` and loopback navigation. This is a verification gap, not a reproduced project
  failure.

---

## Resolution (2026-06-11)

All four findings were addressed; the suite is now 54 tests, all passing.

### P1 — oversized hash decoded before limits: **fixed as suggested**
`readHashState()` now rejects encoded tokens longer than `MAX_HASH_LENGTH` (80,000 chars)
before any base64 or JSON work. The limit is sized from the largest state the app itself
can produce (25 steps × 4 fields × 120 chars plus encoding overhead, with multi-byte
headroom), so no legitimate self-produced link can be rejected. Regression test added
(90,000-char token falls back to defaults).

### P1 — 100-step restore cap: **fixed as suggested**
`MAX_STEPS` lowered to 25 (PLAN.md envisions ~10-step chains; 25 is generous). To keep the
app self-consistent — a state the UI can build must always survive a reload — the same
limit is now enforced at creation time: `addStep()`/`duplicateStep()` no-op at the cap and
the corresponding buttons disable with a "Limit of 25 steps reached" tooltip. The field
caps got matching `maxlength` attributes (120 on step inputs, 300 on the problem title),
so the restore truncation can never eat user-typed content either. The cap test now
asserts `=== 25` exactly, and a new test covers the creation-side guard.

### P2 — assembled page untested: **fixed (static checks) + verification gap closed**
Three static assembly tests added to the suite: (1) no external `<script src>` /
stylesheet `<link>` anywhere in the file, (2) exactly two inline scripts with the app
script before the Alpine bundle (which must contain its `window.Alpine` +
`queueMicrotask` self-start), (3) the precompiled Tailwind block contains the page's
tricky class variants (`max-md:min-h-11`, the arbitrary grid template, `print:hidden`,
`md:contents`, `disabled:opacity-30`) and the `[x-cloak]` rule.

The in-browser smoke test was also run successfully this time: headless Chrome
(`--headless=new --dump-dom` via cmd-shell redirection, which is what the earlier attempts
were missing — Chrome on Windows is a GUI-subsystem binary, so its stdout doesn't attach
to a PowerShell pipeline) rendered the file from `file://` with no network. Verified in
the dumped DOM: Alpine started (all `x-cloak` attributes removed), the default estimate
computed and rendered ("Most likely around 14.7K…"), step rows, percentile cards, the SVG
density path, and the sample buttons all present. This remains a manual check rather than
part of `npm test`, keeping the suite zero-dependency.

### P3 — description edits schedule MC runs: **fixed for descriptions, declined for reorder**
- Step-description inputs now use `saveMeta()` (persist + hash refresh, no simulation),
  same as the problem title. Step names are never read by `stepLogParams`, so this is safe.
- Row **reordering intentionally keeps the recompute**: the engine pairs each step with a
  fixed position in the per-trial random-draw sequence, so permuting steps re-pairs draws
  with different σ values and shifts the empirical percentiles slightly. The distribution
  is mathematically identical, but the displayed numbers are not — if reorder skipped the
  recompute, the display would no longer match what a reload or shared link of the same
  state produces, breaking the determinism contract. A comment in `moveStep()` now
  records this rationale.
