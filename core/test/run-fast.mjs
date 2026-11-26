// Runs the fast test level (R200, R239): all core test files except the slowest integration suites, which run in validate:full.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SLOW = /^(checkpointslice|init)(-\d+)?\.test\.mjs$|^(settle|prototypeinputs|milestonereview)\.test\.mjs$/;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs') && !SLOW.test(f)).sort().map(f => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: path.dirname(dir), stdio: 'inherit' });
process.exit(r.status ?? 1);
