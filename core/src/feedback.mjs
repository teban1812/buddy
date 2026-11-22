// buddy feedback (R100): one line about what got in the way, written to the field log of Buddy's factory (the repository
// where Buddy is built), never into the project where it happened (R85).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configFile, readConfig, updateConfig } from './config.mjs';

export { configFile };
export const LOG = path.join('docs', 'field-log.md');

// The factory: BUDDY_FACTORY wins, then the per-user config. Returns { path, from } or null.
export function factoryPath(env = process.env) {
  if (env.BUDDY_FACTORY) return { path: path.resolve(env.BUDDY_FACTORY), from: 'the BUDDY_FACTORY variable' };
  const c = readConfig(); return c.factory ? { path: c.factory, from: configFile() } : null;
}

export function setFactory(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`${abs} does not exist or is not a folder`);
  updateConfig(c => { c.factory = abs; });
  return abs;
}

// The project: the folder name of the current git repository's root, or of the current folder outside git.
export function projectName(cwd = process.cwd()) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return path.basename(r.status === 0 ? r.stdout.trim() : path.resolve(cwd));
}

export function buddyVersion(manifest) {
  try { return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || 'unknown'; } catch { return 'unknown'; }
}

const HEADER = ['# Field log', '',
  'What real projects taught Buddy, one line each, written by `buddy feedback` from the project where it happened. The owner decides here what becomes a change, weighing it against Buddy\'s purpose.', '',
  '| Date | Project | Buddy | What happened |', '| :-- | :-- | :-- | :-- |', ''].join('\n');
const cell = s => String(s).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

export function appendFeedback(factory, { text, project, version, date = new Date().toISOString().slice(0, 10) }) {
  const words = cell(text ?? ''); if (!words) throw new Error('the feedback is empty: say what happened, buddy feedback "<text>"');
  if (!fs.existsSync(factory) || !fs.statSync(factory).isDirectory()) throw new Error(`Buddy's factory ${factory} does not exist or is not a folder; set it again with: buddy feedback --factory <path>`);
  const file = path.join(factory, LOG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER;
  if (body && !body.endsWith('\n')) body += '\n';
  const line = `| ${date} | ${cell(project)} | ${cell(version)} | ${words} |`;
  fs.writeFileSync(file, body + line + '\n');
  return { file, line };
}
