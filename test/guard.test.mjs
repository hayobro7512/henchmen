// node --test test/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const guard = new URL('../src/guard.mjs', import.meta.url).pathname;
const check = (command) => {
  const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
  return { blocked: r.status === 2, why: r.stderr };
};
// Something of the agent's own to stop, with a name nothing else has.
const mine = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1e6)', 'henchmen-guard-marker-q7'], { stdio: 'ignore' });
after(() => mine.kill());

test('the kill guard lets narrow kills through', () => {
  for (const c of [
    `kill ${mine.pid}`,
    'pkill -f henchmen-guard-marker-q7',
    'pkill -TERM -f henchmen-guard-marker-q7 2>/dev/null || true',
    'pkill -f no-such-process-zq9 >/dev/null 2>&1; echo done',
    'killall no-such-process-zq9',
    'lsof -t -iTCP:8123 -sTCP:LISTEN | xargs kill',
    'echo "pkill is fine here"',
    'pgrep -f e',
    'kill -l',
  ]) assert.equal(check(c).blocked, false, c);
});

test('the kill guard stops anything universal, and says why', () => {
  const cases = {
    // The one that took down the user's apps: macOS read -P and 1 as patterns, and 1 matches nearly everything.
    'pkill -f "app/dev_server.py" -P 1': /-P comes after the pattern/,
    'pkill -0 -f e': /would stop \d+ processes/,
    'kill -9 -1': /every process you own/,
    'kill 0': /process group/,
    'kill -- -4242': /process group 4242/,
    [`kill ${process.pid}`]: /must keep running/, // its own parent: the agent itself
    'kill $(pgrep -f e)': /pgrep feeding a kill would stop/,
    'pkill -f "$SERVER"': /fills in later/,
    'killall -u nobody': /every process of a user/,
  };
  for (const [c, why] of Object.entries(cases)) {
    const r = check(c);
    assert.ok(r.blocked, c);
    assert.match(r.why, why, c);
    assert.match(r.why, /by its PID, or by its port/);
  }
});

test('the kill guard ignores other tools and broken input', () => {
  assert.equal(spawnSync(process.execPath, [guard], { input: 'not json', encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }), encoding: 'utf8' }).status, 0);
});
