// Runs the project's validate command with a time limit and prints the result as JSON. It is a separate process so that the checkpoint,
// which is synchronous, can wait for it and still have the whole process tree of validate stopped when the time is over (runWithTimeout).
import { runWithTimeout } from './proc.mjs';
const { c, cwd, timeoutMs } = JSON.parse(process.argv[2]);
const r = await runWithTimeout(c, { cwd, timeoutMs });
process.stdout.write(JSON.stringify(r));
process.exit(0);
