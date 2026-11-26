import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { TEXT, GROUPS, shown, actOf } from '../../claude/hooks/words.js';
import { ask } from './view.js';

// The panel's page: the short view of Claude Code's panel, drawn from what the `buddy_board` tool answers. It refreshes every 30 seconds by calling that
// tool again; its buttons write a request into the conversation (app.sendMessage), open the full board, or refresh.
const EVERY_MS = 30_000;
const CONNECT = {
  en: { line: "I do not know which project is open yet.", button: 'Connect to this project', ask: "Open Buddy's panel for the project I have open: call the buddy_board tool with the folder of this project." },
  es: { line: 'Todavía no sé qué proyecto está abierto.', button: 'Conectar con este proyecto', ask: 'Abre el panel de Buddy para el proyecto que tengo abierto: llama a la herramienta buddy_board con la carpeta de este proyecto.' },
};
const NO_PROGRAM = {
  en: "I did not find Buddy's program: install his plugin (agy plugin install <path to Buddy's repository>/core) or open Buddy's project.",
  es: 'No encontré el programa de Buddy: instala su plugin (agy plugin install <ruta del repositorio de Buddy>/core) o abre el proyecto de Buddy.',
};
const app = new App({ name: 'buddy-panel', version: '0.1.0' });
const root = document.getElementById('root');
const status = document.getElementById('status');
const WORDS = { en: { updated: 'Updated', refreshing: 'Refreshing…' }, es: { updated: 'Actualizado', refreshing: 'Actualizando…' } };
let fetched = null;
let snap = null;
let note = '';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) (k.includes('-') ? e.setAttribute(k, v) : (e[k] = v));
  for (const k of kids.flat()) if (k !== null && k !== '') e.append(k);
  return e;
};
const dim = t => el('span', { className: 'dim' }, t);
const bar = (d, t) => { const f = t > 0 ? Math.round((10 * Math.max(0, d)) / t) : 0; return '●'.repeat(f) + '○'.repeat(10 - f); };
// The open milestone's bar (R285): the board page's segmented bar, each group as wide as its count, in the page's order and colours; the counts are written beside it.
const mbar = g => el('div', { className: 'mbar', 'aria-hidden': 'true' }, GROUPS.filter(k => g[k]).map(k => el('span', { className: `s-${k}`, style: `flex:${g[k]}` })));
const flat = (ws, depth = 0) => ws.flatMap(w => [{ w, depth }, ...flat(w.under ?? [], depth + 1)]);
const clock = l => (fetched ? `${WORDS[l].updated} ${fetched.toLocaleTimeString(TEXT[l].time, { hour: '2-digit', minute: '2-digit' })}` : '');
let lastMsg = '';
const say_ = text => { status.textContent = text; };

const what = (it, l) => {
  const w = TEXT[l];
  const tasks = it.total > 0 ? w.tasks(it.done, it.total) : '';
  return el('div', { className: 'w' },
    it.of ? el('div', {}, dim(w.piece(it.of.n, it.of.total)), `«${it.of.title}»`) : el('div', {}, dim(it.label ? w.milestone : w.change)),
    el('div', {}, it.title, it.status ? dim(` (${w.status[it.status] ?? it.status})`) : ''),
    tasks ? el('div', {}, el('span', { className: 'bar', 'aria-hidden': 'true' }, bar(it.done, it.total)), ` ${tasks}`) : '');
};
const section = (title, ...kids) => el('section', {}, el('h2', {}, title), ...kids);

async function say(text) {
  try { await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }); } catch (e) { note = String(e.message ?? e); draw(); }
}
async function refresh(manual) {
  if (manual && snap) say_(WORDS[snap.lang].refreshing);
  try {
    const r = await app.callServerTool({ name: 'buddy_board', arguments: {} });
    if (r.structuredContent) { snap = r.structuredContent; fetched = new Date(); note = ''; }
  } catch (e) { note = String(e.message ?? e); }
  draw();
  if (manual && snap && !note && !snap.error) say_(clock(snap.lang));
}
async function openBoard() {
  const w = TEXT[snap?.lang ?? 'en'];
  try {
    const r = await app.callServerTool({ name: 'buddy_open_board', arguments: {} });
    const code = r.structuredContent?.code ?? 1;
    note = code === 0 ? '' : code === 3 ? w.noBuddy : w.noPage;
  } catch { note = w.noPage; }
  draw();
}

const errText = (e, l) => (e.code === 'noAnswer' ? TEXT[l].noAnswer(e.detail ?? '') : e.code === 'noRoot' ? CONNECT[l].line : e.code === 'noProgram' ? NO_PROGRAM[l] : TEXT[l][e.code]);
// The whole view is redrawn, so the focused control is found again by its key afterwards.
function draw() {
  const key = document.activeElement?.dataset?.key;
  paint();
  document.documentElement.lang = snap?.lang ?? 'en';
  const msg = snap?.error ? errText(snap.error, snap.lang) : note;
  if (msg !== lastMsg) { lastMsg = msg; say_(msg); }
  if (key) root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
}
function paint() {
  if (!snap) return root.replaceChildren(el('p', { className: 'dim' }, TEXT.en.reading));
  const l = snap.lang, w = TEXT[l];
  const refreshBtn = el('button', { onclick: () => refresh(true), 'data-key': 'refresh' }, w.refresh);
  if (snap.error) {
    if (snap.error.code === 'noRoot') return root.replaceChildren(el('p', {}, CONNECT[l].line), el('footer', {}, el('button', { className: 'p', onclick: () => say(CONNECT[l].ask), 'data-key': 'connect' }, CONNECT[l].button), refreshBtn));
    return root.replaceChildren(el('p', {}, errText(snap.error, l)), refreshBtn);
  }
  const waits = flat(snap.waiting).map(({ w: it, depth }, i) => {
    const text = shown(it.text, l);
    // Keyed by the change (its ref), not its place, so focus stays on the same thing across a redraw.
    return el('div', { className: 'w', style: `padding-left:${16 * depth}px` }, el('div', {}, text),
      el('button', { className: 'p', onclick: () => say(ask(it, l)), 'data-key': `ask:${it.ref ?? `${depth}.${i}`}`, 'aria-label': `${w.act[actOf(it)]}: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}` }, w.act[actOf(it)]));
  });
  root.replaceChildren(
    section(w.waits, waits.length ? waits : dim(w.nothingWaits)),
    section(w.now, snap.current.length ? snap.current.map(c => what(c, l)) : dim(snap.discovery ? w.discovering(snap.discovery) : w.idle)),
    section(w.next, snap.next ? what(snap.next, l) : dim(w.queue)),
    snap.milestone ? section(`${w.milestone}: ${snap.milestone.title}`, mbar(snap.milestone.groups), el('div', {}, w.progress(snap.milestone.groups, snap.milestone.total))) : '',
    note ? el('p', {}, note) : '',
    el('footer', {}, refreshBtn, el('button', { onclick: openBoard, 'data-key': 'page' }, w.page), dim(clock(l))));
}

const theme = ctx => { if (ctx?.theme) applyDocumentTheme(ctx.theme); if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables); };
app.onhostcontextchanged = theme;
app.ontoolresult = r => { if (r.structuredContent) { snap = r.structuredContent; fetched = new Date(); note = ''; draw(); } };
draw();
app.connect().then(() => { theme(app.getHostContext()); return refresh(); }, e => { note = String(e.message ?? e); draw(); });
setInterval(() => refresh(), EVERY_MS);
