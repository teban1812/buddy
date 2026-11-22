// The routine permissions of a project built with Buddy (R157): what Claude Code runs there without asking the owner. Buddy's own program,
// the project's checks and local git; never a push, a deletion, an installation or anything outside the project. Written into the project's
// .claude/settings.json by `buddy init` (and `buddy init --permissions` for a project that already exists), merged with what the owner
// wrote there: their entries are never changed or removed.
// The rules follow Claude Code's permission syntax: `Bash(<command> *)` matches that command with any arguments (and the bare command),
// and a compound command (`a && b`) runs without asking only when each part matches a rule. PowerShell rules have the same shape.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS = path.join('.claude', 'settings.json');
export const CHECKS = ['npm run validate', 'npm run scan', 'npm run setup', 'npm test'];
export const LOCAL_GIT = ['git status', 'git diff', 'git log', 'git add', 'git commit', 'git show'];

// Buddy's program is run as `node "<plugin root>/bin/buddy.mjs" <command>`, and the plugin root is the path of the installed version, so the
// rule names the path of this installation: a plugin update moves it, and `buddy init --permissions` writes the new one. Claude Code puts the
// path in Buddy's instructions with forward slashes on Windows; the native form is kept too, and the unquoted form when the path has no spaces.
export function buddyCommands(root = PLUGIN_ROOT) {
  const cli = path.join(root, 'bin', 'buddy.mjs');
  return [...new Set([cli.split(path.sep).join('/'), cli])].flatMap(p => [`node "${p}"`, ...(/\s/.test(p) ? [] : [`node ${p}`])]);
}

export function routineRules(root = PLUGIN_ROOT) {
  const commands = [...buddyCommands(root), ...CHECKS, ...LOCAL_GIT];
  return ['Bash', 'PowerShell'].flatMap(tool => commands.map(c => `${tool}(${c} *)`));
}

// Adds the routine rules that are missing to <project>/.claude/settings.json: { change: 'created'|'merged'|'kept', added, file }.
// A settings file that is not valid JSON is not touched: it is refused, saying so.
export function writePermissions(project, { root = PLUGIN_ROOT } = {}) {
  const file = path.join(project, SETTINGS); const had = fs.existsSync(file);
  let settings = {};
  if (had) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${SETTINGS} is not valid JSON (${e.message}); it was left as it was, fix it and run buddy init --permissions again`); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${SETTINGS} does not hold a JSON object; it was left as it was`);
  }
  const permissions = settings.permissions && typeof settings.permissions === 'object' && !Array.isArray(settings.permissions) ? settings.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const missing = routineRules(root).filter(r => !allow.includes(r));
  if (!missing.length && had) return { change: 'kept', added: 0, file };
  settings.permissions = { ...permissions, allow: [...allow, ...missing] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { change: had ? 'merged' : 'created', added: missing.length, file };
}

export const PERMISSIONS_NOTE = "Buddy's program, the project's checks (npm run validate, scan, setup, npm test) and local git (status, diff, log, add, commit, show) run without asking; a push, a deletion, an installation or anything outside the project still asks";

export function permissionsAction(r) {
  const what = SETTINGS.split(path.sep).join('/');
  if (r.change === 'kept') return { done: 'kept', what, note: 'the routine permissions are already there' };
  return { done: r.change, what, note: `${r.change === 'merged' ? `${r.added} routine permission${r.added === 1 ? '' : 's'} added; the entries already there were kept. ` : ''}${PERMISSIONS_NOTE}` };
}
