import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSlice, startMilestone, moveSlice } from '../src/slicestore.mjs';
import { loadBoard, boardHtml, refreshBoardPage } from '../src/board.mjs';
import { sinceLooked, writeMark, boardMeasures } from '../src/digest.mjs';
import { refreshIndex } from '../src/index.mjs';

// live-board, fifth piece (R248, R249): the slim page, what changed since the owner last looked, and the usability audit's findings that break a criterion (AC17).
const NOW = '2026-10-31T18:00:00Z';
const lang = h => h.replace(/<span lang="en">(.*?)<\/span>/g, '$1');
const en = h => lang(h).replace(/<span data-l="es">.*?<\/span>/g, '').replace(/<span data-l="en">(.*?)<\/span>/g, '$1');
const es = h => lang(h).replace(/<span data-l="en">.*?<\/span>/g, '').replace(/<span data-l="es">(.*?)<\/span>/g, '$1');
const text = h => h.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const row = (id, title, status, o = {}) => ({ id, title, kind: 'feat', status, change: null, milestone: null, updated: NOW, steps: { done: 0, total: 0 }, priority: null, waits_for: [], abandoned_deps: [], assurance: null, merge: null, howto: [], screens: [], ...o });
const ms = (id, title, status, acc, total, request) => ({ id, title, status, rank: 1, request, changes: { accepted: acc, total } });
const base = o => ({ now: NOW, current: [], next: null, waiting: [], requests: null, decisions: null, milestones: [], slices: [], ...o });
const css = h => /<style>([\s\S]*?)<\/style>/.exec(h)[1];
const script = h => /<script>([\s\S]*?)<\/script>/.exec(h)[1];

// WCAG contrast of two #rrggbb colours
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const full = h => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h);
const tokens = block => Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{3,6})/g)].map(([, k, v]) => [k, full(v)]));

test('a card shows its title, its state, its tasks or pieces and what it waits for: no id, no kind, no age, no stage times (AC21, R248)', () => {
  const b = base({ milestones: [ms('m', 'First', 'building', 0, 2)], slices: [row('save-books', 'Save books', 'building', { milestone: 'm', kind: 'feat', steps: { done: 1, total: 3 }, updated: '2026-10-29T18:00:00Z' }), row('fix-sort', 'Fix the sort', 'delivered', { milestone: 'm', kind: 'fix' })] });
  const html = en(boardHtml(b, { minutes: { changes: [], milestones: [] }, stages: { 'save-books': { building: 600 } }, work_mix: { days: 14, total: 0, share: {} }, routes: {}, looked: null }));
  const cards = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  assert.match(cards, /<b>Save books<\/b>[\s\S]*Being built[\s\S]*1 of 3 steps/);
  assert.doesNotMatch(cards, /save-books|fix-sort|\bfeat\b|\bfix\b|2 d|<1 h|Time in each stage|Average time/);
});

test('"How the process is going" is folded at the end: the open milestone\'s average stage times (over the changes that spent time in each), what it waited for me, the work mix and the routes', () => {
  const b = base({ milestones: [ms('m', 'First', 'building', 0, 3), ms('n', 'Second', 'refining', 0, 1)], slices: [row('a', 'A', 'building', { milestone: 'm' }), row('c', 'C', 'delivered', { milestone: 'm' }), row('x', 'Elsewhere', 'building', { milestone: 'n' })] });
  const m = { minutes: { changes: [], milestones: [{ id: 'm', asked: 3, waited_minutes: 90 }] }, stages: { a: { refining: 60, ready: 0, building: 180, delivered: 0 }, c: { refining: 180, ready: 0, building: 60, delivered: 120 }, x: { building: 5000 } },
    work_mix: { days: 14, total: 100, share: { product: 50, tests: 20, records: 10, evidence: 10, process: 10 } }, routes: { feat: 2 }, looked: null };
  const raw = boardHtml(b, m); const html = en(raw);
  assert.ok(raw.indexOf('How the process is going') > raw.lastIndexOf('</article>')); assert.match(raw, /<details class="fold"><summary><b>/);   // folded, at the end
  assert.match(html, /Milestone in progress: First/); assert.match(html, /Average time a change spent in each stage: Being defined <span class="nw">2 h<\/span> · Being built <span class="nw">2 h<\/span> · Ready for you to try <span class="nw">2 h<\/span>/);
  assert.match(html, /you were asked 3 times; it waited for you 1 h 30 min/); assert.match(html, /Work mix, last 14 days \(100 lines\)/); assert.match(html, /Routes used, last 14 days: feature 2/);
  assert.match(es(raw), /Tiempo medio de un cambio en cada etapa/); assert.match(es(raw), /te preguntó 3 veces; te esperó/);
  assert.doesNotMatch(boardHtml(b), /How the process is going/);   // without the measures there is nothing to fold
});

test('what changed since the owner last looked is below what waits for him, from his last look mark; nothing is marked by writing the page', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')); fs.mkdirSync(path.join(d, 'docs')); fs.mkdirSync(path.join(d, '.git'));
  let min = 0; const at = h => () => new Date(Date.UTC(2026, 9, 31, h, min++, 0)); const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
  const old = startSlice({ repo: d, title: 'Old news', ...goal, now: at(8) }); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, old.id, to, { now: at(8) });
  assert.equal(sinceLooked(d, loadBoard(d, NOW)), null);   // never marked a look: no "since"
  writeMark(d, '2026-10-31T12:00:00Z');
  const fresh = startSlice({ repo: d, title: 'Fresh work', ...goal, now: at(13) }); for (const to of ['ready', 'building']) moveSlice(d, fresh.id, to, { now: at(13) });
  const done = startSlice({ repo: d, title: 'Done work', ...goal, now: at(14) }); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, done.id, to, { now: at(14) });
  const shipped = startSlice({ repo: d, title: 'Shipped work', ...goal, now: at(15) }); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, shipped.id, to, { now: at(15) }); moveSlice(d, shipped.id, 'accepted', { by: 'owner', now: at(15) });
  const index = refreshIndex(d).index; const b = loadBoard(d, NOW, { index }); const m = boardMeasures(d, b, index);
  assert.deepEqual(m.looked.items.map(i => `${i.kind}: ${i.title}`).sort(), ['accepted: Shipped work', 'delivered: Done work', 'started: Fresh work']);   // Old news is from before the look
  const raw = boardHtml(b, m); const t = text(en(raw));
  assert.match(t, /Waiting for you[\s\S]*Since you last looked counting from 2026-10-31 12:00 UTC Started: Fresh work Delivered: Done work Accepted: Shipped work/); assert.match(text(es(raw)), /Desde la última vez que miraste contando desde 2026-10-31 12:00 UTC Empezado: Fresh work Entregado: Done work Aceptado: Shipped work/);   // in the order of the board
  assert.match(t, /Since you last looked counting from 2026-10-31 12:00 UTC/); assert.match(text(es(raw)), /contando desde 2026-10-31 12:00 UTC/); assert.match(raw, /<time datetime="2026-10-31T12:00:00Z">2026-10-31 12:00 UTC<\/time>/);   // since when it counts, in the viewer's local time once the script runs
  assert.ok(raw.indexOf('Waiting for you') < raw.indexOf('Since you last looked') && raw.indexOf('Since you last looked') < raw.indexOf('class="box agent"') + 2000);
  fs.mkdirSync(path.join(d, '.buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.buddy', 'board.html'), 'x'); const before = fs.readFileSync(path.join(d, '.buddy', 'last-looked'), 'utf8');
  assert.equal(refreshBoardPage(d), true); assert.equal(fs.readFileSync(path.join(d, '.buddy', 'last-looked'), 'utf8'), before);   // writing the page is not looking
  writeMark(d, '2026-10-31T23:00:00Z'); const b2 = loadBoard(d, NOW); assert.match(text(en(boardHtml(b2, boardMeasures(d, b2)))), /Since you last looked counting from 2026-10-31 23:00 UTC Nothing changed\./);
});

test('the reload can be paused (remembered like the language), never runs while text is selected or a control has focus, and puts the focus back (S4, WCAG 2.2.2)', () => {
  const raw = boardHtml(base()); const js = script(raw);
  assert.match(raw, /<button type="button" class="pause" data-state="run" hidden><span data-s="run"><span data-l="en">Pause updates<\/span><span data-l="es">Pausar actualización<\/span><\/span><span data-s="paused"><span data-l="en">Resume updates/);
  assert.match(js, /localStorage\.getItem\(P\)/); assert.match(js, /localStorage\.setItem\(P/); assert.match(js, /buddy-pause/);   // remembered, like 'buddy-lang'
  assert.match(js, /getSelection\(\)/); assert.match(js, /document\.activeElement/); assert.match(js, /\.focus\(/); assert.match(js, /pagehide/); assert.match(js, /location\.reload\(\)/);
  assert.match(js, /if\(off\|\|document\.hidden\)return/); assert.match(js, /\(s&&String\(s\)\)\|\|\(a&&a!==document\.body&&!a\.closest\('\.ctl'\)\)/);
  assert.match(raw, /<span class="hold" role="status" hidden>/);   // says so when it holds the reload back
  // run the script against a small fake page: the reload holds back for a selection and for a focused control, and goes ahead otherwise
  const run = ({ selection = '', active = null, paused = false } = {}) => {
    const log = { reloads: 0, saved: null }; const store = { 'buddy-pause': paused ? '1' : '0' }; let tick;
    const btn = { hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }; const hold = { hidden: true }; const body = {};
    const doc = { documentElement: { getAttribute: () => 'x' }, title: '', hidden: false, body, activeElement: active ?? body,
      querySelectorAll: s => (s === 'time[datetime]' || s === 'details' ? [] : s.startsWith('a[href]') ? [active].filter(Boolean) : []), querySelector: s => (s === '.pause' ? btn : s === '.hold' ? hold : { hidden: true, addEventListener() {} }) };
    const g = { document: doc, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, sessionStorage: { getItem: () => null, setItem: (k, v) => { log.saved = v; } }, navigator: { language: 'en' },
      getSelection: () => selection, scrollX: 0, scrollY: 0, scrollTo() {}, addEventListener() {}, setInterval: f => { tick = f; }, location: { reload: () => { log.reloads++; } } };
    new Function(...Object.keys(g), js)(...Object.values(g)); tick(); return { ...log, hold: hold.hidden, button: btn.hidden };
  };
  assert.equal(run().reloads, 1); assert.equal(run({ selection: 'some words' }).reloads, 0); assert.equal(run({ selection: 'some words' }).hold, false);   // selected text: held, and says so
  assert.equal(run({ active: { closest: () => null } }).reloads, 0);   // a control with focus: held
  assert.equal(run({ active: { closest: () => ({}) } }).reloads, 1);   // the two top buttons keep their focus through the reload
  assert.equal(run({ paused: true }).reloads, 0); assert.equal(run().button, false);   // paused by the viewer; the button shows
  assert.equal(JSON.parse(run({ active: { closest: () => ({}) } }).saved).f, 0);   // the focus is saved to put it back
});

test('the folds look like they open, the language buttons do not break on a phone, the goal is whole, and nothing is cut to a tooltip (M3, m2, m3)', () => {
  const s = css(boardHtml(base()));
  assert.match(s, /summary\.meta\{display:list-item;margin-left:18px;color:var\(--ink\);text-decoration:underline\}/);   // the piece fold has its marker, like the others
  assert.match(s, /\.lang button,\.pause\{[^}]*white-space:nowrap;overflow-wrap:normal\}/); assert.match(s, /min-height:24px/); assert.match(s, /\.top\{[^}]*flex-wrap:wrap/);
  assert.match(s, /\.goal\{margin:2px 0;font-size:14px\}/); assert.doesNotMatch(s, /text-overflow:ellipsis|\.goal\{[^}]*nowrap/);
  const b = base({ milestones: [ms('m', 'First', 'building', 0, 1, 'A goal that is long enough that a one-line cut would hide most of what the owner wanted from it')], slices: [row('a', 'A', 'building', { milestone: 'm' })] });
  assert.match(en(boardHtml(b)), /<p class="goal">A goal that is long enough that a one-line cut would hide most of what the owner wanted from it<\/p>/);
});

test('the time is the viewer\'s local time, with the UTC time for when there is no script', () => {
  const raw = boardHtml(base()); assert.match(raw, /<time datetime="2026-10-31T18:00:00Z">2026-10-31 18:00 UTC<\/time>/);
  assert.match(script(raw), /time\[datetime\]/); assert.match(script(raw), /toLocaleString\(l,\{dateStyle:'medium',timeStyle:'short'\}\)/);   // set again when the language changes
});

test('the records\' own text is marked with its language, in the cards, the tiles, the path and the lines of what waits (M5, WCAG 3.1.2)', () => {
  const b = base({ waiting: [{ kind: 'accept', text: 'try and accept: Guardar libros [save-books]', ref: 'save-books', since: null }], current: [{ id: 'save-books', title: 'Guardar libros', change: null, step: null }],
    milestones: [ms('m', 'Primera entrega', 'building', 0, 2, 'Una meta'), ms('n', 'Segunda', 'refining', 0, 0)], slices: [row('save-books', 'Guardar libros', 'building', { milestone: 'm' }), row('x', 'Exportar', 'delivered', { milestone: 'm', howto: [{ criterion: 'AC1', steps: 'Abrir', expect: 'Ver' }] })] });
  const raw = boardHtml(b);
  for (const t of ['Primera entrega', 'Una meta', 'Exportar', 'Abrir', 'Ver']) assert.ok(raw.includes(`<span lang="en">${t}</span>`), t);
  assert.ok((raw.match(/<span lang="en">Guardar libros<\/span>/g) || []).length >= 4);   // card, now, path, the lines of what waits (both languages)
  assert.match(raw, /<span data-l="es">prueba y acepta: <span lang="en">Guardar libros<\/span> \[save-books\]<\/span>/); assert.doesNotMatch(raw, /<span lang="en"><span/);
  assert.doesNotMatch(raw, /<span lang="en">[^<]*<script/);
});

test('plurals read right in both languages: 1 and 2 of what is counted (m1)', () => {
  const one = base({ milestones: [ms('m', 'M', 'building', 0, 1)], slices: [row('a', 'A', 'delivered', { milestone: 'm' })], waiting: [] });
  const two = base({ milestones: [ms('m', 'M', 'building', 0, 2)], slices: [row('a', 'A', 'delivered', { milestone: 'm' }), row('b', 'B', 'delivered', { milestone: 'm' })] });
  assert.match(en(boardHtml(one)), /try and accept 1 change\./); assert.match(es(boardHtml(one)), /probar y aceptar 1 cambio\./); assert.match(en(boardHtml(two)), /try and accept 2 changes\./); assert.match(es(boardHtml(two)), /probar y aceptar 2 cambios\./);
  const loose = n => en(boardHtml(base({ milestones: [ms('m', 'M', 'building', 0, 0)], slices: Array.from({ length: n }, (_, i) => row('l' + i, 'L' + i, 'refining')) })));
  assert.match(loose(1), /<b>1<\/b> change</); assert.match(loose(2), /<b>2<\/b> changes</); assert.match(loose(0), /<b>0<\/b> changes</); assert.doesNotMatch(text(boardHtml(two)), /\(s\)|\(es\)|vez\(veces\)|cambio\(s\)/);
  const asked = { minutes: { changes: [], milestones: [{ id: 'm', asked: 1, waited_minutes: 5 }] }, stages: {}, work_mix: { days: 14, total: 0, share: {} }, routes: {}, looked: null };
  assert.match(en(boardHtml(one, asked)), /asked 1 time;/); assert.match(es(boardHtml(one, asked)), /preguntó 1 vez;/);
  assert.match(es(boardHtml(base({ waiting: [{ kind: 'accept', text: 'try and accept: A [a] (1 departure from the prototype to decide; the reviews left 1 note)', ref: 'a', since: null }] }))), /1 desviación del prototipo por decidir; las revisiones dejaron 1 nota/);
  assert.match(es(boardHtml(base({ waiting: [{ kind: 'accept', text: 'try and accept: A [a] (2 departures from the prototype to decide; the reviews left 3 notes)', ref: 'a', since: null }] }))), /2 desviaciones del prototipo por decidir; las revisiones dejaron 3 notas/);
});

test('the table of milestones has column headers, and each bar has its text (m4)', () => {
  const raw = boardHtml(base({ milestones: [ms('m', 'First', 'building', 1, 2)], slices: [row('a', 'A', 'accepted', { milestone: 'm' })] })); const html = en(raw);
  assert.match(html, /<thead><tr><th scope="col">Milestone<\/th><th scope="col">State<\/th><th scope="col">Progress<\/th><th scope="col">Accepted<\/th><\/tr><\/thead>/); assert.match(es(raw), /<th scope="col">Hito<\/th><th scope="col">Estado<\/th><th scope="col">Avance<\/th><th scope="col">Aceptados<\/th>/);
  assert.match(html, /<span class="seg"><i style="width:50%"><\/i><span class="vh">1 of 2 accepted<\/span><\/span>/);
});

test('every text of the page meets 4.5:1 and every part of a bar 3:1, in light and in dark (S2, S3, N3)', () => {
  const s = css(boardHtml(base())); const light = tokens(/^:root\{([^}]*)\}/m.exec(s)[1]); const dark = tokens(/prefers-color-scheme:dark\)\{:root\{([^}]*)\}/.exec(s)[1]); light.card = '#ffffff'; dark.card = dark.card ?? '#1f1f22';
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    const text = [['ink', 'bg'], ['ink', 'card'], ['mute', 'bg'], ['mute', 'card'], ['mute', 'define-bg'], ['mute', 'owner-bg'], ['owner', 'owner-bg'], ['owner', 'card'], ['owner', 'bg'], ['agent', 'agent-bg'], ['agent', 'card'], ['agent', 'bg'],
      ['done', 'done-bg'], ['done', 'card'], ['on-owner', 'owner'], ['ink', 'owner-bg']];   // the chips, the owner's headings, the legend, the meta lines, the numbered steps
    for (const [f, g] of text) assert.ok(ratio(t[f], t[g]) >= 4.5, `${name}: ${f} on ${g} is ${ratio(t[f], t[g]).toFixed(2)}`);
    for (const k of ['done', 'owner', 'agent', 'define', 'blocked', 'mute']) assert.ok(ratio(t[k], t['define-bg']) >= 3 && ratio(t[k], t.card) >= 3, `${name}: the bar part ${k} is ${ratio(t[k], t['define-bg']).toFixed(2)} on its track, ${ratio(t[k], t.card).toFixed(2)} on the card`);
  }
  assert.doesNotMatch(s, /\.s-define[^}]*opacity/);   // the "to define" part is not faded into its track
  assert.match(s, /\.chip\.owner\{background:var\(--owner\);color:var\(--on-owner\)\}/);
});

test('an accepted change with no branch to merge says only how it was accepted, never "Nothing yet" (m7)', () => {
  const b = base({ milestones: [ms('m', 'M', 'building', 1, 2)], slices: [row('a', 'A', 'accepted', { milestone: 'm', assurance: 'recorded', merge: { state: 'none', trunk: 'main' } }), row('b', 'B', 'accepted', { milestone: 'm', assurance: 'recorded', merge: { state: 'pending', trunk: 'main' } })] });
  const html = en(boardHtml(b)); assert.match(html, /accepted, recorded only<\/span>/); assert.match(html, /accepted, recorded only · waiting to merge into main/); assert.doesNotMatch(html, /Nothing yet\.<\/span><\/div>/);
});

test('on a narrow screen a milestone\'s name breaks only between words and the bar column gives way to the count', () => {
  const s = css(boardHtml(base()));
  assert.match(s, /\.mt \.name\{[^}]*overflow-wrap:normal\}/); assert.match(s, /@media \(max-width:420px\)\{\.mt \.bc,\.mt th:nth-child\(3\)\{display:none\}\}/);
});

test('the line to merge a branch reads its plural right in both languages', () => {
  const w = n => base({ waiting: [{ kind: 'merge', text: `merge branch feat/x into main: ${n} ${n === 1 ? 'slice' : 'slices'} accepted`, ref: 'feat/x', since: null }] });
  assert.match(es(boardHtml(w(1))), /integra la rama feat\/x en main: 1 cambio aceptado/); assert.match(es(boardHtml(w(2))), /integra la rama feat\/x en main: 2 cambios aceptados/);
  assert.doesNotMatch(text(boardHtml(w(2))), /slice\(s\)|cambio\(s\)/);
});

test('a card names what it waits for, and a dependency that was abandoned, by title only, marked with its language (AC21)', () => {
  const b = base({ milestones: [ms('m', 'M', 'building', 0, 1)], slices: [row('a', 'Save books', 'refining', { milestone: 'm', waits_for: [{ id: 'sign-in', title: 'Sign in', status: 'building' }, { id: 'x', title: 'Other', status: 'ready' }], abandoned_deps: [{ id: 'old-one', title: 'Old one' }] })] });
  const raw = boardHtml(b); const html = en(raw); const card = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  assert.match(card, /waits for: Sign in, Other/); assert.match(card, /its dependency Old one was abandoned/); assert.doesNotMatch(card, /sign-in|old-one|\[x\]/);
  assert.match(raw, /waits for: <span lang="en">Sign in<\/span>, <span lang="en">Other<\/span>/); assert.match(es(raw), /espera a: Sign in, Other/); assert.match(es(raw), /su dependencia Old one fue descartada/);
});
