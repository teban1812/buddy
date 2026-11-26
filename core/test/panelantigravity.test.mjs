import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Antigravity's panel (buddy-mod, build-antigravity-panel): the plugin's server runs without Antigravity. The tests speak MCP to the built bundle over stdio
// as the host does: list its tools and resources, read the ui:// page, call the tool. No package is needed to run them.
const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'panel', 'antigravity');
const CLAUDE = path.join(PLUGIN, '..', 'claude', 'hooks');
const tmp = p => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const BOARD = { now: '2026-11-23T10:00:00Z', current: [{ id: 'a', title: 'Piece A', change: 'c' }], slices: [{ id: 'c', title: 'The change', change: null, rank: 1 }, { id: 'a', title: 'Piece A', change: 'c', rank: 2, steps: { done: 1, total: 4 } }],
  next: { id: 'n', title: 'Next one', status: 'ready', change: null }, milestones: [{ id: 'm', title: 'Version 1', status: 'building', changes: { accepted: 2, total: 5 }, groups: { done: 2, owner: 1, agent: 1, define: 1 } }],
  view: [{ kind: 'accept', text: 'try and accept: Save books [save-books] (the reviews left 1 note)', ref: 'save-books' }] };

function project(program) {
  const d = tmp('panelag-'); fs.mkdirSync(path.join(d, 'docs', 'buddy'), { recursive: true });
  if (program) { fs.mkdirSync(path.join(d, 'core', 'bin'), { recursive: true }); fs.writeFileSync(path.join(d, 'core', 'bin', 'buddy.mjs'), program); }
  return d;
}
const fakeBuddy = `import fs from 'node:fs'; const a = process.argv.slice(2);
if (a[1] === '--out') fs.writeFileSync(a[2], '<html></html>'); else console.log(${JSON.stringify(JSON.stringify(BOARD))});`;

// A tiny MCP client: one JSON message per line, as the stdio transport sends them.
async function session(cwd, env = {}, fn, roots) {
  const home = tmp('panelag-home-');
  const p = spawn(process.execPath, [path.join(PLUGIN, 'dist', 'server.mjs')], { cwd, env: { ...process.env, BUDDY_HOME: home, PATH: path.join(home, 'nobin'), ...env } });
  let buf = ''; const waiting = new Map(); let id = 0;
  p.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.method === 'roots/list') p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { roots: roots() } }) + '\n'); else waiting.get(m.id)?.(m); } });
  const call = (method, params = {}) => new Promise((res, rej) => { const n = ++id; const t = setTimeout(() => rej(new Error(`no answer to ${method}`)), 20_000); waiting.set(n, m => { clearTimeout(t); res(m); }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: roots ? { roots: { listChanged: true } } : {}, clientInfo: { name: 'test', version: '0' } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return await fn(call, init.result, home);
  } finally { p.kill(); }
}

test('the plugin is declared the way Antigravity reads it, and its bundle is current', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8'));
  assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'mcp_config.json'), 'utf8'));
  assert.deepEqual(Object.values(cfg.mcpServers)[0], { command: 'node', args: ['${PLUGIN_ROOT}/dist/server.mjs'] });
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/, 'versions are pinned exactly');
  assert.ok(!fs.existsSync(path.join(PLUGIN, '..', '..', 'core', 'node_modules')) && !JSON.parse(fs.readFileSync(path.join(PLUGIN, '..', '..', 'core', '.claude-plugin', 'plugin.json'), 'utf8')).dependencies, 'core keeps no dependency');
  // The bundle is what `npm run build` makes from src/: checked only where the build's packages are installed.
  if (fs.existsSync(path.join(PLUGIN, 'node_modules', 'esbuild'))) assert.equal(spawnSync(process.execPath, ['build.mjs', '--check'], { cwd: PLUGIN }).status, 0, 'dist/server.mjs is stale: run `npm run build` in panel/antigravity');
});

test('the server lists its two tools and its one page, and the page is served as an MCP App', async () => {
  await session(project(fakeBuddy), {}, async (call, init) => {
    assert.ok(init.capabilities.tools && init.capabilities.resources);
    const tools = (await call('tools/list')).result.tools;
    const board = tools.find(t => t.name === 'buddy_board'), open = tools.find(t => t.name === 'buddy_open_board');
    assert.equal(board._meta.ui.resourceUri, 'ui://buddy/panel.html');
    assert.deepEqual(board._meta['com.google.antigravity/ui'].entrypoints, [{ type: 'aux_pane', title: 'Buddy' }]);
    assert.deepEqual(open._meta.ui.visibility, ['app']);
    const res = (await call('resources/list')).result.resources;
    assert.deepEqual(res.map(r => [r.uri, r.mimeType]), [['ui://buddy/panel.html', 'text/html;profile=mcp-app']]);
    const page = (await call('resources/read', { uri: 'ui://buddy/panel.html' })).result.contents[0];
    assert.equal(page.mimeType, 'text/html;profile=mcp-app');
    assert.match(page.text, /^<!doctype html>/); assert.match(page.text, /<script>/);
    assert.ok(page.text.includes('sendMessage') && page.text.includes('buddy_board') && page.text.includes('buddy_open_board') && page.text.includes('3e4'), 'the page sends messages, calls both tools and refreshes every 30 s');
    assert.ok(!page.text.includes('/Users/'), 'no personal folder in the page');
    // The audit's findings (docs/research/2026-11-23-buddy-mod-ux-audit.md): the page follows the host's theme, keeps focus by key, declares its language,
    // names each Ask button by its change, announces messages and labels the time. Read from the page's text: no browser runs here.
    for (const [what, text] of [['the host theme', 'onhostcontextchanged'], ['the host colours', '--color-text-primary'], ['focus kept by a key', 'data-key'], ['the language of the page', '<html lang="en">'],
      ['a name for each Ask button', 'aria-label'], ['announced messages', 'aria-live="polite"'], ['the time labelled', 'Actualizado'], ['the time labelled', 'Updated'], ['the refresh acknowledged', 'Actualizando']]) assert.ok(page.text.includes(text), what);
    assert.ok(page.text.includes('documentElement.lang') && page.text.includes('.focus()'), 'the language follows the one shown and focus is put back after a redraw');
  });
});

test('buddy_board answers the short view from the board, in English, and in Spanish when the machine says so', async () => {
  const d = project(fakeBuddy);
  await session(d, {}, async call => {
    const s = (await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent;
    assert.equal(s.lang, 'en'); assert.equal(s.error, null);
    assert.deepEqual(s.milestone, { id: 'm', title: 'Version 1', total: 5, groups: { done: 2, owner: 1, agent: 1, define: 1 } });
    assert.deepEqual(s.current[0], { id: 'a', title: 'Piece A', of: { title: 'The change', n: 1, total: 1 }, done: 1, total: 4, status: '' });
    assert.equal(s.next.title, 'Next one'); assert.equal(s.waiting[0].ref, 'save-books');
  });
  const home = tmp('panelag-es-'); fs.writeFileSync(path.join(home, 'environment.json'), '{"language":"es"}');
  await session(d, { BUDDY_HOME: home }, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.lang, 'es'));
});

test('buddy_board says what is wrong when there is no Buddy or no program; BUDDY_PROJECT points it to the project', async () => {
  await session(tmp('panelag-none-'), {}, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error.code, 'noRoot', 'no root offered and no project known: it says so'));
  const asked = tmp('panelag-noproj-'); await session(tmp('panelag-none-'), {}, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error.code, 'noBuddy'), () => [{ uri: pathToFileURL(asked).href }]);
  await session(project(null), { HOME: tmp('panelag-h-'), USERPROFILE: tmp('panelag-h-'), CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'panelag-nothing') }, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error.code, 'noProgram'));
  await session(tmp('panelag-elsewhere-'), { BUDDY_PROJECT: project(fakeBuddy) }, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error, null));
});

test('buddy_open_board writes the full page to .buddy/board.html and says 6 when no browser opens', { skip: process.platform === 'win32' }, async () => {
  const d = project(fakeBuddy);
  await session(d, {}, async call => {
    assert.equal((await call('tools/call', { name: 'buddy_open_board', arguments: {} })).result.structuredContent.code, 6);
    assert.ok(fs.existsSync(path.join(d, '.buddy', 'board.html')));
  });
});

// R284 (open-board-with-own-buddy): in a project without core/bin, the server takes the Buddy installed in Antigravity, for the short view and the page.
test('outside Buddy\'s repository the server prefers the Buddy installed in Antigravity to Claude Code\'s, for the short view and the page alike', { skip: process.platform === 'win32' }, async () => {
  const d = project(null), home = tmp('panelag-tools-');
  const put = (file, title) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, fakeBuddy.replace('Version 1', title).replace("'<html></html>'", JSON.stringify(title))); };
  put(path.join(home, '.claude', 'plugins', 'cache', 'cat', 'buddy', '0.4.0', 'bin', 'buddy.mjs'), 'from Claude Code');
  put(path.join(home, '.gemini', 'config', 'plugins', 'buddy', 'bin', 'buddy.mjs'), 'from Antigravity');
  await session(d, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' }, async call => {
    assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.milestone.title, 'from Antigravity');
    await call('tools/call', { name: 'buddy_open_board', arguments: {} });
    assert.equal(fs.readFileSync(path.join(d, '.buddy', 'board.html'), 'utf8'), 'from Antigravity');
  });
});

test('the panel shares Claude Code\'s finder and words (one source) and follows its reading of the board and its requests', async () => {
  const bundle = fs.readFileSync(path.join(PLUGIN, 'dist', 'server.mjs'), 'utf8');
  const { SCRIPT } = await import(pathToFileURL(path.join(CLAUDE, 'find.js')).href); const { TEXT } = await import(pathToFileURL(path.join(CLAUDE, 'words.js')).href);
  assert.ok(bundle.includes(JSON.stringify(SCRIPT).slice(1, -1).slice(0, 80)) || bundle.includes(SCRIPT.slice(0, 80)), 'the bundle carries the finder of panel/claude');
  assert.ok(bundle.includes(TEXT.es.waits) && bundle.includes(TEXT.en.waits) && bundle.includes(TEXT.es.act.group), 'and its words');
  assert.ok(bundle.includes('Probar y aceptar') && bundle.includes('Try and accept') && !bundle.includes('va al cuadro de texto') && !bundle.includes('Pedírselo a Buddy'), 'the buttons name their act, with no hint (R259)');
  // R285: the milestone's bar is the board page's segmented bar, in its colours, light and dark, and its counts are the panel's words.
  const style = fs.readFileSync(path.join(PLUGIN, '..', '..', 'core', 'src', 'board.mjs'), 'utf8').match(/const style = `([^\n]*)\n@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}/);
  const hex = (css, k) => css.match(new RegExp(`--${k}:(#[0-9a-f]+)`))[1];
  for (const k of ['done', 'owner', 'agent', 'define']) assert.ok(bundle.includes(`.s-${k}{background:light-dark(${hex(style[1], k)},${hex(style[2], k)})}`), `the ${k} group in the page's colour`);
  assert.ok(bundle.includes('mbar') && bundle.includes('your turn') && bundle.includes('te toca a ti'), 'a segmented bar with its counts in both languages');
  // Copied from register.tsx, so they must not drift: the rules that choose what a button asks, and how the board's lines become the view.
  const claude = fs.readFileSync(path.join(PLUGIN, '..', 'claude', 'hooks', 'register.tsx'), 'utf8');
  const mine = fs.readFileSync(path.join(PLUGIN, 'src', 'view.js'), 'utf8');
  const rules = s => [...s.matchAll(/^\s*(?:if \(w\.kind[^\n]*|const (?:open|n|q|what|pieces|steps|rows) = [^\n]*|waiting: [^\n]*|current: [^\n]*|next: [^\n]*|milestone: [^\n]*)/gm)].map(m => m[0].trim().replace(/: Snapshot|: Waiting|: Lang|[ ]as const/g, '').replace(/\s+/g, ' ').replace(/;$/, ''));
  for (const line of rules(mine)) if (/ms\.find|b\.next|b\.view/.test(line)) assert.ok(rules(claude).includes(line), `drifted from panel/claude/hooks/register.tsx: ${line}`);
  assert.ok(claude.includes('q[actOf(w)]') && mine.includes('q[actOf(w)]'), 'both choose the request by the one classification, actOf (R259)');
});

test('the project is the first workspace root the client offers that holds docs/buddy, asked at each call; with none, the server\'s folder', async () => {
  const other = tmp('panelag-other-'), proj = project(fakeBuddy); let offered = [other, proj];
  const uris = () => offered.map(d => ({ uri: pathToFileURL(d).href, name: 'w' }));
  await session(tmp('panelag-server-'), {}, async call => {
    const s = (await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent;
    assert.equal(s.error, null); assert.equal(s.milestone.id, 'm');
    offered = [other];   // the workspace changed: no root holds Buddy now
    assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error.code, 'noBuddy');
  }, uris);
  const d = project(fakeBuddy);   // the server's own folder is used when the roots hold no Buddy and nothing else is set... only if it is a project
  await session(d, {}, async call => assert.equal((await call('tools/call', { name: 'buddy_board', arguments: {} })).result.structuredContent.error, null), () => [{ uri: pathToFileURL(other).href }]);
});

test('the agent passes the open project to buddy_board: it is remembered, kept in PLUGIN_DATA across a restart, and a folder that is not a project is refused', async () => {
  const proj = project(fakeBuddy), data = path.join(tmp('panelag-data-'), 'nested'), server = tmp('panelag-plugin-');
  const board = (call, args = {}) => call('tools/call', { name: 'buddy_board', arguments: args });
  await session(server, { PLUGIN_DATA: data }, async call => {
    assert.equal((await board(call)).result.structuredContent.error.code, 'noRoot', 'nothing known yet');
    const given = (await board(call, { project: proj })).result.structuredContent;
    assert.equal(given.error, null); assert.equal(given.milestone.id, 'm');
    assert.equal((await board(call)).result.structuredContent.milestone.id, 'm', 'the page\'s own calls (no argument) use the remembered project');
    for (const bad of [tmp('panelag-notbuddy-'), 'relative/folder']) {
      const r = (await board(call, { project: bad })).result;
      assert.equal(r.isError, true); assert.match(r.content[0].text, /not a Buddy project/);
    }
    assert.equal((await board(call)).result.structuredContent.milestone.id, 'm', 'a refused folder does not forget the good one');
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'project.json'), 'utf8')), { project: proj });
  await session(server, { PLUGIN_DATA: data }, async call => assert.equal((await board(call)).result.structuredContent.milestone.id, 'm', 'a restart reads it from PLUGIN_DATA'));
  const page = fs.readFileSync(path.join(PLUGIN, 'dist', 'server.mjs'), 'utf8');
  assert.ok(page.includes('Connect to this project') && page.includes('Conectar con este proyecto'), 'the page offers to connect, in both languages');
});

// R287 (find-project-from-subfolder): a folder inside a project, passed by the agent, offered as a root or the server's own, is that project (the nearest one up).
test('a folder inside a project is that project: passed, offered as a root or the server\'s own; it remembers the project\'s root; a project inside another is itself', async () => {
  const proj = project(fakeBuddy), data = path.join(tmp('panelag-data-'), 'sub');
  const sub = path.join(proj, 'docs', 'buddy', 'milestones'); fs.mkdirSync(sub, { recursive: true });
  const board = (call, args = {}) => call('tools/call', { name: 'buddy_board', arguments: args });
  await session(tmp('panelag-plugin-'), { PLUGIN_DATA: data }, async call => {
    const s = (await board(call, { project: sub })).result.structuredContent;
    assert.equal(s.error, null); assert.equal(s.milestone.id, 'm');
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'project.json'), 'utf8')), { project: proj }, 'the project\'s root is remembered, not the subfolder');
  await session(tmp('panelag-server-'), {}, async call => assert.equal((await board(call)).result.structuredContent.error, null), () => [{ uri: pathToFileURL(sub).href }]);
  await session(sub, {}, async call => assert.equal((await board(call)).result.structuredContent.error, null));
  const inner = path.join(proj, 'apps', 'inner'); fs.mkdirSync(path.join(inner, 'docs', 'buddy'), { recursive: true });
  const innerData = path.join(tmp('panelag-data-'), 'inner');
  await session(tmp('panelag-plugin-'), { PLUGIN_DATA: innerData }, async call => assert.equal((await board(call, { project: path.join(inner, 'docs') })).result.isError, undefined));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(innerData, 'project.json'), 'utf8')), { project: inner }, 'the nearest project wins');
});

// build-and-test-the-prototype, AC3: the discovery's stage reaches the short view, and its words are the board's, in both languages.
test('the short view carries the discovery\'s stage and the panel words it as the board does', async () => {
  const { fromBoard } = await import(pathToFileURL(path.join(PLUGIN, 'src', 'view.js')).href); const { TEXT } = await import(pathToFileURL(path.join(CLAUDE, 'words.js')).href);
  assert.equal(fromBoard({ now: 'x', current: [], discovery: 3 }, 'en').discovery, 3); assert.equal(fromBoard({ now: 'x' }, 'en').discovery, null);
  assert.equal(TEXT.en.discovering(1), 'Discovering the product: stage 1 of 3 (research and brief)');
  assert.equal(TEXT.es.discovering(3), 'Descubriendo el producto: etapa 3 de 3 (prototipo y su prueba)');
  const { loadBoard, boardText } = await import('../src/board.mjs'); const d = tmp('panelag-disc-'); fs.mkdirSync(path.join(d, 'docs', 'discovery', 'wireframes'), { recursive: true });
  const b = loadBoard(d, '2026-11-25T00:00:00Z'); assert.equal(b.discovery, 2); assert.ok(boardText(b).includes(TEXT.en.discovering(2)), 'the same words as the text board');
  const bundle = fs.readFileSync(path.join(PLUGIN, 'dist', 'server.mjs'), 'utf8'); assert.ok(bundle.includes('Descubriendo el producto'), 'the bundle is current');
});

// R276 AC5: each panel's missing-program message names how to install Buddy in the tool it runs in.
test('each panel\'s missing-program message names how to install Buddy in its tool', async () => {
  const { TEXT } = await import(pathToFileURL(path.join(CLAUDE, 'words.js')).href);
  assert.match(TEXT.en.noProgram, /claude plugin install buddy@buddy/);
  assert.match(TEXT.es.noProgram, /claude plugin install buddy@buddy/);
  const page = fs.readFileSync(path.join(PLUGIN, 'src', 'page.js'), 'utf8');
  assert.match(page, /agy plugin install <path to Buddy's repository>\/core/);
  assert.match(page, /agy plugin install <ruta del repositorio de Buddy>\/core/);
  const bundle = fs.readFileSync(path.join(PLUGIN, 'dist', 'server.mjs'), 'utf8');
  assert.match(bundle, /agy plugin install <path to Buddy\\?'s repository>\/core/, 'Antigravity bundle carries its install command in EN');
  assert.ok(bundle.includes('agy plugin install <ruta del repositorio de Buddy>/core'), 'Antigravity bundle carries its install command in ES');
});
