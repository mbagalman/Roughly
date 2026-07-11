// Engine tests for roughly/roughly.html.
//
// Strategy: read the shipped HTML, extract its single inline <script> block
// (the one without an `src` attribute), run it in a sandboxed `vm` context
// with stubbed `window`, then pull the pure functions out of the context and
// exercise them directly. No source duplication, no build step, no devdeps —
// drift between these tests and the production artifact is impossible by
// construction because both read from the same string.
//
// Requires Node 20+ for the stable `node:test` runner.

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'roughly', 'roughly.html');
const html = await readFile(htmlPath, 'utf8');

// Grab the inline <script> block that defines the engine. The file contains a
// second inline script (the vendored Alpine.js bundle), so select by content
// rather than by position.
const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const inlineScript = scriptMatches.find(m => !/\bsrc=/.test(m[1]) && m[2].includes('parseFermiNumber'));
if (!inlineScript) {
    throw new Error('Could not find the engine <script> block in roughly/roughly.html');
}
const script = inlineScript[2];

// Sandbox globals. The engine uses Math/Number/Array/Float64Array/Uint8Array/JSON/
// String/parseFloat/RegExp/console/TextEncoder/TextDecoder/btoa/atob/URLSearchParams.
// It also touches `window` and `localStorage` — stub minimally so the smoke-test
// IIFE early-returns and the alpine:init listener registration is a no-op.
const ctx = vm.createContext({
    window: {
        addEventListener: () => {},
        location: { search: '', hash: '' },
        localStorage: { getItem: () => null, setItem: () => {} }
    },
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Math, Number, Array, Float64Array, Uint8Array, JSON,
    String, parseFloat, parseInt, RegExp, Object,
    console
});
vm.runInContext(script, ctx);

const {
    parseFermiNumber,
    monteCarloEstimate,
    mulberry32,
    encodeState,
    decodeState,
    escapeMarkdownCell,
    slugify,
    fermiApp
} = ctx;

// Fresh component instance per test that needs one. init() exercises the real
// restore path (URL hash → localStorage → defaults) against the stubbed window.
function makeApp({ hash = '' } = {}) {
    ctx.window.location.hash = hash;
    const app = fermiApp();
    app.init();
    return app;
}

// ─── assembled page ────────────────────────────────────────────────────────
// The vm-based tests below only execute the engine script. These static checks
// guard the rest of the single-file build: self-containment, script ordering,
// and the precompiled Tailwind subset. (Full in-browser behavior still needs a
// manual check — see docs/CODE_REVIEW_2026-06-11.md.)

test('assembled page: fully self-contained — no external scripts or stylesheets', () => {
    assert.equal(/<script[^>]*\bsrc=/i.test(html), false, 'found a <script src=...>');
    assert.equal(/<link[^>]*rel=["']?stylesheet/i.test(html), false, 'found a stylesheet <link>');
    assert.equal(html.includes('cdn.tailwindcss.com'), false);
});

test('assembled page: app script precedes the vendored Alpine bundle', () => {
    const inline = scriptMatches.filter(m => !/\bsrc=/.test(m[1]));
    assert.equal(inline.length, 2, 'expected exactly two inline scripts');
    assert.ok(inline[0][2].includes('parseFermiNumber'), 'first inline script must be the app');
    assert.ok(inline[1][2].includes('window.Alpine'), 'second inline script must be Alpine');
    assert.ok(inline[1][2].includes('queueMicrotask'), 'Alpine CDN build must self-start');
});

test('assembled page: precompiled Tailwind covers the class variants the page uses', () => {
    for (const probe of [
        '.max-md\\:min-h-11',
        '.md\\:grid-cols-\\[2fr_auto_1fr_1fr_1fr_auto_auto_auto\\]',
        '.print\\:hidden',
        '.md\\:contents',
        '.disabled\\:opacity-30',
        '.sm\\:grid-cols-3'
    ]) {
        assert.ok(html.includes(probe), `compiled CSS is missing ${probe}`);
    }
    assert.ok(html.includes('[x-cloak]'), 'missing the x-cloak rule');
});

// ─── parseFermiNumber ──────────────────────────────────────────────────────

test('parseFermiNumber: plain integers and decimals', () => {
    assert.equal(parseFermiNumber('2700000'), 2700000);
    assert.equal(parseFermiNumber('0'), 0);
    assert.equal(parseFermiNumber('-5'), -5);
    assert.equal(parseFermiNumber('.5'), 0.5);
    assert.equal(parseFermiNumber('0.5'), 0.5);
});

test('parseFermiNumber: scaled suffixes are case-insensitive', () => {
    assert.equal(parseFermiNumber('2.7M'), 2_700_000);
    assert.equal(parseFermiNumber('2.7m'), 2_700_000);
    assert.equal(parseFermiNumber('300K'), 300_000);
    assert.equal(parseFermiNumber('1.2B'), 1.2e9);
    assert.equal(parseFermiNumber('1.5T'), 1.5e12);
});

test('parseFermiNumber: scientific notation', () => {
    assert.equal(parseFermiNumber('1e6'), 1e6);
    assert.equal(parseFermiNumber('2.7e6'), 2.7e6);
    assert.equal(parseFermiNumber('1.5e-3'), 0.0015);
    assert.equal(parseFermiNumber('1.5 e6'), 1.5e6);
});

test('parseFermiNumber: fractions', () => {
    assert.ok(Math.abs(parseFermiNumber('1/150') - 1/150) < 1e-12);
    assert.equal(parseFermiNumber('1/0'), null);
});

test('parseFermiNumber: percent', () => {
    assert.equal(parseFermiNumber('33%'), 0.33);
    assert.equal(parseFermiNumber('100%'), 1);
    assert.equal(parseFermiNumber('50 %'), 0.5);
});

test('parseFermiNumber: repeated percent suffix is rejected', () => {
    assert.equal(parseFermiNumber('5%%'), null);
    assert.equal(parseFermiNumber('5% %'), null);
});

test('parseFermiNumber: percent binds to the fraction operand it suffixes', () => {
    // '1/150%' = 1 / (150%) = 1 / 1.5 — pinned so a refactor doesn't silently
    // change the semantics.
    assert.ok(Math.abs(parseFermiNumber('1/150%') - 1 / 1.5) < 1e-12);
});

test('parseFermiNumber: comma separators and whitespace', () => {
    assert.equal(parseFermiNumber('2,700,000'), 2_700_000);
    assert.equal(parseFermiNumber('2.7 M'), 2_700_000);
    assert.equal(parseFermiNumber('  100  '), 100);
});

test('parseFermiNumber: invalid input returns null (never NaN, never 0)', () => {
    assert.equal(parseFermiNumber(''), null);
    assert.equal(parseFermiNumber('   '), null);
    assert.equal(parseFermiNumber('abc'), null);
    assert.equal(parseFermiNumber('5.5.5'), null);
    assert.equal(parseFermiNumber('K'), null);
    assert.equal(parseFermiNumber(null), null);
    assert.equal(parseFermiNumber(undefined), null);
});

test('parseFermiNumber: numeric input passes through', () => {
    assert.equal(parseFermiNumber(2700000), 2700000);
    assert.equal(parseFermiNumber(NaN), null);
    assert.equal(parseFermiNumber(Infinity), null);
});

// ─── mulberry32 ────────────────────────────────────────────────────────────

test('mulberry32: same seed produces identical sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
        assert.equal(a(), b());
    }
});

test('mulberry32: different seeds diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differs = false;
    for (let i = 0; i < 10; i++) {
        if (a() !== b()) { differs = true; break; }
    }
    assert.ok(differs);
});

test('mulberry32: output is in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
});

// ─── monteCarloEstimate: math ──────────────────────────────────────────────

test('monteCarloEstimate: zero-variance returns exact value', () => {
    const r = monteCarloEstimate([{ min: '10', best: '10', max: '10' }]);
    assert.ok(r.valid);
    assert.ok(Math.abs(r.p50 - 10) < 1e-9);
    assert.ok(Math.abs(r.p5  - 10) < 1e-9);
    assert.ok(Math.abs(r.p95 - 10) < 1e-9);
});

test('monteCarloEstimate: piano tuners P50 lands in [150, 1000]', () => {
    const r = monteCarloEstimate([
        { name: 'Chicago population', min: '2M',   best: '2.7M', max: '3.5M' },
        { name: 'Households/person',  min: '0.25', best: '0.33', max: '0.4'  },
        { name: 'Pianos/household',   min: '2%',   best: '5%',   max: '8%'   },
        { name: 'Tunings/year',       min: '1',    best: '2',    max: '3'    },
        { name: 'Tunings/tuner/year', min: '100',  best: '150',  max: '250', op: '/' }
    ]);
    assert.ok(r.valid);
    assert.ok(r.p50 >= 150 && r.p50 <= 1000, `P50=${r.p50}`);
});

test('monteCarloEstimate: deterministic — same inputs give byte-identical output', () => {
    const inputs = [
        { min: '1M',  best: '2M',  max: '4M' },
        { min: '0.1', best: '0.2', max: '0.3' }
    ];
    const a = monteCarloEstimate(inputs);
    const b = monteCarloEstimate(inputs);
    assert.equal(a.p5,  b.p5);
    assert.equal(a.p50, b.p50);
    assert.equal(a.p95, b.p95);
});

test('monteCarloEstimate: asymmetric input preserves its P5/P50/P95', () => {
    const r = monteCarloEstimate([{ min: '10', best: '20', max: '100' }], 100_000);
    assert.ok(r.valid);
    assert.ok(Math.abs(r.p5 / 10 - 1) < 0.03, `P5=${r.p5}`);
    assert.ok(Math.abs(r.p50 / 20 - 1) < 0.03, `P50=${r.p50}`);
    assert.ok(Math.abs(r.p95 / 100 - 1) < 0.03, `P95=${r.p95}`);
});

test('monteCarloEstimate: blank best uses the geometric midpoint', () => {
    const r = monteCarloEstimate([{ min: '10', best: '', max: '90' }], 100_000);
    assert.ok(r.valid);
    assert.ok(Math.abs(r.p50 / 30 - 1) < 0.03, `P50=${r.p50}`);
    assert.equal(r.incompleteCount, 0);
});

test('monteCarloEstimate: ÷ operator divides correctly', () => {
    const r = monteCarloEstimate([
        { min: '100', best: '100', max: '100' },
        { min: '10',  best: '10',  max: '10', op: '/' }
    ]);
    assert.ok(r.valid);
    assert.ok(Math.abs(r.p50 - 10) < 1e-9);
});

test('monteCarloEstimate: returns log + linear histograms with 50 bins each', () => {
    const r = monteCarloEstimate([{ min: '1M', best: '2M', max: '4M' }]);
    assert.ok(r.histograms);
    assert.ok(r.histograms.log);
    assert.ok(r.histograms.linear);
    assert.equal(r.histograms.log.counts.length, 50);
    assert.equal(r.histograms.linear.counts.length, 50);
});

// ─── monteCarloEstimate: validation ────────────────────────────────────────

test('monteCarloEstimate: rejects best < lower', () => {
    assert.equal(monteCarloEstimate([{ min: '10', best: '5', max: '20' }]).valid, false);
});

test('monteCarloEstimate: rejects best > upper (the (10, 100, 20) bug)', () => {
    assert.equal(monteCarloEstimate([{ min: '10', best: '100', max: '20' }]).valid, false);
});

test('monteCarloEstimate: rejects lower === upper with mismatched best', () => {
    assert.equal(monteCarloEstimate([{ min: '10', best: '15', max: '10' }]).valid, false);
});

test('monteCarloEstimate: rejects upper < lower', () => {
    assert.equal(monteCarloEstimate([{ min: '20', best: '15', max: '10' }]).valid, false);
});

test('monteCarloEstimate: rejects zero or negative values', () => {
    assert.equal(monteCarloEstimate([{ min: '0',  best: '5', max: '10' }]).valid, false);
    assert.equal(monteCarloEstimate([{ min: '-1', best: '5', max: '10' }]).valid, false);
});

test('monteCarloEstimate: skips incomplete steps and counts them', () => {
    const r = monteCarloEstimate([
        { min: '1',   best: '2',   max: '3'   },   // valid
        { min: '10',  best: '100', max: '20'  },   // invalid (best > upper)
        { min: '0.5', best: '1',   max: '2'   }    // valid
    ]);
    assert.ok(r.valid);
    assert.equal(r.incompleteCount, 1);
});

test('monteCarloEstimate: all-invalid input yields valid=false', () => {
    assert.equal(monteCarloEstimate([{ min: '', best: '', max: '' }]).valid, false);
    assert.equal(monteCarloEstimate([{ min: 'abc', best: 'xyz', max: '???' }]).valid, false);
});

// ─── encodeState / decodeState ────────────────────────────────────────────

test('encodeState/decodeState: round-trip preserves problem and steps', () => {
    const state = {
        problem: 'Piano tuners in Chicago',
        steps: [
            { name: 'Chicago population',  min: '2M',  best: '2.7M', max: '3.5M', op: '*' },
            { name: 'Tunings/tuner/year',  min: '100', best: '150',  max: '250',  op: '/' }
        ]
    };
    assert.deepEqual(decodeState(encodeState(state)), state);
});

test('encodeState: handles non-ASCII (emoji, accents) via UTF-8', () => {
    const state = { problem: 'How many 🎯 darts hit the bullseye café?', steps: [] };
    assert.deepEqual(decodeState(encodeState(state)), state);
});

test('encodeState: output is URL-safe base64', () => {
    const state = { problem: 'x', steps: [{ name: 'y', min: '1', best: '2', max: '3', op: '*' }] };
    assert.match(encodeState(state), /^[A-Za-z0-9_-]+$/);
});

test('decodeState: returns null on garbage', () => {
    assert.equal(decodeState('not!valid!base64!'), null);
    assert.equal(decodeState(''), null);
});

// ─── escapeMarkdownCell ────────────────────────────────────────────────────

test('escapeMarkdownCell: escapes pipes so tables stay intact', () => {
    assert.equal(escapeMarkdownCell('a|b'), 'a\\|b');
});

test('escapeMarkdownCell: collapses newlines to spaces', () => {
    assert.equal(escapeMarkdownCell('a\nb'),   'a b');
    assert.equal(escapeMarkdownCell('a\r\nb'), 'a b');
});

test('escapeMarkdownCell: trims whitespace', () => {
    assert.equal(escapeMarkdownCell('  hello  '), 'hello');
});

test('escapeMarkdownCell: null and undefined become empty string', () => {
    assert.equal(escapeMarkdownCell(null), '');
    assert.equal(escapeMarkdownCell(undefined), '');
});

// ─── slugify ───────────────────────────────────────────────────────────────

test('slugify: produces kebab-case from sentences', () => {
    assert.equal(slugify('Number of piano tuners in Chicago'),
                 'number-of-piano-tuners-in-chicago');
});

test('slugify: collapses non-alphanumerics into single hyphens', () => {
    assert.equal(slugify('Hello, world! 123'), 'hello-world-123');
});

test('slugify: caps length at 60 characters', () => {
    assert.ok(slugify('a'.repeat(100)).length <= 60);
});

test('slugify: blank input falls back to "estimate"', () => {
    assert.equal(slugify(''),    'estimate');
    assert.equal(slugify('   '), 'estimate');
    assert.equal(slugify(null),  'estimate');
});

// ─── monteCarloEstimate: histogram edge cases ──────────────────────────────

test('monteCarloEstimate: zero-variance input yields null histograms', () => {
    const r = monteCarloEstimate([{ min: '10', best: '10', max: '10' }]);
    assert.ok(r.valid);
    assert.equal(r.histograms, null);
});

// ─── fermiApp component: init / restore ────────────────────────────────────

test('init: malformed hash with null step entries does not crash', () => {
    const hash = '#e=' + encodeState({ problem: 'x', steps: [null, { min: '1', best: '2', max: '3' }] });
    const app = makeApp({ hash });
    assert.equal(app.problem, 'x');
    assert.equal(app.steps.length, 2);
    // null entry normalized to a blank step instead of throwing
    assert.equal(app.steps[0].name, '');
    assert.equal(app.steps[0].min, '');
    assert.equal(app.steps[1].best, '2');
    assert.ok(app.result.valid); // recompute() was reached
});

test('init: undecodable hash falls back to defaults', () => {
    const app = makeApp({ hash: '#e=!!!not-base64!!!' });
    assert.equal(app.steps.length, 3); // constructor defaults
    assert.ok(app.result.valid);
});

test('init: restored state is capped (25 steps, 300-char problem)', () => {
    const steps = Array.from({ length: 250 }, () => ({ min: '1', best: '2', max: '3', op: '*' }));
    const hash = '#e=' + encodeState({ problem: 'p'.repeat(2000), steps });
    const app = makeApp({ hash });
    assert.equal(app.steps.length, 25);
    assert.equal(app.problem.length, 300);
    assert.ok(app.result.valid);
});

test('init: oversized hash token is rejected before decoding', () => {
    // > MAX_HASH_LENGTH (80,000) of valid base64url characters — must fall back
    // to defaults without attempting atob/JSON.parse on the payload.
    const app = makeApp({ hash: '#e=' + 'A'.repeat(90000) });
    assert.equal(app.steps.length, 3); // constructor defaults
    assert.ok(app.result.valid);
});

test('addStep/duplicateStep: refuse to grow beyond the 25-step cap', () => {
    const app = makeApp();
    while (app.canAddStep()) app.steps.push(app.blankStep());
    assert.equal(app.steps.length, 25);
    app.addStep();
    assert.equal(app.steps.length, 25);
    app.duplicateStep(0);
    assert.equal(app.steps.length, 25);
});

test('normalizeStep: never throws and truncates oversized fields', () => {
    const app = makeApp();
    for (const junk of [null, undefined, 42, 'text', [], { min: { nested: true } }]) {
        const step = app.normalizeStep(junk);
        assert.equal(typeof step.name, 'string');
        assert.equal(step.op === '*' || step.op === '/', true);
    }
    const long = app.normalizeStep({ name: 'n'.repeat(500), min: '1'.repeat(500) });
    assert.ok(long.name.length <= 120);
    assert.ok(long.min.length <= 120);
});

test('steps carry unique runtime ids; serializeSteps strips them', () => {
    const app = makeApp();
    const ids = app.steps.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => Number.isInteger(id)));
    for (const s of app.serializeSteps()) {
        assert.equal('id' in s, false);
        assert.deepEqual(Object.keys(s).sort(), ['best', 'max', 'min', 'name', 'op']);
    }
});

// ─── fermiApp component: row status and messages ───────────────────────────

test('stepStatus: blank vs unparseable vs invalid vs valid', () => {
    const app = makeApp();
    assert.equal(app.stepStatus({ min: '',    best: '',  max: ''   }), 'empty');
    assert.equal(app.stepStatus({ min: '',    best: '5', max: '10' }), 'incomplete');
    assert.equal(app.stepStatus({ min: 'abc', best: '5', max: '10' }), 'unparseable');
    assert.equal(app.stepStatus({ min: '0',   best: '5', max: '10' }), 'invalid');
    assert.equal(app.stepStatus({ min: '1',   best: '5', max: '10' }), 'valid');
    assert.equal(app.stepStatus({ min: '1',   best: '',  max: '10' }), 'valid');
    assert.equal(app.stepStatus({ min: '0',   best: '',  max: '10' }), 'invalid');
});

test('stepIssues: filled-but-unparseable row gets a format hint, not "fill in all three"', () => {
    const app = makeApp();
    const issues = app.stepIssues({ min: 'abc', best: '5', max: '10' });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /Can't read/);
});

test('stepIssues: blank best does not hide a non-positive bound', () => {
    const app = makeApp();
    const issues = app.stepIssues({ min: '0', best: '', max: '10' });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /greater than zero/);
});

// ─── fermiApp component: formatting ────────────────────────────────────────

test('formatValue: unit boundaries round to the next suffix, never "1000.0K"', () => {
    const app = makeApp();
    assert.equal(app.formatValue(999950),      '1.0M');
    assert.equal(app.formatValue(999949),      '999.9K');
    assert.equal(app.formatValue(999999999),   '1.0B');
    assert.equal(app.formatValue(999.95),      '1.0K');
    assert.equal(app.formatValue(1e12),        '1.0T');
    assert.equal(app.formatValue(2700000),     '2.7M');
});

test('formatValue: small and degenerate values', () => {
    const app = makeApp();
    assert.equal(app.formatValue(0), '0');
    assert.equal(app.formatValue(NaN), '–');
    assert.equal(app.formatValue(0.5), '0.500');
    assert.equal(app.formatValue(0.009), '9.00e-3');
});

// ─── fermiApp component: markdown export ───────────────────────────────────

test('buildMarkdown: asterisks in the title are escaped inside the bold wrapper', () => {
    const app = makeApp();
    app.problem = 'rough*estimate*';
    const md = app.buildMarkdown();
    assert.ok(md.startsWith('**rough\\*estimate\\***'), md.split('\n')[0]);
});

test('buildMarkdown: step names with pipes do not break the table', () => {
    const app = makeApp();
    app.steps = [app.normalizeStep({ name: 'a|b', min: '1', best: '2', max: '3' })];
    app.recompute();
    const md = app.buildMarkdown();
    assert.ok(md.includes('a\\|b'));
});
