// The `henchmen` command. It starts the server on first use.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, PORT, serve } from './server.mjs';

const USAGE = `henchmen new ROOM [--dir FOLDER] [goal text, or stdin]   ROOM can be a/b/c: divisions nest
henchmen list
henchmen open                 open the page and make this browser the owner's
henchmen revoke               sign every browser out of owner rights
henchmen stop                 stop the server and every agent it started
henchmen share on --host IP    let invited guests reach this computer on a private address (your Tailscale one); share off ends it
henchmen invite PROJECT --as NAME   invite a friend: prints what to send them. invites lists them, uninvite NAME withdraws one
henchmen join URL INVITE       a friend's invite: your agents work in their project from this computer. unjoin PROJECT leaves
henchmen talk ROOM AGENT      this agent's own terminal tab: watch it work and type to it directly
henchmen ROOM ME sync         goal, leader, tasks, claims, unread (first sync also gives your instructions)
henchmen ROOM ME post KIND [@NAME|@all|@human] [--reply ID] [text, or stdin]
                               KIND: note ask answer done decision blocked. Only @ wakes anyone.
henchmen ROOM ME wait [secs]  block until a message for you, then print unread (default 1800). Terminal agents only.
henchmen ROOM ME doing [text]
henchmen ROOM ME rename NEW   choose your own name
henchmen ROOM ME request ROLE [--model sonnet|opus|fable] [--effort LEVEL] WHY   ask for a full agent; brief it with @name once started
henchmen ROOM ME claim WHAT...   take files or tasks across the whole project. If one's taken: exit 1 with HELD, and you're
                               in line and get told when it's yours
henchmen ROOM ME release [WHAT...]
henchmen ROOM ME tasks
henchmen ROOM ME task add [@OWNER] TITLE        leader adds; anyone else proposes
henchmen ROOM ME task assign ID [@OWNER]        leader only
henchmen ROOM ME task status ID open|doing|blocked|done   owner or leader
henchmen ROOM ME report show
henchmen ROOM ME report set SECTION [--base V] [text, or stdin]   exit 1 with STALE or REFUSED and nothing saved
henchmen ROOM ME detail [NAME] [--show|--hide] [text, or stdin]   no text reads the page, no NAME lists pages. Pages stay off the human's report unless you --show them
henchmen ROOM ME detail NAME --delete   leader only: delete a page, after merging it into another
henchmen ROOM ME pass ID @NAME   give the human's message you have to the agent whose work it is; it goes straight to them, so post nothing
henchmen ROOM ME take ID      take a message from the human that nobody has yet; the first to take it has it
henchmen ROOM ME resolve ID   close your own blocker, question or taken message (leader: anyone's)
henchmen ROOM ME goal done WHY  leader only: the goal is met and checked, so the room stops until the human restarts it
henchmen ROOM ME division delete NAME   leader only: delete a finished division (no agents running, no open tasks); its last report
                               is kept here as the page NAME-final-report
henchmen ROOM ME follow tasks|off   be told each time a task finishes here or in a division below (for a recorder or reviewer)
henchmen ROOM ME leave        leave and release your claims here
henchmen ROOM ME log [n]
henchmen ROOM ME show ID
Names: lowercase letters, digits, . _ -   Page: http://localhost:${PORT}`;

function call(path, args, remote = null) {
  return new Promise((resolve, reject) => {
    // node:http, not fetch: fetch gives up on a long wait after 5 minutes.
    const to = remote ? new URL(remote.url) : null;
    const headers = { 'x-henchmen': '1', 'content-type': 'application/json', host: to ? to.host : `localhost:${PORT}`, ...(remote ? { 'x-henchmen-guest': remote.token } : {}) };
    const req = http.request({ host: to ? to.hostname : '127.0.0.1', port: to ? Number(to.port) || 80 : PORT, path, method: 'POST', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ ok: res.statusCode < 400, text }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(args));
  });
}

// Projects you joined on someone else's computer: their address and your invite, kept only on this computer.
const remotesPath = join(HOME, 'remotes.json');
const remotes = () => { try { return JSON.parse(readFileSync(remotesPath, 'utf8')); } catch { return {}; } };
async function callOrStart(path, args) {
  try {
    return await call(path, args);
  } catch (e) {
    if (e.code !== 'ECONNREFUSED') throw e;
  }
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const log = openSync(join(HOME, 'server.log'), 'a');
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      return await call(path, args);
    } catch (e) {
      if (e.code !== 'ECONNREFUSED') throw e;
    }
  }
  let why = '';
  try { why = readFileSync(join(HOME, 'server.log'), 'utf8').trim().split('\n').at(-1); } catch { /* no log yet */ }
  throw new Error(`The server wouldn't start. ${why}`);
}

// Read as a stream: a synchronous read of a slow pipe fails with EAGAIN.
async function stdinText() {
  if (process.stdin.isTTY) return '';
  // A pipe or a file is read to its end. Anything else, like the socket a coding tool's shell leaves open with
  // nothing coming, counts only if text arrives at once; otherwise a read with no text would hang forever.
  const s = fstatSync(0);
  let text = '';
  const quiet = !(s.isFIFO() || s.isFile()) && setTimeout(() => process.stdin.destroy(), 500);
  try { for await (const chunk of process.stdin) { clearTimeout(quiet); text += chunk; } } catch { /* closed while quiet */ }
  clearTimeout(quiet);
  return text;
}
function flag(list, name) {
  const i = list.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = list.splice(i, 2);
  return value;
}
const finish = ({ ok, text }) => {
  (ok ? process.stdout : process.stderr).write(text + '\n');
  process.exitCode = ok ? 0 : 1;
};

// One agent's own tab. It shows the agent working, and what you type goes straight to it.
async function talk(room, agent) {
  if (!room || !agent) return finish({ ok: false, text: 'henchmen talk ROOM AGENT' });
  const key = readFileSync(join(HOME, 'key'), 'utf8').trim();
  const ask = (verb, extra = {}) => callOrStart(`/talk/${verb}`, { key, room, agent, ...extra });
  const first = await ask('state');
  if (!first.ok) return finish(first);
  const title = (leader) => process.stdout.write(`\u001b]1;${leader === agent ? '\u2605 ' : ''}${agent}\u0007`);
  title(JSON.parse(first.text).leader);
  const titles = setInterval(async () => {
    // Never restarts the server: someone may have stopped it on purpose.
    const r = await call('/talk/state', { key, room, agent }).catch(() => null);
    if (r?.ok) title(JSON.parse(r.text).leader);
  }, 5000);
  titles.unref();
  console.log(`${agent} in ${room}. Type to talk to it. Your conversation here stays out of the group chat.\n/terminal opens the full Claude Code screen; /allow and /deny answer an approval by its number; Ctrl-C closes this tab and the agent keeps working.\n`);

  let tty = '';
  try { tty = (await import('node:child_process')).execSync('tty', { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' }).trim(); } catch { /* not a terminal */ }
  const watch = () => http.request({ host: '127.0.0.1', port: PORT, path: '/talk/stream', method: 'POST', headers: { 'x-henchmen': '1', host: `localhost:${PORT}` } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (t) => process.stdout.write(t));
    res.on('end', () => {
      if (paused) return;
      console.log('\nThe agent has stopped. You can close this tab.');
      process.exit(0);
    });
  });
  let paused = false;
  let stream = watch();
  stream.on('error', () => {});
  stream.end(JSON.stringify({ key, room, agent, tty }));

  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const answer = text.match(/^\/(allow|deny)(?:\s+(\d+))?$/);
    if (!answer && /^\/(allow|deny)\b/.test(text)) {
      console.log('Use /allow or /deny, with the request number if several are waiting. Nothing was sent.');
    } else if (answer) {
      const r = await ask('decide', { decision: answer[1], id: answer[2] });
      if (!r.ok) console.log(r.text);
    } else if (text === '/terminal') {
      const got = await ask('takeover');
      if (!got.ok) { console.log(got.text); continue; }
      const { session, cwd, args, env, token, bin } = JSON.parse(got.text);
      paused = true;
      stream.destroy();
      rl.pause();
      console.log("\nOpening the full screen. Group chat messages wait until you exit. Spending in the full screen isn't capped or counted here.\n");
      process.stdin.setRawMode?.(false);
      await new Promise((done) => {
        const merged = { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` };
        const c = spawn(process.env.HENCHMEN_CLAUDE || 'claude', ['--resume', session, ...args], { cwd, env: merged, stdio: 'inherit' });
        ask('pid', { token, pid: c.pid }).catch(() => {});
        c.on('close', done);
        c.on('error', done);
      });
      rl.resume();
      await ask('return', { token });
      paused = false;
      console.log('\nBack on the page. Messages held for it are being delivered now.\n');
      stream = watch();
      stream.on('error', () => {});
      stream.end(JSON.stringify({ key, room, agent }));
    } else {
      const r = await ask('say', { body: text });
      if (!r.ok) { console.log(r.text); if (r.text.includes("isn't running")) break; }
    }
  }
  clearInterval(titles);
  stream.destroy();
}

async function main(argv) {
  const first = argv[0];
  if (first === 'serve') return serve();
  if (!argv.length || first === 'help' || first === '--help') return console.log(USAGE);
  if (first === 'list') {
    // Projects joined on a friend's computer are listed too, so nobody makes a second one here by mistake.
    const joined = Object.entries(remotes()).map(([p, x]) => `${p}  joined: hosted on another computer (${x.url}); you're ${x.name} there. Sync there; don't create it here.`);
    const res = await callOrStart('/list', {});
    return finish({ ...res, text: [joined.length && res.text === 'no rooms' ? '' : res.text, ...joined].filter(Boolean).join('\n') });
  }
  if (first === 'new') {
    const rest = argv.slice(2);
    const dir = flag(rest, '--dir');
    // A division works in its parent's folder unless told otherwise.
    const nested = String(argv[1]).includes('/');
    return finish(await callOrStart('/new', { path: argv[1], dir: dir ?? (nested ? null : process.cwd()), brief: rest.join(' ') || await stdinText() }));
  }
  // Owner actions belong to the person, never to an agent started from the page.
  if (process.env.HENCHMEN_AGENT && ['open', 'stop', 'serve', 'talk', 'revoke', 'share', 'invite', 'invites', 'uninvite', 'join', 'unjoin'].includes(first)) {
    return finish({ ok: false, text: `Only the person running Henchmen can do "${first}". Ask them.` });
  }
  if (first === 'open') {
    await callOrStart('/list', {});
    const { text } = await call('/open-code', { key: readFileSync(join(HOME, 'key'), 'utf8').trim() });
    const url = `http://localhost:${PORT}/#code=${JSON.parse(text).code}`;
    if (!process.env.HENCHMEN_NO_BROWSER) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], () => {});
    return console.log(`Open this within a minute if your browser didn't: ${url}`);
  }
  if (first === 'talk') return talk(argv[1], argv[2]);
  const key = () => readFileSync(join(HOME, 'key'), 'utf8').trim();
  if (first === 'share') {
    const rest = argv.slice(2);
    if (argv[1] !== 'on' && argv[1] !== 'off') return finish({ ok: false, text: 'usage: henchmen share on --host YOUR-TAILSCALE-ADDRESS [--port N] | henchmen share off' });
    await callOrStart('/list', {});
    return finish(await call('/share', { key: key(), off: argv[1] === 'off', host: flag(rest, '--host'), port: flag(rest, '--port') }));
  }
  if (first === 'invite') {
    const rest = argv.slice(2);
    await callOrStart('/list', {});
    return finish(await call('/invite', { key: key(), room: argv[1], as: flag(rest, '--as') }));
  }
  if (first === 'invites') { await callOrStart('/list', {}); return finish(await call('/invites', { key: key() })); }
  if (first === 'uninvite') { await callOrStart('/list', {}); return finish(await call('/uninvite', { key: key(), as: argv[1] })); }
  // A friend's invite: check it with their computer, then send that project's commands there.
  if (first === 'join') {
    const [url, token] = [argv[1], argv[2]];
    if (!/^http:\/\/[\w.-]+:\d+\/?$/.test(url || '') || !/^[a-f0-9]{48}$/.test(token || '')) return finish({ ok: false, text: 'usage: henchmen join http://ADDRESS:PORT INVITE (both come from the host)' });
    const remote = { url: url.replace(/\/$/, ''), token };
    let res;
    try { res = await call('/g/whoami', {}, remote); } catch (e) { return finish({ ok: false, text: `Couldn't reach ${remote.url} (${e.code || e.message}). Are you both on the same Tailscale network, and is sharing on there?` }); }
    if (!res.ok) return finish(res);
    const { name, project } = JSON.parse(res.text);
    mkdirSync(HOME, { recursive: true, mode: 0o700 });
    writeFileSync(remotesPath, JSON.stringify({ ...remotes(), [project]: { ...remote, name } }, null, 2), { mode: 0o600 });
    return console.log(`Joined ${project} as ${name}. Your agents work there from this computer: open Claude Code in your clone of the code and say /henchmen ${project}. They show up there as ${name}.NAME. Code still moves through git. Leave with: henchmen unjoin ${project}`);
  }
  if (first === 'unjoin') {
    const all = remotes();
    if (!all[argv[1]]) return finish({ ok: false, text: `You haven't joined ${argv[1]}.` });
    delete all[argv[1]];
    writeFileSync(remotesPath, JSON.stringify(all, null, 2), { mode: 0o600 });
    return console.log(`Left ${argv[1]}. Its commands go to this computer's henchmen again.`);
  }
  if (first === 'revoke') {
    await callOrStart('/list', {});
    return finish(await call('/revoke', { key: readFileSync(join(HOME, 'key'), 'utf8').trim() }));
  }
  if (first === 'stop') {
    const { execSync } = await import('node:child_process');
    try {
      const pid = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t`, { encoding: 'utf8' }).trim();
      if (pid) process.kill(Number(pid));
      return console.log('stopped');
    } catch {
      return console.log('not running');
    }
  }

  const [room, agent, cmd, ...rest] = argv;
  if (!cmd) return console.log(USAGE);
  const args = { room, agent, cmd, caller: process.env.HENCHMEN_AGENT || undefined };
  const text = async () => rest.join(' ') || await stdinText();
  if (cmd === 'post') {
    args.reply = flag(rest, '--reply');
    args.kind = rest.shift();
    if (rest[0]?.startsWith('@')) {
      // "@name the message" in one quoted word is a tag and its text, not a name with spaces.
      const [tag, ...more] = rest.shift().split(/\s+/);
      args.target = tag.slice(1);
      if (more.length) rest.unshift(more.join(' '));
    }
    args.body = await text();
  } else if (cmd === 'request') {
    args.model = flag(rest, '--model');
    args.effort = flag(rest, '--effort');
    args.role = rest.shift();
    args.body = rest.join(' ');
  } else if (cmd === 'doing' || cmd === 'claim' || cmd === 'release' || cmd === 'rename') args.body = rest.join(' ');
  else if (cmd === 'goal') {
    if (rest.shift() !== 'done') { console.error(`usage: henchmen ROOM ME goal done WHY`); process.exit(2); }
    args.body = rest.join(' ');
  } else if (cmd === 'wait') args.secs = rest[0];
  else if (cmd === 'log') args.n = rest[0];
  else if (cmd === 'show' || cmd === 'resolve' || cmd === 'take') args.id = rest[0];
  else if (cmd === 'division') [args.sub, args.name] = rest;
  else if (cmd === 'follow') args.body = rest[0];
  else if (cmd === 'pass') [args.id, args.target] = rest;
  else if (cmd === 'task') {
    args.sub = rest.shift();
    if (args.sub === 'add') {
      if (rest[0]?.startsWith('@')) args.owner = rest.shift().slice(1);
      args.body = rest.join(' ');
    } else {
      args.id = rest.shift();
      if (args.sub === 'assign' && rest[0]) args.owner = rest[0].replace(/^@/, '');
      if (args.sub === 'status') args.status = rest[0];
    }
  } else if (cmd === 'report') {
    args.sub = rest.shift();
    if (args.sub === 'set') {
      args.base = flag(rest, '--base');
      args.name = rest.shift();
      args.body = await text();
    } else if (args.sub !== 'show') return finish({ ok: false, text: 'report show | report set SECTION [--base V] [text, or stdin]' });
  } else if (cmd === 'detail') {
    const d = rest.indexOf('--delete');
    if (d >= 0) { rest.splice(d, 1); args.del = true; }
    for (const [f, on] of [['--show', true], ['--hide', false]]) {
      const i = rest.indexOf(f);
      if (i >= 0) { rest.splice(i, 1); args.show = on; }
    }
    args.name = rest.shift();
    args.body = rest.length ? rest.join(' ') : args.name ? await stdinText() : '';
  }
  const remote = remotes()[String(room).split('/')[0]];
  finish(remote ? await call('/c', args, remote) : await callOrStart('/c', args));
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.code === 'ECONNRESET' ? 'The server restarted; run the command again.' : e.message);
  process.exitCode = 1;
});
