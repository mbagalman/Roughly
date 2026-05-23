# Roughly — Tickets

Tickets are grouped by priority. Each has explicit acceptance criteria. Dependencies are noted where they exist.

---

## Done (initial scaffold)

The project started as a 3-file scaffold (`fermicalc.html` + `app.js` + `styles.css`) inside a `fermi-estimator/` folder. Carried forward into the single-file build via P0-2; the scaffold files no longer exist in the repo.

- [x] Page scaffold with header, problem input, step rows, summary section, sample picker, help text
- [x] Alpine component with `problem` + `steps` state
- [x] `localStorage` persistence on input
- [x] Add / remove step actions
- [x] Sample picker with three starter estimates (note: piano-tuners sample was mathematically wrong — fixed in P1-3)
- [x] Inline "How to use" help block
- [x] Basic K/M/B output formatter

---

## P0 — Foundation
Must be done first; everything else depends on these.

### P0-1. Implement Monte Carlo math engine ✅ Done
Log-normal Monte Carlo engine landed: each step's `(lower, best, upper)` interpreted as `(P5, P50, P95)`, 10,000 trials aggregated in log-space, respects per-step `op` (`*` or `/`), reports P5/P50/P95. Result is reactive state recomputed from `save()`. Smoke-test IIFE asserts the piano-tuners sample produces a P50 in [150, 1000] and logs the actual figure on page load.

**Determinism**: RNG is a fixed-seed Mulberry32 (`MC_SEED = 0x9E3779B1`) reset at the top of every `monteCarloEstimate` call. Identical inputs produce identical output across reloads, tabs, and machines — important so shared links via P3-2 reproduce the sender's exact P5/P50/P95.

**Histogram data**: added as part of P2-1 — engine now also returns `histograms.log` and `histograms.linear` for the visualization.

### P0-2. Consolidate to a single self-contained `.html` file ✅ Done
Merged the 3-file scaffold (`fermicalc.html`, `app.js`, `styles.css`) into one file with inline `<style>` and `<script>` blocks. Tailwind pinned to `3.4.0`, Alpine pinned to `3.14.1`. README updated to reflect single-file structure. (File later renamed to `roughly/roughly.html` as part of the project rebrand to "Roughly".)

---

## P1 — Core correctness
The product is wrong without these.

### P1-1. Smart number input parser ✅ Done
`parseFermiNumber()` accepts plain numbers, scaled suffixes (K/M/B/T, case-insensitive), scientific notation, signed exponents, fractions (`1/150`), percentages (`33%`), and comma-grouped digits (`2,700,000`). Returns `null` on any failure so downstream code can distinguish incomplete from zero. Step values are now stored as the user's raw input string (e.g. `'2.7M'`) — equivalent to the `{raw, value}` shape but simpler, since the input field itself *is* the display. Engine reads via the parser. Inputs switched from `type="number"` to text, and a row with an unparseable value gets a rose-tinted border so the user sees which cell is bad. Defaults and all three samples updated to use readable input strings (`'2.7M'`, `'33%'`, etc.). Parser has 20 explicit assertion cases in the smoke-test block.

**Not done** (deferred to P1-2 / P1-4): explicit error message when a `÷` step contains zero — currently zero is treated as invalid universally (step is skipped, incomplete-count increments). The per-cell error styling is in place; the specific "zero divisor" message belongs with the operator UI in P1-2.

### P1-2. Per-step `×` / `÷` operator ✅ Done (URL-hash persistence still pending under P3-2)
Single-button toggle per row with `role="switch"` and `aria-checked` so screen readers announce the state. Click (or focus + Space/Enter) flips between `×` and `÷`. `÷` rows render with an amber pill so the operator is visible at a glance among many `×` rows. The piano-tuners sample now visibly shows `÷` on its final factor. Engine still does the log-space sign flip from P0-1.

`stepIssues()` surfaces row-level errors: a `÷` row with any zero gets the explicit message "Cannot divide by zero. Replace any 0 above with a value greater than 0." Other semantic problems (negative values, upper < lower) get their own clear messages. Per-cell rose border from P1-1 remains for unparseable input.

`localStorage` persistence works (the `op` field is part of each saved step). URL-hash persistence is intentionally deferred to P3-2 where the broader hash encoding ticket lives.

Help text under "How to use" now mentions the operator and explains the lower/best/upper as P5/P50/P95 of a log-normal range.

### P1-3. Fix the piano-tuners sample (and audit the others) ✅ Done
Piano-tuners last factor uses `op: '/'`, smoke-test asserts P50 ∈ [150, 1000]. NYC-pizza and library-books samples reviewed and confirmed correctly all-multiply. Added a fourth sample, "Hairdressers in your city" (population × haircuts/person/year ÷ haircuts/hairdresser/year), so users can see a second worked example of the `÷` operator alongside piano tuners.

### P1-4. Validation for incomplete rows ✅ Done
Decided on the "omit + notify" path. Engine skips rows that can't be parsed into a valid log-normal triple; the UI surfaces this at three levels:
1. **Cell level**: unparseable non-empty cells get a rose border (from P1-1).
2. **Row level**: a small italic "Not included in the estimate — fill in all three values to add this step." note appears under rows that have been started but aren't fully filled. Pure empty rows (right after pressing Add) don't get this nag. Rows with semantic problems (zero, negative, upper<lower, **best outside [lower, upper]**) get the explicit error messages from P1-2.
3. **Result level**: when at least one row is valid, an "X step(s) skipped due to incomplete or invalid values" notice appears beneath the bar; when zero rows are valid, the entire Summary block is replaced with "Enter lower, best, and upper values for at least one step to see an estimate."

Validation semantics: `(lower, best, upper)` is treated as (P5, P50, P95) of a log-normal, so the engine requires `0 < lower ≤ best ≤ upper`. Earlier versions only enforced `lower ≤ upper`, which silently accepted impossible triples like `(10, 100, 20)` and produced misleading log-normals (median = 100, spread derived from the lower/upper ratio that didn't actually contain the median). Fixed in `stepLogParams` + `stepStatus` + `stepIssues`, with three new smoke-test assertions guarding the regression.

All-complete state shows no warnings or notices.

---

## P2 — UX
Makes the tool genuinely usable.

### P2-1. Result distribution visualization ✅ Done
Engine returns histograms in both log-spaced and linear-spaced binning over the trimmed central 98% (P1–P99) of the Monte Carlo samples (50 bins each). The Summary section renders the active one as an inline SVG density band (viewBox 1000×100, `preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`). Three vertical markers overlay: rose-dashed P5, solid indigo P50, emerald-dashed P95. Numeric labels are absolutely-positioned beneath each marker so they track actual log/linear positions.

A small **Log / Linear** pill toggle sits above the band. Default is `log` (correct convention for Fermi work — bell shape, equal precision across orders of magnitude). Switching to `linear` reveals the underlying right-skew of the log-normal — useful when the user wants to see the tail shape. The choice is persisted in `localStorage` (`roughly-axis-mode`) and toggling does not re-run Monte Carlo (both histograms are built from the same sample set at compute time, so switching is instant).

**Depends on**: P0-1. (done)

### P2-2. Improved summary copy ✅ Done
Added a plain-language headline sentence above the three percentile cards: "Most likely around 600, with a 90% chance the true value is between 200 and 1,800." (built from a `resultPhrase` getter, using the same `formatValue` formatter as the cards). Card labels switched from terse "Lower (P5) / Best (P50) / Upper (P95)" to two-line "Low / 5th percentile", "Best guess / median", "High / 95th percentile" — clearer for non-statisticians without losing the precise term for users who want it.

### P2-3. Duplicate-step button ✅ Done
Each row has a "Duplicate" pill button alongside Remove. `duplicateStep(index)` deep-clones the source step, splices the copy in at `index + 1`, saves, then `$nextTick`s to focus + `select()` the new row's description input so the user can immediately type a new name without manually clearing the duplicated one. Grid template extended to `2fr_auto_1fr_1fr_1fr_auto_auto` for the extra column.

### P2-4. Reorder steps (drag or up/down) ✅ Done
Up/down arrow buttons (▲/▼) in a stacked vertical pair between the Upper input and the Duplicate button. `moveStep(index, direction)` splices the array; `direction` is `-1` or `+1`. Up disabled on first row, Down disabled on last row. After a move, focus is restored to the corresponding button on the moved row at its new position (looked up via `data-move-up` / `data-move-down` attributes), falling back to the opposite direction's button when the user has reached an extremity. Fully keyboard-accessible: Tab to reach, Enter/Space to activate. No drag — keeps things simple and avoids touch-screen gesture complexity.

### P2-5. Confirm before destructive clear ✅ Done
Picked the undo-affordance path (less flow-breaking than a native confirm dialog, and recoverable from fat-finger clicks). On Clear, `clearAll()` snapshots `{problem, steps}` into `clearUndoSnapshot`, kicks off a 10-second `setTimeout` that nulls the snapshot, then performs the clear. A small amber banner with an Undo button renders below the section header for the duration; clicking Undo restores the snapshot and cancels the timer. Banner has `role="status"` + `aria-live="polite"` so screen readers announce both the clear and the undo opportunity. If the user clicks Clear again within the window, the snapshot is overwritten with the current (just-cleared) state — predictable but means rapid double-clicks lose the original.

### P2-6. Inline help: what Fermi estimation is and how to read the bands ✅ Done
Replaced the 4-bullet "How to use" with a comprehensive collapsible help block built on native `<details>/<summary>` (native keyboard accessibility, no JS toggle plumbing needed). Six subsections: Quick start, What is a Fermi estimate?, Multiply (×) vs divide (÷) with the piano-tuners worked example, Reading the result (P5/P50/P95 + 90% range + log/linear band), Input formats (smart-parser cheat sheet from P1-1), and Keyboard shortcuts (using `<kbd>` styled spans for the keys). Default open on first visit; `setHelpOpen()` persists collapse/expand state to localStorage under `roughly-help-open` so the user only has to dismiss once.

### P2-7. Keyboard editing ✅ Done
- **Enter on Upper input**: if it's the last row, `addStep()` appends a new row and focuses its description; otherwise focus jumps to the next row's description. `.prevent` stops any latent form-submit behavior. Title tooltip on the Upper input hints at this.
- **Tab order**: already correct via DOM order (name → op → lower → best → upper → duplicate → remove → next row), so no markup changes needed for this bullet.
- **Ctrl/Cmd+D**: `@keydown.window` on the root x-data element calls `handleGlobalKeydown` which checks for `(ctrl||meta) + 'd'` with no `alt`/`shift`, walks up from `document.activeElement` to the nearest `[data-step-row]`, reads its index, and calls `duplicateStep`. `preventDefault()` only fires when the focused element is inside a step row, so the browser's bookmark shortcut still works elsewhere on the page. Duplicate button tooltip mentions the shortcut.
- Refactored `focusDescription(index, { select })` shared by `addStep`, `duplicateStep`, and `handleEnterOnUpper`.

---

## P3 — Share & export

### P3-1. Copy estimate as text (markdown) ✅ Done
"Copy as text" button at the bottom of the Summary section. `buildMarkdown()` produces:
- Problem statement (bolded, falls back to "Fermi estimate" if blank)
- Markdown table of all steps with `# | Step | Op | Lower | Best | Upper`, using each step's **raw input string** (`2.7M`, `33%`) rather than parsed numbers — what you typed is what pastes
- `Best guess` and `90% range` lines from the percentile result
- Footer attributing the tool

`copyMarkdown()` uses `navigator.clipboard.writeText` in secure contexts and falls back to a temporary-textarea + `document.execCommand('copy')` otherwise. Button shows ✓ Copied / Copy failed feedback for 2 seconds before reverting. `escapeMarkdownCell()` escapes pipes and flattens newlines so a step name containing `|` doesn't break the table.

Output renders as a real table in GitHub / Notion / Linear, and is still legible as plain text (clear pipe-separator visual) when pasted into Slack or email.

### P3-2. Shareable URL hash ✅ Done
`encodeState`/`decodeState` use `TextEncoder` + URL-safe base64 (no dependency, handles UTF-8). The hash format is `#e=<encoded>`; the `e=` prefix lets us add other parameters later without parsing every fragment as estimate data. `save()` now also calls `scheduleHashUpdate()` which debounces the `history.replaceState(...)` write by 500 ms — fast enough to feel live, slow enough to avoid spamming the URL bar mid-keystroke. `init()` reads `readHashState()` first and uses it if valid (steps array present and non-empty); `localStorage` is the fallback. A "Copy share link" button next to "Copy as text" calls `updateHashNow()` synchronously before reading `location.href`, so the copied URL is always current. Typical estimate (5 steps) produces a ~500-character hash, well under the 1 KB target. Same 2-second feedback pattern (✓ Link copied / Copy failed) as P3-1, with independent state so the two buttons don't share a status.

**Not done by design**: no `hashchange` listener — pasting a new URL hash into the address bar of the *current* tab does nothing until the page reloads. Sharing URLs to *new* tabs (the actual use case) works fine, so adding a hashchange handler isn't worth the loop/debounce complexity.

### P3-3. Export to JSON download ✅ Done
"Download JSON" pill button next to the two copy buttons. `downloadJson()` builds a payload with problem, full steps array (operators + raw input strings preserved), the percentile result block (P5/P50/P95 + sample/incomplete counts, or `null` if no valid result), and an ISO `exportedAt` timestamp. Output is pretty-printed (`JSON.stringify(..., null, 2)`) and triggered via a temporary `<a download>` + `URL.createObjectURL` Blob. Filename: `fermi-<slug>-YYYY-MM-DD.json`, where `slug` lowercases the problem statement, collapses non-alphanumerics into `-`, trims, caps at 60 chars, and falls back to `estimate` if blank. Histograms are deliberately excluded — they're derived, would inflate the file, and can be regenerated deterministically from the inputs (P0-1 determinism).

---

## P4 — Polish

### P4-1. Accessibility pass ✅ Done
- **Landmark**: app wrapper is now `<main>` instead of a div.
- **Problem statement**: `<label for="fermi-problem">` programmatically associated with `<input id="fermi-problem">`.
- **Step inputs**: new `stepLabel(index, field)` helper produces dynamic aria-labels that use the step's own name when present (e.g. "Lower bound for Chicago population") and fall back to "step N" when unnamed. Applied to name, op, lower, best, upper, move-up, move-down, duplicate, remove.
- **Step row**: wrapped as `role="group"` with an aria-label like "Step 1: Chicago population", so screen-reader users can navigate by row.
- **Op switch**: aria-label now reads its current state explicitly ("Operator for Chicago population (currently multiply)"); inner `×`/`÷` glyph is `aria-hidden` so it's not double-announced.
- **Move buttons**: `▲`/`▼` glyphs wrapped in `aria-hidden` spans; buttons use the descriptive aria-label.
- **Result phrase**: paragraph now has `aria-live="polite"` + `aria-atomic="true"` so screen readers announce updates after the user pauses typing.
- **Color contrast**: card subtitles bumped from `text-slate-400` (~2.85:1, fails AA) to `text-slate-500` (~4.83:1, passes AA). All other colors already passed.
- **Band labels redundancy**: the P5/P50/P95 numeric strip beneath the SVG is now `aria-hidden="true"` since the same values are announced from the three cards above.
- **Focus order**: already correct via DOM order (verified during P2-7); no markup changes needed.

Lighthouse accessibility score should comfortably clear 90 with these changes; a manual Lighthouse run is the final verification step.

### P4-2. Mobile/responsive polish ✅ Done
**Row reflow**: each row's `(op + 3 inputs)` and `(↑↓ + duplicate + remove)` are now wrapped in containers that use `md:contents`. Below the `md` breakpoint the wrappers are 4-column and 3-column grids respectively, so the row stacks into three logical strips: description (full width), op + lower/best/upper (one strip), action buttons (one strip). At `md` and up the wrappers vanish (`display: contents`) and the children become direct grid items of the outer 8-column grid — desktop layout is unchanged byte-for-byte.

**Tap targets**: bumped all small interactive elements to `min-height: 44px` on mobile via the `max-md:min-h-11` utility. Applied to: op switch, ↑/↓ arrows (also bumped padding `px-3 py-1` from desktop's `md:px-2 md:py-0.5`), Duplicate, Remove, Add step, Clear, Log/Linear axis toggle, Undo, Copy as text, Copy share link, Download JSON. Desktop keeps the original compact sizes.

**Focus styling**: added `focus:outline-none focus:ring-2 focus:ring-indigo-400` to the buttons that were missing it (Add step, Clear, sample-picker cards) so the focus ring is consistent across all interactive elements.

The 3-card percentile grid in the Summary section already stacks on mobile via `sm:grid-cols-3`, which is correct — at 390px wide there isn't room for three cards side-by-side with the 2xl-sized numbers. Sample picker already stacks via `sm:grid-cols-2`. Body padding `p-4 md:p-8` already shrinks gutters on mobile.

Manual test in mobile Safari / Chrome remains the final verification step.

### P4-3. Print stylesheet ✅ Done
Added a `@media print` block in the inline `<style>`:
- Strips body padding, card shadows, and the outer card's border-radius / max-width / box-shadow so the page uses the full sheet with `0.5cm` of paper-friendly margin inside `<main>`.
- `break-inside: avoid` (+ legacy `page-break-inside`) on step rows, section cards, and the help disclosure so a row doesn't get split across pages.
- Inputs and the op switch lose their borders/backgrounds/padding so they read as plain text on paper (the op glyph still shows as `×` / `÷`).

`print:hidden` (Tailwind variant) added to every interactive control that has no meaning on paper: Add step / Clear buttons, each row's ↑↓ / Duplicate / Remove wrapper, the Log/Linear axis toggle, Copy / Share / Download buttons, the undo banner, the Example templates picker, and the How-to help disclosure.

What remains and prints: the question being estimated, each step's description + operator + lower/best/upper values, the result phrase, the three percentile cards, and the SVG distribution band. Backgrounds of the section cards aren't printed by default (browser setting), so the layout is mostly black-on-white with section borders intact.

### P4-4. Offline-capable build (optional)
Vendor Tailwind and Alpine into the file. File grows from ~40KB to ~120KB but works with zero network. Ship only if CDN reliability becomes an issue.

### P4-5. Favicon, meta description, Open Graph tags ✅ Done
- **Favicon**: inline SVG emoji (🎯) via `data:image/svg+xml,...` — keeps the file single-file with no external asset, scales crisply at any size, no separate `.ico` download.
- **Meta description**: one-line summary covering what the tool does, the Monte Carlo backing, and the no-backend / no-tracking positioning. Used for search snippets and bookmark previews.
- **Theme color**: indigo-600 (`#4F46E5`) so mobile browser chrome tints to match the UI's accent.
- **Open Graph**: `og:title`, `og:description`, `og:type=website` for nice link previews when pasted into Slack / Discord / iMessage / LinkedIn.
- **Twitter card**: `twitter:card=summary` for X/Twitter previews.

---

## Deferred / explicit non-goals
Documented here so we don't relitigate later. See [PLAN.md](PLAN.md#non-goals-out) for the full list.

- Saved-estimate library
- Account system, login, sync
- Analytics / telemetry
- Server-side short-links
- Custom distributions beyond log-normal
- CSV / Excel import
