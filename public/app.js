'use strict';
// The Henchmen page. Everything from agents is hostile: DOM is built with textContent, and the
// one innerHTML (the report's markdown) escapes first and allows only http(s) links.

// ---------- small helpers ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(`henchmen.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`henchmen.${k}`, JSON.stringify(v)); } catch { /* private window: this visit only */ } },
};
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'required') el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
// Puts els in container in this order, moving only what's out of place so focus and text survive.
function place(container, els) {
  els.forEach((el, i) => { if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null); });
  while (container.children.length > els.length) container.lastElementChild.remove();
}
const esc = (s) => String(s).replace(/\u0000/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return plural(Math.floor(s / 86400), 'day') + ' ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function clock(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
// Only agents started from the page report spending, so with none there's nothing honest to show.
const spendText = (s) => (!s.any ? '' : !s.reported ? 'Spend not reported' : `$${s.usd.toFixed(2)} spent`);
const money = (n) => `$${Number(n).toFixed(2)}`;
const badgeColor = (name) => { let x = 5381; for (const c of name) x = (x * 33 + c.codePointAt(0)) >>> 0; return `c${x % 10}`; };
const initial = (name) => (name[0] || '?').toUpperCase();
const badge = (name) => h('span', { class: `badge ${badgeColor(name)}`, 'aria-hidden': 'true' }, initial(name));

// ---------- markdown: escape first, http(s) links only ----------
function inline(s) {
  const held = [];
  const hold = (html) => { held.push(html); return `\u0000${held.length - 1}\u0000`; };
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)\u0000]+)\)/g, (_, t, u) => hold(`<a href="${u}" rel="noopener noreferrer" target="_blank">${t}</a>`))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
}
// marks: the set of source-line numbers to show as changed.
function markdown(src, marks) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  const cls = (i) => (marks && marks.has(i) ? ' class="ln"' : '');
  const list = /^\s*([-*]|\d+\.)\s+/;
  let out = '', i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const start = i, code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      const changed = code.some((_, n) => marks && marks.has(start + 1 + n));
      i++;
      out += `<pre${changed ? ' class="ln"' : ''}><code>${esc(code.join('\n'))}</code></pre>`;
    } else if ((m = l.match(/^(#{1,3})\s+(.*)/))) {
      out += `<h${m[1].length}${cls(i)}>${inline(m[2])}</h${m[1].length}>`; i++;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      out += '<hr>'; i++;
    } else if (l.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] || '')) {
      out += `<table><thead><tr${cls(i)}>${cells(l).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) out += `<tr${cls(i)}>${cells(lines[i]).map((c) => `<td>${c}</td>`).join('')}</tr>`;
      out += '</tbody></table>';
    } else if (list.test(l)) {
      const tag = /^\s*\d+\./.test(l) ? 'ol' : 'ul';
      out += `<${tag}>`;
      for (; i < lines.length && list.test(lines[i]); i++) out += `<li${cls(i)}>${inline(lines[i].replace(list, ''))}</li>`;
      out += `</${tag}>`;
    } else if (l.startsWith('>')) {
      const q = [], start = i;
      for (; i < lines.length && lines[i].startsWith('>'); i++) q.push(lines[i].replace(/^>\s?/, ''));
      const changed = q.some((_, n) => marks && marks.has(start + n));
      out += `<blockquote${changed ? ' class="ln"' : ''}>${inline(q.join(' '))}</blockquote>`;
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) p.push(marks && marks.has(i) ? `<span class="ln">${inline(lines[i])}</span>` : inline(lines[i]));
      if (!p.length) { p.push(inline(lines[i])); i++; }
      out += `<p>${p.join('<br>')}</p>`;
    }
  }
  return out;
}
// Which lines of the new text aren't in the old one. Moved lines don't count as changed.
function changedLines(oldText, newText) {
  const left = new Map();
  for (const l of String(oldText ?? '').replace(/\r/g, '').split('\n')) left.set(l, (left.get(l) || 0) + 1);
  const marks = new Set();
  String(newText).replace(/\r/g, '').split('\n').forEach((l, i) => {
    if (left.get(l)) left.set(l, left.get(l) - 1);
    else if (l.trim()) marks.add(i);
  });
  return marks;
}

// ---------- talking to the server ----------
const banner = h('div', { class: 'banner', role: 'alert', hidden: true }, "Can't reach Henchmen. Run: ", h('code', {}, 'henchmen list'));
function setOffline(off) {
  if (banner.hidden === !off) return;
  banner.hidden = !off;
}
// Owner rights live in this page's own storage, which browsers keep separate per port. A cookie wouldn't be.
let ownerToken = store.get('owner', '');
const ownerHeaders = () => (ownerToken ? { 'x-henchmen-owner': ownerToken } : {});
// The page asks; the computer shows a dialog; only the person's click gives this browser control.
function takeControlButton() {
  const err = h('span', { class: 'err-inline', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Take control');
  btn.addEventListener('click', async () => {
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Check the dialog on your screen';
    try {
      const r = await fetch('/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const text = await r.text();
      if (!r.ok) throw new Error(text);
      ownerToken = JSON.parse(text).token;
      store.set('owner', ownerToken);
      location.reload();
    } catch (x) {
      err.textContent = x.message;
      btn.disabled = false;
      btn.textContent = 'Take control';
    }
  });
  return h('span', { class: 'take-control' }, btn, err);
}
async function redeemOpenLink() {
  const code = location.hash.match(/^#code=([0-9a-f]+)$/)?.[1];
  if (!code) return;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (r.ok) {
      ownerToken = (await r.json()).token;
      store.set('owner', ownerToken);
    }
  } catch { /* the page still opens, view only, and says how to take control */ }
}
class Gone extends Error {}
async function getJSON(url) {
  let r;
  try { r = await fetch(url, { headers: ownerHeaders() }); } catch (e) { setOffline(true); throw e; }
  setOffline(false);
  if (r.status === 404) throw new Gone();
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function act(action, args) {
  let r;
  try {
    r = await fetch(`/h/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...ownerHeaders() }, body: JSON.stringify(args) });
  } catch {
    setOffline(true);
    throw new Error("Can't reach Henchmen, so nothing changed. Run: henchmen list");
  }
  setOffline(false);
  const text = await r.text();
  if (!r.ok) {
    throw Object.assign(new Error(r.status === 403 ? "This browser doesn't have owner rights, so nothing changed. Run henchmen open to take control." : text), { status: r.status, text });
  }
  return JSON.parse(text || '{}');
}
let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
// Runs a control's action: disabled while in flight, errors shown in errEl or a toast.
async function run(btn, fn, errEl) {
  if (errEl) errEl.textContent = '';
  if (btn) btn.disabled = true;
  try {
    await fn();
    return true;
  } catch (e) {
    if (errEl) errEl.textContent = e.message; else toast(e.message);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- theme ----------
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store.get('theme', 'auto'));

// ---------- overlays ----------
function openDialog({ title, cls = 'drawer', light = true, build, onclose }) {
  const id = `dlg-${Math.random().toString(36).slice(2)}`;
  const body = h('div', { class: 'dlg-body' });
  const d = h('dialog', { class: cls, 'aria-labelledby': id },
    h('header', { class: 'dlg-head' }, h('h2', { id }, title), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')),
    body);
  d.addEventListener('close', () => { d.remove(); onclose?.(); });
  if (light) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  build(body, d);
  d.showModal();
  return d;
}
// A path box with a button that opens the computer's own folder window.
function folderField(label, input, hint) {
  const err = h('p', { class: 'err', role: 'alert' });
  const pick = h('button', { class: 'btn', type: 'button', disabled: input.disabled }, 'Choose folder');
  pick.addEventListener('click', async (e) => {
    e.preventDefault();
    err.textContent = '';
    pick.disabled = true;
    pick.textContent = 'Waiting for your selection';
    try {
      const { path } = await act('pickFolder', { current: input.value.trim() });
      if (path) {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (x) {
      err.textContent = x.message;
    } finally {
      pick.disabled = false;
      pick.textContent = 'Choose folder';
    }
  });
  return h('div', { class: 'field' }, h('label', { class: 'field-label' }, h('span', {}, label), h('div', { class: 'folder-row' }, input, pick)), hint && h('span', { class: 'hint' }, hint), err);
}
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint && h('span', { class: 'hint' }, hint));
const NAME_PATTERN = '[a-z0-9][a-z0-9._\\-]{0,63}';
const NAME_HINT = 'Lowercase letters, digits, and . _ -';

let popEl = null, popAnchor = null;
function closePop(refocus) {
  if (!popEl) return;
  popEl.hidden = true;
  popAnchor?.setAttribute('aria-expanded', 'false');
  if (refocus) popAnchor?.focus();
  popEl = popAnchor = null;
}
function openPop(el, anchor) {
  closePop();
  el.hidden = false;
  popEl = el;
  popAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  const a = anchor.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight;
  const m = innerWidth < 860 ? 16 : 12;
  let left = a.right + m;
  if (left + w > innerWidth - m) left = a.left - w - m;
  let top = a.top;
  if (left < m) { left = Math.max(m, Math.min(a.left, innerWidth - w - m)); top = a.bottom + m; }
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(m, Math.min(top, innerHeight - ht - m))}px`;
}
document.addEventListener('pointerdown', (e) => { if (popEl && !popEl.contains(e.target) && !popAnchor.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popEl) closePop(true); });

// ---------- shared forms ----------
function newProjectForm(onDone) {
  const name = h('input', { required: true, pattern: NAME_PATTERN, autocomplete: 'off', spellcheck: 'false' });
  const dir = h('input', { required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'Choose a folder, or paste its path' });
  const goal = h('textarea', { rows: 3 });
  const err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Create project');
  return h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      run(btn, async () => {
        const { id } = await act('createRoom', { path: name.value.trim(), brief: goal.value, dir: dir.value.trim() });
        onDone(id);
      }, err);
    },
  },
    field('Name', name, NAME_HINT),
    folderField('Working folder', dir, 'Agents run here.'),
    field('Goal', goal, 'Optional. Every agent reads this when it joins.'),
    err, btn);
}
function newDivisionForm(parentPath, onDone) {
  const name = h('input', { required: true, pattern: NAME_PATTERN, autocomplete: 'off', spellcheck: 'false' });
  const goal = h('textarea', { rows: 2 });
  const err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Create division');
  return h('form', {
    class: 'inline-form',
    onsubmit: (e) => {
      e.preventDefault();
      run(btn, async () => {
        const { id } = await act('createRoom', { path: `${parentPath}/${name.value.trim()}`, brief: goal.value });
        onDone(id);
      }, err);
    },
  },
    field(`New division in ${parentPath}`, name, NAME_HINT),
    field('Goal', goal, 'Optional.'),
    err, btn);
}
const go = (id) => { location.href = id ? `/r/${id}` : '/'; };

// ---------- home ----------
function homePage() {
  const app = document.getElementById('app');
  document.title = 'Henchmen';
  const list = h('div', {});
  const notice = h('div', { class: 'notice', hidden: true }, 'View only. ', takeControlButton(), ' or run ', h('code', {}, 'henchmen open'), '.');
  const formSlot = h('fieldset', {});
  formSlot.append(h('h2', {}, 'New project'), newProjectForm(go));
  app.append(banner, notice, h('div', { class: 'home' },
    h('main', { class: 'home-list' },
      h('h1', {}, h('img', { src: '/logo.svg', alt: '', width: '52', height: '52' }), 'Henchmen'),
      h('p', { class: 'sub' }, 'One boss, a crew of coding agents, no dental plan.'),
      list),
    h('section', { class: 'home-form', 'aria-label': 'New project' }, formSlot)));
  let sig = '';
  const refresh = async () => {
    if (document.hidden) return;
    let t;
    try { t = await getJSON('/api/tree'); } catch { return; }
    notice.hidden = t.owner;
    formSlot.disabled = !t.owner;
    const next = JSON.stringify(t.roots);
    if (next === sig) return;
    sig = next;
    list.replaceChildren(...(t.roots.length ? t.roots.map(projectRow) : [h('div', { class: 'projects-empty' },
      h('h2', {}, 'No projects yet'),
      h('p', {}, 'Create one here with a name and a working folder, or run ', h('code', {}, 'henchmen new my-project --dir .'), ' in a terminal. Then start an agent from the project page and put it to work.'))]));
  };
  refresh();
  setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', refresh);
}
function projectRow(r) {
  const count = (n) => n.children.reduce((c, k) => c + 1 + count(k), 0);
  const divisions = count(r);
  return h('div', { class: 'project' },
    h('a', { href: `/r/${r.id}` }, r.slug),
    r.needs > 0 && h('span', { class: 'tag-alert' }, `${r.needs} need${r.needs === 1 ? 's' : ''} you`),
    h('span', { class: 'note' }, `${plural(r.agents, 'agent')} here`),
    divisions > 0 && h('span', { class: 'note' }, plural(divisions, 'division')),
    h('span', { class: 'note' }, `Active ${ago(r.last)}`),
    h('span', { class: 'note' }, spendText(r.spend)));
}

// ---------- room ----------
const FILTERS = [['note', 'Notes'], ['ask', 'Questions'], ['answer', 'Answers'], ['done', 'Done'], ['decision', 'Decisions'], ['blocked', 'Blocked'], ['system', 'System lines']];
const TAGS = { blocked: 'Blocked', decision: 'Decision', ask: 'Question', done: 'Done' };
const STATE = { working: 'Working', approval: 'Waiting for your approval', starting: 'Opening its terminal window', idle: 'Idle', gone: 'Gone', crashed: 'Crashed', capped: 'Hit its spending cap', terminal: 'In a terminal with you' };
const STATE_WORD = { working: 'Working', idle: 'Idle', approval: 'Needs you', starting: 'Opening', crashed: 'Crashed', capped: 'At cap', gone: 'Gone', terminal: 'In terminal' };
const EFFORTS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const VIEW_ONLY = 'View only. Use Take control at the top of the page.';

const R = {
  id: 0, v: null, owner: false, first: true,
  // discussion
  msgs: [], lastId: 0, seenId: null, unreadFrom: null, dividerPlaced: false, lastShown: null,
  stick: true, away: false, wasHidden: false, newCount: 0, loadingOlder: false, exhausted: false,
  filters: { note: true, ask: true, answer: true, done: true, decision: true, blocked: true, system: true, ...store.get('filters', {}) },
  // report
  seen: null, secs: new Map(), rolls: new Map(), rollLines: new Map(),
  // needs, crew
  needRows: new Map(), needsOpen: false, crew: new Map(), popAgent: null, talkCmds: {},
  el: {}, inflight: false, again: false, stopped: false,
  tasksDraw: null,
};

function roomPage(id) {
  R.id = id;
  R.seenId = store.get(`seen.${id}`, null);
  R.unreadFrom = R.seenId;
  R.seen = store.get(`sections.${id}`, null);
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 700);
  setInterval(watchMarks, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) R.wasHidden = true; else tick();
  });
}
async function tick() {
  if (R.stopped) return;
  if (R.inflight) { R.again = true; return; }
  R.inflight = true;
  try {
    const v = await getJSON(`/api/room/${R.id}?after=${R.lastId}`);
    if (R.v && v.owner !== R.owner) { location.reload(); return; }
    apply(v);
  } catch (e) {
    if (e instanceof Gone) { R.stopped = true; roomGone(); }
  } finally {
    R.inflight = false;
    if (R.again) { R.again = false; tick(); }
  }
}
function roomGone() {
  const app = document.getElementById('app');
  document.title = 'Room not found | Henchmen';
  app.replaceChildren(banner, h('div', { class: 'empty lost' },
    h('h2', {}, "This room doesn't exist"),
    h('p', {}, 'It may have been deleted. ', h('a', { href: '/' }, 'See all projects'))));
}
function apply(v) {
  if (!R.v) { R.owner = v.owner; buildRoom(v); }
  R.v = v;
  renderTop(v);
  renderNeeds(v);
  renderCrew(v);
  renderReport(v);
  renderChat(v);
  if (R.tasksDraw) R.tasksDraw(v);
  R.first = false;
}

function buildRoom() {
  const app = document.getElementById('app');
  app.dataset.tab = 'report';
  const E = R.el;
  E.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  E.lead = h('span', { class: 'lead-line' });
  E.fullAccess = h('span', { class: 'full-access', hidden: true, title: 'Agents started in this room run any command without asking. Change this in Room settings.' }, 'Full access');
  E.spend = h('span', { class: 'spend' });
  E.tasksBtn = h('button', { class: 'btn', type: 'button', onclick: openTasks });
  E.startBtn = h('button', { class: 'btn primary', type: 'button', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY, onclick: openStart }, 'Start agent');
  E.viewBtn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => toggleView() }, 'View');
  E.needs = h('section', { class: 'needs', 'aria-label': 'Needs you', hidden: true });
  E.needList = h('div', {});
  E.needMore = h('div', { class: 'needs-more', hidden: true });
  E.needs.append(E.needList, E.needMore);
  E.report = h('section', { class: 'report', 'aria-label': 'Report', id: 'panel-report' });
  E.sections = h('div', {});
  E.addSlot = h('div', {});
  E.rollups = h('div', { class: 'rollups', hidden: true });
  E.rollList = h('div', {});
  E.rollups.append(h('h2', {}, 'Divisions'), E.rollList);
  E.details = h('div', { class: 'details', hidden: true });
  E.emptyReport = h('div', { class: 'empty', hidden: true });
  E.words = h('span', {});
  E.addBtn = h('button', { class: 'text-btn', type: 'button', disabled: !R.owner, onclick: openAddSection }, 'Add section');
  E.goalText = h('span', {});
  E.goalEdit = h('button', { class: 'text-btn', type: 'button', onclick: openSettings });
  E.goalRule = h('div', { class: 'goal-rule' });
  E.report.append(h('div', { class: 'goal' }, h('strong', {}, 'Goal: '), E.goalText, ' ', E.goalEdit, E.goalRule), E.emptyReport, E.sections, E.addSlot, E.rollups, E.details, h('div', { class: 'report-foot' }, E.words, E.addBtn));

  E.chat = h('div', { class: 'chat', tabindex: '0', role: 'log', 'aria-label': 'Discussion messages', onscroll: onChatScroll });
  E.jump = h('button', { class: 'btn jump', type: 'button', hidden: true, onclick: () => { scrollChatEnd(); onChatScroll(); } });
  E.disc = h('section', { class: 'disc', 'aria-label': 'Discussion', id: 'panel-discussion' }, E.chat, h('div', { class: 'jump-slot' }, E.jump), buildComposer());

  E.crewList = h('ul', { class: 'crew', 'aria-label': 'Crew' });
  E.clearGone = h('button', { class: 'stop-all clear-gone', type: 'button', hidden: true, disabled: !R.owner, title: 'Clear agents who are gone, leaving a handoff for each', onclick: openClearGone }, 'Clear gone');
  E.stopAll = h('button', { class: 'stop-all', type: 'button', hidden: true, disabled: !R.owner, title: 'Stop every agent running in this room and its divisions', onclick: stopAll }, 'Stop all');
  E.rail = h('div', { class: 'rail' },
    h('div', { class: 'rail-handle', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels. Use the left and right arrow keys.', 'aria-valuemin': '25', 'aria-valuemax': '75', 'aria-valuenow': '50', onpointerdown: startDrag, onkeydown: dragKeys }),
    h('h2', { class: 'rail-head' }, 'On the payroll'),
    E.crewList,
    h('div', { class: 'rail-foot' }, E.clearGone, E.stopAll));
  E.split = h('main', { class: 'split' }, E.report, E.rail, E.disc);
  E.pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Agent', hidden: true });
  E.viewPop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'View', hidden: true });

  E.tabReport = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', 'aria-controls': 'panel-report', onclick: () => setTab('report') }, 'Report');
  E.tabCount = h('span', { class: 'count', hidden: true });
  E.tabDisc = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'panel-discussion', onclick: () => setTab('discussion') }, 'Discussion', E.tabCount);

  app.append(
    h('header', { class: 'top' },
      h('a', { class: 'brand', href: '/', title: 'All projects', 'aria-label': 'Henchmen, all projects' }, h('img', { src: '/logo.svg', alt: '', width: '30', height: '30' }), h('span', {}, 'Henchmen')),
      E.crumbs, E.lead, E.fullAccess,
      h('div', { class: 'actions' }, E.spend, E.tasksBtn, E.startBtn, E.viewBtn,
        h('button', { class: 'btn', type: 'button', onclick: openSettings }, 'Room settings'))),
    banner,
    h('div', { class: 'notice', hidden: R.owner }, 'View only. ', takeControlButton(), ' or run ', h('code', {}, 'henchmen open'), '.'),
    E.needs,
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Panels' }, E.tabReport, E.tabDisc),
    E.split, E.pop, E.viewPop);
  applySplit();
  setSwap(store.get('swap', false));
}
function setTab(tab) {
  const app = document.getElementById('app');
  app.dataset.tab = tab;
  R.el.tabReport.setAttribute('aria-selected', String(tab === 'report'));
  R.el.tabDisc.setAttribute('aria-selected', String(tab === 'discussion'));
  if (tab === 'discussion' && R.stick) { scrollChatEnd(); onChatScroll(); }
}

// ---------- top bar ----------
function renderTop(v) {
  const E = R.el;
  const sig = JSON.stringify(v.crumbs);
  if (sig !== E.crumbSig) {
    E.crumbSig = sig;
    const parts = [];
    v.crumbs.forEach((c, i) => {
      if (i) parts.push(h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'));
      parts.push(h('a', { href: `/r/${c.id}`, 'aria-current': i === v.crumbs.length - 1 ? 'page' : null }, c.slug));
    });
    parts.push(h('button', { class: 'chev', type: 'button', 'aria-label': 'Switch project or division', title: 'Switch project or division', onclick: openSwitcher }));
    E.crumbs.replaceChildren(...parts);
  }
  document.title = `${v.needs.length ? `(${v.needs.length}) ` : ''}${v.room.path} | Henchmen`;
  const stops = v.room.until_ts ? `, stops ${stopWhen(v.room.until_ts)}` : '';
  const lead = (v.leader ? `Led by ${v.leader}, ${v.agents.filter((a) => a.here).length} here` : 'Nobody here yet') + stops;
  if (E.lead.textContent !== lead) { E.lead.textContent = lead; E.lead.title = lead; }
  E.fullAccess.hidden = v.room.effective_security !== 'full';
  // Window agents run on the person's plan, so with only those there's no spend to report, and saying so reads like an error.
  E.spend.textContent = v.agents.some((a) => a.run && a.run.mode !== 'window') ? spendText(v.spend) : '';
  const open = v.tasks.filter((t) => t.status !== 'done').length;
  E.tasksBtn.replaceChildren('Tasks ', h('span', { class: 'tasks-n' }, String(open)));
}

// ---------- needs strip ----------
const NEED_ORDER = { approval: 0, window: 0, request: 0, blocked: 1, paused: 2, question: 3, agent: 4 };
function approvalInput(n) {
  let o;
  try { o = JSON.parse(n.input); } catch { return n.input; }
  if (o && typeof o.command === 'string') {
    // The command, plus every other option it carries: an approval has to show all of what it approves.
    const rest = Object.keys(o).filter((k) => k !== 'command' && k !== 'description');
    return [o.command, ...rest.map((k) => `${k}: ${JSON.stringify(o[k])}`)].join('\n');
  }
  if (o && typeof o === 'object') {
    const keys = Object.keys(o);
    if (!keys.length) return '(no input)';
    return keys.map((k) => `${k}: ${typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k])}`).join('\n');
  }
  return String(n.input);
}
function needRow(n) {
  const prefix = [n.here ? h('strong', {}, n.room) : h('a', { href: `/r/${n.room_id}` }, n.room), ': '];
  const reply = h('form', { class: 'need-reply', hidden: true });
  const actions = h('div', { class: 'need-actions' });
  if (!n.here) actions.append(h('a', { class: 'btn', href: `/r/${n.room_id}` }, 'Open room'));
  let text, long = false;
  const btn = (label, cls, fn) => {
    const b = h('button', { class: `btn ${cls || ''}`, type: 'button', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY });
    b.textContent = label;
    b.addEventListener('click', () => run(b, async () => { await fn(); tick(); }));
    return b;
  };
  const resolve = () => btn('Resolve', '', () => act('resolve', { id: n.id, room_id: n.room_id }));
  if (n.type === 'approval') {
    const input = approvalInput(n);
    long = input.length > 180 || input.includes('\n');
    text = [...prefix, `${n.agent} wants to run ${n.tool}: `, h('code', {}, input)];
    if (n.input.length >= 4000) text.push(' ', h('strong', {}, 'Input cut off at 4,000 characters, so this may not be all of it.'));
    actions.append(btn('Approve', 'primary', () => act('decide', { id: n.id, room_id: n.room_id, decision: 'allow' })), btn('Deny', '', () => act('decide', { id: n.id, room_id: n.room_id, decision: 'deny' })));
  } else if (n.type === 'blocked') {
    long = n.body.length > 180 || n.body.includes('\n');
    text = [...prefix, `${n.agent} is blocked: ${n.body}`];
    actions.append(resolve());
  } else if (n.type === 'question') {
    long = n.body.length > 180 || n.body.includes('\n');
    text = [...prefix, `${n.agent} asks: ${n.body}`];
    const replyBtn = h('button', { class: 'btn primary', type: 'button', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY, 'aria-expanded': 'false' }, 'Reply');
    const input = h('input', { 'aria-label': `Reply to ${n.agent}`, required: true, autocomplete: 'off' });
    const send = h('button', { class: 'btn primary', type: 'submit' }, 'Send reply');
    reply.append(input, send);
    reply.addEventListener('submit', (e) => {
      e.preventDefault();
      // A reply answers the question, so it also closes the row.
      run(send, async () => {
        await act('say', { id: n.room_id, body: input.value, target: n.agent });
        await act('resolve', { id: n.id, room_id: n.room_id });
        tick();
      });
    });
    replyBtn.addEventListener('click', () => { reply.hidden = !reply.hidden; replyBtn.setAttribute('aria-expanded', String(!reply.hidden)); if (!reply.hidden) input.focus(); });
    actions.append(replyBtn, resolve());
  } else if (n.type === 'request') {
    long = (n.body || '').length > 120;
    text = [...prefix, `${n.agent} asks for a new ${n.role} on ${(n.model || '').replace(/^claude-/, '').split('-')[0]}${n.body ? `: ${n.body}` : ''}`];
    actions.append(btn('Start agent', 'primary', () => act('answerRequest', { id: n.id, approve: true })), btn('Decline', '', () => act('answerRequest', { id: n.id, approve: false })));
  } else if (n.type === 'window') {
    text = [...prefix, `${n.agent} is ${n.body[0].toLowerCase()}${n.body.slice(1)}`]; // "builder is waiting for you in its terminal: dialog open"
    actions.append(btn('Open its terminal', 'primary', () => act('talk', { id: n.room_id, name: n.agent })));
  } else if (n.type === 'agent') {
    const why = n.status === 'crashed' ? `crashed: ${n.body}` : 'hit its spending cap';
    long = why.length > 180 || why.includes('\n');
    text = [...prefix, `${n.agent} ${why}`];
    actions.append(btn('Dismiss', '', () => act('ack', { id: n.id })));
  } else {
    text = [...prefix, n.body];
    actions.append(btn('Keep going', 'primary', () => act('resume', { id: n.room_id })));
  }
  const t = h('div', { class: `need-text ${long ? 'clamped' : ''}` }, ...text.flatMap((x) => (typeof x === 'string' ? refNodes(x) : [x])));
  // Questions and blocks are messages, so they can be found in the chat.
  const inChat = (n.type === 'question' || n.type === 'blocked') && (n.here
    ? h('button', { class: 'text-btn', type: 'button', onclick: () => jumpToMsg(n.id) }, 'Find in chat')
    : h('a', { class: 'text-btn', href: `/r/${n.room_id}#msg-${n.id}` }, 'Find in chat'));
  const more = long && h('button', {
    class: 'text-btn', type: 'button', 'aria-expanded': 'false',
    onclick: (e) => {
      const opened = t.classList.toggle('clamped');
      e.target.textContent = opened ? 'Show all' : 'Show less';
      e.target.setAttribute('aria-expanded', String(!opened));
    },
  }, 'Show all');
  return h('div', {}, h('div', { class: 'need' }, t, more, inChat || null, actions), reply);
}
function renderNeeds(v) {
  const E = R.el;
  const list = [...v.needs].sort((a, b) => NEED_ORDER[a.type] - NEED_ORDER[b.type] || a.ts - b.ts);
  E.needs.hidden = !list.length;
  const els = [];
  const live = new Set();
  for (const n of list) {
    const key = `${n.type}:${n.id}:${n.room}:${n.type === 'paused' ? n.body : ''}`;
    live.add(key);
    if (!R.needRows.has(key)) R.needRows.set(key, needRow(n));
    els.push(R.needRows.get(key));
  }
  for (const k of [...R.needRows.keys()]) if (!live.has(k)) R.needRows.delete(k);
  const extra = els.length - 3;
  if (extra <= 0) R.needsOpen = false;
  place(E.needList, R.needsOpen ? els : els.slice(0, 3));
  E.needMore.hidden = extra <= 0;
  if (extra > 0) {
    const label = R.needsOpen ? 'Show fewer' : `${extra} more`;
    if (E.needMore.textContent !== label) {
      E.needMore.replaceChildren(h('button', { class: 'text-btn', type: 'button', onclick: () => { R.needsOpen = !R.needsOpen; renderNeeds(R.v); } }, label));
    }
  }
}

// ---------- crew rail ----------
function agentState(a) {
  if (!a.here) {
    const st = a.source === 'page' && a.run?.status;
    return st === 'crashed' || st === 'capped' ? st : 'gone';
  }
  if (a.live) return { waiting: 'approval', starting: 'starting', idle: 'idle', terminal: 'terminal' }[a.run?.status] || 'working';
  if (a.waiting) return 'idle';
  return Date.now() - a.seen < 300000 ? 'working' : 'idle';
}
const isWindow = (a) => a.source === 'window' && !!a.run;
const stateText = (a) => (agentState(a) === 'approval' && isWindow(a) ? 'Waiting for you in its terminal' : STATE[agentState(a)]);
function renderCrew(v) {
  const E = R.el;
  const left = v.agents.filter((a) => !a.here);
  // Who left last, plus any crash or cap, so those stay visible.
  const gone = left.filter((a, i) => i >= left.length - 4 || agentState(a) !== 'gone');
  const els = [...v.agents.filter((a) => a.here), ...gone].map((a) => {
    let p = R.crew.get(a.name);
    if (!p) {
      p = { word: h('span', { class: 'crew-state' }), lead: h('span', { class: 'crew-lead' }, 'Leads') };
      p.btn = h('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggleAgent(a.name) },
        badge(a.name), h('span', { class: 'crew-text' }, h('span', { class: 'crew-name' }, a.name), h('span', { class: 'crew-status' }, p.word, p.lead)));
      p.li = h('li', {}, p.btn);
      R.crew.set(a.name, p);
    }
    const state = agentState(a);
    p.btn.className = `crew-btn ${state}`;
    const label = `${a.name}${a.leader ? ', leader' : ''}: ${stateText(a)}`;
    p.btn.title = label;
    p.btn.setAttribute('aria-label', label);
    p.word.textContent = STATE_WORD[state];
    p.lead.hidden = !a.leader;
    p.li.classList.toggle('off', !a.here);
    return p.li;
  });
  place(E.crewList, els);
  E.stopAll.hidden = !v.agents.some((a) => a.live) && !v.rollups.some((r) => r.live > 0);
  E.clearGone.hidden = !v.agents.some((a) => !a.here && !a.live);
  if (R.popAgent) {
    const a = v.agents.find((x) => x.name === R.popAgent);
    if (!a) closePop(); else if (popEl === E.pop) fillPop(a);
  }
}
function toggleAgent(name) {
  const E = R.el;
  if (popEl === E.pop && R.popAgent === name) { closePop(); R.popAgent = null; return; }
  const a = R.v.agents.find((x) => x.name === name);
  R.popAgent = name;
  E.popSig = null;
  fillPop(a);
  openPop(E.pop, R.crew.get(name).btn);
  // It sits apart from the rail in the page order, so the keyboard has to be taken there. Escape brings it back.
  E.pop.tabIndex = -1;
  (E.pop.querySelector('button:not(:disabled)') || E.pop).focus();
}
function commandBox(command) {
  const status = h('span', { class: 'hint', role: 'status' });
  return h('div', { class: 'command' },
    h('p', {}, 'Paste this into a terminal'),
    h('code', {}, command),
    h('div', { class: 'row' }, h('button', {
      class: 'btn', type: 'button',
      onclick: () => Promise.resolve().then(() => navigator.clipboard.writeText(command)).then(() => { status.textContent = 'Copied.'; }, () => { status.textContent = "Couldn't copy. Select the command and copy it yourself."; }),
    }, 'Copy command'), status));
}
function fillPop(a) {
  const E = R.el;
  const command = a.live ? R.talkCmds[a.name] : null;
  const sig = JSON.stringify([a, R.v.leader, command]);
  if (sig === E.popSig) return;
  E.popSig = sig;
  const page = a.source === 'page' && a.run;
  const win = isWindow(a);
  const inTerminal = agentState(a) === 'terminal';
  const rows = [['State', stateText(a)]];
  if (a.leader) rows.push(['Role', 'Leads this room']);
  if (a.run?.role) rows.push(['Role', a.run.role]);
  rows.push(['Task', a.task || a.doing || 'Picks its own work']);
  if (page || win) {
    if (!inTerminal && !win) rows.push(['Doing now', a.run.activity || (a.live ? 'Nothing right now' : 'Stopped')]);
    if (!win) rows.push(['Spend', `${a.run.cost_known ? `${money(a.run.cost)} of` : 'Not reported;'} ${money(a.run.cap)} cap`]); // a window agent's spend isn't known
    rows.push(['Model', a.run.model || 'Your default']);
    if (a.run.effort) rows.push(['Effort', EFFORTS[a.run.effort] || a.run.effort]);
    if (a.run.why && !a.live) rows.push(['Why it stopped', a.run.why]);
  } else {
    rows.push(['Last seen', ago(a.seen)]);
  }
  if (!inTerminal) rows.push(['Runs in', win ? 'Its own terminal window' : a.source === 'page' ? 'This page' : 'A terminal']);
  const owned = { disabled: !R.owner, title: R.owner ? null : VIEW_ONLY };
  const talk = a.live && h('button', { class: 'btn primary', type: 'button', ...owned }, a.source === 'window' ? 'Open its terminal' : 'Talk to agent');
  if (talk) {
    talk.addEventListener('click', () => run(talk, async () => {
      const t = await act('talk', { id: R.id, name: a.name });
      if (t.opened) { delete R.talkCmds[a.name]; toast(win ? 'Opened a terminal window' : 'Opened in your terminal'); } else R.talkCmds[a.name] = t.command;
      const now = R.v.agents.find((x) => x.name === a.name);
      if (now) fillPop(now);
      if (!t.opened) E.pop.querySelector('.command button')?.focus();
    }));
  }
  const stop = a.live && h('button', { class: 'btn danger', type: 'button', ...owned }, `Stop ${a.name}`);
  if (stop) stop.addEventListener('click', () => run(stop, async () => { await act('stop', { id: R.id, name: a.name }); closePop(); R.popAgent = null; tick(); }));
  // This redraws while open, so the button in use keeps focus.
  const focused = E.pop.contains(document.activeElement) ? document.activeElement.textContent : null;
  E.pop.replaceChildren(
    h('h2', {}, a.name),
    h('dl', {}, rows.flatMap(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])),
    ...(inTerminal ? [h('p', { class: 'pop-note' }, "It's in a full terminal session with you. Messages sent now are held and delivered when it returns.")] : []),
    ...(win && a.live ? [h('p', { class: 'pop-note' }, "Runs in its own terminal window on your plan. Room messages are typed into it; they wait while it's asking you something.")] : []),
    ...(a.here && a.source === 'terminal' ? [h('p', { class: 'pop-note' }, 'This session runs in your own terminal.')] : []),
    ...(a.live ? [h('div', { class: 'pop-actions' }, talk, stop)] : []),
    ...(command ? [commandBox(command)] : []));
  if (focused) [...E.pop.querySelectorAll('button')].find((b) => b.textContent === focused)?.focus();
  if (popEl === E.pop) E.pop.style.top = `${Math.max(12, Math.min(parseFloat(E.pop.style.top), innerHeight - E.pop.offsetHeight - 12))}px`;
}
function openClearGone() {
  const gone = R.v.agents.filter((a) => !a.here && !a.live);
  openDialog({
    title: `Clear ${plural(gone.length, 'gone agent')}`, cls: 'center',
    build: (body, d) => {
      const err = h('p', { class: 'err', role: 'alert' });
      const btn = h('button', { class: 'btn primary', type: 'button' }, `Clear ${plural(gone.length, 'agent')}`);
      btn.addEventListener('click', () => run(btn, async () => {
        const { cleared } = await act('clearGone', { id: R.id });
        d.close();
        toast(`Cleared ${plural(cleared.length, 'agent')}. Each left a handoff in the report.`);
        tick();
      }, err));
      body.append(
        h('p', {}, 'Each one leaves the crew and gets a handoff page in this report, built from its status, tasks, commits and latest messages. Its files, messages and chat history stay.'),
        h('ul', { class: 'gone-list' }, gone.map((a) => h('li', {}, h('strong', {}, a.name), a.doing ? `: ${a.doing}` : ''))),
        h('p', { class: 'hint' }, "Unfinished tasks become unassigned and claims are released. This doesn't close any terminal: a silent session can look gone, and it rejoins by syncing under its name."),
        err, h('div', { class: 'row' }, btn));
    },
  });
}
function openHandoffs(list) {
  openDialog({
    title: 'Handoffs', cls: 'center',
    build: (body, d) => {
      body.append(h('ul', { class: 'gone-list' }, list.map((x) => h('li', {}, h('button', { class: 'text-btn', type: 'button', onclick: () => { d.close(); openDetail(x.name); } }, x.name.replace(/^Handoff: /, ''))))));
    },
  });
}
function stopAll(e) {
  run(e.target, async () => {
    const { stopped } = await act('stopAll', { id: R.id });
    toast(stopped ? `Stopped ${plural(stopped, 'agent')}.` : 'No page-started agents were running. Terminal agents stop from their own terminals.');
    tick();
  });
}

// ---------- divider ----------
const clampSplit = (x) => Math.min(0.75, Math.max(0.25, x));
function applySplit() {
  const x = store.get('split', 0.5);
  R.el.split.style.setProperty('--split', x);
  R.el.rail.firstChild.setAttribute('aria-valuenow', String(Math.round(x * 100)));
}
function setSplit(x) { store.set('split', clampSplit(x)); applySplit(); }
function startDrag(e) {
  if (e.button !== 0) return;
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const box = R.el.split.getBoundingClientRect();
  const rail = R.el.rail.offsetWidth;
  const move = (m) => setSplit((m.clientX - box.left - rail / 2) / (box.width - rail));
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}
function dragKeys(e) {
  const x = store.get('split', 0.5);
  if (e.key === 'ArrowLeft') setSplit(x - 0.02);
  else if (e.key === 'ArrowRight') setSplit(x + 0.02);
  else if (e.key === 'Home') setSplit(0.5);
  else return;
  e.preventDefault();
}
function setSwap(on) {
  store.set('swap', on);
  R.el.split.classList.toggle('swapped', on);
}

// ---------- report ----------
function saveSeen() { store.set(`sections.${R.id}`, R.seen); }
function markSeen(key, version) {
  if (!R.seen) R.seen = {};
  R.seen[key] = version;
  saveSeen();
}
function setMark(e, on) {
  e.changed = on;
  e.el.classList.toggle('changed', on);
  e.note.hidden = !on;
  if (!on) e.marks = null;
  e.watched = 0;
}
function pulse(el) {
  el.classList.remove('pulse');
  void el.offsetWidth; // restart the animation for a second update
  el.classList.add('pulse');
  el.addEventListener('animationend', () => el.classList.remove('pulse'), { once: true });
}
function sectionEntry(name) {
  const e = { name, s: null, marks: null, changed: false, watched: 0, editing: false };
  e.note = h('span', { class: 'mark-note', hidden: true }, 'Changed');
  e.meta = h('span', { class: 'sec-meta' });
  e.title = h('h2', {}, name);
  e.editBtn = h('button', { class: 'text-btn', type: 'button', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY, 'aria-label': `Edit ${name}`, onclick: () => openEditor(e) }, 'Edit');
  e.body = h('div', { class: 'md' });
  e.editor = h('div', { class: 'editor', hidden: true });
  e.el = h('article', { class: 'sec' }, h('div', { class: 'sec-head' }, e.title, e.note, e.meta, e.editBtn), e.body, e.editor);
  return e;
}
const rollupText = (body) => body.replace(/^\s*(#{1,3}|>)\s+/gm, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
function paintBody(e) { e.body.innerHTML = markdown(e.s.body, e.marks); }
function metaText(s) { return `updated ${ago(s.ts)} by ${s.by === 'human' ? 'you' : s.by}`; }
const stopWhen = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function renderGoal(r) {
  const E = R.el;
  E.goalText.textContent = r.brief || 'No goal set yet.';
  E.goalEdit.textContent = r.brief ? 'Change' : 'Set goal';
  const rule = r.paused ? '' : !r.until_ts ? 'Runs until the leader says the goal is done.'
    : r.past_goal ? `Runs until ${stopWhen(r.until_ts)}, improving after the goal is met.`
    : `Runs until ${stopWhen(r.until_ts)}, or until the goal is met.`;
  E.goalRule.textContent = [r.goal_met && `Goal met: ${r.goal_met}`, rule].filter(Boolean).join(' ');
}
function renderReport(v) {
  const E = R.el;
  renderGoal(v.room);
  const firstEver = R.seen == null;
  if (firstEver) R.seen = {};
  const live = new Set();
  const els = v.sections.map((s) => {
    live.add(s.name);
    let e = R.secs.get(s.name);
    const fresh = !e;
    if (!e) { e = sectionEntry(s.name); R.secs.set(s.name, e); }
    if (e.savedAt && Date.now() - e.savedAt < 3000 && s.version < e.s.version) return e.el; // a poll from before our own save
    // Same version with new text means it was deleted and written again between polls.
    const landed = e.s && (e.s.version !== s.version || e.s.body !== s.body);
    const rewritten = landed && e.s.version === s.version;
    const oldBody = e.s?.body;
    e.s = s;
    e.meta.textContent = metaText(s);
    const key = `s:${s.name}`;
    if (firstEver) R.seen[key] = s.version;
    const unseen = R.seen[key] !== s.version || rewritten;
    if (unseen && (fresh && !R.first || landed)) {
      // Landed while watching: mark exactly which lines changed.
      e.marks = changedLines(oldBody, s.body);
      setMark(e, true);
      if (!e.editing) pulse(e.el);
    } else if (unseen && !e.changed) {
      setMark(e, true); // changed while away: the old text isn't known, so no line marks
    }
    if (fresh || landed) paintBody(e);
    return e.el;
  });
  for (const [name, e] of R.secs) {
    if (!live.has(name)) {
      if (e.editing) els.push(e.el); else R.secs.delete(name);
    }
  }
  place(E.sections, els);

  const liveLines = new Set();
  const rollEls = v.rollups.map((r) => {
    let e = R.rolls.get(r.id);
    if (!e) {
      e = {};
      e.link = h('a', { href: `/r/${r.id}` });
      e.tag = h('span', { class: 'tag-alert', hidden: true });
      e.leader = h('span', {});
      e.agents = h('span', {});
      e.spend = h('span', {});
      e.lines = h('div', {});
      e.none = h('div', { class: 'roll-line' }, 'No report yet.');
      e.el = h('div', { class: 'roll' }, h('div', { class: 'roll-head' }, e.link, e.tag, e.leader, e.agents, e.spend), e.lines);
      R.rolls.set(r.id, e);
    }
    e.link.textContent = r.slug;
    const blocked = v.needs.some((n) => n.type === 'blocked' && (n.room === r.slug || n.room.startsWith(`${r.slug}/`)));
    e.tag.hidden = !(r.needs > 0);
    e.tag.textContent = blocked ? 'Blocked' : 'Needs you';
    e.leader.textContent = r.leader ? `Led by ${r.leader}` : 'No leader yet';
    e.agents.textContent = `${plural(r.agents, 'agent')} here`;
    e.spend.textContent = spendText(r.spend);
    const lines = r.sections.map((s) => {
      const key = `r:${r.id}:${s.name}`;
      liveLines.add(key);
      let l = R.rollLines.get(key);
      const fresh = !l;
      if (!l) {
        l = { name: key, isRoll: true, version: null, changed: false, watched: 0 };
        l.note = h('span', { class: 'mark-note', hidden: true }, 'Changed');
        l.text = h('span', { class: 'roll-text' });
        l.el = h('div', { class: 'roll-line' }, l.note, l.text);
        R.rollLines.set(key, l);
      }
      const landed = l.version != null && (l.version !== s.version || l.body !== s.body);
      const rewritten = landed && l.version === s.version;
      l.version = s.version;
      l.body = s.body;
      if (fresh || landed) {
        const text = rollupText(s.body);
        l.text.replaceChildren(h('strong', {}, `${s.name}: `), text);
        l.el.title = `${s.name}: ${text}`;
      }
      if (firstEver) R.seen[key] = s.version;
      if ((R.seen[key] !== s.version || rewritten) && (landed || !l.changed)) {
        setMark(l, true);
        if (landed || !R.first) pulse(l.el);
      }
      return l.el;
    });
    place(e.lines, lines.length ? lines : [e.none]);
    return e.el;
  });
  for (const key of R.rollLines.keys()) if (!liveLines.has(key)) R.rollLines.delete(key);
  place(E.rollList, rollEls);
  E.rollups.hidden = !rollEls.length;
  if (firstEver || R.first) saveSeen();

  E.details.hidden = !v.details.length;
  const detailSig = JSON.stringify(v.details.map((d) => d.name));
  if (detailSig !== E.detailSig) {
    E.detailSig = detailSig;
    // Handoffs collapse into one link, so clearing a crew doesn't crowd the one-page report.
    const handoffs = v.details.filter((d) => d.name.startsWith('Handoff: '));
    const pages = v.details.filter((d) => !d.name.startsWith('Handoff: '));
    E.details.replaceChildren(h('span', {}, 'Detail pages:'), ...pages.map((d) => h('button', { class: 'text-btn', type: 'button', onclick: () => openDetail(d.name) }, d.name)), ...(handoffs.length ? [h('button', { class: 'text-btn', type: 'button', onclick: () => openHandoffs(handoffs) }, `Handoffs (${handoffs.length})`)] : []));
  }
  E.words.textContent = `${v.words} of ${v.word_limit} words`;
  updateItems(v.items);

  const blank = !v.sections.length && !v.rollups.length && !v.details.length;
  E.emptyReport.hidden = !blank;
  if (blank) {
    const sig = `${v.room.path}\n${v.room.brief}`;
    if (sig !== E.emptySig) {
      E.emptySig = sig;
      E.emptyReport.replaceChildren(
        h('h2', {}, 'No report yet'),
        v.room.brief && h('p', { class: 'goal' }, `Goal: ${v.room.brief}`),
        h('p', {}, "This page will show the room's current state: short named sections that are replaced as the work moves, plus one row for each division."),
        h('p', {}, 'An agent publishes a section with ', h('code', {}, `henchmen ${v.room.path} NAME report set Status "what's true now"`), '. You can also add one here.'));
    }
  }
  for (const e of R.secs.values()) if (e.s) e.meta.textContent = metaText(e.s);
}
// Marks clear after about 10 seconds in view, or once the viewer has seen one and scrolled on.
function watchMarks() {
  if (!R.v || document.hidden) return;
  const panel = R.el.report.getBoundingClientRect();
  if (!panel.height) return;
  for (const e of [...R.secs.values(), ...R.rollLines.values()]) {
    if (!e.changed || e.editing) continue;
    const r = e.el.getBoundingClientRect();
    const visible = r.height > 0 && r.bottom > panel.top + 20 && r.top < panel.bottom - 20;
    if (visible) e.watched++;
    const done = visible ? e.watched >= 10 : e.watched > 0;
    if (!done) continue;
    setMark(e, false);
    if (e.isRoll) markSeen(e.name, e.version);
    else { markSeen(`s:${e.name}`, e.s.version); paintBody(e); }
  }
}
function closeEditor(e) {
  e.editing = false;
  e.editor.hidden = true;
  e.editor.replaceChildren();
  e.body.hidden = false;
  e.editBtn.hidden = false;
  if (!R.v.sections.some((s) => s.name === e.name)) { R.secs.delete(e.name); e.el.remove(); return; }
  paintBody(e);
}
function refusalText(err) {
  const m = err.status === 413 && String(err.text).match(/would be (\d+) words.*fits (\d+)/);
  if (m) return `Refused: that makes the report ${m[1]} words and this page fits ${m[2]}. Nothing was saved. Cut ${m[1] - m[2]} words, or move the detail to a linked page.`;
  return err.message;
}
// A stale save comes back as text: the first line says the version, and the current text follows the first "---".
function parseStale(text) {
  const cut = text.indexOf('\n---\n');
  const m = text.slice(0, cut < 0 ? undefined : cut).match(/.*is at version (\d+)/);
  return { version: m ? Number(m[1]) : 0, body: cut < 0 ? '' : text.slice(cut + 5) };
}
function openEditor(e) {
  e.editing = true;
  e.editBtn.hidden = true;
  e.body.hidden = true;
  e.editor.hidden = false;
  let base = e.s.version;
  const ta = h('textarea', { rows: Math.min(14, e.s.body.split('\n').length + 2), 'aria-label': `Text of ${e.name}`, value: e.s.body });
  const err = h('p', { class: 'err', role: 'alert' });
  const compare = h('div', { hidden: true });
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Save section');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => closeEditor(e) }, 'Cancel');
  save.addEventListener('click', () => {
    err.textContent = '';
    save.disabled = true;
    act('report', { id: R.id, name: e.name, body: ta.value, base }).then((res) => {
      if (res.version) markSeen(`s:${e.name}`, res.version);
      else delete R.seen[`s:${e.name}`];
      setMark(e, false);
      e.s = { ...e.s, body: ta.value.trim(), version: res.version || e.s.version };
      e.savedAt = Date.now();
      closeEditor(e);
      tick();
    }, (x) => {
      if (x.status === 409) {
        const cur = parseStale(x.text);
        base = cur.version;
        compare.hidden = false;
        err.textContent = `Someone saved version ${cur.version} while you were editing. Nothing was overwritten and your text is still here. Compare them, fix yours on the right, and save again.`;
        const takeCurrent = h('button', { class: 'btn', type: 'button', onclick: () => { ta.value = cur.body; compare.after(ta); compare.hidden = true; err.textContent = ''; ta.focus(); } }, 'Use current text');
        compare.replaceChildren(h('div', { class: 'compare' },
          h('div', {}, h('h3', {}, `Current text, version ${cur.version}`), h('pre', {}, cur.body), h('div', { class: 'row' }, takeCurrent)),
          h('div', {}, h('h3', {}, 'Your text'), ta)));
      } else {
        err.textContent = refusalText(x);
      }
    }).finally(() => { save.disabled = false; });
  });
  e.editor.replaceChildren(compare, ta, err, h('div', { class: 'row' }, save, cancel, h('span', { class: 'hint' }, 'Save it empty to remove the section.')));
  ta.focus();
}
function openAddSection() {
  const E = R.el;
  if (E.addSlot.firstChild) { E.addSlot.querySelector('input')?.focus(); return; }
  const name = h('input', { required: true, maxlength: '60', 'aria-label': 'Section name', placeholder: 'Section name' });
  const ta = h('textarea', { rows: 4, 'aria-label': 'Section text', required: true, placeholder: 'What should this section say?' });
  const err = h('p', { class: 'err', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Add section');
  E.addSlot.append(h('form', {
    class: 'sec editor',
    onsubmit: (ev) => {
      ev.preventDefault();
      err.textContent = '';
      save.disabled = true;
      act('report', { id: R.id, name: name.value.trim(), body: ta.value, base: 0 }).then((res) => {
        markSeen(`s:${name.value.trim()}`, res.version);
        E.addSlot.replaceChildren();
        tick();
      }, (x) => {
        err.textContent = x.status === 409 ? `A section called "${name.value.trim()}" already exists. Pick another name, or edit that one.` : refusalText(x);
      }).finally(() => { save.disabled = false; });
    },
  }, name, h('div', { class: 'editor' }, ta), err, h('div', { class: 'row' }, save, h('button', { class: 'btn', type: 'button', onclick: () => E.addSlot.replaceChildren() }, 'Cancel'))));
  name.focus();
}
function openDetail(name) {
  openDialog({
    title: name, cls: 'sheet',
    build: (body) => {
      const box = h('div', { class: 'md' }, 'Loading');
      const meta = h('p', { class: 'hint' });
      body.append(box, meta);
      getJSON(`/api/room/${R.id}/detail?name=${encodeURIComponent(name)}`).then((d) => {
        if (d.body == null) { box.textContent = "This page isn't there anymore."; return; }
        box.innerHTML = markdown(d.body);
        meta.textContent = `Updated ${ago(d.ts)} by ${d.by === 'human' ? 'you' : d.by}`;
      }, () => { box.textContent = "Couldn't load this page. Check that Henchmen is running: henchmen list"; });
    },
  });
}

// ---------- discussion ----------
function buildComposer() {
  const E = R.el;
  E.input = h('textarea', {
    rows: 1, 'aria-label': 'Message', disabled: !R.owner,
    placeholder: R.owner ? 'Message the room. @name for one agent, /skill to run a skill.' : VIEW_ONLY,
    oninput: sizeInput,
    onkeydown: composerKeys,
  });
  E.menu = inputMenu(E.input, composerOptions);
  E.sendErr = h('p', { class: 'err', role: 'alert' });
  E.sendBtn = h('button', { class: 'btn primary', type: 'submit', disabled: !R.owner }, 'Send');
  return h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(); } }, E.menu.el,
    h('div', { class: 'composer-row' }, E.input, E.sendBtn), E.sendErr);
}
function sizeInput() {
  const t = R.el.input;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}
function send() {
  const E = R.el;
  const body = E.input.value;
  if (!body.trim()) return;
  // @name /skill runs it in that agent alone: the skill has to reach it as the start of the message.
  const skillFor = body.match(/^\s*@([a-z0-9][a-z0-9._-]*)\s+(\/[\s\S]*)$/);
  // One known @name anywhere goes to that agent; several go to everyone, where each still sees their name.
  const names = new Set([...body.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]*)/g)].map((m) => m[1]).filter((n) => R.v.agents.some((a) => a.here && a.name === n)));
  const target = names.size === 1 && !body.startsWith('@') && !body.startsWith('/') ? [...names][0] : undefined; // the server takes a leading @name itself
  run(E.sendBtn, async () => {
    await act('say', skillFor ? { id: R.id, body: skillFor[2], target: skillFor[1] } : { id: R.id, body, target });
    E.input.value = '';
    sizeInput();
    E.menu.hide();
    R.stick = true;
    tick();
  }, E.sendErr).then(() => E.input.focus());
}
function composerKeys(e) {
  if (R.el.menu.keys(e)) return;
  // isComposing: Enter confirms an IME candidate, it doesn't send.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
}
// The menu for @ and /: arrow keys, Enter or Tab, Escape, or click.
// find(textBeforeCaret, reload) answers { start, options: [{ insert, nodes, cls, title }], notes } or null for no menu.
let menuCount = 0;
function inputMenu(input, find, cls = '') {
  const id = `menu-${++menuCount}`;
  const el = h('ul', { class: `mentions ${cls}`, id, role: 'listbox', 'aria-label': 'Suggestions', hidden: true });
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  let start = 0;
  const hide = () => { el.hidden = true; input.removeAttribute('aria-activedescendant'); };
  const options = () => [...el.querySelectorAll('[role=option]')];
  const pick = (text) => {
    input.setRangeText(`${text} `, start, input.selectionStart, 'end');
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  const select = (item) => {
    options().forEach((x) => x.setAttribute('aria-selected', String(x === item)));
    if (item) { input.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
  };
  const update = () => {
    const found = find(input.value.slice(0, input.selectionStart), () => { if (!el.hidden) update(); });
    if (!found) { hide(); return; }
    start = found.start;
    el.replaceChildren(
      ...(found.notes || []).map((n) => h('li', { class: 'menu-note', role: 'presentation' }, n)),
      ...found.options.map((o, i) => h('li', {
        id: `${id}-${i}`, class: o.cls, role: 'option', title: o.title, 'aria-selected': 'false', 'data-insert': o.insert,
        onpointerdown: (ev) => { ev.preventDefault(); pick(o.insert); },
      }, o.nodes)));
    el.hidden = false;
    select(options()[0]);
  };
  input.addEventListener('input', update);
  input.addEventListener('blur', () => setTimeout(hide, 120));
  // True when the menu took the key.
  const keys = (e) => {
    if (el.hidden) return false;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return true; }
    const items = options();
    if (!items.length) return false;
    const i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]);
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing) { e.preventDefault(); pick(items[i].dataset.insert); return true; }
    return false;
  };
  return { el, keys, hide };
}
function composerOptions(before, reload) {
  const at = before.match(/(?:^|\s)@([a-z0-9._-]*)$/);
  if (at) {
    const here = R.v.agents.filter((a) => a.here && a.name.startsWith(at[1]));
    return here.length ? { start: before.length - at[1].length, options: here.map((a) => ({ insert: a.name, nodes: [badge(a.name), a.name] })) } : null;
  }
  const skill = before.match(/^@([a-z0-9][a-z0-9._-]*)\s+\/(\S*)$/) || before.match(/^()\/(\S*)$/);
  if (!skill) return null;
  // Only agents started from this page can take a skill as a turn; one in its own terminal just reads the message.
  const own = R.v.agents.some((a) => a.name === skill[1] && a.here && !a.live);
  const hint = own ? `${skill[1]} runs in your own terminal, so it only reads this as a message.` : skill[1] ? `Runs in ${skill[1]} only.` : 'The first free agent runs it. Start with @name to pick one.';
  return skillOptions(before, skill[2], reload, hint);
}
// Agents add to the list once they run, so it's fetched again after a minute.
const skillCache = { list: null, at: 0, loading: false, failed: false };
function skillOptions(before, query, reload, hint) {
  if (!skillCache.loading && Date.now() - skillCache.at > 60000) {
    skillCache.loading = true;
    getJSON(`/api/room/${R.id}/skills`).then(({ skills }) => { skillCache.list = skills; skillCache.failed = false; }, () => { skillCache.failed = true; })
      .finally(() => { skillCache.at = Date.now(); skillCache.loading = false; reload(); });
  }
  const start = before.length - query.length;
  const list = skillCache.list;
  if (!list) return { start, options: [], notes: [skillCache.failed ? "Couldn't load skills. Check that Henchmen is running: henchmen list" : 'Looking for skills'] };
  if (!list.length) return { start, options: [], notes: ['No skills found yet'] };
  const q = query.toLowerCase();
  const named = (x) => x.name.toLowerCase();
  const matched = list.filter((x) => named(x).includes(q)).sort((x, y) => named(y).startsWith(q) - named(x).startsWith(q)); // stable: names starting with it come first
  if (!matched.length) return { start, options: [], notes: [`No skill matches ${query}`] };
  return {
    start,
    notes: hint ? [hint] : [],
    options: matched.map((x) => ({
      insert: x.name, cls: 'skill', title: x.description || null,
      nodes: [h('span', { class: 'menu-name' }, `/${x.name}`), h('span', { class: 'menu-source' }, x.source), x.description && h('span', { class: 'menu-desc' }, x.description)],
    })),
  };
}

const showsInChat = (m) => (m.sender === 'human' ? true : m.sender === 'system' ? R.filters.system : R.filters[m.kind] !== false);
const sameRun = (a, b) => a && a.sender === b.sender && a.sender !== 'system' && a.from_room === b.from_room && a.target === b.target && b.ts - a.ts < 300000 && !TAGS[b.kind] && !TAGS[a.kind];
const itemWords = (x) => (x.handled === 2 ? `Handled by ${x.taken_by}` : x.handled === 1 ? `${x.taken_by} has this` : 'Waiting for a free agent');
function updateItems(items) {
  for (const x of items || []) {
    const el = document.querySelector(`[data-item="${Number(x.id)}"]`);
    if (el && el.textContent !== itemWords(x)) el.textContent = itemWords(x);
  }
}
// "#377" and "task 22" in a message are links, so a number always leads to what it means.
function refNodes(text) {
  const parts = String(text).split(/(#\d+|\b[Tt]asks? \d+)/);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const n = Number(part.match(/\d+/)[0]);
    if (part.startsWith('#')) return h('button', { class: 'ref', type: 'button', title: `Go to message ${part}`, onclick: () => jumpToMsg(n) }, part);
    const task = R.v?.tasks?.find((t) => t.id === n);
    return h('button', { class: 'ref', type: 'button', title: task ? task.title : `Open the task board`, onclick: openTasks }, part);
  });
}
async function jumpToMsg(id) {
  const find = () => document.querySelector(`[data-msg="${Number(id)}"]`);
  for (let i = 0; i < 25 && !find() && !R.exhausted; i++) await loadOlder();
  const el = find();
  if (!el) { toast(`Message #${id} isn't in this room.`); return; }
  el.querySelector('.bubble.clamped')?.classList.remove('clamped');
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 2000);
}
function msgEl(m, prev) {
  if (m.sender === 'system') return h('div', { class: 'sys', 'data-msg': m.id }, h('span', { class: 'msg-id' }, `#${m.id}`), ' ', ...refNodes(m.body));
  const own = m.sender === 'human';
  const cont = sameRun(prev, m);
  const head = !cont && h('div', { class: 'who' },
    h('strong', {}, own ? 'You' : m.sender),
    TAGS[m.kind] && h('span', { class: `tag tag-${m.kind}` }, TAGS[m.kind]),
    m.from_room && h('span', { class: 'from', title: `Synced from the division ${m.from_room}` }, m.from_room),
    m.target && h('span', { class: 'to' }, `to ${m.target === 'human' ? 'you' : m.target === 'all' ? 'everyone' : m.target}`),
    h('time', { datetime: new Date(m.ts).toISOString() }, clock(m.ts)),
    h('span', { class: 'msg-id' }, `#${m.id}`));
  const state = own && m.handled != null && h('div', { class: 'msg-state', 'data-item': m.id }, itemWords(m));
  // Long posts open short, so the chat stays readable. The full text is one click away.
  const long = !own && String(m.body).trim().split(/\s+/).length > 45;
  const bubble = h('div', { class: `bubble ${long ? 'clamped' : ''}` }, ...refNodes(m.body));
  const more = long && h('button', { class: 'text-btn more-btn', type: 'button', 'aria-expanded': 'false', onclick: (e) => {
    const open = bubble.classList.toggle('clamped');
    e.target.textContent = open ? 'Show more' : 'Show less';
    e.target.setAttribute('aria-expanded', String(!open));
  } }, 'Show more');
  const main = h('div', { class: 'msg-main' }, head || h('div', { class: 'who cont-id' }, h('span', { class: 'msg-id' }, `#${m.id}`)), bubble, more, state);
  return h('div', { class: `msg ${own ? 'own' : ''} ${cont ? 'cont' : ''} ${m.kind === 'blocked' ? 'blocked' : ''}`, 'data-msg': m.id },
    !own && (cont ? h('span', {}) : badge(m.sender)), main);
}
function appendMsgs(frag, msgs) {
  for (const m of msgs) {
    if (!showsInChat(m)) continue;
    if (!R.dividerPlaced && R.unreadFrom != null && m.id > R.unreadFrom && m.sender !== 'human') {
      R.dividerPlaced = true;
      frag.append(h('div', { class: 'unread', role: 'separator' }, h('span', {}, 'Unread')));
      R.lastShown = null;
    }
    frag.append(msgEl(m, R.lastShown));
    R.lastShown = m;
  }
}
// A link from another room's band lands here with #msg-123.
function jumpFromLink() {
  const id = location.hash.match(/^#msg-(\d+)$/)?.[1];
  if (!id || !R.msgs?.length) return;
  history.replaceState(null, '', location.pathname);
  jumpToMsg(Number(id));
}
function rebuildChat() {
  const E = R.el;
  const frag = document.createDocumentFragment();
  R.dividerPlaced = false;
  R.lastShown = null;
  if (R.exhausted && R.msgs.length) frag.append(h('div', { class: 'chat-start' }, 'This is the start of the discussion.'));
  appendMsgs(frag, R.msgs);
  if (!R.msgs.length) frag.append(h('div', { class: 'chat-empty' }, 'No messages yet. Start an agent, or say what you want done.'));
  E.chat.replaceChildren(frag);
}
const chatVisible = () => R.el.chat.clientHeight > 0;
function scrollChatEnd() {
  const c = R.el.chat;
  c.scrollTop = c.scrollHeight;
  R.stick = true;
}
function updateSeen() {
  if (document.hidden || !chatVisible() || !R.stick || !R.lastId) return;
  if (R.seenId !== R.lastId) { R.seenId = R.lastId; store.set(`seen.${R.id}`, R.lastId); }
}
function updateJump() {
  const E = R.el;
  E.jump.hidden = R.stick;
  E.jump.classList.toggle('fresh', R.newCount > 0);
  const label = R.newCount > 0 ? `Jump to latest, ${R.newCount} new` : 'Jump to latest';
  if (E.jump.textContent !== label) E.jump.textContent = label;
  E.tabCount.hidden = !R.newCount;
  E.tabCount.textContent = R.newCount;
}
function onChatScroll() {
  const c = R.el.chat;
  if (!chatVisible()) return;
  R.stick = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
  if (R.stick) { R.away = false; R.newCount = 0; updateSeen(); }
  updateJump();
  if (c.scrollTop < 300) loadOlder();
}
async function loadOlder() {
  if (R.loadingOlder || R.exhausted || !R.msgs.length) return;
  R.loadingOlder = true;
  const c = R.el.chat;
  try {
    const { messages } = await getJSON(`/api/room/${R.id}/older?before=${R.msgs[0].id}`);
    if (messages.length < 60) R.exhausted = true;
    R.msgs = messages.concat(R.msgs);
    const fromEnd = c.scrollHeight - c.scrollTop;
    rebuildChat();
    c.scrollTop = c.scrollHeight - fromEnd;
  } catch { /* the next scroll tries again */ } finally { R.loadingOlder = false; }
  if (!R.exhausted && chatVisible() && c.scrollTop < 300) loadOlder();
}
function renderChat(v) {
  const E = R.el;
  const fresh = v.messages.filter((m) => m.id > R.lastId);
  if (R.first) {
    R.msgs = fresh;
    if (fresh.length) R.lastId = fresh[fresh.length - 1].id;
    if (fresh.length < 100) R.exhausted = true;
    if (R.seenId == null || R.seenId >= R.lastId) { R.unreadFrom = null; if (R.lastId) { R.seenId = R.lastId; store.set(`seen.${R.id}`, R.lastId); } }
    rebuildChat();
    const div = E.chat.querySelector('.unread');
    if (div) {
      R.newCount = fresh.filter((m) => m.id > R.unreadFrom && showsInChat(m) && m.sender !== 'human').length;
      R.away = true;
      // When the discussion is hidden (phones), this waits for the tab.
      if (chatVisible()) { E.chat.scrollTop = div.offsetTop - E.chat.offsetTop - 40; R.stick = E.chat.scrollHeight - E.chat.scrollTop - E.chat.clientHeight < 40; }
    } else scrollChatEnd();
    if (R.stick && chatVisible()) { R.away = false; R.newCount = 0; updateSeen(); }
    updateJump();
    if (chatVisible() && E.chat.scrollTop < 300) loadOlder();
    jumpFromLink();
    return;
  }
  if (!fresh.length) { updateSeen(); return; }
  // Over 100 new since the last poll leaves a gap, so start again from what came back.
  if (fresh.length === 100 && R.lastId) {
    R.msgs = fresh;
    R.lastId = fresh[99].id;
    R.exhausted = false;
    rebuildChat();
    if (R.stick) scrollChatEnd();
    updateJump();
    return;
  }
  const watching = R.stick && !document.hidden && chatVisible() && !R.wasHidden;
  if (!watching && !R.away) {
    R.away = true;
    E.chat.querySelector('.unread')?.remove();
    R.dividerPlaced = false;
    R.unreadFrom = R.seenId;
    R.newCount = 0;
  }
  R.wasHidden = false;
  E.chat.querySelector('.chat-empty')?.remove();
  R.msgs.push(...fresh);
  R.lastId = fresh[fresh.length - 1].id;
  const stick = R.stick;
  const frag = document.createDocumentFragment();
  appendMsgs(frag, fresh);
  E.chat.append(frag);
  if (stick && chatVisible()) { scrollChatEnd(); R.away = false; R.newCount = 0; }
  else if (R.away) R.newCount += fresh.filter((m) => showsInChat(m) && m.sender !== 'human').length;
  updateSeen();
  updateJump();
}

// ---------- view menu ----------
function toggleView() {
  const E = R.el;
  if (popEl === E.viewPop) { closePop(); return; }
  const theme = store.get('theme', 'auto');
  const radio = (value, label) => h('label', { class: 'check' }, h('input', {
    type: 'radio', name: 'theme', value, checked: theme === value,
    onchange: () => { store.set('theme', value); applyTheme(value); },
  }), label);
  E.viewPop.replaceChildren(
    h('div', { class: 'pop-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => setSwap(!store.get('swap', false)) }, 'Swap sides'),
      h('button', { class: 'btn', type: 'button', onclick: () => setSplit(0.5) }, 'Reset divider')),
    h('h3', {}, 'Show in discussion'),
    ...FILTERS.map(([key, label]) => h('label', { class: 'check' }, h('input', {
      type: 'checkbox', checked: R.filters[key] !== false,
      onchange: (e) => {
        R.filters[key] = e.target.checked;
        store.set('filters', R.filters);
        const c = E.chat, fromEnd = c.scrollHeight - c.scrollTop;
        rebuildChat();
        if (R.stick) scrollChatEnd(); else c.scrollTop = c.scrollHeight - fromEnd;
      },
    }), label)),
    h('h3', {}, 'Theme'),
    radio('auto', 'Match my system'), radio('light', 'Light'), radio('dark', 'Dark'));
  openPop(E.viewPop, E.viewBtn);
  const a = E.viewBtn.getBoundingClientRect();
  E.viewPop.style.left = `${Math.max(12, Math.min(a.right - E.viewPop.offsetWidth, innerWidth - E.viewPop.offsetWidth - 12))}px`;
  E.viewPop.style.top = `${a.bottom + 8}px`;
  E.viewPop.querySelector('button').focus();
}

// ---------- switcher ----------
function openSwitcher() {
  const v = R.v;
  let timer;
  openDialog({
    title: 'Switch room', cls: 'switcher',
    onclose: () => clearInterval(timer),
    build: (body) => {
      const treeBox = h('div', {});
      const formBox = h('div', {});
      const paint = async () => {
        let t;
        try { t = await getJSON('/api/tree'); } catch { return; }
        const nodeEl = (n) => h('li', {},
          h('div', { class: `tree-row ${n.id === R.id ? 'current' : ''}` },
            h('a', { href: `/r/${n.id}`, 'aria-current': n.id === R.id ? 'page' : null }, n.slug),
            n.agents > 0 && h('span', { class: 'note' }, `${plural(n.agents, 'agent')}`),
            n.needs > 0 && h('span', { class: 'count', title: `${n.needs} waiting on you` }, n.needs)),
          n.children.length > 0 && h('ul', {}, n.children.map(nodeEl)));
        treeBox.replaceChildren(h('ul', { class: 'tree' }, t.roots.map(nodeEl)));
      };
      paint();
      timer = setInterval(() => { if (!document.hidden) paint(); }, 3000);
      const div = h('button', { class: 'btn', type: 'button', disabled: !R.owner, onclick: () => { formBox.replaceChildren(newDivisionForm(v.room.path, go)); formBox.querySelector('input').focus(); } }, 'New division here');
      const proj = h('button', { class: 'btn', type: 'button', disabled: !R.owner, onclick: () => { formBox.replaceChildren(h('div', { class: 'inline-form' }, newProjectForm(go))); formBox.querySelector('input').focus(); } }, 'New project');
      body.append(treeBox, h('div', { class: 'switch-actions' }, div, proj, h('a', { class: 'btn', href: '/' }, 'All projects')), formBox);
    },
  });
}

// ---------- tasks ----------
function openTasks() {
  openDialog({
    title: 'Tasks', onclose: () => { R.tasksDraw = null; },
    build: (body) => {
      const lead = h('p', {});
      const list = h('div', {});
      const claims = h('div', {});
      const title = h('input', { required: true, 'aria-label': 'Task title', placeholder: 'What needs doing?', disabled: !R.owner });
      const owner = h('select', { 'aria-label': 'Task owner', disabled: !R.owner });
      const err = h('p', { class: 'err', role: 'alert' });
      const add = h('button', { class: 'btn primary', type: 'submit', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY }, 'Add task');
      const form = h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          run(add, async () => {
            await act('task', { id: R.id, title: title.value, owner: owner.value || undefined });
            title.value = '';
            tick();
          }, err);
        },
      }, h('div', { class: 'editor' }, title), h('div', { class: 'editor' }, owner), err, h('div', { class: 'editor' }, add));
      body.append(h('div', { class: 'dlg-group' }, lead, form),
        h('div', { class: 'dlg-group' }, list),
        h('div', { class: 'dlg-group' }, h('h3', {}, 'Claims across this project'), claims));
      let sig = '';
      const ownerOptions = (v, cur) => {
        const names = v.agents.filter((a) => a.here).map((a) => a.name);
        if (cur && !names.includes(cur)) names.push(cur);
        return [h('option', { value: '' }, 'Nobody'), ...names.map((n) => h('option', { value: n }, n))];
      };
      const draw = (v) => {
        const next = JSON.stringify([v.tasks, v.claims, v.leader, v.agents.map((a) => [a.name, a.here])]);
        if (next === sig) return;
        sig = next;
        lead.textContent = v.leader ? `${v.leader} leads this room and manages its tasks. You can change anything here too.` : 'No one leads this room yet. The first agent to join will.';
        const keep = owner.value;
        owner.replaceChildren(...ownerOptions(v));
        owner.value = keep;
        list.replaceChildren(...(v.tasks.length ? v.tasks.map((t) => {
          const who = h('select', {
            'aria-label': `Owner of ${t.title}`, disabled: !R.owner,
            onchange: (e) => run(null, async () => { await act('task', { id: R.id, task_id: t.id, owner: e.target.value }); tick(); }),
          }, ownerOptions(v, t.owner));
          who.value = t.owner || '';
          const states = ['open', 'doing', 'blocked', 'done'];
          if (!states.includes(t.status)) states.unshift(t.status);
          const label = { open: 'Open', doing: 'Doing', blocked: 'Blocked', done: 'Done', proposed: 'Proposed', finished: 'Finished, waiting for the leader' };
          const st = h('select', {
            'aria-label': `Status of ${t.title}`, disabled: !R.owner,
            onchange: (e) => run(null, async () => { await act('task', { id: R.id, task_id: t.id, status: e.target.value }); tick(); }),
          }, states.map((s) => h('option', { value: s }, label[s] || s)));
          st.value = t.status;
          const close = t.status === 'finished' && h('button', { class: 'btn primary', type: 'button', disabled: !R.owner, title: R.owner ? null : VIEW_ONLY }, 'Close task');
          if (close) close.addEventListener('click', () => run(close, async () => { await act('task', { id: R.id, task_id: t.id, status: 'done' }); tick(); }));
          return h('div', { class: `task ${t.status}` }, h('div', { class: 'task-title' }, h('span', { class: 'task-id' }, `Task ${t.id}`), t.title), h('div', { class: 'task-ctrl' }, who, st), close && h('div', { class: 'task-close' }, close));
        }) : [h('p', { class: 'hint' }, 'No tasks yet. Add one above, or the leader will.')]));
        claims.replaceChildren(v.claims.length
          ? h('ul', { class: 'claims' }, v.claims.map((c) => h('li', {}, h('strong', {}, c.owner), ` holds ${c.what}`)))
          : h('p', { class: 'hint' }, 'Nothing claimed. Agents claim files or work here so they don\'t overlap.'));
      };
      draw(R.v);
      R.tasksDraw = draw;
    },
  });
}

// ---------- start agent ----------
function securityLine(v) {
  return v.room.effective_security === 'full'
    ? h('p', { class: 'warn' }, "This room is on Full access: this agent runs any command without asking.")
    : h('p', { class: 'hint' }, 'This room is on Ask: anything your Claude Code settings would prompt for shows up on this page for you to approve.');
}
function openStart() {
  const v = R.v;
  openDialog({
    title: 'Start agent', cls: 'center', light: false,
    build: (body, d) => {
      const name = h('input', { pattern: NAME_PATTERN, autocomplete: 'off', spellcheck: 'false' });
      const role = h('input', { autocomplete: 'off', placeholder: 'Reviewer, tester, researcher' });
      const task = h('textarea', { rows: 3, onkeydown: (e) => taskMenu.keys(e) });
      const taskMenu = inputMenu(task, (before, reload) => {
        const skill = before.match(/^\/(\S*)$/);
        return skill && skillOptions(before, skill[1], reload);
      }, 'below');
      const model = h('select', { autofocus: true }, [['claude-sonnet-5-5', 'Sonnet'], ['claude-opus-5-5', 'Opus'], ['claude-fable-5-1', 'Fable']].map(([value, label]) => h('option', { value }, label)));
      const effort = h('select', {},
        h('option', { value: '' }, 'Default'),
        Object.entries(EFFORTS).map(([value, label]) => h('option', { value }, label)));
      const cap = h('input', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal' });
      const mode = h('select', {},
        v.windows_available && h('option', { value: 'window' }, 'New terminal window, on your Claude plan'),
        h('option', { value: 'background' }, 'In the background, with a spending cap'));
      mode.value = v.default_mode;
      const capField = field('Spending cap in dollars', cap, 'The agent stops when it has spent this much.');
      const modeHint = h('p', { class: 'hint' });
      const askLine = securityLine(v);
      const isAsk = v.room.effective_security !== 'full';
      const syncMode = () => {
        const background = mode.value === 'background';
        askLine.hidden = isAsk && !background; // a window asks in the window, which the line above already says
        capField.hidden = !background;
        cap.required = background;
        if (!background) cap.value = '';
        modeHint.textContent = background
          ? 'It works unseen. Approvals appear on this page, and you can open a live view of it.'
          : 'A normal Claude Code window you can type in. Permission questions appear there. It uses your plan, so there is no spending cap.';
      };
      mode.addEventListener('change', syncMode);
      syncMode();
      const err = h('p', { class: 'err', role: 'alert' });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Start agent');
      body.append(h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          run(btn, async () => {
            const started = await act('start', { id: R.id, name: name.value.trim() || undefined, role: role.value.trim() || undefined, task: task.value.trim() || undefined, model: model.value, effort: effort.value || undefined, mode: mode.value, cap: mode.value === 'background' ? Number(cap.value) : undefined });
            const { tab, name: who } = started;
            tick();
            if (tab?.opened) { d.close(); toast(mode.value === 'window' ? 'Opened a terminal window' : 'Opened in your terminal'); return; }
            if (!tab) { d.close(); return; }
            R.talkCmds[who] = tab.command;
            body.replaceChildren(h('p', {}, `${who} is running. Its own terminal didn't open, so to talk to it there:`), commandBox(tab.command));
            body.querySelector('button').focus();
          }, err);
        },
      },
        field('Model', model, 'It reads the room, picks the work nobody has, and names itself.'),
        field('Effort', effort),
        field('Runs', mode),
        modeHint,
        capField,
        h('details', { class: 'start-more' },
          h('summary', {}, 'Give it a role, task or name'),
          field('Role', role, 'Becomes its name. It takes on whatever fits.'),
          h('div', { class: 'menu-anchor' }, field('Task', task, 'Start with / to run a skill.'), taskMenu.el),
          field('Name', name, NAME_HINT)),
        askLine,
        v.room.effective_dir && h('p', { class: 'hint' }, `Runs in ${v.room.effective_dir}`),
        err, h('div', { class: 'row' }, btn)));
    },
  });
}

// ---------- room settings ----------
function openSettings() {
  const v = R.v, r = v.room;
  const saved = (el, text) => { el.textContent = text; setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000); };
  openDialog({
    title: 'Room settings', light: false,
    build: (body, d) => {
      // Goal, folder and instructions
      const brief = h('textarea', { rows: 3, value: r.brief || '' });
      const dir = h('input', { value: r.dir || '', spellcheck: 'false', placeholder: r.dir ? '' : r.effective_dir ? `Using the parent's: ${r.effective_dir}` : 'None set' });
      // What the server holds. Saving sends only what differs, and says Saved only for what it read back.
      const base = { brief: r.brief || '', dir: r.dir || '', instructions: r.instructions, version: r.instructions_version, budget: r.budget_usd ?? null, wake: r.wake_limit, until: r.until_ts ?? null, past: r.past_goal };
      let own = r.effective_instructions;
      let fallback = r.instructions == null ? r.effective_instructions : null; // what ticking the box puts on screen, once known
      const instr = h('textarea', {
        id: 'instr-text', rows: 8, value: r.effective_instructions,
        oninput: () => { inherit.checked = false; },
      });
      const inherit = h('input', {
        type: 'checkbox', checked: r.instructions == null,
        onchange: async () => {
          if (!inherit.checked) { instr.value = own; instr.placeholder = ''; return; }
          own = instr.value;
          if (fallback == null) fallback = await inheritedInstructions(r);
          if (!inherit.checked) return;
          instr.value = fallback;
          if (!fallback) instr.placeholder = "Henchmen's default instructions apply. Type here to replace them.";
        },
      });
      const instrSlot = h('div', {}, instr);
      const inheritLabel = r.parent_id ? "Use parent's instructions" : "Use Henchmen's default instructions";
      const unstale = () => { instrSlot.replaceChildren(instr); };
      const budget = h('input', { type: 'number', min: '0.01', step: '0.01', value: r.budget_usd ?? '', placeholder: 'No budget', inputmode: 'decimal' });
      const wake = h('input', { type: 'number', min: '1', step: '1', value: r.wake_limit || '', placeholder: 'No limit' });
      const localTime = (ms) => { const t = new Date(ms); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 16); };
      const stopAt = h('input', { type: 'datetime-local', value: r.until_ts ? localTime(r.until_ts) : '' });
      const hours = h('input', { type: 'number', min: '0', step: 'any', placeholder: 'Hours', oninput: () => { stopAt.value = hours.value ? localTime(Date.now() + Number(hours.value) * 3600e3) : ''; } });
      const early = h('select', {}, h('option', { value: '1' }, 'Keep improving until the stop time'), h('option', { value: '0' }, 'Stop as soon as the goal is met'));
      early.value = r.past_goal ? '1' : '0';
      const saveErr = h('p', { class: 'err', role: 'alert' });
      const saveOk = h('span', { class: 'hint', role: 'status' });
      const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Save settings');
      const readBack = async () => {
        const fresh = (await getJSON(`/api/room/${r.id}?after=${2 ** 52}`)).room;
        Object.assign(base, { brief: fresh.brief || '', dir: fresh.dir || '', instructions: fresh.instructions, version: fresh.instructions_version, budget: fresh.budget_usd ?? null, wake: fresh.wake_limit, until: fresh.until_ts ?? null, past: fresh.past_goal });
        return fresh;
      };
      const showStale = async (text) => {
        const cut = text.indexOf('\n---\n');
        const current = cut < 0 ? '' : text.slice(cut + 5);
        const fresh = await readBack();
        saveErr.textContent = 'Someone changed these instructions while you were editing. Nothing of yours is lost. Compare them, fix yours on the right, and save again.';
        instrSlot.replaceChildren(h('div', { class: 'compare' },
          h('div', {}, h('h3', {}, `Current text, version ${fresh.instructions_version}`), h('pre', {}, current), h('div', { class: 'row' }, h('button', {
            class: 'btn', type: 'button',
            onclick: () => { unstale(); instr.value = current; inherit.checked = fresh.instructions == null; saveErr.textContent = ''; instr.focus(); },
          }, 'Use current text'))),
          h('div', {}, h('h3', {}, 'Your text'), instr)));
      };
      const mainForm = h('form', {
        class: 'dlg-group',
        onsubmit: (e) => {
          e.preventDefault();
          saveOk.textContent = '';
          run(saveBtn, async () => {
            const want = {
              brief: brief.value.trim(), dir: dir.value.trim(), instructions: inherit.checked ? null : instr.value,
              budget_usd: budget.value === '' ? null : Number(budget.value), wake_limit: wake.value === '' ? 0 : Math.floor(Number(wake.value)),
              until_ts: stopAt.value ? new Date(stopAt.value).getTime() : null,
              past_goal: Number(early.value),
            };
            if (want.instructions != null && !want.instructions.trim()) throw new Error(`Write some instructions, or tick "${inheritLabel}".`);
            const fields = [['brief', 'goal', base.brief], ['dir', 'working folder', base.dir], ['instructions', 'instructions', base.instructions], ['budget_usd', 'budget', base.budget], ['until_ts', 'stop time', base.until], ['past_goal', 'goal rule', base.past], ['wake_limit', 'wake-up limit', base.wake]];
            const changed = fields.filter(([key, , was]) => want[key] !== was);
            if (!changed.length) { saved(saveOk, 'Nothing to save: this already matches.'); return; }
            const args = { id: r.id };
            for (const [key] of changed) args[key] = want[key];
            if ('instructions' in args) args.instructions_base = base.version;
            try {
              await act('settings', args);
            } catch (x) {
              if (x.status === 409 && String(x.text).startsWith('STALE:')) { await showStale(x.text); return; }
              await readBack().catch(() => {});
              throw x;
            }
            const fresh = await readBack();
            // A folder comes back as a full path, so only whether one is set can be compared.
            const stored = { brief: base.brief, dir: want.dir && base.dir ? want.dir : base.dir, instructions: base.instructions, budget_usd: base.budget, wake_limit: base.wake, until_ts: base.until, past_goal: base.past };
            const lost = changed.filter(([key]) => stored[key] !== want[key]).map(([, label]) => label);
            const done = changed.map(([, label]) => label).filter((label) => !lost.includes(label));
            unstale();
            if (fresh.instructions !== want.instructions) instr.value = fresh.effective_instructions; // a key was redacted: show what's stored
            if (lost.length) saveErr.textContent = `Henchmen didn't keep your ${lost.join(', ')} as typed, so that isn't saved as shown. Check it and save again.`;
            if (done.length) saved(saveOk, `Saved: ${done.join(', ')}.`);
            tick();
          }, saveErr);
        },
      },
        field('Goal', brief),
        folderField('Working folder', dir, r.parent_id ? 'Leave empty to use the parent room\'s folder.' : 'Agents run here.'),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'instr-text' }, 'Default agent instructions'), instrSlot, h('span', { class: 'hint' }, 'Every agent in this room gets these when it joins. Typing here makes them this room\'s own.')),
        h('label', { class: 'check' }, inherit, inheritLabel),
        h('div', { class: 'editor' }),
        field('Budget in dollars', budget, `Agents won't start if their cap doesn't fit.${spendText(v.spend) ? ` ${spendText(v.spend)} so far.` : ''}`),
        field('Run for (hours)', hours, 'Fills in the stop time below.'),
        field('Stop at', stopAt, "Blank: agents keep going until the leader says the goal is done. Agents in windows use your plan's usage the whole time."),
        field('If the goal is met before the stop time', early, 'Only applies when a stop time is set.'),
        field('Wake-up limit', wake, `Optional. Pauses after this many wake-ups with no input from you. Current count: ${v.room.wakes}.`),
        saveErr, h('div', { class: 'row' }, saveBtn, saveOk));

      // Security
      const secErr = h('p', { class: 'err', role: 'alert' });
      const confirmBox = h('div', { hidden: true });
      const secRadio = (value, label, hint) => h('label', { class: 'check' }, h('input', {
        type: 'radio', name: 'security', value, checked: r.effective_security === value,
        onchange: () => {
          if (value === 'full') { confirmBox.hidden = false; return; }
          confirmBox.hidden = true;
          setSecurity('ask');
        },
      }), h('span', {}, h('strong', {}, label), `. ${hint}`));
      const setSecurity = (value) => run(null, async () => {
        await act('settings', { id: r.id, security: value });
        r.effective_security = value;
        confirmBox.hidden = true;
        tick();
      }, secErr);
      const askRadioGroup = h('div', {},
        secRadio('ask', 'Ask', 'Anything your Claude Code settings would prompt for shows up on this page for you to approve.'),
        secRadio('full', 'Full access', 'Agents run without asking.'));
      confirmBox.append(h('div', { class: 'warn' },
        h('p', {}, `Full access means agents in ${r.slug} run any command without asking, including ones that change or delete files. It applies to agents started after this.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn danger', type: 'button', onclick: () => setSecurity('full') }, 'Turn on Full access'),
          h('button', {
            class: 'btn', type: 'button',
            onclick: () => { confirmBox.hidden = true; askRadioGroup.querySelector('input[value=ask]').checked = true; },
          }, 'Keep Ask'))));

      // Rename
      const slug = h('input', { required: true, pattern: NAME_PATTERN, value: r.slug, 'aria-label': 'Room name', spellcheck: 'false' });
      const renameErr = h('p', { class: 'err', role: 'alert' });
      const renameBtn = h('button', { class: 'btn', type: 'submit' }, 'Rename room');
      const renameForm = h('form', {
        class: 'dlg-group',
        onsubmit: (e) => {
          e.preventDefault();
          run(renameBtn, async () => { await act('renameRoom', { id: r.id, slug: slug.value.trim() }); d.close(); toast(`Renamed to ${slug.value.trim()}.`); tick(); }, renameErr);
        },
      }, h('h3', {}, 'Rename'), h('div', { class: 'editor' }, slug), h('span', { class: 'hint' }, `${NAME_HINT}. Agents use the new name from now on.`), renameErr, h('div', { class: 'editor' }, renameBtn));

      // Delete
      const typed = h('input', { 'aria-label': "Type the room's name to confirm", autocomplete: 'off', spellcheck: 'false', oninput: () => { delBtn.disabled = !R.owner || typed.value !== r.slug; } });
      const delErr = h('p', { class: 'err', role: 'alert' });
      const delBtn = h('button', { class: 'btn danger', type: 'submit', disabled: true }, 'Delete room');
      const delForm = h('form', {
        class: 'dlg-group danger-zone',
        onsubmit: (e) => {
          e.preventDefault();
          if (typed.value !== r.slug) return;
          run(delBtn, async () => {
            const res = await act('deleteRoom', { id: r.id, confirm: r.slug });
            R.stopped = true;
            go(res.parent_id);
          }, delErr);
        },
      }, h('h3', {}, 'Delete'),
        h('p', {}, `This removes ${r.slug}, its divisions, messages and report, and stops any agent running in them. It can't be undone. Type ${r.slug} to confirm.`),
        typed, delErr, h('div', { class: 'editor' }, delBtn));

      const wrap = h('fieldset', { disabled: !R.owner },
        mainForm,
        h('div', { class: 'dlg-group' }, h('h3', {}, 'Security level'), askRadioGroup, confirmBox, secErr),
        renameForm, delForm);
      body.append(wrap);
    },
  });
}
async function inheritedInstructions(r) {
  if (!r.parent_id) return ''; // the defaults aren't sent for a room with its own text; the placeholder says so
  try { return (await getJSON(`/api/room/${r.parent_id}?after=${2 ** 52}`)).room.effective_instructions; } catch { return ''; }
}

// ---------- start ----------
const roomMatch = location.pathname.match(/^\/r\/(\d+)\/?$/);
// A new owner link opened in a tab that's already here.
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#code=')) redeemOpenLink().finally(() => location.reload()); });
redeemOpenLink().finally(() => { if (roomMatch) roomPage(Number(roomMatch[1])); else homePage(); });
