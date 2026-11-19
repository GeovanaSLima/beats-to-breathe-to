// One command for both halves: the bridge (camera + SDK) and the web app, with labelled output.
// Ctrl+C stops both, and if one exits the other is stopped too, so the bridge always releases the camera.
// (A plain `a & b` npm script won't do: background jobs in a non-interactive shell ignore Ctrl+C.)
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const parts = { bridge: ['--prefix', 'bridge', 'start'], web: ['--prefix', 'web', 'run', 'dev'] };

let stopping = false;
const procs = Object.entries(parts).map(([name, args]) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const [stream, out] of [[child.stdout, console.log], [child.stderr, console.error]]) {
    createInterface({ input: stream }).on('line', (line) => out(`[${name}] ${line}`));
  }
  child.on('exit', (code, signal) => {
    if (!stopping) console.log(`[${name}] stopped (${signal ?? `exit ${code}`}), stopping the rest`);
    stopAll(code ?? 1); // killed by a signal (e.g. a native crash) is a failure
  });
  return child;
});

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of procs) child.kill('SIGINT'); // no-op for one that already exited
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(0));
process.stdout.on('error', () => stopAll(1)); // e.g. piped into `head`: don't orphan the children
