import { Store, ASSIGNEE_BOTH, ASSIGNEE_TRADE, ASSIGNEE_NONE, uid, materialCost, taskTotals, supplierFromUrl, normaliseUrl } from './store.js';

const store = new Store();
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const view = $('#view');
const fab = $('#fab');
const banner = $('#banner');
const pageTitle = $('#pageTitle');
const backBtn = $('#backBtn');
const menuBtn = $('#menuBtn');
const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');
const roomDialog = $('#roomDialog');
const roomForm = $('#roomForm');

let route = { tab: 'rooms', roomId: null };
let taskFilter = { who: 'all', status: 'open' };
let showBought = false;
let shopGroupBy = 'shop';
let editingTaskId = null;
let editingRoomId = null;

/* ------------------------------------------------------------------ */
/* Routing (history-backed so the Android back button behaves)         */

function navigate(next, { replace = false } = {}) {
  route = { tab: next.tab || 'rooms', roomId: next.roomId || null };
  const st = { ...route };
  if (replace) history.replaceState(st, ''); else history.pushState(st, '');
  render();
}

window.addEventListener('popstate', e => {
  $$('dialog[open]').forEach(d => d.close());
  const st = e.state || { tab: 'rooms', roomId: null };
  route = { tab: st.tab || 'rooms', roomId: st.roomId || null };
  render();
});

function openSheet(dialog) {
  history.pushState({ ...route, sheet: dialog.id }, '');
  dialog.showModal();
}
function closeSheet(dialog) {
  if (dialog.open) dialog.close();
}
[taskDialog, roomDialog].forEach(d => d.addEventListener('close', () => {
  if (history.state?.sheet === d.id) history.back();
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                              */

const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };
const STATUS_ORDER = { doing: 0, todo: 1, done: 2 };
const PRIO_ORDER = { high: 0, normal: 1, low: 2 };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function money(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return (v < 0 ? '-' : '') + '£' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
function safeHref(url) {
  const u = normaliseUrl(url);
  return /^https?:\/\//i.test(u) ? u : '';
}
function siteHref(url) {
  try { return new URL(safeHref(url)).origin; } catch { return ''; }
}
function sortTasks(list) {
  return [...list].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
    (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.createdAt || 0) - (b.createdAt || 0));
}
function assigneeChip(code, small = false) {
  const cls = small ? 'chip small' : 'chip';
  if (code === ASSIGNEE_BOTH) return `<span class="${cls}">👫 Both</span>`;
  if (code === ASSIGNEE_TRADE) return `<span class="${cls}">🔧 Trade</span>`;
  if (!code) return `<span class="${cls}" style="opacity:.7">Unassigned</span>`;
  const m = store.member(code);
  if (!m) return `<span class="${cls}">?</span>`;
  return `<span class="${cls} member" style="background:${esc(m.colour)}">${esc(m.name)}</span>`;
}
function toast(msg, { action, onAction, ms = 3500 } = {}) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? `<button type="button">${esc(action)}</button>` : '');
  t.hidden = false;
  if (action) $('button', t).onclick = () => { t.hidden = true; onAction?.(); };
  clearTimeout(toast._t);
  if (!action) toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */

function render() {
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === route.tab));
  backBtn.hidden = !route.roomId;
  menuBtn.hidden = !route.roomId;
  fab.hidden = !(route.tab === 'rooms' || route.tab === 'tasks') || !store.signedIn || !store.ready;

  renderBanner();

  if (!store.ready) { view.innerHTML = `<div class="empty"><div class="big">⏳</div>Loading…</div>`; pageTitle.textContent = 'Our Renovation'; return; }
  if (store.mode === 'cloud' && !store.user) { renderSignIn(); return; }

  if (route.roomId) {
    const room = store.room(route.roomId);
    if (!room) { navigate({ tab: 'rooms' }, { replace: true }); return; }
    pageTitle.textContent = room.name;
    view.innerHTML = renderRoomDetail(room);
  } else if (route.tab === 'rooms') {
    pageTitle.textContent = 'Rooms';
    view.innerHTML = renderRooms();
  } else if (route.tab === 'tasks') {
    pageTitle.textContent = 'All tasks';
    view.innerHTML = renderTasks();
  } else if (route.tab === 'shopping') {
    pageTitle.textContent = 'Shopping list';
    view.innerHTML = renderShopping();
  } else if (route.tab === 'money') {
    pageTitle.textContent = 'Money';
    view.innerHTML = renderMoney();
  } else {
    pageTitle.textContent = 'Settings';
    view.innerHTML = renderSettings();
  }
}

function renderBanner() {
  let html = '';
  if (store.error) html = `⚠️ ${esc(store.error)}`;
  else if (store.mode === 'local' && route.tab === 'rooms' && !route.roomId) html = `📱 <b>Local mode</b> — this data lives only on this phone. See <a href="#" data-action="go-settings">Settings</a> for how to share it with your partner.`;
  else if (store.mode === 'cloud' && !navigator.onLine) html = `📴 Offline — changes will sync when you're back online.`;
  banner.innerHTML = html;
  banner.hidden = !html;
}

function renderSignIn() {
  pageTitle.textContent = 'Our Renovation';
  view.innerHTML = `
    <div class="empty">
      <div class="big">🏠</div>
      <h2 style="margin-bottom:8px">Sign in to see the shared plan</h2>
      <p class="muted">Use the Google account you and your partner have been given access to.</p>
      <button class="btn" data-action="sign-in" style="margin-top:14px">Sign in with Google</button>
    </div>`;
}

function renderRooms() {
  const rooms = store.roomsSorted();
  const allOpen = store.state.tasks.filter(t => t.status !== 'done');
  const toBuy = store.state.tasks.filter(t => t.status !== 'done').flatMap(t => t.materials).filter(m => !m.bought).length;
  const totals = store.totals();
  const toPay = totals.planned - totals.spent;
  const needsNames = store.state.members.some(m => ['Me', 'Partner'].includes(m.name));

  let html = '';
  if (needsNames) html += `<div class="card" style="background:var(--brand-soft);border-color:transparent">👋 <b>First things first:</b> put both your names in <a href="#" data-action="go-settings">Settings</a> so tasks can be assigned to each of you.</div>`;

  html += `<div class="card" style="display:flex;justify-content:space-around;text-align:center">
    <div><div style="font-size:22px;font-weight:700">${allOpen.length}</div><div class="muted">open tasks</div></div>
    <div><div style="font-size:22px;font-weight:700">${toBuy}</div><div class="muted">to buy</div></div>
    <div><div style="font-size:22px;font-weight:700">${money(toPay)}</div><div class="muted">still to pay</div></div>
  </div>`;

  html += `<div class="section-title"><span>Rooms</span><button class="link" data-action="add-room" style="padding:0">+ Add room</button></div>`;
  if (!rooms.length) html += `<div class="empty"><div class="big">🚪</div>No rooms yet. Add one to get started.</div>`;

  for (const room of rooms) {
    const tasks = store.tasksInRoom(room.id);
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const who = {};
    tasks.filter(t => t.status !== 'done').forEach(t => { who[t.assignee] = (who[t.assignee] || 0) + 1; });
    const whoHtml = Object.entries(who).map(([code, n]) => assigneeChip(code, true).replace('</span>', ` · ${n}</span>`)).join('');
    html += `
      <div class="card tappable room-card" data-action="open-room" data-id="${esc(room.id)}">
        <div class="name">${esc(room.name)}</div>
        <div class="count">${tasks.length ? `${done}/${tasks.length} done` : 'No tasks'}</div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        ${whoHtml ? `<div class="who">${whoHtml}</div>` : ''}
      </div>`;
  }
  return html;
}

function renderTaskRow(t, { showRoom = false } = {}) {
  const room = store.room(t.roomId);
  const overdue = t.due && t.status !== 'done' && t.due < todayISO();
  const toBuy = t.materials.filter(m => !m.bought).length;
  const total = taskTotals(t).planned;
  const meta = [
    showRoom && room ? `<span>📍 ${esc(room.name)}</span>` : '',
    assigneeChip(t.assignee, true),
    t.status === 'doing' ? `<span class="chip small status-doing">In progress</span>` : '',
    t.priority === 'high' ? `<span class="prio-high">! High priority</span>` : '',
    t.due ? `<span class="${overdue ? 'overdue' : ''}">📅 ${esc(fmtDate(t.due))}${overdue ? ' (overdue)' : ''}</span>` : '',
    toBuy ? `<span>🛒 ${toBuy} to buy</span>` : '',
    total ? `<span>${money(total)}</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="card task tappable" data-action="edit-task" data-id="${esc(t.id)}" data-status="${esc(t.status)}">
      <button class="check" type="button" data-action="cycle-status" data-id="${esc(t.id)}" aria-label="Change status"><i></i></button>
      <div>
        <div class="title">${esc(t.title)}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
    </div>`;
}

function renderRoomDetail(room) {
  const tasks = sortTasks(store.tasksInRoom(room.id));
  const open = tasks.filter(t => t.status !== 'done');
  const done = tasks.filter(t => t.status === 'done');
  let html = '';
  if (!tasks.length) html += `<div class="empty"><div class="big">📝</div>Nothing planned for the ${esc(room.name.toLowerCase())} yet.<br>Tap + to add the first job.</div>`;
  if (open.length) html += `<div class="section-title"><span>To do (${open.length})</span></div>` + open.map(t => renderTaskRow(t)).join('');
  if (done.length) html += `<div class="section-title"><span>Done (${done.length})</span></div>` + done.map(t => renderTaskRow(t)).join('');
  return html;
}

function renderTasks() {
  const whoOptions = [
    ['all', 'Everyone'],
    ...store.state.members.map(m => [m.id, m.name]),
    [ASSIGNEE_BOTH, 'Both'], [ASSIGNEE_TRADE, 'Trade'], [ASSIGNEE_NONE + '_none', 'Unassigned'],
  ];
  const statusOptions = [['open', 'Open'], ['done', 'Done'], ['all', 'All']];
  let list = store.state.tasks;
  if (taskFilter.who === '_none') list = list.filter(t => !t.assignee);
  else if (taskFilter.who !== 'all') list = list.filter(t => t.assignee === taskFilter.who);
  if (taskFilter.status === 'open') list = list.filter(t => t.status !== 'done');
  if (taskFilter.status === 'done') list = list.filter(t => t.status === 'done');
  list = sortTasks(list);

  let html = `<div class="filters">${whoOptions.map(([v, l]) => `<button data-action="filter-who" data-value="${esc(v)}" class="${taskFilter.who === v ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
  html += `<div class="filters">${statusOptions.map(([v, l]) => `<button data-action="filter-status" data-value="${esc(v)}" class="${taskFilter.status === v ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
  if (!list.length) html += `<div class="empty"><div class="big">🎉</div>Nothing here.</div>`;
  html += list.map(t => renderTaskRow(t, { showRoom: true })).join('');
  return html;
}

function shoppingItems() {
  // Every material on an open task, with its task and room attached.
  const items = [];
  for (const room of store.roomsSorted()) {
    for (const t of sortTasks(store.tasksInRoom(room.id))) {
      if (t.status === 'done') continue;
      t.materials.forEach(m => items.push({ m, t, room }));
    }
  }
  return items;
}

function shoppingGroups(items) {
  const groups = new Map();
  for (const it of items) {
    let key, label, sub = '', site = '';
    if (shopGroupBy === 'shop') {
      const name = it.m.supplier || supplierFromUrl(it.m.url) || '';
      key = name.toLowerCase() || '~none';
      label = name || 'Anywhere / shop not set';
      site = siteHref(it.m.url);
    } else {
      key = it.room.id; label = it.room.name;
    }
    if (!groups.has(key)) groups.set(key, { key, label, sub, site, items: [], total: 0, toBuy: 0 });
    const g = groups.get(key);
    if (!g.site && site) g.site = site;
    g.items.push(it);
    g.total += materialCost(it.m);
    if (!it.m.bought) g.toBuy += materialCost(it.m);
  }
  const list = [...groups.values()];
  list.sort((a, b) => (a.key === '~none') - (b.key === '~none') || a.label.localeCompare(b.label));
  return list;
}

function renderShopping() {
  const all = shoppingItems();
  const visible = all.filter(it => showBought || !it.m.bought);
  const groups = shoppingGroups(visible);
  const toBuyTotal = all.filter(it => !it.m.bought).reduce((s, it) => s + materialCost(it.m), 0);
  const noPrice = all.filter(it => !it.m.bought && it.m.price === null).length;

  let html = `<div class="filters">
    <button data-action="group-by" data-value="shop" class="${shopGroupBy === 'shop' ? 'active' : ''}">By shop</button>
    <button data-action="group-by" data-value="room" class="${shopGroupBy === 'room' ? 'active' : ''}">By room</button>
    <button data-action="toggle-bought" data-value="0" class="${showBought ? '' : 'active'}">To buy</button>
    <button data-action="toggle-bought" data-value="1" class="${showBought ? 'active' : ''}">Everything</button>
  </div>`;
  const n = all.filter(it => !it.m.bought).length;
  html += `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
    <div><b>${money(toBuyTotal)}</b> <span class="muted">still to buy · ${n} item${n === 1 ? '' : 's'}</span>${noPrice ? `<div class="muted" style="font-size:12px">${noPrice} item${noPrice === 1 ? '' : 's'} without a price</div>` : ''}</div>
    <button class="btn ghost small" data-action="share-shopping">📋 Copy list</button>
  </div>`;

  if (!groups.length) html += `<div class="empty"><div class="big">🛒</div>${all.length ? 'All bought!' : 'Nothing to buy. Add materials to a task and they show up here.'}</div>`;
  for (const g of groups) {
    const count = g.items.filter(it => !it.m.bought).length;
    html += `<div class="card shop-group">
      <header>
        <div class="h-main">${esc(g.label)}<small>${count} to buy${g.items.length !== count ? ` · ${g.items.length - count} bought` : ''}</small></div>
        ${g.site ? `<a class="site" href="${esc(g.site)}" target="_blank" rel="noopener">Open site ↗</a>` : ''}
        <div class="h-total">${money(showBought ? g.total : g.toBuy)}</div>
      </header>
      ${g.items.map(({ m, t, room }) => {
        const href = safeHref(m.url);
        const context = shopGroupBy === 'shop' ? `${room.name} · ${t.title}` : `${t.title}${m.supplier ? ` · ${m.supplier}` : ''}`;
        return `
        <div class="shop-item ${m.bought ? 'bought' : ''}">
          <input type="checkbox" data-action="buy" data-task="${esc(t.id)}" data-id="${esc(m.id)}" ${m.bought ? 'checked' : ''} aria-label="Bought">
          <div class="name">${esc(m.name)}<small><a href="#" data-action="edit-task" data-id="${esc(t.id)}">${esc(context)}</a></small></div>
          <div class="amount">
            ${m.price !== null ? money(materialCost(m)) : '<span class="muted">no price</span>'}${href ? `<a class="item-link" href="${esc(href)}" target="_blank" rel="noopener" aria-label="Open product link">↗</a>` : ''}
            <small>${m.qty} × ${m.price !== null ? money(m.price) : '?'}</small>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
  return html;
}

function shoppingText() {
  const lines = ['Shopping list – ' + new Date().toLocaleDateString()];
  const items = shoppingItems().filter(it => !it.m.bought);
  let grand = 0;
  for (const g of shoppingGroups(items)) {
    lines.push('', g.label.toUpperCase() + (g.site ? ` – ${g.site}` : ''));
    for (const { m, t, room } of g.items) {
      const price = m.price !== null ? ` – ${money(materialCost(m))}` : '';
      lines.push(`  ☐ ${m.qty} × ${m.name}${price} (${shopGroupBy === 'shop' ? room.name : t.title})${m.url ? ` ${safeHref(m.url)}` : ''}`);
    }
    lines.push(`  Subtotal: ${money(g.toBuy)}`);
    grand += g.toBuy;
  }
  lines.push('', `TOTAL: ${money(grand)}`);
  return lines.join('\n');
}

function renderMoney() {
  const budget = store.state.budget;
  const { planned, spent } = store.totals();
  const toPay = planned - spent;
  const headroom = budget !== null ? budget - planned : null;
  const scale = Math.max(budget || 0, planned, 1);
  const spentPct = Math.min(100, spent / scale * 100);
  const plannedPct = Math.min(100, (planned - spent) / scale * 100);
  const overPct = budget !== null && planned > budget ? Math.min(100, (planned - budget) / scale * 100) : 0;

  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div><b>Budget</b> <span class="muted">${budget !== null ? money(budget) : 'not set'}</span></div>
      <a href="#" data-action="go-settings" class="muted" style="font-size:13px">${budget !== null ? 'Change' : 'Set budget'}</a>
    </div>
    <div class="money-bar">
      <i class="spent" style="width:${spentPct}%"></i><i class="planned" style="width:${plannedPct - overPct}%"></i><i class="over" style="width:${overPct}%"></i>
    </div>
    <div class="money-legend"><span><i style="background:var(--ok)"></i>Spent</span><span><i style="background:var(--doing)"></i>Still to pay</span>${overPct ? '<span><i style="background:var(--danger)"></i>Over budget</span>' : ''}</div>
    <div class="money-grid">
      <div class="cell"><div class="v">${money(planned)}</div><div class="l">Total planned</div></div>
      <div class="cell"><div class="v">${money(spent)}</div><div class="l">Spent so far</div></div>
      <div class="cell"><div class="v">${money(toPay)}</div><div class="l">Still to pay</div></div>
      ${headroom !== null ? `<div class="cell ${headroom < 0 ? 'neg' : 'pos'}"><div class="v">${money(Math.abs(headroom))}</div><div class="l">${headroom < 0 ? 'Over budget' : 'Under budget'}</div></div>` : ''}
    </div>
  </div>`;

  // Per room
  const rooms = store.roomsSorted().map(r => {
    const tot = store.tasksInRoom(r.id).reduce((a, t) => { const x = taskTotals(t); a.planned += x.planned; a.spent += x.spent; return a; }, { planned: 0, spent: 0 });
    return { r, ...tot };
  }).filter(x => x.planned > 0);
  html += `<div class="section-title"><span>By room</span></div><div class="card">`;
  if (!rooms.length) html += `<p class="muted" style="margin:0">Add prices to materials or a labour cost to a task and it shows up here.</p>`;
  else html += `<table class="money"><thead><tr><th>Room</th><th class="num">Spent</th><th class="num">Planned</th></tr></thead><tbody>
    ${rooms.map(x => `<tr class="tappable" data-action="open-room" data-id="${esc(x.r.id)}"><td>${esc(x.r.name)}<div class="mini"><i style="width:${x.planned ? x.spent / x.planned * 100 : 0}%"></i></div></td><td class="num">${money(x.spent)}</td><td class="num">${money(x.planned)}</td></tr>`).join('')}
  </tbody></table>`;
  html += `</div>`;

  // Per task (biggest first)
  const tasks = [...store.state.tasks].map(t => ({ t, ...taskTotals(t) })).filter(x => x.planned > 0).sort((a, b) => b.planned - a.planned);
  if (tasks.length) {
    html += `<div class="section-title"><span>By task</span></div><div class="card"><table class="money"><thead><tr><th>Task</th><th class="num">Spent</th><th class="num">Planned</th></tr></thead><tbody>
      ${tasks.map(x => `<tr class="tappable" data-action="edit-task" data-id="${esc(x.t.id)}"><td>${esc(x.t.title)}<div class="muted" style="font-size:12px">${esc(store.room(x.t.roomId)?.name || '')}${x.other ? ` · labour ${money(x.other)}${x.otherSpent ? ' (paid)' : ''}` : ''}</div></td><td class="num">${money(x.spent)}</td><td class="num">${money(x.planned)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  // Per shop
  const shops = new Map();
  store.state.tasks.forEach(t => t.materials.forEach(m => {
    const name = m.supplier || supplierFromUrl(m.url) || 'Shop not set';
    const g = shops.get(name.toLowerCase()) || { name, planned: 0, spent: 0, n: 0 };
    g.planned += materialCost(m); if (m.bought) g.spent += materialCost(m); g.n++;
    shops.set(name.toLowerCase(), g);
  }));
  const shopList = [...shops.values()].filter(x => x.planned > 0).sort((a, b) => b.planned - a.planned);
  if (shopList.length) {
    html += `<div class="section-title"><span>By shop</span></div><div class="card"><table class="money"><thead><tr><th>Shop</th><th class="num">Spent</th><th class="num">Planned</th></tr></thead><tbody>
      ${shopList.map(x => `<tr><td>${esc(x.name)}<div class="muted" style="font-size:12px">${x.n} item${x.n === 1 ? '' : 's'}</div></td><td class="num">${money(x.spent)}</td><td class="num">${money(x.planned)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  return html;
}

function renderSettings() {
  const m = store.state.members;
  let sync;
  if (store.mode === 'local') {
    sync = `<p class="muted">Right now everything is stored on this phone only. To share live with your partner, turn on sync — a one-off 15 minute setup described in the project README (<b>Turning on shared sync</b>).</p>`;
  } else if (store.user) {
    sync = `<div class="kv"><span>Signed in as</span><b>${esc(store.user.name || store.user.email)}</b></div>
            <div class="kv"><span>Email</span><span class="muted">${esc(store.user.email)}</span></div>
            <button class="btn ghost small" data-action="sign-out">Sign out</button>`;
  } else {
    sync = `<button class="btn" data-action="sign-in">Sign in with Google</button>`;
  }
  return `
    <div class="section-title"><span>Household</span></div>
    <div class="card settings-list">
      ${m.map((mm, i) => `
        <div class="row">
          <input type="color" value="${esc(mm.colour)}" data-member-colour="${i}" aria-label="Colour">
          <input type="text" value="${esc(mm.name)}" data-member-name="${i}" placeholder="Name" aria-label="Name">
        </div>`).join('')}
      <div class="row">
        <label for="budgetInput" style="flex:0 0 auto;font-weight:600">Budget £</label>
        <input type="number" id="budgetInput" inputmode="decimal" min="0" step="1" value="${store.state.budget ?? ''}" placeholder="e.g. 15000" style="flex:1;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);min-width:0">
      </div>
      <div class="row"><button class="btn small full" style="margin-top:6px" data-action="save-members">Save</button></div>
    </div>

    <div class="section-title"><span>Sharing &amp; sync</span></div>
    <div class="card stack">${sync}</div>

    <div class="section-title"><span>Your data</span></div>
    <div class="card stack">
      <button class="btn ghost small" data-action="export">⬇️ Export backup (JSON)</button>
      <label class="btn ghost small" style="cursor:pointer">⬆️ Import backup <input type="file" accept="application/json,.json" data-action="import" hidden></label>
      <p class="muted" style="margin:4px 0 0">Import replaces what's here with the contents of the file.</p>
    </div>

    <div class="section-title"><span>Install on your phone</span></div>
    <div class="card muted">
      <b>Android (Chrome):</b> tap the ⋮ menu → <b>Add to Home screen</b> / <b>Install app</b>. It then opens full-screen like a normal app and works offline.<br><br>
      <b>iPhone (Safari):</b> Share → <b>Add to Home Screen</b>.
    </div>
    <p class="muted" style="text-align:center">Our Renovation · ${esc(store.mode === 'cloud' ? 'shared' : 'local')} mode</p>`;
}

/* ------------------------------------------------------------------ */
/* Task editor                                                          */

function fillSelects(selectedRoom, selectedAssignee) {
  const rs = $('#taskRoom');
  rs.innerHTML = store.roomsSorted().map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  if (selectedRoom) rs.value = selectedRoom;
  const as = $('#taskAssignee');
  as.innerHTML = [
    `<option value="">Unassigned</option>`,
    ...store.state.members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`),
    `<option value="${ASSIGNEE_BOTH}">Both of us</option>`,
    `<option value="${ASSIGNEE_TRADE}">Tradesperson</option>`,
  ].join('');
  as.value = selectedAssignee || '';
}

function materialRow(m = {}) {
  const row = document.createElement('div');
  row.className = 'mat-row';
  row.dataset.id = m.id || uid();
  row.innerHTML = `
    <input type="checkbox" name="bought" title="Already bought" ${m.bought ? 'checked' : ''}>
    <input type="text" name="name" placeholder="Item, e.g. Emulsion paint 5L" value="${esc(m.name || '')}">
    <button type="button" class="remove" aria-label="Remove">×</button>
    <div class="sub">
      <label>Qty<input type="number" name="qty" inputmode="decimal" min="0" step="any" value="${esc(m.qty ?? 1)}"></label>
      <label>£ each<input type="number" name="price" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="${m.price ?? ''}"></label>
      <label>Shop<input type="text" name="supplier" list="supplierList" placeholder="e.g. Screwfix" value="${esc(m.supplier || '')}" autocomplete="off"></label>
    </div>
    <input class="link" type="url" name="url" inputmode="url" placeholder="Link to product or shop (optional)" value="${esc(m.url || '')}" autocomplete="off">`;
  $('.remove', row).onclick = () => { row.remove(); updateMaterialTotal(); };
  const urlInput = $('[name=url]', row), shopInput = $('[name=supplier]', row);
  urlInput.addEventListener('change', () => { if (!shopInput.value.trim()) shopInput.value = supplierFromUrl(urlInput.value); });
  row.addEventListener('input', updateMaterialTotal);
  return row;
}

function readMaterialRows() {
  return $$('.mat-row', $('#materialRows')).map(row => ({
    id: row.dataset.id,
    bought: $('[name=bought]', row).checked,
    name: $('[name=name]', row).value,
    qty: $('[name=qty]', row).value,
    price: $('[name=price]', row).value,
    supplier: $('[name=supplier]', row).value,
    url: $('[name=url]', row).value,
  }));
}

function updateMaterialTotal() {
  const total = readMaterialRows().reduce((s, m) => s + (Number(m.price) || 0) * (Number(m.qty) || 0), 0);
  $('#materialTotal').textContent = total ? `Materials: ${money(total)}` : '';
}

function openTaskDialog(task, defaults = {}) {
  if (!store.state.rooms.length) { toast('Add a room first'); return; }
  editingTaskId = task?.id || null;
  $('#taskDialogTitle').textContent = task ? 'Edit task' : 'New task';
  $('#taskDeleteBtn').hidden = !task;
  const f = taskForm;
  f.reset();
  fillSelects(task?.roomId || defaults.roomId || store.roomsSorted()[0]?.id, task?.assignee);
  f.title.value = task?.title || '';
  f.status.value = task?.status || 'todo';
  f.priority.value = task?.priority || 'normal';
  f.due.value = task?.due || '';
  f.cost.value = task?.cost ?? '';
  f.costPaid.checked = !!task?.costPaid;
  f.notes.value = task?.notes || '';
  $('#supplierList').innerHTML = store.suppliers().map(n => `<option value="${esc(n)}">`).join('');
  const rows = $('#materialRows');
  rows.innerHTML = '';
  (task?.materials || []).forEach(m => rows.appendChild(materialRow(m)));
  updateMaterialTotal();
  openSheet(taskDialog);
  setTimeout(() => { if (!task) f.title.focus(); }, 50);
}

function readTaskForm() {
  const f = taskForm;
  const materials = readMaterialRows();
  const existing = editingTaskId ? store.task(editingTaskId) : null;
  return {
    ...(existing || {}),
    id: editingTaskId || undefined,
    title: f.title.value,
    roomId: f.roomId.value,
    assignee: f.assignee.value,
    status: f.status.value,
    priority: f.priority.value,
    due: f.due.value,
    cost: f.cost.value === '' ? null : Number(f.cost.value),
    costPaid: f.costPaid.checked,
    notes: f.notes.value,
    materials,
  };
}

taskForm.addEventListener('submit', async e => {
  e.preventDefault();
  const data = readTaskForm();
  if (!data.title.trim()) { taskForm.title.focus(); toast('Give the task a name'); return; }
  closeSheet(taskDialog);
  await store.saveTask(data);
});
taskForm.addEventListener('click', async e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'cancel') closeSheet(taskDialog);
  if (action === 'add-material') { const r = materialRow(); $('#materialRows').appendChild(r); $('[name=name]', r).focus(); }
  if (action === 'delete' && editingTaskId) {
    if (confirm('Delete this task?')) { const id = editingTaskId; closeSheet(taskDialog); await store.deleteTask(id); }
  }
});

/* Room editor */
function openRoomDialog(room) {
  editingRoomId = room?.id || null;
  $('#roomDialogTitle').textContent = room ? 'Edit room' : 'New room';
  $('#roomDeleteBtn').hidden = !room;
  roomForm.reset();
  roomForm.name.value = room?.name || '';
  openSheet(roomDialog);
  setTimeout(() => roomForm.name.focus(), 50);
}
roomForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = roomForm.name.value.trim();
  if (!name) { roomForm.name.focus(); return; }
  const existing = editingRoomId ? store.room(editingRoomId) : null;
  closeSheet(roomDialog);
  await store.saveRoom({ ...(existing || {}), name });
});
roomForm.addEventListener('click', async e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'cancel') closeSheet(roomDialog);
  if (action === 'delete' && editingRoomId) {
    const n = store.tasksInRoom(editingRoomId).length;
    if (confirm(`Delete this room${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}?`)) {
      const id = editingRoomId;
      closeSheet(roomDialog);
      await store.deleteRoom(id);
      if (route.roomId === id) navigate({ tab: 'rooms' }, { replace: true });
    }
  }
});

/* ------------------------------------------------------------------ */
/* Global interactions                                                  */

$$('.tabbar button').forEach(b => b.addEventListener('click', () => navigate({ tab: b.dataset.tab }, { replace: !route.roomId })));
backBtn.addEventListener('click', () => history.back());
menuBtn.addEventListener('click', () => openRoomDialog(store.room(route.roomId)));
fab.addEventListener('click', () => openTaskDialog(null, { roomId: route.roomId }));

view.addEventListener('click', async e => {
  const ext = e.target.closest('a[target="_blank"]');
  if (ext) { e.stopPropagation(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, value } = el.dataset;
  switch (action) {
    case 'open-room': navigate({ tab: 'rooms', roomId: id }); break;
    case 'add-room': openRoomDialog(null); break;
    case 'edit-task': e.preventDefault(); openTaskDialog(store.task(id)); break;
    case 'cycle-status': {
      e.stopPropagation();
      const t = store.task(id);
      const next = { todo: 'doing', doing: 'done', done: 'todo' }[t.status];
      await store.setTaskStatus(id, next);
      if (next === 'done') toast('Nice one 🎉');
      break;
    }
    case 'filter-who': taskFilter.who = value === '_none' ? '_none' : value; render(); break;
    case 'filter-status': taskFilter.status = value; render(); break;
    case 'toggle-bought': showBought = value === '1'; render(); break;
    case 'group-by': shopGroupBy = value; render(); break;
    case 'share-shopping': {
      const text = shoppingText();
      if (navigator.share) { try { await navigator.share({ title: 'Shopping list', text }); } catch { /* cancelled */ } }
      else { await navigator.clipboard?.writeText(text); toast('Copied to clipboard'); }
      break;
    }
    case 'sign-in': await store.signIn(); break;
    case 'sign-out': if (confirm('Sign out?')) await store.signOut(); break;
    case 'save-members': {
      const members = store.state.members.map((m, i) => ({
        ...m,
        name: $(`[data-member-name="${i}"]`, view).value,
        colour: $(`[data-member-colour="${i}"]`, view).value,
      }));
      const budget = $('#budgetInput', view).value;
      await store.setMembers(members);
      await store.setBudget(budget);
      toast('Saved');
      break;
    }
    case 'export': download(`renovation-backup-${todayISO()}.json`, store.exportState()); break;
    case 'go-settings': e.preventDefault(); navigate({ tab: 'settings' }, { replace: true }); setTimeout(() => $('#budgetInput', view)?.focus(), 50); break;
  }
});
view.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.action === 'buy') {
    await store.setMaterialBought(el.dataset.task, el.dataset.id, el.checked);
  }
  if (el.dataset.action === 'import' && el.files?.[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (confirm('Replace everything with the contents of this backup?')) { await store.importState(data); toast('Imported'); }
    } catch { toast('That file could not be read'); }
    el.value = '';
  }
});
banner.addEventListener('click', e => {
  if (e.target.dataset.action === 'go-settings') { e.preventDefault(); navigate({ tab: 'settings' }, { replace: true }); }
});
window.addEventListener('online', renderBanner);
window.addEventListener('offline', renderBanner);

/* ------------------------------------------------------------------ */
/* Store events                                                         */

store.addEventListener('change', render);
store.addEventListener('auth', render);
store.addEventListener('ready', render);
store.addEventListener('migrate', async e => {
  const local = e.detail;
  const n = local.tasks?.length || 0;
  if (confirm(`This phone has ${n} task${n === 1 ? '' : 's'} saved locally. Upload them to the shared household?`)) {
    await store.importState(local);
    toast('Uploaded');
  } else {
    await store.seedDefaults();
  }
});

/* ------------------------------------------------------------------ */
/* Service worker                                                       */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update available', { action: 'Reload', onAction: () => location.reload() });
          }
        });
      });
    } catch (e) { console.warn('SW registration failed', e); }
  });
}

/* ------------------------------------------------------------------ */

history.replaceState({ ...route }, '');
render();
store.init();
