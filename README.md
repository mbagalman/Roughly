# Roughly

> A browser-only Fermi estimation tool that does the math properly. One static HTML file plus two pinned CDN scripts. Drop into any web-connected static host, link from your site.

## What is a Fermi estimate?

A Fermi estimate breaks a hard *"how many?"* question into a chain of simpler factors you can guess at — populations, fractions, rates, frequencies — then multiplies (and sometimes divides) them to land on an order-of-magnitude answer. The canonical example, attributed to physicist Enrico Fermi himself, is *"how many piano tuners are there in Chicago?"*

Most online Fermi calculators are toys. They multiply your lower bounds together, multiply your upper bounds together, and pretend that's the range. With five factors, that produces a window so wide it's useless — it represents the joint probability that all five guesses are simultaneously at their floor (or ceiling), which is essentially zero. **This tool does the math properly.**

## Why this one

- **Real Monte Carlo aggregation.** Each step is interpreted as a log-normal distribution (lower = 5th percentile, best = 50th, upper = 95th). 10,000 trials are propagated through your multiply/divide chain to give a *legitimate* 90% interval on the answer.
- **Per-step `×` or `÷` operator.** This is essential — and most simple calculators get it wrong. In the piano-tuners problem, the last factor (*tunings per tuner per year*) must **divide**, not multiply, because `tuners × tunings/tuner = total tunings`, not the other way around. One click flips the operator on any row.
- **Deterministic.** A fixed-seed PRNG means identical inputs always produce identical output — across browsers, reloads, machines. Share a link, your colleague sees the *exact* same numbers down to the last digit.
- **Single static HTML file for deployment** (~50 KB on disk). No build step, no backend, no database, no accounts, no telemetry. Two pinned CDN scripts (Tailwind + Alpine) load at first paint — see [Network requirement](#deploy-to-your-site) below; fine for any standard web host but not for fully offline / air-gapped environments without inlining the deps.
- **Privacy-respecting by construction.** Estimates never leave your browser. `localStorage` and the URL hash are the only persistence; nothing is uploaded anywhere.

## Quick start

### Try it locally

```
git clone https://github.com/mbagalman/Roughly.git
```

Then double-click `roughly/roughly.html`. That's the entire setup.

### Deploy to your site

1. Copy `roughly/roughly.html` into any folder on your static host (GitHub Pages, Netlify, Cloudflare Pages, S3, nginx, Apache, anywhere).
2. Link to it from your site's navigation.

There is no install step. **Network requirement:** at first paint the page loads Tailwind 3.4.0 from `cdn.tailwindcss.com` and Alpine.js 3.14.1 from `unpkg.com`. Visitors' browsers need outbound HTTPS to those two hosts — true for any standard public web deployment, but the page **will not render or be interactive** in fully offline, air-gapped, or strict-egress environments. To remove that dependency, inline a precompiled Tailwind stylesheet and the Alpine script into the file (the P4-4 ticket in [docs/TICKETS.md](docs/TICKETS.md) — not done by default).

## Features

**Math & inputs**
- Log-normal Monte Carlo engine, 10,000 trials, deterministic seed
- Smart number parser: `2.7M`, `300K`, `1.2B`, `1e6`, `1/150`, `33%`, `2,700,000` all work
- Per-step `×` or `÷` operator with explicit error when ÷ meets zero
- Add / remove / duplicate / reorder steps; keyboard shortcuts for power users
- Per-cell validation (rose-tinted invalid inputs) and per-row notice when a step won't be included

**Results**
- P5 / P50 / P95 reported as plain-language: *"Most likely around 600, with a 90% chance the true value is between 200 and 1,800."*
- Inline SVG distribution band with log / linear x-axis toggle (log default; switch to linear to see the right-skew)
- Three percentile cards (Low / Best guess / High) with explicit *"5th percentile / median / 95th percentile"* labels

**Share & export**
- **Copy as text** — Markdown table with the problem, all steps, and the result summary. Pastes legibly into Slack, GitHub, Notion, Linear, plain email.
- **Copy share link** — full estimate encoded into the URL hash (~500 chars). The recipient clicks and sees your exact numbers.
- **Download JSON** — archive an estimate to disk; filename includes the problem slug and date.

**UX**
- Four built-in worked examples (piano tuners, NYC pizza, library books, hairdressers in your city)
- Local persistence — your last estimate is restored on next visit
- 10-second undo window after Clear
- Mobile layout reflows into 3 logical strips per row; all tap targets ≥ 44 px
- Print stylesheet hides interactive controls and lays out the estimate cleanly on paper
- Collapsible help section with worked examples, format cheat-sheet, and shortcut reference

**Accessibility**
- Programmatic labels on every input (uses your step's name when set)
- `role="group"` on each step row with descriptive aria-label
- `aria-live="polite"` on the result phrase so screen readers announce updates
- WCAG AA color contrast throughout
- Native `<details>`-based help disclosure for no-JS keyboard nav
- Full keyboard operability; no drag-only interactions

## How the math works

Each step's `(lower, best, upper)` triple is treated as the 5th / 50th / 95th percentile of a log-normal distribution:

- μ = ln(best)
- σ = (ln(upper) − ln(lower)) / (2 × 1.6449)

The constant 1.6449 is the 95th-percentile *z*-score of a standard normal. For each of 10,000 trials, we sample one value from each step's distribution, sum them in log-space (subtracting for `÷` steps), exponentiate the sum, and store the result. Sorting the array gives the empirical P5 / P50 / P95.

A fixed seed (`MC_SEED = 0x9E3779B1`, a golden-ratio derivative) initialises a [Mulberry32](https://gist.github.com/tommyettinger/46a3a48b7fbc9e7c7a35) PRNG at the start of every recompute, which is why identical inputs reproduce byte-identical output.

The same Monte Carlo samples are binned into two histograms (log-spaced and linear-spaced) for the distribution visualization — switching axis modes is instant because we don't re-run MC.

## Input formats

| You type      | Parsed as     |
|---------------|---------------|
| `2700000`     | 2,700,000     |
| `2.7M`        | 2,700,000     |
| `300K`        | 300,000       |
| `1.2B`        | 1,200,000,000 |
| `1.5T`        | 1.5 × 10¹²    |
| `1e6`         | 1,000,000     |
| `2.7e6`       | 2,700,000     |
| `1.5e-3`      | 0.0015        |
| `1/150`       | 0.00667       |
| `33%`         | 0.33          |
| `2,700,000`   | 2,700,000     |
| `2.7 M`       | 2,700,000     |

Unparseable input (`abc`, `5.5.5`, …) tints the cell rose and the row is excluded from the result with a *"Not included"* notice.

## Keyboard shortcuts

| Keys                           | Action |
|--------------------------------|--------|
| `Enter` on the Upper input     | Add a new step (or jump to the next row if one exists) |
| `Ctrl/Cmd` + `D` inside a row  | Duplicate the focused row |
| `Tab`                          | Move through inputs left-to-right, top-to-bottom |

## Project structure

```
roughly/
  roughly.html        The entire app: HTML + inline CSS + inline JS + inline SVG favicon
docs/
  PLAN.md           Goals, constraints, methodology, non-goals
  TICKETS.md        Task breakdown with acceptance criteria
tests/
  engine.test.mjs   Node-based test suite for the math engine
README.md           This file
LICENSE             MIT
package.json        `npm test` convenience script (no runtime deps)
```

## Tech

- [Tailwind CSS 3.4.0](https://tailwindcss.com) (Play CDN) for styling
- [Alpine.js 3.14.1](https://alpinejs.dev) (unpkg) for reactivity
- Vanilla JavaScript for the math engine, smart parser, Monte Carlo, log-normal sampling, and SVG rendering
- Inline SVG for the distribution chart; no charting library
- Native `<details>` for the help disclosure
- `localStorage` + `history.replaceState` for persistence

No build step. No `package.json`. No `npm install`. View source to read the entire app.

## Running tests

The math engine (`parseFermiNumber`, `monteCarloEstimate`, `mulberry32`, `encodeState` / `decodeState`, `escapeMarkdownCell`, `slugify`) is covered by a Node-based test suite at [tests/engine.test.mjs](tests/engine.test.mjs). The tests load `roughly/roughly.html` as text, extract the inline `<script>` block, and run it in a sandboxed `vm` context — so the tests exercise the *actual shipped code*, and drift between source and tests is impossible by construction.

Zero dev dependencies: the suite uses only Node's built-in `node:test`, `node:assert`, `node:fs`, and `node:vm`. Requires Node 20+.

```bash
npm test
# or, without npm:
node --test tests/
```

The shipped HTML also carries a tiny opt-in smoke test that runs when the page is loaded with `?test` in the URL (e.g. `roughly.html?test`). It writes pass/fail to the browser console — useful as a quick sanity check after editing the file in production.

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari — last two major versions). Uses `TextEncoder`/`TextDecoder`, the Clipboard API, `history.replaceState`, CSS grid with `display: contents`, and inline SVG. Works on mobile.

## Status

Built end-to-end across the tickets in [docs/TICKETS.md](docs/TICKETS.md). Feature-complete on the original scope; the only deliberately-deferred item is vendoring the two CDN scripts into the file for a fully offline build (worth doing only if CDN reliability becomes an actual problem).

## License

[MIT](LICENSE) — Copyright (c) 2026 Michael Bagalman.
