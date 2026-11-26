import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { SCRIPT } from '../../claude/hooks/find.js';
import { lang } from '../../claude/hooks/words.js';
import { empty, fromBoard } from './view.js';

// Antigravity's panel (R251, R255, R257): an MCP App. This server holds one page (`ui://buddy/panel.html`, built into __PAGE__) and two tools: `buddy_board`
// (opens the panel beside the conversation and answers with the short view; the page calls it again every 30 seconds and on its refresh button) and
// `buddy_open_board` (the page's button for the full board, hidden from the model). The finder and the words are Claude Code's panel's (panel/claude/hooks).
// Antigravity starts the server in its plugin folder and offers no workspace (its roots are not sent), so the project is, in this order: the folder the agent
// passes to `buddy_board` (remembered, in memory and in ${PLUGIN_DATA}/project.json so a restart keeps it); the first workspace root the client offers that
// holds docs/buddy (asked at each call, for a client that does offer them); BUDDY_PROJECT; the remembered project; the server's own folder. With none of
// them, the panel says so (`noRoot`) and offers to ask the agent to connect it. A folder inside a project counts as that project: the nearest folder holding
// docs/buddy going up, as the finder looks for it (R287), so a project inside another is itself.
const URI = 'ui://buddy/panel.html';
let server;
let remembered = null, loaded = false;
const top = d => {
  if (typeof d !== 'string' || !path.isAbsolute(d)) return null;
  for (let x = path.resolve(d); ; x = path.dirname(x)) { if (fs.existsSync(path.join(x, 'docs', 'buddy'))) return x; if (path.dirname(x) === x) return null; }
};
const file = () => (process.env.PLUGIN_DATA ? path.join(process.env.PLUGIN_DATA, 'project.json') : '');
function recall() {
  if (!loaded) {
    loaded = true;
    try { const d = top(JSON.parse(fs.readFileSync(file(), 'utf8')).project); if (d) remembered = d; } catch { /* nothing remembered */ }
  }
  return remembered;
}
function remember(d) {
  remembered = d; loaded = true;
  try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify({ project: d })); } catch { /* memory only */ }
}
async function where(given) {
  if (given !== undefined) { const d = top(given); if (!d) return { refused: given }; remember(d); return { dir: d }; }
  let roots = [];
  if (server.server.getClientCapabilities()?.roots) {
    try { roots = (await server.server.listRoots()).roots.map(r => fileURLToPath(r.uri)); } catch { roots = []; }
  }
  const root = roots.map(top).find(Boolean);
  if (root) return { dir: root };
  if (process.env.BUDDY_PROJECT) return { dir: process.env.BUDDY_PROJECT };
  const known = recall();
  return { dir: known ?? process.cwd(), noRoot: !known && roots.length === 0 };
}
// `antigravity` tells the finder to prefer the Buddy installed in Antigravity, the one its conversation uses (R284).
const run = (mode, cwd) => spawnSync(process.execPath, ['-e', SCRIPT, mode, 'antigravity'], { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 28 });

async function snapshot(given) {
  const { dir, noRoot } = await where(given);
  const g = run('language', dir);
  const l = lang((g.stdout ?? '').trim());
  const r = run('json', dir);
  if (r.status === 3) return empty({ code: noRoot ? 'noRoot' : 'noBuddy' }, l);
  if (r.status === 4) return empty({ code: 'noProgram' }, l);
  if (r.status !== 0) return empty({ code: 'noAnswer', detail: String(r.stderr || r.stdout || r.error || '').trim().slice(0, 200) }, l);
  try { return fromBoard(JSON.parse(r.stdout), l); } catch (e) { return empty({ code: 'noAnswer', detail: String(e).slice(0, 200) }, l); }
}

function createServer() {
  server = new McpServer({ name: 'buddy-panel', version: '0.1.0' });
  registerAppResource(server, 'Buddy panel', URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({ contents: [{ uri: URI, mimeType: RESOURCE_MIME_TYPE, text: __PAGE__ }] }));
  registerAppTool(server, 'buddy_board', {
    title: 'Buddy',
    description: 'Shows what waits for the owner, what Buddy is building now, what comes next and the milestone in progress, in a panel beside the conversation. Pass `project`: the absolute folder of the project the user has open.',
    inputSchema: { project: z.string().optional().describe('The absolute folder of the project the user has open in Antigravity (the one holding docs/buddy). Always pass it.') },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: URI }, 'com.google.antigravity/ui': { entrypoints: [{ type: 'aux_pane', title: 'Buddy' }] } },
  }, async ({ project }) => {
    if (project !== undefined && !top(project)) return { isError: true, content: [{ type: 'text', text: `${project} is not a Buddy project (an absolute folder holding docs/buddy, or one inside it): pass the folder of the project the user has open.` }] };
    return { content: [{ type: 'text', text: 'The Buddy panel is open beside the conversation.' }], structuredContent: await snapshot(project) };
  });
  registerAppTool(server, 'buddy_open_board', {
    title: 'Open the full board',
    description: "Writes the board's full page to .buddy/board.html and opens it in the browser.",
    inputSchema: {},
    _meta: { ui: { resourceUri: URI, visibility: ['app'] } },
  }, async () => {
    const r = run('open', (await where()).dir);
    return { content: [{ type: 'text', text: r.status === 0 ? 'opened' : 'not opened' }], structuredContent: { code: r.status ?? 1 } };
  });
  return server;
}

await createServer().connect(new StdioServerTransport());
