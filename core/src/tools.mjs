// The setting of each environment (support-antigravity, step 3): which tools this machine has (claude = Claude Code, agy = Antigravity) and the words
// that turn a level (economical, balanced, strong) into a model. Dev and the reviewer work in the tool Buddy runs in (R235, R238): no tool per role. It is one small file in the user's
// own home folder (~/.buddy/environment.json, or $BUDDY_HOME/environment.json), never in the project, so it does not travel through git.
// Only what the owner or a correction changed is written; the rest is worked out each time from what Buddy finds, so a tool installed later shows up.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TOOLS = { claude: 'Claude Code', agy: 'Antigravity' };
// The registry names a tool in general terms (never the model): claude-code or antigravity.
export const RUNTIMES = { claude: 'claude-code', agy: 'antigravity' };
export const toolOfRuntime = r => Object.keys(RUNTIMES).find(t => t === r || RUNTIMES[t] === r || TOOLS[t] === r);
export const LEVELS = ['economical', 'balanced', 'strong'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const CLAUDE_WORDS = ['haiku', 'sonnet', 'opus'];
const BASE_WORDS = { claude: { economical: 'haiku', balanced: 'sonnet', strong: 'opus' }, agy: { economical: 'flash', balanced: null, strong: null } };

export const settingFile = (env = process.env) => path.join(env.BUDDY_HOME || path.join(os.homedir(), '.buddy'), 'environment.json');

export function readSetting(env = process.env) {
  let text; try { text = fs.readFileSync(settingFile(env), 'utf8'); } catch { return {}; }
  try { const s = JSON.parse(text); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; }
  catch (e) { throw new Error(`your environment setting ${settingFile(env)} is not valid JSON (${e.message}); fix or delete it and try again`); }
}
export function changeSetting(fn, env = process.env) {
  const s = readSetting(env); fn(s);
  fs.mkdirSync(path.dirname(settingFile(env)), { recursive: true }); fs.writeFileSync(settingFile(env), JSON.stringify(s, null, 2) + '\n');
  return s;
}

// Which of the two tools are on this machine: a program of that name on the path, or Antigravity's bundled binary (~/.gemini/bin/agy) used by the IDE and App.
export function toolCommand(tool, env = process.env) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (dirs.some(d => exts.some(x => exists(path.join(d, tool + x))))) return tool;
  if (tool === 'agy') {
    const home = env.HOME || env.USERPROFILE || (env === process.env ? os.homedir() : '');
    const bundled = home && exts.map(x => path.join(home, '.gemini', 'bin', 'agy' + x)).find(exists);
    if (bundled) return bundled;
  }
  return null;
}
export function findTools(env = process.env) {
  return Object.keys(TOOLS).filter(t => toolCommand(t, env));
}
// The tool Buddy himself runs in: BUDDY_TOOL if set, Claude Code when it passed its plugin variables, else Antigravity when that is on the machine.
export function runsIn(env = process.env, found = findTools(env)) {
  if (env.BUDDY_TOOL in TOOLS) return env.BUDDY_TOOL;
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDECODE) return 'claude';
  return found.includes('agy') ? 'agy' : 'claude';
}

// What is in force: Dev and the reviewer in the tool Buddy runs in (R235, R238; a review by another tool is the owner's to run at will), and the words set.
export function effective(env = process.env) {
  const s = readSetting(env), found = findTools(env), here = runsIn(env, found);
  const dev = found.includes(here) || !found.length ? here : found[0], reviewer = dev;
  const levels = {};
  for (const t of Object.keys(TOOLS)) { levels[t] = {}; for (const l of LEVELS) levels[t][l] = { word: BASE_WORDS[t][l], ...s.levels?.[t]?.[l] }; }
  return { found, runsIn: here, dev, reviewer, levels, notes: s.notes || [], file: settingFile(env) };
}

// What the tool offers today: Antigravity lists its models (`agy models`: an id and a name per line, the effort being the id's last part);
// Claude Code takes the words haiku, sonnet and opus for the latest of each. `run` is the way to run a program (a stand-in in tests).
export function offers(tool, { run = spawnSync, env = process.env } = {}) {
  if (tool === 'claude') return { models: CLAUDE_WORDS, efforts: [...EFFORTS, 'max'] };
  const cmd = toolCommand('agy', env);
  if (!cmd) return { models: [], efforts: [], error: 'Antigravity CLI (agy) was not found on PATH or in ~/.gemini/bin/agy' };
  const r = run(cmd, ['models'], { encoding: 'utf8', env, timeout: 60000 });
  const models = String(r.stdout || '').split('\n').filter(l => l.includes('\t')).map(l => l.split('\t')[0].trim()).filter(Boolean);
  return { models, efforts: EFFORTS.filter(e => models.some(m => m.endsWith(`-${e}`))), error: r.error || r.status ? `agy models gave no list (${r.error?.code || `exit ${r.status}`})` : models.length ? undefined : 'agy models gave no list' };
}

// The nearest word that still matches something offered: the same family (a part of the old word that an offered model still carries), else none.
const nearest = (word, models) => String(word).split(/[^a-z]+/i).filter(p => p.length >= 3).sort((a, b) => b.length - a.length).find(p => models.some(m => m.includes(p)));

// Turns a level into what to ask the tool for: { tool, level, model, effort, notes } (model undefined: the tool's default). A word that matches nothing is
// replaced by the nearest family, else the tool's default; Buddy carries on and, with `save`, writes the corrected word into the setting and a note
// for the owner's next summary (AC11). A word that is not offered as an effort is ignored, and says so (AC10).
export function resolveLevel(tool, level, { env = process.env, offer = offers(tool, { env }), save = true } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`a level is one of ${LEVELS.join(', ')}, not ${level}`);
  const { word, effort } = effective(env).levels[tool]?.[level] ?? {};
  const notes = []; let use = word;
  const match = w => offer.models.filter(m => m.includes(w));
  if (offer.error) notes.push(`${TOOLS[tool]} gave no list of models (${offer.error}): its default is used`);
  else if (!word) notes.push(`no word for the ${level} level of ${TOOLS[tool]}: its default model is used`);
  else if (!match(word).length) {
    use = nearest(word, offer.models) ?? null;
    notes.push(`"${word}" matches nothing ${TOOLS[tool]} offers any more: ${use ? `"${use}", the same family, is used` : 'its default model is used'}`);
    if (save) changeSetting(s => {
      const slot = ((s.levels ??= {})[tool] ??= {}); slot[level] = { ...slot[level], word: use };
      (s.notes ??= []).push(`The ${level} word of ${TOOLS[tool]} was "${word}", which it no longer offers; Buddy took ${use ? `"${use}"` : 'the tool\'s default'} and wrote it in your setting.`);
    }, env);
  }
  const found = use && !offer.error ? match(use) : [];
  let model = tool === 'claude' ? found[0] : found.find(m => effort && m.endsWith(`-${effort}`)) ?? found[0];
  let usedEffort;
  if (effort && !offer.efforts.includes(effort)) notes.push(`${TOOLS[tool]} offers no "${effort}" effort: it is ignored`);
  else if (effort && tool === 'agy' && !model?.endsWith(`-${effort}`)) notes.push(`${model || 'the default model'} has no "${effort}" version: its default effort is used`);
  else if (effort && tool === 'claude') usedEffort = effort;
  return { tool, level, model, effort: usedEffort, notes };
}

// What an ask runs with (step 4): the tool Buddy runs in, for every role, the flags that choose its model and effort, and the notes resolveLevel made.
// The reviewer is a fresh session of that tool at the strong level when the tool offers it apart from the balanced one (R233, R235).
// `model` is a word given by hand (--model): it skips the level.
export function plan(role, level, { env = process.env, model } = {}) {
  const tool = effective(env).dev, cmd = toolCommand(tool, env) || tool;
  if (model) return { tool, cmd, level, notes: [], flags: ['--model', model] };
  const offer = offers(tool, { env });
  if (role === 'reviewer') { const at = l => resolveLevel(tool, l, { env, offer, save: false }); if (at('strong').model && at('strong').model !== at('balanced').model) level = 'strong'; }
  const r = resolveLevel(tool, level, { env, offer });
  return { tool, cmd, level, notes: r.notes, flags: [...(r.model ? ['--model', r.model] : []), ...(r.effort ? ['--effort', r.effort] : [])] };
}

// The corrections Buddy made for the owner's next summary, and the acknowledgement that clears them.
export const pendingNotes = env => readSetting(env).notes || [];
export const clearNotes = env => changeSetting(s => { delete s.notes; }, env);

// Changes: a level's word, with an optional effort word (`-` as the word or the effort takes it away).
export function setWord(tool, level, word, effort, env = process.env) {
  if (!(tool in TOOLS)) throw new Error(`the tool is one of ${Object.keys(TOOLS).join(', ')}, not ${tool}`);
  if (!LEVELS.includes(level)) throw new Error(`a level is one of ${LEVELS.join(', ')}, not ${level}`);
  if (effort && effort !== '-' && !EFFORTS.includes(effort) && effort !== 'max') throw new Error(`an effort is one of ${EFFORTS.join(', ')}, not ${effort}`);
  changeSetting(s => { const slot = (((s.levels ??= {})[tool] ??= {})[level] ??= {}); slot.word = word === '-' ? null : word; if (effort) slot.effort = effort === '-' ? undefined : effort; }, env);
}
export const resetSetting = (env = process.env) => { try { fs.unlinkSync(settingFile(env)); return true; } catch { return false; } };

// The language of the person who looks at the panels, kept with the rest of the setting (never in a project: two people may share one). English when unset.
export const LANGUAGES = { en: 'English', es: 'Spanish' };
export const languageOf = (env = process.env) => { const l = readSetting(env).language; return LANGUAGES[l] ? l : 'en'; };
export const languageSet = (env = process.env) => !!LANGUAGES[readSetting(env).language];
export function setLanguage(code, env = process.env) {
  if (!LANGUAGES[code]) throw new Error(`the panel speaks ${Object.keys(LANGUAGES).join(' or ')}, not "${code}"`);
  changeSetting(s => { s.language = code; }, env);
}

// The panels (buddy-mod, tell-missing-panel): is a tool's panel installed, and the one line that tells the owner how, said once per tool and never installed by Buddy.
// Only a folder is looked at, nothing is run: Claude Code's under <its folder>/plugins/cache/<catalogue>/buddy-panel (CLAUDE_CONFIG_DIR moves it), Antigravity's at ~/.gemini/config/plugins/buddy-panel.
// HOME moves the home folder (as in toolCommand), so a test points them at a fake machine.
const PANEL_LINE = {
  claude: { en: 'Claude Code is here but not its Buddy panel; to install it: claude plugin install buddy-panel@buddy', es: 'Claude Code está aquí pero no su panel de Buddy; para instalarlo: claude plugin install buddy-panel@buddy' },
  agy: { en: 'Antigravity is here but not its Buddy panel (for the App); to install it: agy plugin install <path to Buddy\'s repository>/panel/antigravity', es: 'Antigravity está aquí pero no su panel de Buddy (para la App); para instalarlo: agy plugin install <ruta del repositorio de Buddy>/panel/antigravity' },
};
export function panelInstalled(tool, env = process.env) {
  const home = env.HOME || env.USERPROFILE || (env === process.env ? os.homedir() : '');
  const dir = d => { try { return fs.readdirSync(d); } catch { return []; } };
  if (tool === 'agy') return !!home && fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'buddy-panel', 'plugin.json'));
  const cache = path.join(env.CLAUDE_CONFIG_DIR || (home && path.join(home, '.claude')) || '', 'plugins', 'cache');
  return dir(cache).some(m => dir(path.join(cache, m, 'buddy-panel')).length > 0);
}
// The lines to say now (one per tool found without its panel that was not said before), and the saying is remembered in the setting. Nothing when all is as it should be.
export function missingPanelLines(env = process.env, found = findTools(env)) {
  const said = readSetting(env).panelsTold || {}, lang = languageOf(env);
  const miss = found.filter(t => !said[t] && !panelInstalled(t, env));
  if (miss.length) changeSetting(s => { s.panelsTold = { ...s.panelsTold, ...Object.fromEntries(miss.map(t => [t, true])) }; }, env);
  return miss.map(t => PANEL_LINE[t][lang]);
}
export const missingPanelReport = (env = process.env) => { const l = missingPanelLines(env); return l.length ? '\n\n' + l.join('\n') : ''; };
