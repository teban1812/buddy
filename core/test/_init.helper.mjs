import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

export const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
// Every run has a private home (so the user's own ~/.buddy is never read or touched) and no BUDDY_LIBRARY, unless given.
export const HOME = tmp();
export const run = (args, cwd, { home = HOME, env = {} } = {}) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home }; delete e.BUDDY_LIBRARY;
  return spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd, env: { ...e, ...env } });
};
export const g = (cwd, c) => execSync(`git -c core.autocrlf=false -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8' });
export const snapshot = dir => { const out = {}; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) { out[path.relative(dir, p) + '/'] = ''; walk(p); } else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); } }; walk(dir); return out; };

// --- libraries: a small fake library, local and in git; never the network ---
export const BIN = Buffer.from([0, 1, 2, ...Buffer.from('BuddyApp'), 0]);
export const put = (root, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); } };
// standards/general (unless general: false), standards/x and standards/y; templates/x: a base application named with the
// placeholders, whose validate checks the renaming; templates/empty: an empty project whose validate passes.
export const EMPTY_TEMPLATE = {
  'templates/empty/README.md': '# BuddyApp\n', 'templates/empty/.gitignore': 'node_modules/\n', 'templates/empty/.editorconfig': 'root = true\n',
  'templates/empty/package.json': JSON.stringify({ name: 'buddy-app', private: true, scripts: { validate: 'node -e "console.log(\'nothing is checked yet\')"' } }, null, 2) + '\n',
};
// The pipelines of templates/x, one per host (unless pipelines: false); the empty template brings none.
export const PIPELINES = { 'templates/x/.github/workflows/validate.yml': 'name: buddy-app\non: push\n', 'templates/x/azure-pipelines.yml': "trigger: ['*']\n# buddy-app\n" };
export function fakeLibrary({ scripts = { validate: 'node check.mjs' }, general = true, pipelines = true } = {}) {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')); g(lib, 'init -q');
  if (general) put(lib, { 'standards/general/team.md': '---\nlifecycle: evergreen\n---\n# team\n' });
  put(lib, EMPTY_TEMPLATE);
  put(lib, {
    'standards/x/rules.md': '# rules\n', 'standards/x/web/react.md': '# react\n', 'standards/y/other.md': '# other\n',
    'templates/x/package.json': JSON.stringify({ name: 'buddy-app', private: true, ...(scripts ? { scripts } : {}) }, null, 2) + '\n',
    'templates/x/check.mjs': "import fs from 'node:fs';\nif (!fs.readFileSync('src/BuddyApp.Api/Program.cs', 'utf8').includes('namespace BuddyApp.Api;')) process.exit(1);\n",
    'templates/x/src/BuddyApp.Api/Program.cs': 'namespace BuddyApp.Api;\n// served at /buddy-app\n',
    'templates/x/README.md': '# BuddyApp v1\n', 'templates/x/assets/logo.bin': BIN,
    ...(pipelines ? PIPELINES : {}),
  });
  g(lib, 'add -A'); g(lib, 'commit -q -m v1'); g(lib, 'tag v1');
  const v1 = g(lib, 'rev-parse HEAD').trim();
  put(lib, { 'templates/x/README.md': '# BuddyApp v2\n' }); g(lib, 'commit -q -am v2');
  return { lib, v1, head: g(lib, 'rev-parse HEAD').trim() };
}
export const project = name => { const d = path.join(tmp(), name); fs.mkdirSync(d); return d; };
export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
