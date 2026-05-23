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

// Grab the first <script> block with no `src=` attribute — that's the engine.
const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const inlineScript = scriptMatches.find(m => !/\bsrc=/.test(m[1]));
if (!inlineScript) {
    throw new Error('Could not find an inline <script> block in roughly/roughly.html');
}
const script = inlineScript[2];

// Sandbox globals. The engine uses Math/Number/Array/Float64Array/Uint8Array/JSON/
// String/parseFloat/RegExp/console/TextEncoder/TextDecoder/btoa/atob/URLSearchParams.
// It also touches `window` and `localStorage` — stub minimally so the smoke-test
// IIFE early-returns and the alpine:init listener registration is a no-op.
const ctx = vm.createContext({
    window: {
        addEventListener: () => {},
        location: { search: '' },
        localStorage: { getItem: () => null, setItem: () => {} }
    },
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
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
    slugify
} = ctx;

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
});

test('parseFermiNumber: fractions', () => {
    assert.ok(Math.abs(parseFermiNumber('1/150') - 1/150) < 1e-12);
    assert.equal(parseFermiNumber('1/0'), null);
});

test('parseFermiNumber: percent', () => {
    assert.equal(parseFermiNumber('33%'), 0.33);
    assert.equal(parseFermiNumber('100%'), 1);
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
