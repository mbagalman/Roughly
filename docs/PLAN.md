# Roughly — Plan

## Goal
Build the best possible Fermi estimation tool that lives as a single static page on an existing website. The user should be able to drop one file into their host's folder, link to it, and have a tool that handles real Fermi problems correctly — including the kind that involve division, span many orders of magnitude, and require honest uncertainty bands.

## Hard constraints
These are non-negotiable; they shape every other decision below.

- **Static only.** No backend, no database, no server-side execution (no Python, no Node, no PHP).
- **Drop-in deployment.** A single file copied into a folder must "just work" when linked from the host site's navigation. No build step, no install, no relative-path surprises.
- **No accounts, no analytics, no tracking.**
- **Browser-only persistence.** State lives in `localStorage` and (optionally) the URL hash.

## Math methodology
The product is only as good as the math. We use **log-normal Monte Carlo**:

- Each step has a lower / best / upper value, interpreted as the 5th percentile / median / 95th percentile of a log-normal distribution.
- On every input change, sample ~10,000 trials in log-space and aggregate (multiply, divide per the step's operator) across trials.
- Report **P5 / P50 / P95** of the resulting distribution as lower / best / upper.
- Render a small histogram or density band of the full result distribution.

Why not the naive `min*min*min` worst-case? Because with N steps the odds of every factor hitting its floor simultaneously approach zero, so the bound is uselessly wide and dishonest. Log-normal sampling is the standard practice for compounded uncertain quantities and matches how Fermi problems behave in real life. It is also cheap (10k samples × ~10 steps is sub-millisecond in the browser).

## Operator support
Each step has a `×` or `÷` operator. This is required to model canonical Fermi problems correctly (piano tuners, ambulance demand, etc., all involve dividing by a per-unit rate). Multiplication is the default.

## Input format
Inputs accept any of:
- Plain numbers: `2700000`
- Scaled: `2.7M`, `300K`, `1.2B`
- Scientific: `1e6`, `2.7e6`
- Fractions: `1/150`

A single parser normalizes these to a numeric value. The display preserves the user's original input style for editability.

## Architecture
- **Single file**: `roughly/roughly.html` contains markup, inline `<style>`, and inline `<script>`. No external `app.js`, `styles.css`, or `examples.json`.
- **Dependencies**: Tailwind via CDN (`cdn.tailwindcss.com`) and Alpine.js via CDN, both pinned to specific versions (no floating `3.x.x`).
- **Samples**: inlined into the script section as a JS array.
- **State**: a single Alpine component holds `problem`, `steps`, and computed results; persists to `localStorage` on change.

Trade-off acknowledged: the single-file approach makes the file larger (~30–40KB) and slightly less ergonomic to edit, but eliminates the entire class of "did I copy all the files / are the relative paths right" deployment bugs. For a tool whose primary value prop is *drop in and go*, that trade is correct.

## Feature scope (in)
1. Smart number parser and formatter
2. Per-step `×` / `÷` operator
3. Log-normal Monte Carlo engine with P5 / P50 / P95 reporting
4. Result distribution visualization (band + percentile markers)
5. Add / remove / duplicate / reorder steps
6. Curated example templates (piano tuners, NYC pizza, etc.) — all verified mathematically correct
7. localStorage persistence of active estimate
8. Copy-as-text export (markdown table)
9. Shareable URL hash encoding the full estimate
10. Help / explainer section covering what Fermi estimation is, what `×`/`÷` mean, and how to read the percentile bands
11. Keyboard-friendly editing (Enter to add row, etc.)
12. Mobile-responsive layout
13. Accessibility pass (label associations, focus order, contrast, ARIA on summary)

## Non-goals (out)
Explicitly out of scope, to prevent creep:
- Saved-estimate library / multi-document workspace (one active estimate only)
- Server-side sharing or short-links
- Account system, login, sync across devices
- Analytics / telemetry
- Native social-share buttons (URL hash is the share mechanism)
- Sensitivity analysis dashboards beyond the result histogram
- CSV/Excel import
- Custom probability distributions beyond log-normal

## Success criteria
- One `.html` file deployed to a static host works end-to-end.
- The piano-tuners sample produces an answer in the right order of magnitude (~150–1000 tuners) — a regression test for the math and operator support.
- A user with no Fermi background can land on the page, load a sample, understand what the percentiles mean from the inline help, and adjust the numbers without reading documentation.
- A shared URL hash reproduces the sender's estimate exactly on the recipient's machine.
- Lighthouse accessibility score ≥ 90.

## Risks and open items
- **CDN availability**: Tailwind/Alpine CDNs failing breaks the page. If this becomes a concern in practice, we can vendor both into the file as a follow-up (turning a 40KB file into a ~120KB file). Tracked as a P4 ticket, not done by default.
- **Tailwind CDN script size on slow connections**: acceptable for now; revisit only if the host site has performance budgets.
- **Host-site CSS collisions**: Tailwind's reset may interact with the host site's styles. The page is self-contained inside a `max-w-3xl` card, but if collisions appear, we'll scope styles or move to a shadow DOM wrapper.
