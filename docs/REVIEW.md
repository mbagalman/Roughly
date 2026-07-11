# Roughly — Code review findings (2026-06-10)

Full review of `roughly/roughly.html`, `tests/engine.test.mjs`, `package.json`, and the docs.
All 35 tests pass (Node 24.11.1, file invoked directly). Items marked **[verified]** were
reproduced by running the actual shipped code extracted from the HTML, the same way the
test suite does.

---

## Resolution status (2026-06-10, same day)

All findings below have been addressed; the suite now has 49 tests, all passing.

| Finding | Resolution |
|---|---|
| B1 hash crash | Fixed — `normalizeStep` is null-safe, and the hash restore path is try/catch-guarded like the localStorage path. Regression-tested. |
| B2 broken `npm test` | Fixed — script is now `node --test tests/engine.test.mjs`; README updated. |
| B3 `"1000.0K"` | Fixed — suffix thresholds moved to 999.95×unit so rounding picks the next suffix. Regression-tested. |
| B4 misleading row notice | Fixed — new `unparseable` status with a format-hint message; "fill in all three values" now only shows for genuinely blank cells. Tested. |
| R1 no SRI / R2 Play CDN | Resolved by vendoring (user's choice): Tailwind precompiled with the standalone CLI v3.4.17 and inlined; Alpine 3.14.1 inlined. Zero runtime network requests; P4-4 closed. |
| R3 unbounded hash state | Fixed — restored state capped at 100 steps, 300-char problem, 120-char fields. Tested. (Tightened further on 2026-06-11: 25 steps, hash-length check before decoding — see [CODE_REVIEW_2026-06-11.md](CODE_REVIEW_2026-06-11.md).) |
| U1 pre-Alpine flash | Fixed — `[x-cloak]` rule + attributes on conditional blocks; help `<details>` statically `open` to match the default. |
| U2 per-keystroke MC run | Fixed — recompute debounced 150 ms behind typing (clicks flush immediately; export paths flush before reading the result); problem-title edits no longer trigger simulation. |
| U3 chatty aria-live | Mitigated by the U2 debounce — the phrase now updates after a typing pause. |
| U4 index keys | Fixed — steps carry runtime-only ids (`:key="step.id"`), stripped from persisted/shared/exported state. Tested. |
| U5 nits | Fixed — `clearAll` resets to an unnamed step; JSON filename uses the local date; markdown title escapes asterisks. `og:image` intentionally skipped. |
| D1–D4 doc drift | Fixed — README/PLAN/TICKETS updated (package.json mention, ~125 KB size, engine-scoped determinism claim, realistic perf numbers). |
| Test gaps | Closed — component-level tests added for `formatValue`, `normalizeStep`, `stepStatus`/`stepIssues`, `buildMarkdown`, the init/restore path, parser leniency pinning, and the zero-variance histogram case. |

---

## Bugs

### B1. Malformed share-link hash crashes `init()` **[verified]** — high
`roughly.html` `init()` (≈ line 745): the URL-hash restore path calls
`hashState.steps.map(s => this.normalizeStep(s))` with no try/catch. `decodeState()` accepts
any valid JSON, so a hash encoding `{"steps":[null]}` makes `normalizeStep` throw
`TypeError: Cannot read properties of null (reading 'name')` inside `init()`. The component
never reaches `recompute()`, so the app loads in a broken state from a crafted or corrupted
link. Reproduced with hash `#e=eyJwcm9ibGVtIjoieCIsInN0ZXBzIjpbbnVsbF19`.

The `localStorage` restore path immediately below has a try/catch guarding the same
operation — the hash path is the inconsistent one. Fix: wrap the hash restore in try/catch
(falling back to localStorage), and/or filter `steps` to object entries before mapping.

### B2. `npm test` is broken on current Node **[verified]** — high
`package.json` declares `"test": "node --test tests/"` with `engines: ">=20"`. On Node
24.11.1 (Windows) that exact command fails with `MODULE_NOT_FOUND: Cannot find module
'...\tests'` — the runner treats the directory argument as a literal test-file path. Both
`node --test` (auto-discovery) and `node --test tests/engine.test.mjs` work and all 35
tests pass. The README's "Running tests" section repeats the broken command. Fix: change
the script to `node --test tests/engine.test.mjs` (or bare `node --test`) and update the
README.

### B3. `formatValue` boundary rounding: "1000.0K" **[verified]** — low (cosmetic)
`roughly.html` `formatValue()` (≈ line 1094): values just under a unit boundary round up
past it — `formatValue(999950)` → `"1000.0K"` (should be `"1.0M"`), `formatValue(999999999)`
→ `"1000.0M"`. The threshold is checked against the raw value but the displayed mantissa is
rounded with `toFixed(1)`. Fix: pick the suffix after rounding, or bump to the next suffix
when the rounded mantissa reaches 1000.

### B4. Misleading "fill in all three values" notice — low
`stepStatus()` returns `'incomplete'` whenever any cell fails to parse, including a row
where **all three cells are filled** but one is gibberish (e.g. `abc / 5 / 10`). The row
then shows "Not included in the estimate — fill in all three values to add this step",
which is wrong advice — the values are filled; one is unparseable. The rose cell tint
partially compensates, but the message should distinguish "blank cell" from "unparseable
value". (Verified: `stepStatus({min:'abc',best:'5',max:'10'})` → `'incomplete'`,
`stepIssues` → `[]`.)

---

## Robustness / security

### R1. No Subresource Integrity on the two CDN scripts — medium
`roughly.html:14-15` loads pinned scripts from `cdn.tailwindcss.com` and `unpkg.com`
without `integrity`/`crossorigin` attributes. If either CDN (or the path to it) is
compromised, arbitrary JS runs in the page. The Alpine file on unpkg is immutable and
straightforward to SRI-pin. The Tailwind Play CDN response may not be byte-stable, which
is itself an argument for the already-ticketed P4-4 vendoring work.

### R2. Tailwind Play CDN is explicitly not for production — medium
`cdn.tailwindcss.com` is the JIT *Play* CDN: it compiles utility classes in the browser at
runtime, logs a "should not be used in production" console warning, and adds significant
script weight/work before first styled paint. PLAN.md treats CDN availability as the only
risk, but the production-use warning and runtime-compile cost apply even when the CDN is
up. Vendoring a precompiled stylesheet (P4-4) would resolve R1, R2, and the offline gap at
once — recommend promoting that ticket.

### R3. No bounds on hash-restored state — low
`init()` accepts whatever the hash decodes to: thousands of steps or megabyte-long strings
will be stored, re-encoded into the hash, and Monte-Carlo'd on every keystroke. Not
exploitable beyond making a tab sluggish (no XSS — all rendering uses `x-text`), but a cap
on step count / string length during `normalizeStep` would be cheap insurance.

---

## UX / accessibility

### U1. No `x-cloak` — pre-Alpine flash of broken UI — medium
Alpine loads `defer` from a CDN; until it executes, every `x-show` element renders. On a
slow connection the user briefly sees the "Estimate cleared." undo banner, *both* summary
states (the "enter values…" prompt and the empty result skeleton with its buttons), and
the help `<details>` popping from closed to open. Standard fix: add
`[x-cloak]{display:none!important}` to the inline `<style>` and `x-cloak` attributes to
the conditionally-shown blocks.

### U2. Monte Carlo + localStorage write on every keystroke — low
`save()` runs the full 10,000-trial simulation, `JSON.stringify`, and a localStorage write
per input event — measured ~30–80 ms per recompute in the test run (PLAN.md's
"sub-millisecond" claim is off by ~2 orders of magnitude). Typing in the **problem title**
also triggers it, though the title never affects the math. Tolerable on desktop, but
noticeable on low-end mobile; a ~150 ms debounce of `recompute()` (the hash update is
already debounced) and skipping recompute for title-only edits would fix it.

### U3. `aria-live` result phrase updates per keystroke — low
The result sentence (`roughly.html:165`) is `aria-live="polite" aria-atomic="true"` and
recomputes on every input event, so screen readers queue an announcement of the full
sentence repeatedly while a number is being typed. Pairing with U2's debounce would
mitigate; alternatively announce only on blur/settle.

### U4. `x-for` keyed by index — low
The steps loop uses `:key="index"` (`roughly.html:103`). With reorder/remove, keys don't
travel with rows, so Alpine patches rows in place; `x-model` keeps values correct, but
DOM-level state (focus, IME composition, scroll) can land on the wrong row. A stable
per-step id generated at creation would make moves/removals clean.

### U5. Minor inconsistencies — info
- `clearAll()` resets to a single step *named* "Step 1", while the normal empty step added
  by "Add step" is unnamed — the placeholder text and a real value look identical until
  the user has to delete the name.
- `downloadJson()` uses `toISOString().slice(0,10)` — a UTC date, so evening exports west
  of UTC get tomorrow's date in the filename.
- The problem title is wrapped in `**…**` in `buildMarkdown()`; a title containing `**`
  breaks the bold formatting (pipes/newlines are escaped, asterisks aren't).
- No `og:image`, so link previews render text-only (fine if intentional).

---

## Documentation drift

### D1. README contradicts itself about `package.json` — low
README "Tech" section (line 135): "No build step. No `package.json`. No `npm install`." —
but the repo has a `package.json` (and the README's own *Project structure* section lists
it). Leftover from before the test harness was added.

### D2. File-size claims are stale — info
The file is 64,599 bytes (~63 KB). README says "~50 KB on disk"; PLAN.md says "~30–40KB";
TICKETS.md P4-4 says "~40KB → ~120KB". Pick one number and update.

### D3. Cross-browser byte-identical determinism is overstated — low
README (lines 15, 80) and TICKETS P0-1 claim identical inputs produce identical output
"across browsers … machines … down to the last digit". Mulberry32 is exactly reproducible,
but `randNormal()` uses `Math.log`/`Math.cos`/`Math.sqrt`, whose results are
implementation-defined per ECMA-262 — engines may differ in the last ulp, and those
differences compound over 10,000 trials. Determinism holds within an engine (reloads,
tabs, share links opened in the same browser family) but is not guaranteed across V8 /
JSC / SpiderMonkey. Soften the claim or implement the transcendental functions
deterministically.

### D4. PLAN.md "sub-millisecond" performance claim — info
See U2: a 5-step estimate measures ~80 ms per 10k-trial run, not sub-millisecond.

---

## Test gaps

- **Component-level functions are untested**: `formatValue` (would have caught B3),
  `normalizeStep` (would have caught B1), `stepStatus`/`stepIssues` (B4), `buildMarkdown`,
  `markerX`, `densityPath`. They're all reachable in the existing vm harness via
  `ctx.fermiApp()` — no browser needed.
- **Parser leniency is unpinned**: `parseFermiNumber('5%%')` → `0.0005`,
  `'1/150%'` → `0.667` (percent binds to the denominator only), `'50 %'` → `0.5`. None of
  these are necessarily wrong, but the behavior is accidental rather than chosen — worth a
  test asserting whichever semantics are intended.
- **`buildHistograms`/`buildBins` edge cases** (zero-variance → `null` histograms, the
  P1/P99 trim) have no direct assertions.
- The smoke-test block duplicates the piano-tuners sample data (≈ line 574) instead of
  referencing the `samples` array — the two can drift.

---

## What's in good shape

For balance: the math core is correct (log-normal parameterization matches the documented
σ formula; ÷ as sign-flip in log-space is right; `Float64Array.sort()` is numeric; the
(10,100,20) impossible-triple class is rejected and regression-tested). State restore
normalizes types defensively (in the localStorage path), all dynamic rendering uses
`x-text` so there's no XSS through shared links, storage access is wrapped against
private-mode SecurityErrors, and the test harness's extract-and-run-the-shipped-script
approach genuinely prevents source/test drift.
