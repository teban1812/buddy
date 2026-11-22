// What the plugin's hook needs to judge a `git commit` that Buddy or Dev is about to run (R111): the message, read out of the command line,
// and the secret scan of what is staged. Nothing here writes into the project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Shell words of a command: quotes and backslashes honoured, no expansion. An unquoted ; & | or newline ends a command and comes out as OP.
const OP = '\u0000';
export function words(line) {
  const out = []; let cur = '', has = false, q = null;
  const flush = () => { if (has || cur) { out.push(cur); cur = ''; has = false; } };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n') { flush(); if (out[out.length - 1] !== OP) out.push(OP); continue; }
    if (/\s/.test(c)) { flush(); continue; }
    cur += c; has = true;
  }
  flush();
  return out;
}

// The first `git commit` of a command (possibly chained or with a heredoc) -> { found, message, all, noEdit }.
// message is the text git would store, or null when it cannot be known from the command (an editor, --amend --no-edit, a file that is not there).
// The first `git commit` of a command, for callers that only need one.
export const readCommitCommand = (command, o) => readCommitCommands(command, o).commits[0] ?? { found: false };

// Every `git commit` of a command, and what the same command adds first: { commits, adds (paths of the `git add`s), addsAll (`git add -A`, `.`, `-u`) }.
export function readCommitCommands(command, { readFile = null } = {}) {
  const heredocs = []; let text = String(command);
  text = text.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$|\)|"|')/g, (_, __, tag, body) => { heredocs.push(body); return `__HEREDOC${heredocs.length - 1}__`; });
  const all = words(text); const segs = []; let cur = [];
  for (const t of all) { if (t === OP) { segs.push(cur); cur = []; } else cur.push(t); }
  segs.push(cur);
  const sub = seg => { let k = seg.findIndex(t => t === 'git' || /[\\/]git$/.test(t)); if (k < 0) return -1; for (k++; k < seg.length; k++) { if (seg[k] === '-c' || seg[k] === '-C') { k++; continue; } if (seg[k].startsWith('-')) continue; return seg[k] === 'commit' ? k : -1; } return -1; };
  const adds = []; let addsAll = false;
  for (const seg of segs) {                                    // `git add <paths>` in the same command: the hook runs before it, so it is read here
    let k = seg.findIndex(t => t === 'git' || /[\\/]git$/.test(t)); if (k < 0) continue;
    for (k++; k < seg.length && (seg[k] === '-c' || seg[k] === '-C' || seg[k].startsWith('-')); k++) if (seg[k] === '-c' || seg[k] === '-C') k++;
    if (seg[k] !== 'add') continue;
    for (const t of seg.slice(k + 1)) { if (t === '-A' || t === '--all' || t === '-u' || t === '--update' || t === '.') addsAll = true; else if (!t.startsWith('-')) adds.push(t); }
  }
  return { commits: segs.filter(s => sub(s) >= 0).map(seg => oneCommit(seg.slice(sub(seg) + 1), heredocs, readFile)), adds, addsAll };
}
function oneCommit(args, heredocs, readFile) {
  const fill = t => t.replace(/\$\(\s*cat\s*__HEREDOC(\d+)__\s*\)/g, (_, n) => heredocs[Number(n)]).replace(/__HEREDOC(\d+)__/g, (_, n) => heredocs[Number(n)]);
  const parts = [], paths = []; let file = null, everything = false, noEdit = false, rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) { paths.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    if (a === '-m' || a === '--message') parts.push(fill(args[++i] ?? ''));
    else if (a.startsWith('--message=')) parts.push(fill(a.slice(10)));
    else if (a === '-F' || a === '--file') file = args[++i];
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a === '--no-edit') noEdit = true;
    else if (a === '--all') everything = true;
    else if (/^-[a-zA-Z]+$/.test(a) && !a.startsWith('--')) { if (a.includes('a')) everything = true; if (a.endsWith('m') && a.length > 2) parts.push(fill(args[++i] ?? '')); if (a.endsWith('F') && a.length > 2) file = args[++i]; }
    else if (/^-m./.test(a)) parts.push(fill(a.slice(2)));
    else if (['-C', '-c', '--author', '--date', '-t', '--template', '--cleanup'].includes(a)) i++;
    else if (!a.startsWith('-')) paths.push(a);
  }
  let message = null;
  if (parts.length) message = parts.join('\n\n');
  else if (file === '-') message = heredocs.length ? heredocs[0] : null;
  else if (file && readFile) { try { message = readFile(file); } catch { message = null; } }
  return { found: true, message, all: everything, noEdit, paths };
}

// gitleaks: { status: 'passed' | 'failed' | 'not-run', output }. A secret never prints (--redact). A tool that is not installed, or that cannot run here,
// is `not-run` and says so (R76); only a secret found stops the commit. `tries` are the argument lists to attempt, newest gitleaks syntax first.
function leaks(cwd, cmd, tries) {
  let last = null;
  for (const args of tries) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000 });
    if (r.error) return { status: 'not-run', output: r.error.code === 'ENOENT' ? 'gitleaks is not installed' : String(r.error.message) };
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status === 0) return { status: 'passed', output: out.trim() };
    if (r.status === 1 && !/unknown (command|flag)|unknown shorthand/i.test(out)) return { status: 'failed', output: out.trim() };
    last = out;
  }
  return { status: 'not-run', output: String(last || 'gitleaks could not run').trim().slice(0, 300) };
}

// What is staged.
export const scanStaged = (cwd, { cmd = 'gitleaks' } = {}) => leaks(cwd, cmd, [['git', '--pre-commit', '--staged', '--redact', '--no-banner'], ['protect', '--staged', '--redact', '--no-banner']]);

// The files that differ from HEAD: what `git commit -a` adds (tracked ones) or `git add -A` (untracked ones too). Their whole content is read, not only the change.
// In a repository with no commit yet they are compared with git's empty tree, so every file is new.
export function changedFiles(cwd, { untracked = false } = {}) {
  const sh = (a, input) => spawnSync('git', a, { cwd, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  const run = a => (sh(a).stdout || '').split('\n').filter(Boolean);
  const from = sh(['rev-parse', '--verify', '-q', 'HEAD']).status === 0 ? 'HEAD' : (sh(['hash-object', '-t', 'tree', '--stdin'], '').stdout || '').trim();
  return [...new Set([...run(['diff', '--name-only', from]), ...(untracked ? run(['ls-files', '--others', '--exclude-standard']) : [])])];
}

// Of the paths a command names (files or folders), the files that will really change in the commit: modified against HEAD or new. A file committed
// earlier and left as it is, such as Buddy's own evidence, is not part of what is being committed and is not scanned.
export function filesToCommit(cwd, names) {
  if (!names.length) return [];
  const run = a => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); return r.status === 0 ? (r.stdout || '').split('\n').filter(Boolean) : null; };
  const head = run(['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  const changed = (head ? run(['diff', '--name-only', 'HEAD', '--', ...names]) : run(['ls-files', '--cached', '--', ...names])) || [];
  return [...new Set([...changed, ...(run(['ls-files', '--others', '--exclude-standard', '--', ...names]) || [])])].filter(f => fs.existsSync(path.resolve(cwd, f)));
}

// gitleaks on named files, one call per file: given several paths `gitleaks dir` scans far more than them. The project's .gitleaks.toml is kept.
export function scanFiles(cwd, names, { cmd = 'gitleaks' } = {}) {
  if (!names.length) return { status: 'passed', output: 'nothing to scan' };
  const config = fs.existsSync(path.join(cwd, '.gitleaks.toml')) ? ['--config', path.join(cwd, '.gitleaks.toml')] : [];
  for (const f of names) {
    const r = leaks(cwd, cmd, [['dir', '--redact', '--no-banner', ...config, f], ['detect', '--no-git', '--redact', '--no-banner', ...config, '--source', f]]);
    if (r.status !== 'passed') return r;
  }
  return { status: 'passed', output: '' };
}
