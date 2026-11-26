import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseColor, contrastRatio, parseThemeCss, measureTheme, generateThemeSample } from '../src/theme.mjs';

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(CORE, 'bin', 'verify.mjs');
const BUDDY = path.join(CORE, 'bin', 'buddy.mjs');
const run = (bin, args, cwd) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });

const PASSING_CSS = `/* Harbour: navy and white, high contrast. */
:root {
  --radius: 0.5rem;
  --background: #ffffff;
  --foreground: #111827;
  --card: #ffffff;
  --card-foreground: var(--foreground);
  --popover: #ffffff;
  --popover-foreground: #111827;
  --primary: #1d4ed8;
  --primary-foreground: #ffffff;
  --secondary: #e5e7eb;
  --secondary-foreground: #111827;
  --muted: #f3f4f6;
  --muted-foreground: #4b5563;
  --accent: #dbeafe;
  --accent-foreground: #1e3a8a;
  --destructive: #b91c1c;
  --destructive-foreground: #ffffff;
  --success: #15803d;
  --success-foreground: #ffffff;
  --border: #6b7280;
  --input: #6b7280;
  --ring: #1d4ed8;
  --sidebar: #f8fafc;
  --sidebar-foreground: #0f172a;
  --sidebar-primary: #1d4ed8;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #e2e8f0;
  --sidebar-accent-foreground: #0f172a;
  --sidebar-border: #64748b;
  --sidebar-ring: #1d4ed8;
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.85 0.08 250);
  --primary-foreground: oklch(0.15 0 0);
  --secondary: oklch(0.28 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.78 0 0);
  --accent: oklch(0.3 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.72 0.18 22);
  --destructive-foreground: oklch(0.15 0 0);
  --success: oklch(0.76 0.15 150);
  --success-foreground: oklch(0.15 0 0);
  --border: oklch(1 0 0 / 50%);
  --input: oklch(1 0 0 / 55%);
  --ring: oklch(0.75 0.1 250);
  --sidebar: oklch(0.18 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.85 0.08 250);
  --sidebar-primary-foreground: oklch(0.15 0 0);
  --sidebar-accent: oklch(0.28 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 50%);
  --sidebar-ring: oklch(0.75 0.1 250);
}
`;

const FAILING_CSS = `/* Low: fails light muted text and dark border alpha. */
:root {
  --background: #ffffff;
  --foreground: #111111;
  --muted: #f5f5f5;
  --muted-foreground: #aaaaaa;
  --border: rgb(220, 220, 220);
  --ring: hsl(210 50% 80%);
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}
`;

test('parseColor supports hex, rgb/rgba, hsl/hsla and oklch with alpha', () => {
  assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor('rgb(255, 0, 128)'), { r: 1, g: 0, b: 128 / 255, a: 1 });
  const rgba = parseColor('rgba(0, 128, 255, 0.5)');
  assert.equal(rgba.a, 0.5);
  assert.ok(Math.abs(rgba.g - 128 / 255) < 0.001);
  const hsl = parseColor('hsl(120 100% 50% / 50%)');
  assert.ok(hsl.r < 0.01 && hsl.g > 0.99 && hsl.b < 0.01 && hsl.a === 0.5);
  const ok = parseColor('oklch(1 0 0 / 10%)');
  assert.ok(ok.r > 0.99 && ok.g > 0.99 && ok.b > 0.99 && Math.abs(ok.a - 0.1) < 0.001);
  const okPct = parseColor('oklch(55.6% 0 0)');
  assert.ok(okPct && okPct.r > 0.4 && okPct.r < 0.5 && okPct.a === 1);
  assert.equal(parseColor('not-a-color'), null);
});

test('contrastRatio computes WCAG ratios including alpha compositing over background', () => {
  const black = parseColor('#000000'), white = parseColor('#ffffff');
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio(white, white) - 1) < 0.01);
  const bgDark = parseColor('oklch(0.145 0 0)');
  const border10 = parseColor('oklch(1 0 0 / 10%)');
  const r = contrastRatio(border10, bgDark);
  assert.ok(r > 1.1 && r < 1.5, `expected ~1.26:1, got ${r}`);
  const mutedLight = parseColor('oklch(0.556 0 0)');
  const rMuted = contrastRatio(mutedLight, white);
  assert.ok(rMuted > 4.5 && rMuted < 5.0, `expected ~4.73:1, got ${rMuted}`);
});

test('measureTheme passes an accessible theme and flags every pair below WCAG AA with its ratio', () => {
  const ok = measureTheme(PASSING_CSS, 'harbour.css');
  assert.equal(ok.failures.length, 0, JSON.stringify(ok.failures));
  assert.ok(ok.pairs.length >= 30, `expected >= 30 pairs, got ${ok.pairs.length}`);

  const bad = measureTheme(FAILING_CSS, 'low.css');
  assert.ok(bad.failures.length >= 4);
  assert.ok(bad.failures.some(f => f.mode === 'light' && f.pair === '--muted-foreground on --background' && f.min === 4.5 && f.ratio < 4.5));
  assert.ok(bad.failures.some(f => f.mode === 'light' && f.pair === '--border on --background' && f.min === 3.0 && f.ratio < 3.0));
  assert.ok(bad.failures.some(f => f.mode === 'dark' && f.pair === '--border on --background' && f.min === 3.0 && f.ratio < 3.0));
  assert.ok(bad.failures.some(f => f.mode === 'dark' && f.pair === '--input on --background' && f.min === 3.0 && f.ratio < 3.0));

  const noDark = measureTheme(':root { --background: #fff; --foreground: #000; }', 'light-only.css');
  assert.ok(noDark.failures.some(f => f.mode === 'dark' && /missing/i.test(f.reason || f.pair)));
});

test('CLI: buddy verify theme measures files, exits 0/1/2, supports --json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-theme-'));
  try {
    const good = path.join(dir, 'harbour.css'), bad = path.join(dir, 'low.css');
    fs.writeFileSync(good, PASSING_CSS); fs.writeFileSync(bad, FAILING_CSS);

    const rOk = run(BUDDY, ['verify', 'theme', good], dir);
    assert.equal(rOk.status, 0, rOk.stderr);
    assert.match(rOk.stdout, /0 below WCAG AA/);

    const rBad = run(VERIFY, ['theme', bad], dir);
    assert.equal(rBad.status, 1);
    assert.match(rBad.stderr, /dark: --border on --background: \d+\.\d+:1 \(needs 3\.0:1\)/);
    assert.match(rBad.stderr, /light: --muted-foreground on --background: \d+\.\d+:1 \(needs 4\.5:1\)/);

    const rJson = run(VERIFY, ['theme', bad, '--json'], dir);
    assert.equal(rJson.status, 1);
    const parsed = JSON.parse(rJson.stdout);
    assert.equal(parsed.themes.length, 1);
    assert.ok(parsed.failedPairs >= 4);

    const rMiss = run(VERIFY, ['theme', path.join(dir, 'nope.css')], dir);
    assert.equal(rMiss.status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: buddy verify theme --sample generates theme-sample.html linking all CSS without copying them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sample-'));
  try {
    const themesDir = path.join(dir, 'docs', 'design', 'themes');
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(path.join(themesDir, 'harbour.css'), PASSING_CSS);
    fs.writeFileSync(path.join(themesDir, 'low.css'), FAILING_CSS);

    const r = run(BUDDY, ['verify', 'theme', '--sample'], dir);
    assert.equal(r.status, 0, r.stderr);
    const out = path.join(dir, 'docs', 'discovery', 'theme-sample.html');
    assert.ok(fs.existsSync(out));
    const html = fs.readFileSync(out, 'utf8');
    // Links via relative path without copying CSS files into docs/discovery/
    assert.match(html, /\.\.\/design\/themes\/harbour\.css/);
    assert.match(html, /\.\.\/design\/themes\/low\.css/);
    assert.equal(fs.readdirSync(path.join(dir, 'docs', 'discovery')).filter(f => f.endsWith('.css')).length, 0);
    // Shows theme selector, light/dark toggle, form, table with states, buttons, alert, sidebar tokens
    assert.match(html, /<select/);
    assert.match(html, /classList\.toggle\(['"]dark['"]\)/);
    assert.match(html, /<form/);
    assert.match(html, /<table/);
    assert.match(html, /role="alert"/);
    assert.match(html, /--sidebar/);
    assert.match(html, /Harbour/);

    // Empty dir exits 2
    const empty = path.join(dir, 'empty'); fs.mkdirSync(empty);
    const rEmpty = run(VERIFY, ['theme', '--sample', empty], dir);
    assert.equal(rEmpty.status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
