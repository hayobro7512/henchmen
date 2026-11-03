#!/usr/bin/env node
// Runs before each shell command an agent starts (a Claude Code PreToolUse hook). It stops a kill that
// would reach broadly: many processes, a Claude Code session, the terminal, the Henchmen server, the agent
// itself, or everything at once. A narrow kill of what the agent started goes through. Exit 2 blocks the command.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX = 10;
const PROTECTED = [/(^|\/)claude(\s|$)/, /Terminal\.app|iTerm|WindowServer|loginwindow|Finder\.app|Dock\.app/, /henchmen[^ ]*\/src\/cli\.mjs serve/];

// Words of a shell command, split into simple commands. Quotes are honored; a word with $ or ` in it
// (outside single quotes) can't be known until the shell runs it.
function parse(cmd) {
  const cmds = [[]];
  let word = null, dyn = false, q = null;
  const end = () => { if (word !== null) cmds.at(-1).push({ text: word, dyn }); word = null; dyn = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = null; else word += c; continue; }
    if (q === '"') {
      if (c === '"') q = null; else if (c === '\\' && i + 1 < cmd.length) word += cmd[++i]; else { if (c === '$' || c === '`') dyn = true; word += c; }
      continue;
    }
    if (c === "'" || c === '"') { q = c; word ??= ''; continue; }
    if (c === '\\' && i + 1 < cmd.length) { word = (word ?? '') + cmd[++i]; continue; }
    if (/\s/.test(c) && c !== '\n') { end(); continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')') { end(); if (cmds.at(-1).length) cmds.push([]); continue; }
    if (c === '$' || c === '`') dyn = true;
    word = (word ?? '') + c;
  }
  end();
  return cmds.filter((x) => x.length);
}
// The program a simple command runs, past env assignments and wrappers like sudo or xargs.
function program(words) {
  let i = 0;
  for (;;) {
    const w = words[i]?.text;
    if (w === undefined) return null;
    if (/^[A-Za-z_]\w*=/.test(w)) { i++; continue; }
    if (['sudo', 'command', 'exec', 'nohup', 'time', 'env', 'xargs'].includes(w)) {
      i++;
      while (words[i]?.text.startsWith('-')) i++; // their own flags
      continue;
    }
    // Redirections are the shell's, not the program's: 2>/dev/null, or > file.
    const args = [];
    for (let j = i + 1; j < words.length; j++) {
      if (/^\d*[<>]/.test(words[j].text)) { if (/^\d*[<>]+$/.test(words[j].text)) j++; continue; }
      args.push(words[j]);
    }
    return { name: w.split('/').pop(), args };
  }
}

const table = new Map();
for (const line of spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n')) {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
  if (m) table.set(Number(m[1]), { ppid: Number(m[2]), command: m[3], name: '' });
}
for (const line of spawnSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).stdout.split('\n')) {
  const m = line.match(/^\s*(\d+)\s+(.*)$/);
  if (m && table.has(Number(m[1]))) table.get(Number(m[1])).name = m[2].split('/').pop();
}
const ancestors = new Set();
for (let p = process.ppid; p > 1 && !ancestors.has(p); p = table.get(p)?.ppid ?? 0) ancestors.add(p);

const block = (why) => {
  process.stderr.write(`Blocked by Henchmen's kill guard: ${why}\nStop only what you started: by its PID, or by its port with: lsof -t -iTCP:PORT -sTCP:LISTEN | xargs kill. On macOS, pkill's options go before the pattern; anything after it counts as another pattern.\n`);
  process.exit(2);
};
const show = (pids) => pids.slice(0, 5).map((p) => `${p} ${(table.get(p)?.command ?? '').slice(0, 70)}`).join('; ');
function judge(pids, what) {
  pids = pids.filter((p) => p !== process.pid && table.has(p));
  const hurt = pids.filter((p) => ancestors.has(p) || PROTECTED.some((re) => re.test(table.get(p).command)));
  if (hurt.length) block(`${what} would stop ${hurt.length === pids.length ? '' : `${pids.length} processes, including `}something that must keep running: ${show(hurt)}.`);
  if (pids.length > MAX) block(`${what} would stop ${pids.length} processes, more than ${MAX}: ${show(pids)} ...`);
}
const pgrep = (args) => spawnSync('pgrep', args, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map(Number);
// The same match done here over ps, since pgrep can't see every process from every shell.
function matching(patterns, { full, exact, icase }) {
  const res = patterns.map((x) => { try { return new RegExp(exact ? `^(?:${x})$` : x, icase ? 'i' : ''); } catch { return null; } }).filter(Boolean);
  return [...table].filter(([, t]) => res.some((re) => re.test(full ? t.command : t.name))).map(([pid]) => pid);
}

// pkill reads its options, then everything from the first other word on is a pattern, as macOS does.
function checkPkill(args, what) {
  if (args.some((a) => a.dyn)) block(`${what} has a pattern the shell fills in later (${args.find((a) => a.dyn).text}), so it can't be checked. Write it out.`);
  const words = args.map((a) => a.text);
  let first = 0, flags = '', filtered = false;
  for (; first < words.length && words[first].startsWith('-') && words[first] !== '-'; first++) {
    const w = words[first];
    if (/^-[FGgPstUuj]$/.test(w)) { filtered = true; first++; continue; } // takes a value
    if (!/^-(\d+|[A-Z][A-Z0-9]*)$/.test(w)) flags += w.slice(1);
  }
  const patterns = words.slice(first);
  const late = patterns.find((w) => w.startsWith('-'));
  if (late) block(`in "${what} ${words.join(' ')}", ${late} comes after the pattern, so macOS reads it as another pattern.`);
  const pids = new Set(pgrep(words.filter((w) => !/^-(\d+|[A-Z][A-Z0-9]*)$/.test(w)))); // pgrep has no signal flags
  if (!filtered) for (const p of matching(patterns, { full: flags.includes('f'), exact: flags.includes('x'), icase: flags.includes('i') })) pids.add(p);
  judge([...pids], what);
}
function checkKillall(args) {
  const words = args.map((a) => a.text);
  if (words.includes('-u')) block('killall -u stops every process of a user.');
  if (args.some((a) => a.dyn)) block("killall has a name the shell fills in later, so it can't be checked. Write it out.");
  const regex = words.includes('-m');
  for (const name of words.filter((w) => !w.startsWith('-'))) {
    const pids = new Set([...pgrep(regex ? [name] : ['-x', name]), ...(regex ? matching([name], {}) : [...table].filter(([, t]) => t.name === name).map(([pid]) => pid))]);
    judge([...pids], `killall ${name}`);
  }
}
function checkKill(args) {
  let words = args.map((a) => a.text);
  if (words[0] === '-l' || words[0] === '-L') return;
  if (words[0] === '-s' || words[0] === '-n') words = words.slice(2); else if (words[0]?.startsWith('-') && words[0] !== '--') words = words.slice(1);
  if (words[0] === '--') words = words.slice(1);
  const group = words.find((w) => /^-\d+$/.test(w) || w === '0');
  if (group) block(`kill ${group} signals ${group === '0' || group === '-0' ? 'its whole process group' : group === '-1' ? 'every process you own' : `the whole process group ${group.slice(1)}`}.`);
  judge(words.filter((w) => /^\d+$/.test(w)).map(Number), 'this kill');
}

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const cmd = String(input?.tool_input?.command ?? '');
if (!/\b(kill|pkill|killall)\b/.test(cmd)) process.exit(0);
try {
  for (const words of parse(cmd)) {
    const p = program(words);
    if (!p) continue;
    if (p.name === 'pkill') checkPkill(p.args, 'pkill');
    else if (p.name === 'pgrep') checkPkill(p.args.filter((a) => !['-l', '-a'].includes(a.text)), 'pgrep feeding a kill'); // its list goes to a kill in this command
    else if (p.name === 'killall') checkKillall(p.args);
    else if (p.name === 'kill') checkKill(p.args);
  }
} catch {
  // A guard that breaks must not stop the agent's work.
}
process.exit(0);
