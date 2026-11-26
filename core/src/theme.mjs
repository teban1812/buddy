// Theme CSS contrast measurement (WCAG 2.1/2.2 AA) and sample-page generation for `buddy verify theme`.
import fs from 'node:fs';
import path from 'node:path';

const clamp01 = x => Math.min(1, Math.max(0, x));
const NAMED = { white: { r: 1, g: 1, b: 1, a: 1 }, black: { r: 0, g: 0, b: 0, a: 1 }, transparent: { r: 0, g: 0, b: 0, a: 0 } };

function parseAlpha(s) {
  if (s == null) return 1;
  const t = s.trim();
  if (t.endsWith('%')) { const n = Number(t.slice(0, -1)); return Number.isFinite(n) ? clamp01(n / 100) : NaN; }
  const n = Number(t); return Number.isFinite(n) ? clamp01(n) : NaN;
}

function parseAngle(s) {
  const t = s.trim().toLowerCase();
  if (t === 'none') return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/.exec(t);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] === 'rad' ? v * 180 / Math.PI : m[2] === 'grad' ? v * 0.9 : m[2] === 'turn' ? v * 360 : v;
}

function hslToRgb(h, s, l, a) {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return { r: clamp01(r + m), g: clamp01(g + m), b: clamp01(b + m), a };
}

function oklchToRgb(L, C, H, a) {
  const rad = H * Math.PI / 180, aa = C * Math.cos(rad), bb = C * Math.sin(rad);
  const l_ = L + 0.3963377774 * aa + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * aa - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * aa - 1.2914855480 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const toSrgb = c => { const u = clamp01(c); return u <= 0.0031308 ? 12.92 * u : 1.055 * (u ** (1 / 2.4)) - 0.055; };
  return {
    r: toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    a,
  };
}

function splitArgs(body) {
  const [main, alpha] = body.split('/');
  const parts = main.includes(',') ? main.split(',').map(s => s.trim()).filter(Boolean) : main.trim().split(/\s+/).filter(Boolean);
  if (alpha !== undefined) return { parts, alpha: alpha.trim() };
  return parts.length === 4 ? { parts: parts.slice(0, 3), alpha: parts[3] } : { parts, alpha: null };
}

export function parseColor(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) return { ...NAMED[s] };
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(h)) return { r: parseInt(h[0] + h[0], 16) / 255, g: parseInt(h[1] + h[1], 16) / 255, b: parseInt(h[2] + h[2], 16) / 255, a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 };
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  const fn = /^(rgba?|hsla?|oklch)\(([^)]+)\)$/.exec(s);
  if (fn) {
    const [, kind, body] = fn;
    const { parts, alpha } = splitArgs(body);
    const a = parseAlpha(alpha);
    if (parts.length !== 3 || !Number.isFinite(a)) return null;
    if (kind === 'rgb' || kind === 'rgba') {
      const ch = parts.map(p => p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p) / 255);
      return ch.every(Number.isFinite) ? { r: clamp01(ch[0]), g: clamp01(ch[1]), b: clamp01(ch[2]), a } : null;
    }
    if (kind === 'hsl' || kind === 'hsla') {
      const h = parseAngle(parts[0]), sat = parts[1].endsWith('%') ? Number(parts[1].slice(0, -1)) / 100 : NaN, lig = parts[2].endsWith('%') ? Number(parts[2].slice(0, -1)) / 100 : NaN;
      return Number.isFinite(h) && Number.isFinite(sat) && Number.isFinite(lig) ? hslToRgb(h, clamp01(sat), clamp01(lig), a) : null;
    }
    const L = parts[0].endsWith('%') ? Number(parts[0].slice(0, -1)) / 100 : Number(parts[0]);
    const C = parts[1].endsWith('%') ? Number(parts[1].slice(0, -1)) / 100 * 0.4 : Number(parts[1]);
    const H = parseAngle(parts[2]);
    return Number.isFinite(L) && Number.isFinite(C) && Number.isFinite(H) ? oklchToRgb(clamp01(L), Math.max(0, C), H, a) : null;
  }
  const bare = /^([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))%\s+([+-]?(?:\d+\.?\d*|\.\d+))%(?:\s*\/\s*(\S+))?$/.exec(s);
  if (bare) {
    const a = parseAlpha(bare[4]);
    return Number.isFinite(a) ? hslToRgb(Number(bare[1]), clamp01(Number(bare[2]) / 100), clamp01(Number(bare[3]) / 100), a) : null;
  }
  return null;
}

const composite = (fg, bg) => fg.a >= 1 ? fg : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
const luminance = c => {
  const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
};
export function contrastRatio(fg, bg) {
  const f = composite(fg, bg), l1 = luminance(f), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function parseThemeCss(css) {
  const topComment = /^\s*\/\*([\s\S]*?)\*\//.exec(css)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light = {}, dark = {};
  let hasLight = false, hasDark = false, i = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open < 0) break;
    const sel = clean.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < clean.length && depth > 0) { if (clean[j] === '{') depth++; else if (clean[j] === '}') depth--; j++; }
    const body = clean.slice(open + 1, j - 1);
    i = j;
    if (sel.startsWith('@')) continue;
    const sels = sel.split(',').map(s => s.trim());
    const isLight = sels.some(s => s === ':root');
    const isDark = sels.some(s => s === '.dark' || s === ':root.dark' || s === '[data-theme="dark"]' || s === ':root[data-theme="dark"]');
    if (!isLight && !isDark) continue;
    if (isLight) hasLight = true;
    if (isDark) hasDark = true;
    for (const m of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);?/g)) {
      const k = m[1].trim(), v = m[2].trim();
      if (isLight) light[k] = v;
      if (isDark) dark[k] = v;
    }
  }
  return { comment: topComment, hasLight, hasDark, light, dark };
}

const PAIRS = [
  ['--foreground', '--background', 4.5, 'text'],
  ['--card-foreground', '--card', 4.5, 'text'],
  ['--popover-foreground', '--popover', 4.5, 'text'],
  ['--primary-foreground', '--primary', 4.5, 'text'],
  ['--secondary-foreground', '--secondary', 4.5, 'text'],
  ['--muted-foreground', '--muted', 4.5, 'text'],
  ['--muted-foreground', '--background', 4.5, 'text'],
  ['--muted-foreground', '--card', 4.5, 'text'],
  ['--accent-foreground', '--accent', 4.5, 'text'],
  ['--destructive-foreground', '--destructive', 4.5, 'text'],
  ['--sidebar-foreground', '--sidebar', 4.5, 'text'],
  ['--sidebar-primary-foreground', '--sidebar-primary', 4.5, 'text'],
  ['--sidebar-accent-foreground', '--sidebar-accent', 4.5, 'text'],
  ['--destructive', '--background', 4.5, 'state'],
  ['--destructive', '--card', 4.5, 'state'],
  ...['--success', '--warning', '--info', '--danger'].flatMap(s => [
    [s, '--background', 4.5, 'state'], [s, '--card', 4.5, 'state'], [`${s}-foreground`, s, 4.5, 'state'],
  ]),
  ['--border', '--background', 3.0, 'ui'],
  ['--border', '--card', 3.0, 'ui'],
  ['--input', '--background', 3.0, 'ui'],
  ['--input', '--card', 3.0, 'ui'],
  ['--ring', '--background', 3.0, 'focus'],
  ['--ring', '--card', 3.0, 'focus'],
  ['--sidebar-border', '--sidebar', 3.0, 'ui'],
  ['--sidebar-ring', '--sidebar', 3.0, 'focus'],
];

function resolveToken(tokens, name, seen = new Set()) {
  const raw = tokens[name];
  if (!raw || seen.has(name)) return null;
  const m = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/.exec(raw.trim());
  if (!m) return raw.trim();
  seen.add(name);
  return resolveToken(tokens, m[1], seen) ?? (m[2]?.trim() || null);
}

export function measureTheme(css, file = '') {
  const parsed = parseThemeCss(css);
  const pairs = [], failures = [];
  const modes = [
    ['light', parsed.hasLight, parsed.light, NAMED.white],
    ['dark', parsed.hasDark, { ...parsed.light, ...parsed.dark }, NAMED.black],
  ];
  for (const [mode, present, tokens, fallbackBg] of modes) {
    if (!present) { failures.push({ file, mode, pair: mode === 'light' ? ':root' : '.dark', reason: `missing ${mode === 'light' ? ':root' : '.dark'} block` }); continue; }
    const baseBg = parseColor(resolveToken(tokens, '--background') || '') || fallbackBg;
    for (const [fgName, bgName, min, kind] of PAIRS) {
      if (!(fgName in tokens) || !(bgName in tokens)) continue;
      const fgRaw = resolveToken(tokens, fgName), bgRaw = resolveToken(tokens, bgName);
      const fg = parseColor(fgRaw), bg = parseColor(bgRaw);
      const pair = `${fgName} on ${bgName}`;
      if (!fg || !bg) {
        failures.push({ file, mode, pair, kind, min, reason: `unparseable colour (${!fg ? `${fgName}: ${fgRaw}` : `${bgName}: ${bgRaw}`})` });
        continue;
      }
      const bgSolid = bg.a < 1 ? composite(bg, baseBg) : bg;
      const ratio = Math.round(contrastRatio(fg, bgSolid) * 100) / 100;
      const entry = { file, mode, pair, fg: fgName, bg: bgName, kind, ratio, min, pass: ratio >= min };
      pairs.push(entry);
      if (!entry.pass) failures.push(entry);
    }
  }
  if (parsed.hasLight && parsed.hasDark && !pairs.length && !failures.length) {
    failures.push({ file, mode: 'light', pair: 'tokens', reason: 'no measurable colour pairs found' });
  }
  return { file, pairs, failures };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function generateThemeSample(dir, outPath) {
  const absDir = path.resolve(dir), absOut = path.resolve(outPath);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) throw new Error(`themes folder not found: ${dir}`);
  const cssFiles = fs.readdirSync(absDir).filter(f => f.endsWith('.css')).sort();
  if (!cssFiles.length) throw new Error(`no .css theme files found in ${dir}`);
  const themes = cssFiles.map(f => {
    const css = fs.readFileSync(path.join(absDir, f), 'utf8');
    const { comment } = parseThemeCss(css);
    const id = f.replace(/\.css$/, '');
    const colon = comment.indexOf(':');
    const name = colon > 0 && colon < 40 ? comment.slice(0, colon).trim() : id;
    const desc = colon > 0 && colon < 40 ? comment.slice(colon + 1).trim() : comment;
    const href = path.relative(path.dirname(absOut), path.join(absDir, f)).split(path.sep).join('/');
    return { id, name, desc, href };
  });
  const opts = themes.map(t => `<option value="${esc(t.href)}" data-desc="${esc(t.desc)}">${esc(t.name)}</option>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Theme sample</title>
<link id="theme-css" rel="stylesheet" href="${esc(themes[0].href)}">
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--background);color:var(--foreground);display:flex;min-height:100vh}
aside{width:220px;background:var(--sidebar,var(--card));color:var(--sidebar-foreground,var(--foreground));border-right:1px solid var(--sidebar-border,var(--border));padding:1rem;display:flex;flex-direction:column;gap:.5rem}
aside .nav-item{padding:.5rem .75rem;border-radius:var(--radius,.5rem);font-size:.9rem}
aside .nav-active{background:var(--sidebar-primary,var(--primary));color:var(--sidebar-primary-foreground,var(--primary-foreground))}
aside .nav-hover{background:var(--sidebar-accent,var(--accent));color:var(--sidebar-accent-foreground,var(--accent-foreground))}
main{flex:1;padding:1.5rem;max-width:920px;display:flex;flex-direction:column;gap:1.25rem}
.toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;padding:.75rem 1rem;background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius,.5rem)}
.muted{color:var(--muted-foreground);font-size:.9rem}
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius,.5rem);padding:1rem}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
button,select,input:not([type=checkbox]){font:inherit;height:2.5rem;line-height:1.25;border-radius:var(--radius,.5rem);padding:0 .85rem;border:1px solid var(--input,var(--border));background:var(--background);color:var(--foreground)}
input[type=checkbox]{width:1.25rem;height:1.25rem;margin:0;accent-color:var(--primary)}
.check{flex-direction:row;align-items:center;align-self:end;gap:.5rem;height:2.5rem}
@media (max-width:640px){body{flex-direction:column}aside{width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;border-right:0;border-bottom:1px solid var(--sidebar-border,var(--border))}main{padding:1rem;min-width:0}}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}
.btn-secondary{background:var(--secondary);color:var(--secondary-foreground);border-color:transparent}
.btn-destructive{background:var(--destructive);color:var(--destructive-foreground,#fff);border-color:transparent}
.btn-outline{background:transparent;color:var(--foreground);border-color:var(--border)}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem}
label{display:flex;flex-direction:column;gap:.25rem;font-size:.9rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid var(--border)}
th{background:var(--muted);color:var(--muted-foreground)}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.8rem;border:1px solid var(--border)}
.badge-ok{background:var(--accent);color:var(--accent-foreground)}
.badge-err{background:var(--destructive);color:var(--destructive-foreground,#fff);border-color:transparent}
.badge-muted{background:var(--muted);color:var(--muted-foreground)}
.alert{padding:.75rem 1rem;border-radius:var(--radius,.5rem);border:1px solid var(--border);background:var(--muted);color:var(--foreground)}
.alert-err{border-color:var(--destructive);color:var(--destructive)}
</style>
</head>
<body>
<aside aria-label="Sample navigation">
  <strong>Navigation</strong>
  <div class="nav-item nav-active">Overview</div>
  <div class="nav-item nav-hover">Requests</div>
  <div class="nav-item">Settings</div>
</aside>
<main>
  <div class="toolbar">
    <label style="flex-direction:row;align-items:center">Theme <select id="theme-pick">${opts}</select></label>
    <button type="button" id="mode-toggle" class="btn-outline">Toggle dark</button>
    <span id="theme-desc" class="muted">${esc(themes[0].desc)}</span>
  </div>
  <div class="alert" role="alert"><strong>Notice:</strong> Review every control in both light and dark modes before choosing a theme.</div>
  <div class="alert alert-err" role="alert"><strong>Error:</strong> Sample error alert using the theme's destructive colour.</div>
  <section class="card">
    <h2 style="margin-top:0">Buttons</h2>
    <div class="row">
      <button type="button" class="btn-primary">Primary</button>
      <button type="button" class="btn-secondary">Secondary</button>
      <button type="button" class="btn-destructive">Destructive</button>
      <button type="button" class="btn-outline">Outline</button>
    </div>
  </section>
  <section class="card">
    <h2 style="margin-top:0">Form</h2>
    <form onsubmit="return false">
      <label>Title <input type="text" value="Quarterly review"></label>
      <label>Category <select><option>Operations</option><option>Finance</option></select></label>
      <label class="check"><input type="checkbox" checked> Send summary</label>
      <div class="row"><button type="submit" class="btn-primary">Save</button><button type="reset" class="btn-outline">Cancel</button></div>
    </form>
  </section>
  <section class="card">
    <h2 style="margin-top:0">Table with states</h2>
    <table>
      <thead><tr><th>Item</th><th>Owner</th><th>State</th></tr></thead>
      <tbody>
        <tr><td>Order #104</td><td>A. Morales</td><td><span class="badge badge-ok">Approved</span></td></tr>
        <tr><td>Order #105</td><td>L. Vega</td><td><span class="badge badge-muted">Pending</span></td></tr>
        <tr><td>Order #106</td><td>M. Solis</td><td><span class="badge badge-err">Rejected</span></td></tr>
        <tr><td colspan="3" class="muted">Read-only / archived row preview</td></tr>
      </tbody>
    </table>
  </section>
</main>
<script>
const pick = document.getElementById('theme-pick'), link = document.getElementById('theme-css'), desc = document.getElementById('theme-desc');
pick.addEventListener('change', () => { link.href = pick.value; desc.textContent = pick.selectedOptions[0].dataset.desc || ''; });
document.getElementById('mode-toggle').addEventListener('click', () => { document.documentElement.classList.toggle('dark'); });
</script>
</body>
</html>
`;
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, html);
  return { out: absOut, themes };
}
