// The user's Buddy configuration: one JSON file per user, ~/.buddy/config.json. It holds where Buddy's factory is
// (buddy feedback --factory, R100) and the library new projects use (buddy library --set, R104).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const configFile = () => path.join(os.homedir(), '.buddy', 'config.json');

// The configuration, or {} when there is none. A file that is not valid JSON reads as {} (nothing is configured), except
// when it is about to be written: then it is refused, so a hand-edited file is never silently replaced.
export function readConfig({ strict = false } = {}) {
  let text; try { text = fs.readFileSync(configFile(), 'utf8'); } catch { return {}; }
  try { const c = JSON.parse(text); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; }
  catch (e) { if (strict) throw new Error(`your Buddy configuration ${configFile()} is not valid JSON (${e.message}); fix or delete it and try again`); return {}; }
}

// Changes the configuration with fn(config) and writes it back; returns the new configuration.
export function updateConfig(fn) {
  const c = readConfig({ strict: true }); fn(c);
  fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(c, null, 2) + '\n');
  return c;
}
