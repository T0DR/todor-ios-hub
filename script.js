/* Hub – persönlicher Apple-Hub als PWA.
   Keine Zugangsdaten, keine Server: Daten kommen über Apple Kurzbefehle und bleiben auf dem Gerät. */
'use strict';

/* ========== Helpers ========== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = MD.esc;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('Speicher voll oder blockiert'); return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return (h >>> 0).toString(36); };
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || settings.motion === false;

const DE = 'de-DE';
const fmt = {
  time: d => new Date(d).toLocaleTimeString(DE, { hour: '2-digit', minute: '2-digit' }),
  day: d => new Date(d).toLocaleDateString(DE, { weekday: 'long', day: 'numeric', month: 'long' }),
  short: d => new Date(d).toLocaleDateString(DE, { day: 'numeric', month: 'short' }),
  wd: d => new Date(d).toLocaleDateString(DE, { weekday: 'short' }).replace('.', ''),
  size: b => b == null || b === '' ? '' : (b = +b, b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'),
};
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pad = n => String(n).padStart(2, '0');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = v => v ? new Date(v).toISOString() : null;
// Format, das Kurzbefehle zuverlässig als Datum erkennt (lokale Zeit)
const stamp = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const relDay = iso => {
  const d = new Date(iso), t = startOfDay(new Date());
  const diff = Math.round((startOfDay(d) - t) / 864e5);
  return diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : diff > 1 && diff < 7 ? fmt.wd(d) : fmt.short(d);
};
const hasTime = iso => { const d = new Date(iso); return d.getHours() || d.getMinutes(); };

/* ========== Settings & State ========== */
const SECTIONS = {
  today: { label: 'Heute', h: ['Dein Tag,', 'auf einen Blick.'] },
  reminders: { label: 'Erinnerungen', h: ['Alles Wichtige,', 'erledigt.'] },
  calendar: { label: 'Kalender', h: ['Deine Zeit,', 'im Fluss.'] },
  notes: { label: 'Notizen', h: ['Gedanken,', 'griffbereit.'] },
  files: { label: 'iCloud Drive', h: ['Deine Dateien,', 'an einem Ort.'] },
  pages: { label: 'Seiten', h: ['Schreiben,', 'wie du denkst.'] },
  settings: { label: 'Anpassen', h: ['Dein Hub,', 'deine Regeln.'] },
};
const ACCENTS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#a2845e'];
const DEFAULTS = {
  theme: 'system', accent: '#0a84ff', radius: 24, glass: 20, scale: 1, density: 'cozy',
  cursor: true, motion: true, italic: true,
  name: '', brand: 'Hub', heroLead: '',
  order: ['today', 'reminders', 'calendar', 'notes', 'files', 'pages'], hidden: [],
  remFilter: 'today', remList: '', showDoneInAll: false,
  days: 14, folder: 'Hub',
  scSync: 'Hub Sync', scWrite: 'Hub Write', returnMode: 'auto',
  lock: false, autolock: 5, edMode: 'write',
};
let settings = Object.assign({}, DEFAULTS, LS.get('hub.settings', {}));
const EMPTY = () => ({ data: { reminders: [], events: [], notes: [], files: [], syncedAt: null }, pages: [], outbox: [], sent: null, awaiting: 0 });
let state = null;
let vault = null; // { key, salt } solange entsperrt
let calDay = null; // gewählter Tag im Kalender
let hiddenAt = 0;

function saveSettings() { LS.set('hub.settings', settings); }
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(persist, 200); }
async function persist() {
  if (!state) return;
  if (settings.lock) { if (vault) LS.set('hub.state', await encrypt(state)); }
  else LS.set('hub.state', state);
}

/* ========== Verschlüsselung (AES-GCM, PBKDF2) ========== */
const te = new TextEncoder(), td = new TextDecoder();
function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vault.key, te.encode(JSON.stringify(obj)));
  return { enc: 1, salt: b64(vault.salt), iv: b64(iv), ct: b64(ct) };
}
async function decrypt(blob, pass) {
  const salt = unb64(blob.salt);
  const key = await deriveKey(pass, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return { obj: JSON.parse(td.decode(pt)), key, salt };
}
const cryptoOK = () => !!(window.crypto && crypto.subtle);

function showLock(msg) {
  $('#lock').hidden = false;
  $('#lockMsg').textContent = msg || 'Gib deine Passphrase ein.';
  $('#lockErr').textContent = '';
  $('#lockPass').value = '';
  setTimeout(() => $('#lockPass').focus(), 50);
}
function lockNow() {
  if (!settings.lock) return;
  persist().then(() => {
    state = null; vault = null;
    ['todayBody', 'remBody', 'calBody', 'noteBody', 'fileBody', 'pageBody', 'heroCard', 'remLists', 'pageTags'].forEach(id => { const el = $('#' + id); if (el) el.innerHTML = ''; });
    $$('dialog[open]').forEach(d => d.close());
    showLock();
  });
}
$('#lockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const blob = LS.get('hub.state', null);
  try {
    const { obj, key, salt } = await decrypt(blob, $('#lockPass').value);
    vault = { key, salt };
    state = Object.assign(EMPTY(), obj);
    $('#lock').hidden = true;
    start();
  } catch { $('#lockErr').textContent = 'Passphrase falsch.'; }
});

/* ========== Darstellung ========== */
function applySettings() {
  const r = document.documentElement;
  const t = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  r.dataset.theme = t;
  r.style.setProperty('--accent', settings.accent);
  r.style.setProperty('--radius', settings.radius + 'px');
  r.style.setProperty('--glass-blur', settings.glass + 'px');
  r.style.setProperty('--scale', settings.scale);
  r.dataset.density = settings.density;
  r.dataset.italic = settings.italic ? 'on' : 'off';
  r.dataset.motion = settings.motion ? 'on' : 'off';
  $('meta[name="theme-color"]').content = t === 'dark' ? '#000000' : '#f5f5f7';
  $('#brandName').textContent = settings.brand || 'Hub';
  $('#footName').textContent = settings.brand || 'Hub';
  setupCursor();
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => settings.theme === 'system' && applySettings());

/* ========== Layout: Reihenfolge, Navigation, Überschriften ========== */
function visibleOrder() { return settings.order.filter(k => !settings.hidden.includes(k)).concat('settings'); }
function layout() {
  const wrap = $('#sections');
  const order = visibleOrder();
  Object.keys(SECTIONS).forEach(k => { $('#' + k).hidden = !order.includes(k); });
  order.forEach((k, i) => {
    const sec = $('#' + k);
    wrap.appendChild(sec);
    const s = SECTIONS[k];
    $('.eyebrow', sec).textContent = `${pad(i + 1)} / ${s.label}`;
    $('h2', sec).innerHTML = `${esc(s.h[0])} <em>${esc(s.h[1])}</em>`;
  });
  const links = order.map(k => `<a href="#${k}" data-nav="${k}">${esc(SECTIONS[k].label)}</a>`).join('');
  $('#navLinks').innerHTML = links;
  $('#mobileMenu').innerHTML = order.map((k, i) => `<a href="#${k}" data-nav="${k}">${esc(SECTIONS[k].label)} <small>${pad(i + 1)}</small></a>`).join('');
  observeActive();
}
let activeObs;
function observeActive() {
  activeObs && activeObs.disconnect();
  activeObs = new IntersectionObserver(ents => {
    ents.forEach(en => {
      if (en.isIntersecting) $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === en.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('.section').forEach(s => activeObs.observe(s));
}

/* Scroll-Reveal */
const revealObs = 'IntersectionObserver' in window ? new IntersectionObserver(ents => {
  ents.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); revealObs.unobserve(en.target); } });
}, { rootMargin: '0px 0px -8% 0px' }) : null;
function reveal(root = document) {
  $$('.reveal:not(.in)', root).forEach((el, i) => {
    if (!revealObs || reduced()) { el.classList.add('in'); return; }
    el.style.setProperty('--d', Math.min(i % 6, 5) * 0.06 + 's');
    revealObs.observe(el);
  });
}

/* ========== Rendering ========== */
function renderAll() {
  renderHero(); renderToday(); renderReminders(); renderCalendar(); renderNotes(); renderFiles(); renderPages(); renderSettings(); renderBadge();
  reveal();
}
function renderBadge() {
  const n = state.outbox.length, b = $('#outboxBadge');
  b.hidden = !n; b.textContent = n;
  const s = state.data.syncedAt;
  $('#syncState').textContent = s ? `Zuletzt aktualisiert: ${relDay(s)}, ${fmt.time(s)}${n ? ` · ${n} Änderung${n > 1 ? 'en' : ''} ausstehend` : ''}` : 'Noch nicht synchronisiert – tippe auf „Aktualisieren“ oder lade Demo-Daten unter „Anpassen“.';
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
}
function renderHero() {
  const now = new Date();
  $('#heroDate').textContent = now.toLocaleDateString(DE, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#heroTitle').innerHTML = settings.name
    ? `${esc(greeting())}, <em>${esc(settings.name)}.</em>`
    : `Willkommen in <em>deinem Hub.</em>`;
  if (settings.heroLead) $('#heroLead').textContent = settings.heroLead;
  const evs = upcomingEvents(1).slice(0, 4);
  const due = openReminders().filter(r => r.due && startOfDay(r.due) <= startOfDay(now)).length;
  $('#heroCard').innerHTML = `
    <div><div class="hc-day">${now.getDate()}</div><div class="hc-sub">${esc(now.toLocaleDateString(DE, { weekday: 'long', month: 'long' }))}</div></div>
    <div>${evs.length ? evs.map(e => `<div class="hc-row"><time>${e.allDay ? 'Ganzt.' : fmt.time(e.start)}</time><span>${esc(e.title)}</span></div>`).join('')
      : '<div class="hc-row"><span class="muted">Keine Termine mehr heute.</span></div>'}
    <div class="hc-row"><time>${due}</time><span>Erinnerung${due === 1 ? '' : 'en'} fällig</span></div></div>`;
}

const openReminders = () => state.data.reminders.filter(r => !r.done);
function upcomingEvents(days) {
  const now = new Date(), end = addDays(startOfDay(now), days);
  return state.data.events.filter(e => new Date(e.end || e.start) >= now && new Date(e.start) < end).sort((a, b) => new Date(a.start) - new Date(b.start));
}

function remRow(r) {
  const overdue = r.due && !r.done && new Date(r.due) < (hasTime(r.due) ? new Date() : startOfDay(new Date()));
  const dueTxt = r.due ? `${relDay(r.due)}${hasTime(r.due) ? ', ' + fmt.time(r.due) : ''}` : '';
  return `<div class="row${r.done ? ' done' : ''}">
    <button class="check${r.done ? ' on' : ''}" data-act="toggleRem" data-id="${esc(r.id)}" aria-label="${r.done ? 'Als offen markieren' : 'Erledigen'}" aria-pressed="${r.done}"></button>
    <button class="row-main" data-act="editRem" data-id="${esc(r.id)}">
      <span class="row-title">${r.priority ? `<span class="prio">${'!'.repeat(Math.min(3, r.priority))}</span> ` : ''}${esc(r.title)}</span>
      <span class="row-sub">${dueTxt ? `<span class="${overdue ? 'overdue' : ''}">${esc(dueTxt)}</span>` : ''}${r.list ? `<span>${esc(r.list)}</span>` : ''}${r.notes ? '<span>· Notiz</span>' : ''}</span>
    </button>
    ${r.pending ? '<span class="pending" title="Wird beim nächsten Senden übertragen"></span>' : ''}
  </div>`;
}
function emptyBox(text, act, label) { return `<div class="empty">${esc(text)}${act ? `<br><button class="pill sm" data-act="${act}">${esc(label)}</button>` : ''}</div>`; }

function renderToday() {
  const now = new Date();
  const open = openReminders();
  const dueToday = open.filter(r => r.due && startOfDay(r.due) <= startOfDay(now)).sort((a, b) => new Date(a.due) - new Date(b.due));
  const overdue = dueToday.filter(r => startOfDay(r.due) < startOfDay(now)).length;
  const evToday = state.data.events.filter(e => sameDay(e.start, now));
  const pinned = state.pages.filter(p => p.pinned).slice(0, 4);
  const next = upcomingEvents(3).slice(0, 5);
  $('#todayBody').innerHTML = `
    <div class="stats">
      <button class="card stat reveal${overdue ? ' alert' : ''}" data-act="goto" data-to="reminders" data-f="today"><span class="num">${dueToday.length}</span><span class="lbl">Fällig${overdue ? ` · ${overdue} überfällig` : ''}</span></button>
      <button class="card stat reveal" data-act="goto" data-to="calendar"><span class="num">${evToday.length}</span><span class="lbl">Termine heute</span></button>
      <button class="card stat reveal" data-act="goto" data-to="reminders" data-f="all"><span class="num">${open.length}</span><span class="lbl">Offen gesamt</span></button>
      <button class="card stat reveal" data-act="outbox"><span class="num">${state.outbox.length}</span><span class="lbl">Ausstehend</span></button>
    </div>
    <div class="cols">
      <div class="card reveal"><div class="card-title"><h3>Fällig</h3><a class="link" href="#reminders">Alle ↓</a></div>
        <div class="list">${dueToday.length ? dueToday.slice(0, 6).map(remRow).join('') : '<p class="muted">Nichts fällig. Genieß den Tag.</p>'}</div></div>
      <div class="card reveal"><div class="card-title"><h3>Als Nächstes</h3><a class="link" href="#calendar">Kalender ↓</a></div>
        <div class="list">${next.length ? next.map(evRow).join('') : '<p class="muted">Keine Termine in den nächsten Tagen.</p>'}</div></div>
    </div>
    ${pinned.length ? `<h3 class="group-title">Angeheftete Seiten</h3><div class="grid">${pinned.map(pageCard).join('')}</div>` : ''}`;
}

/* --- Erinnerungen --- */
function renderReminders() {
  const f = settings.remFilter, q = ($('#remSearch').value || '').toLowerCase().trim(), L = settings.remList;
  $$('#remFilter button').forEach(b => { b.classList.toggle('on', b.dataset.f === f); b.setAttribute('aria-selected', b.dataset.f === f); });
  const all = state.data.reminders;
  const lists = [...new Set(all.map(r => r.list).filter(Boolean))].sort((a, b) => a.localeCompare(b, DE));
  $('#remLists').innerHTML = `<button class="chip${!L ? ' on' : ''}" data-act="remList" data-l="">Alle Listen</button>` +
    lists.map(l => `<button class="chip${L === l ? ' on' : ''}" data-act="remList" data-l="${esc(l)}">${esc(l)} <span class="n">${all.filter(r => r.list === l && !r.done).length}</span></button>`).join('');
  const eod = addDays(startOfDay(new Date()), 1);
  let items = all.filter(r => {
    if (L && r.list !== L) return false;
    if (q && !(r.title + ' ' + r.notes + ' ' + r.list).toLowerCase().includes(q)) return false;
    if (f === 'today') return !r.done && r.due && new Date(r.due) < eod;
    if (f === 'planned') return !r.done && r.due;
    if (f === 'done') return r.done;
    return settings.showDoneInAll || !r.done;
  });
  items.sort((a, b) => (a.done - b.done) || ((a.due ? new Date(a.due) : 9e15) - (b.due ? new Date(b.due) : 9e15)) || (b.priority - a.priority));
  if (!items.length) {
    $('#remBody').innerHTML = all.length ? emptyBox('Keine Erinnerungen in dieser Ansicht.') : emptyBox('Noch keine Daten. Aktualisiere über deinen Kurzbefehl.', 'sync', 'Aktualisieren ↻');
    return;
  }
  if (f === 'planned') {
    const groups = {};
    items.forEach(r => { const k = relDay(r.due); (groups[k] = groups[k] || []).push(r); });
    $('#remBody').innerHTML = Object.entries(groups).map(([k, v]) => `<div class="group-title"><span>${esc(k)}</span><span>${v.length}</span></div>${v.map(remRow).join('')}`).join('');
  } else if (!L && f === 'all') {
    const groups = {};
    items.forEach(r => { const k = r.list || 'Ohne Liste'; (groups[k] = groups[k] || []).push(r); });
    $('#remBody').innerHTML = Object.entries(groups).map(([k, v]) => `<div class="group-title"><span>${esc(k)}</span><span>${v.length}</span></div>${v.map(remRow).join('')}`).join('');
  } else $('#remBody').innerHTML = items.map(remRow).join('');
}

/* Natürliche Eingabe: "Arzt anrufen morgen 9 Uhr #Privat !!" */
const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
function parseQuick(text) {
  let t = ' ' + text + ' ', due = null, list = '', priority = 0, time = null;
  t = t.replace(/\s#([\wäöüÄÖÜß-]+)/, (_, l) => { list = l; return ' '; });
  t = t.replace(/\s(!{1,3})(?=\s)/, (_, p) => { priority = p.length; return ' '; });
  t = t.replace(/\s(?:um\s)?(\d{1,2})(?::(\d{2}))?\s?uhr(?=\s)/i, (_, h, m) => { time = [+h, +(m || 0)]; return ' '; });
  t = t.replace(/\s(?:um\s)?(\d{1,2}):(\d{2})(?=\s)/, (_, h, m) => { time = [+h, +m]; return ' '; });
  const today = startOfDay(new Date());
  t = t.replace(/\s(heute|morgen|übermorgen)(?=\s)/i, (_, w) => { w = w.toLowerCase(); due = addDays(today, w === 'heute' ? 0 : w === 'morgen' ? 1 : 2); return ' '; });
  t = t.replace(/\s(?:am\s)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?=\s)/i, (_, w) => {
    const target = WEEKDAYS.indexOf(w.toLowerCase()); let diff = (target - today.getDay() + 7) % 7 || 7; due = addDays(today, diff); return ' ';
  });
  t = t.replace(/\s(?:am\s)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?=\s)/, (_, d, m, y) => {
    y = y ? (y.length === 2 ? 2000 + +y : +y) : today.getFullYear(); due = new Date(y, m - 1, +d); return ' ';
  });
  if (time && !due) due = today;
  if (due && time) due.setHours(time[0], time[1]);
  return { title: t.replace(/\s+/g, ' ').trim(), due: due ? due.toISOString() : null, list, priority };
}

/* --- Kalender --- */
function evRow(e) {
  const multi = !sameDay(e.start, e.end || e.start);
  return `<button class="row ev" data-act="viewEvent" data-id="${esc(e.id)}">
    <time>${e.allDay ? 'Ganzt.' : fmt.time(e.start)}</time>
    <span class="row-main"><span class="row-title">${esc(e.title)}</span>
    <span class="row-sub">${e.allDay ? '' : `<span>bis ${multi ? fmt.short(e.end) + ' ' : ''}${fmt.time(e.end || e.start)}</span>`}${e.calendar ? `<span>${esc(e.calendar)}</span>` : ''}${e.location ? `<span>${esc(e.location)}</span>` : ''}</span></span>
    ${e.pending ? '<span class="pending"></span>' : ''}</button>`;
}
function renderCalendar() {
  const today = startOfDay(new Date());
  const evs = state.data.events.slice().sort((a, b) => new Date(a.start) - new Date(b.start));
  $('#calWeek').innerHTML = [...Array(7)].map((_, i) => {
    const d = addDays(today, i), n = evs.filter(e => sameDay(e.start, d)).length;
    const on = calDay != null && sameDay(calDay, d);
    return `<button class="day${on ? ' on' : ''}" data-act="calDay" data-d="${d.toISOString()}" aria-pressed="${on}">${esc(fmt.wd(d))}<b>${d.getDate()}</b><span class="dots">${'<i></i>'.repeat(Math.min(n, 3))}</span></button>`;
  }).join('');
  let list = calDay ? evs.filter(e => sameDay(e.start, calDay)) : evs.filter(e => new Date(e.end || e.start) >= today && new Date(e.start) < addDays(today, settings.days));
  if (!list.length) {
    $('#calBody').innerHTML = state.data.events.length ? emptyBox(calDay ? 'Keine Termine an diesem Tag.' : 'Keine anstehenden Termine.', 'newEvent', 'Termin +') : emptyBox('Noch keine Termine geladen.', 'sync', 'Aktualisieren ↻');
    return;
  }
  const groups = {};
  list.forEach(e => { const k = startOfDay(e.start).toISOString(); (groups[k] = groups[k] || []).push(e); });
  $('#calBody').innerHTML = Object.entries(groups).map(([k, v]) => `<div class="group-title"><span>${esc(relDay(k) === fmt.short(k) ? fmt.day(k) : relDay(k) + ' · ' + fmt.short(k))}</span><span>${v.length}</span></div><div class="list">${v.map(evRow).join('')}</div>`).join('');
}

/* --- Notizen --- */
function renderNotes() {
  const q = ($('#noteSearch').value || '').toLowerCase().trim();
  const items = state.data.notes.filter(n => !q || (n.title + ' ' + n.body).toLowerCase().includes(q))
    .sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
  $('#noteBody').innerHTML = items.length ? items.map(n => `
    <button class="card reveal" data-act="viewNote" data-id="${esc(n.id)}">
      <h3>${esc(n.title || 'Ohne Titel')}</h3>
      <p class="excerpt">${esc((n.body || '').replace(n.title, '').trim().slice(0, 240))}</p>
      <div class="meta">${n.folder ? `<span>${esc(n.folder)}</span>` : ''}${n.modified ? `<span>${esc(relDay(n.modified))}</span>` : ''}${n.pending ? '<span>ausstehend</span>' : ''}</div>
    </button>`).join('') : (state.data.notes.length ? emptyBox('Keine Treffer.') : emptyBox('Noch keine Notizen geladen.', 'sync', 'Aktualisieren ↻'));
  reveal($('#noteBody'));
}

/* --- Dateien --- */
const TEXT_EXT = ['md', 'markdown', 'txt'];
function renderFiles() {
  const q = ($('#fileSearch').value || '').toLowerCase().trim();
  const items = state.data.files.filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
  $('#fileBody').innerHTML = items.length ? items.map(f => `
    <button class="row" data-act="viewFile" data-id="${esc(f.id)}">
      <span class="file-ico">${esc((f.ext || '?').slice(0, 4))}</span>
      <span class="row-main"><span class="row-title">${esc(f.name)}</span>
      <span class="row-sub">${f.modified ? `<span>${esc(relDay(f.modified))}</span>` : ''}<span>${esc(fmt.size(f.size))}</span>${f.text != null && f.text !== '' ? '<span>Vorschau</span>' : ''}</span></span>
      ${f.pending ? '<span class="pending"></span>' : ''}
    </button>`).join('') : (state.data.files.length ? emptyBox('Keine Treffer.') : emptyBox(`Noch keine Dateien aus „iCloud Drive/${settings.folder}“ geladen.`, 'sync', 'Aktualisieren ↻'));
}

/* --- Seiten (Markdown) --- */
const pageTags = p => (p.tags || []).filter(Boolean);
function pageCard(p) {
  const plain = (p.body || '').replace(/[#>*_`~=\[\]-]/g, '').replace(/\s+/g, ' ').trim();
  return `<button class="card reveal${p.pinned ? ' pinned' : ''}" data-act="openPage" data-id="${esc(p.id)}">
    <span class="ico">${esc(p.icon || '📄')}</span>
    <h3>${esc(p.title || 'Ohne Titel')}</h3>
    <p class="excerpt">${esc(plain.slice(0, 200)) || '<span class="muted">Leer</span>'}</p>
    <div class="meta"><span>${esc(relDay(p.updated))}</span>${pageTags(p).map(t => `<span class="tag-chip">#${esc(t)}</span>`).join('')}${p.pinned ? '<span>📌</span>' : ''}</div>
  </button>`;
}
let pageTagFilter = '';
function renderPages() {
  let q = ($('#pageSearch').value || '').toLowerCase().trim();
  const tags = [...new Set(state.pages.flatMap(pageTags))].sort();
  $('#pageTags').innerHTML = tags.length ? `<button class="chip${!pageTagFilter ? ' on' : ''}" data-act="pageTag" data-t="">Alle</button>` +
    tags.map(t => `<button class="chip${pageTagFilter === t ? ' on' : ''}" data-act="pageTag" data-t="${esc(t)}">#${esc(t)}</button>`).join('') : '';
  const items = state.pages.filter(p => {
    if (pageTagFilter && !pageTags(p).includes(pageTagFilter)) return false;
    if (q.startsWith('#')) return pageTags(p).some(t => t.toLowerCase().startsWith(q.slice(1)));
    return !q || (p.title + ' ' + p.body).toLowerCase().includes(q);
  }).sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  $('#pageBody').innerHTML = items.length ? items.map(pageCard).join('') : emptyBox(state.pages.length ? 'Keine Treffer.' : 'Deine erste Seite – Notizen, Pläne, Journal. Markdown wird unterstützt.', 'newPage', 'Seite +');
  reveal($('#pageBody'));
}

/* --- Anpassen --- */
const sw = (key, on) => `<label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;
function seg(key, opts) { return `<div class="seg">${opts.map(([v, l]) => `<button data-act="setSeg" data-k="${key}" data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`; }
function renderSettings() {
  const mods = settings.order;
  $('#setBody').innerHTML = `
  <div class="card set-group reveal">
    <h3>Darstellung</h3><p>Farben, Formen und Bewegung.</p>
    <div class="field"><span>Modus</span>${seg('theme', [['system', 'Auto'], ['dark', 'Dunkel'], ['light', 'Hell']])}</div>
    <div class="field"><span>Akzent</span><div class="swatches">${ACCENTS.map(c => `<button class="swatch${settings.accent === c ? ' on' : ''}" style="background:${c}" data-act="accent" data-c="${c}" aria-label="Akzent ${c}"></button>`).join('')}<input type="color" data-set="accent" value="${esc(settings.accent)}" aria-label="Eigene Farbe"></div></div>
    <div class="field"><span>Eckenradius</span><input type="range" min="8" max="36" data-set="radius" value="${settings.radius}"></div>
    <div class="field"><span>Glas-Unschärfe</span><input type="range" min="0" max="40" data-set="glass" value="${settings.glass}"></div>
    <div class="field"><span>Schriftgröße</span><input type="range" min="0.85" max="1.2" step="0.05" data-set="scale" value="${settings.scale}"></div>
    <div class="field"><span>Dichte</span>${seg('density', [['compact', 'Kompakt'], ['cozy', 'Normal'], ['airy', 'Luftig']])}</div>
    <div class="field"><span>Kursiver Akzent in Titeln</span>${sw('italic', settings.italic)}</div>
    <div class="field"><span>Animationen</span>${sw('motion', settings.motion)}</div>
    <div class="field"><span>Eigener Cursor (Desktop)</span>${sw('cursor', settings.cursor)}</div>
  </div>
  <div class="card set-group reveal">
    <h3>Layout</h3><p>Bereiche ein-/ausblenden und sortieren.</p>
    ${mods.map((k, i) => `<div class="order-row"><span>${esc(SECTIONS[k].label)}</span>
      <button class="mini" data-act="move" data-k="${k}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">↑</button>
      <button class="mini" data-act="move" data-k="${k}" data-dir="1" ${i === mods.length - 1 ? 'disabled' : ''} aria-label="Nach unten">↓</button>
      <label class="switch"><input type="checkbox" data-act="toggleSec" data-k="${k}" ${settings.hidden.includes(k) ? '' : 'checked'} aria-label="${esc(SECTIONS[k].label)} anzeigen"><i></i></label></div>`).join('')}
    <div class="field"><span>Dein Name</span><input type="text" data-set="name" value="${esc(settings.name)}" placeholder="für die Begrüßung"></div>
    <div class="field"><span>App-Name</span><input type="text" data-set="brand" value="${esc(settings.brand)}" maxlength="20"></div>
    <div class="field"><span>Untertitel</span><input type="text" data-set="heroLead" value="${esc(settings.heroLead)}" placeholder="Standard"></div>
    <div class="field"><span>Kalender-Vorschau (Tage)</span><input type="number" min="1" max="90" data-set="days" value="${settings.days}"></div>
    <div class="field"><span>Erledigte in „Alle“ zeigen</span>${sw('showDoneInAll', settings.showDoneInAll)}</div>
  </div>
  <div class="card set-group reveal">
    <h3>Verbindung zu Apple</h3><p>Über deine Kurzbefehle – ohne Passwörter. Anleitung: SHORTCUTS.md</p>
    <div class="field"><span>Kurzbefehl „Lesen“</span><input type="text" data-set="scSync" value="${esc(settings.scSync)}"></div>
    <div class="field"><span>Kurzbefehl „Schreiben“</span><input type="text" data-set="scWrite" value="${esc(settings.scWrite)}"></div>
    <div class="field"><span>iCloud-Ordner</span><input type="text" data-set="folder" value="${esc(settings.folder)}"></div>
    <div class="field"><span>Rückweg</span>${seg('returnMode', [['auto', 'Auto'], ['url', 'Link'], ['clipboard', 'Zwischenabl.']])}</div>
    <div class="btn-row">
      <button class="pill sm primary" data-act="sync">Jetzt lesen ↻</button>
      <button class="pill sm" data-act="clipImport">Aus Zwischenablage</button>
      <button class="pill sm" data-act="pasteImport">Manuell einfügen</button>
      <button class="pill sm" data-act="demo">Demo-Daten</button>
    </div>
  </div>
  <div class="card set-group reveal">
    <h3>Sicherheit & Daten</h3><p>Alles bleibt lokal auf diesem Gerät. Optional verschlüsselt (AES-256).</p>
    <div class="field"><span>Mit Passphrase sperren</span>${cryptoOK() ? `<label class="switch"><input type="checkbox" data-act="lockToggle" ${settings.lock ? 'checked' : ''}><i></i></label>` : '<span class="muted">nur über HTTPS</span>'}</div>
    <div class="field"><span>Automatisch sperren nach (Min.)</span><input type="number" min="0" max="120" data-set="autolock" value="${settings.autolock}"></div>
    <div class="btn-row">
      ${settings.lock ? '<button class="pill sm" data-act="lockNow">Jetzt sperren</button>' : ''}
      <button class="pill sm" data-act="export">Backup exportieren</button>
      <label class="pill sm" tabindex="0">Backup importieren<input type="file" accept="application/json,.json" id="importFile" hidden></label>
      <button class="pill sm danger" data-act="wipe">Alles löschen</button>
    </div>
  </div>`;
  reveal($('#setBody'));
}

/* ========== Outbox / Änderungen ========== */
function queue(type, payload) {
  const op = { id: uid(), type, payload, ts: Date.now() };
  state.outbox.push(op);
  applyLocal(op);
  save(); rerender();
}
function findRem(m) { return state.data.reminders.find(r => r.title === m.title && (r.list || '') === (m.list || '')); }
function applyLocal(op) {
  const p = op.payload, D = state.data;
  switch (op.type) {
    case 'reminder.add': D.reminders.push({ id: 'tmp_' + op.id, title: p.title, list: p.list || '', due: p.dueISO || null, notes: p.notes || '', priority: p.priority || 0, done: false, pending: true }); break;
    case 'reminder.update': { const r = findRem(p.match); if (r) Object.assign(r, { title: p.title ?? r.title, list: p.list ?? r.list, due: p.dueISO !== undefined ? p.dueISO : r.due, notes: p.notes ?? r.notes, priority: p.priority ?? r.priority, done: p.done ?? r.done, pending: true }); break; }
    case 'reminder.delete': D.reminders = D.reminders.filter(r => r !== findRem(p.match)); break;
    case 'event.add': D.events.push({ id: 'tmp_' + op.id, title: p.title, start: p.startISO, end: p.endISO, allDay: !!p.allDay, calendar: p.calendar || '', location: p.location || '', notes: p.notes || '', pending: true }); break;
    case 'event.delete': D.events = D.events.filter(e => !(e.title === p.match.title && stamp(e.start) === p.match.start)); break;
    case 'note.create': D.notes.unshift({ id: 'tmp_' + op.id, title: p.title, body: p.title + '\n' + p.body, folder: '', modified: new Date().toISOString(), pending: true }); break;
    case 'note.append': { const n = D.notes.find(n => n.title === p.match.title); if (n) { n.body += '\n' + p.text; n.pending = true; } break; }
    case 'file.save': {
      let f = D.files.find(f => f.name === p.name);
      if (!f) { f = { id: 'tmp_' + op.id, name: p.name, ext: p.name.split('.').pop() }; D.files.push(f); }
      Object.assign(f, { text: p.text, size: te.encode(p.text).length, modified: new Date().toISOString(), pending: true });
      break;
    }
  }
}
// Fürs Senden: nur was der Kurzbefehl braucht (ohne interne ISO-Felder)
function opForShortcut(op) {
  const p = Object.assign({}, op.payload);
  delete p.dueISO; delete p.startISO; delete p.endISO; delete p.pageId;
  return Object.assign({ id: op.id, type: op.type }, p);
}
function rerender() { renderHero(); renderToday(); renderReminders(); renderCalendar(); renderNotes(); renderFiles(); renderBadge(); }

/* ========== Brücke zu Apple Kurzbefehlen ========== */
function returnMode() { return settings.returnMode === 'auto' ? (standalone() ? 'clipboard' : 'url') : settings.returnMode; }
function runShortcut(name, input) {
  const p = new URLSearchParams();
  p.set('name', name);
  if (input != null) { p.set('input', 'text'); p.set('text', input); }
  if (returnMode() === 'url') {
    const back = location.origin + location.pathname;
    p.set('x-success', back + '?hub=ok');
    p.set('x-error', back + '?hub=error');
    p.set('x-cancel', back + '?hub=cancel');
  }
  state.awaiting = Date.now(); persist();
  const url = 'shortcuts://x-callback-url/run-shortcut?' + p.toString().replace(/\+/g, '%20');
  if (!isIOS) toast('Kurzbefehle gibt es nur auf iPhone/iPad/Mac. Zum Testen: „Demo-Daten“.');
  location.href = url;
}
function syncRead() { runShortcut(settings.scSync, null); }
function syncWrite() {
  if (!state.outbox.length) return syncRead();
  const ops = state.outbox.map(opForShortcut);
  state.sent = { ids: state.outbox.map(o => o.id), at: Date.now() };
  runShortcut(settings.scWrite, JSON.stringify({ folder: settings.folder, ops }));
}

/* Daten normalisieren – alles was zurückkommt ist unvertrauenswürdig */
function normalize(p) {
  const S = (v, n = 20000) => v == null ? '' : String(v).slice(0, n);
  const D = v => { if (!v) return null; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); };
  const B = v => v === true || /^(true|ja|yes|1)$/i.test(String(v));
  const A = v => Array.isArray(v) ? v.slice(0, 3000) : (v && typeof v === 'object' ? [v] : []);
  const N = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(9, n)); };
  const reminders = A(p.reminders).map(r => {
    const o = { title: S(r.title, 500), list: S(r.list, 200), due: D(r.due), done: B(r.done), notes: S(r.notes, 5000), priority: N(r.priority) };
    o.id = 'r_' + hash(o.list + '|' + o.title + '|' + (o.due || '')); return o;
  }).filter(r => r.title);
  const events = A(p.events).map(e => {
    const o = { title: S(e.title, 500), start: D(e.start), end: D(e.end) || D(e.start), allDay: B(e.allDay), calendar: S(e.calendar, 200), location: S(e.location, 500), notes: S(e.notes, 5000) };
    o.id = 'e_' + hash(o.calendar + '|' + o.title + '|' + o.start); return o;
  }).filter(e => e.title && e.start);
  const notes = A(p.notes).map(n => {
    const o = { title: S(n.title, 500), body: S(n.body, 50000), folder: S(n.folder, 200), modified: D(n.modified) };
    o.id = 'n_' + hash(o.folder + '|' + o.title + '|' + o.modified); return o;
  });
  const files = A(p.files).map(f => {
    const name = S(f.name, 300) + (f.ext && !String(f.name).includes('.') ? '.' + S(f.ext, 10) : '');
    const o = { name, ext: S(f.ext, 10) || name.split('.').pop(), size: f.size == null ? '' : S(f.size, 20), modified: D(f.modified), text: f.text == null ? null : S(f.text, 300000) };
    o.id = 'f_' + hash(o.name); return o;
  }).filter(f => f.name);
  return { reminders, events, notes, files, syncedAt: D(p.ts) || new Date().toISOString() };
}
function importPayload(text, source) {
  let p;
  try {
    const s = String(text).trim();
    p = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch { toast('Daten konnten nicht gelesen werden (kein gültiges JSON).'); return false; }
  if (!p || typeof p !== 'object' || !('reminders' in p || 'events' in p || 'notes' in p || 'files' in p)) { toast('Unbekanntes Format – stimmt der Kurzbefehl?'); return false; }
  state.data = normalize(p);
  // Gesendete Änderungen gelten als übernommen, wenn die Antwort nach dem Senden kam
  if (state.sent && Date.now() - state.sent.at < 30 * 60e3) {
    const sent = new Set(state.sent.ids);
    state.pages.forEach(pg => { if (state.outbox.some(o => sent.has(o.id) && o.payload.pageId === pg.id)) pg.syncedAt = Date.now(); });
    state.outbox = state.outbox.filter(o => !sent.has(o.id));
  }
  state.sent = null; state.awaiting = 0;
  state.outbox.forEach(applyLocal); // später erstellte, noch offene Änderungen wieder anzeigen
  save(); rerender(); reveal();
  const d = state.data;
  toast(`Aktualisiert: ${d.reminders.length} Erinnerungen, ${d.events.length} Termine, ${d.notes.length} Notizen, ${d.files.length} Dateien`);
  return true;
}
async function clipImport() {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return toast('Zwischenablage ist leer.');
    if (importPayload(t, 'clipboard')) try { await navigator.clipboard.writeText(''); } catch {}
  } catch { pasteDialog(); }
}
function readIncoming() {
  const u = new URL(location.href);
  let r = u.searchParams.get('result');
  if (r == null) { const m = location.href.match(/[?&]result=([^&#]*)/); if (m) try { r = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch {} }
  const status = u.searchParams.get('hub');
  if (status || r != null) history.replaceState(null, '', u.pathname + u.hash);
  if (status === 'error') toast('Kurzbefehl-Fehler: ' + (u.searchParams.get('errorMessage') || 'unbekannt'));
  if (status === 'cancel') toast('Kurzbefehl abgebrochen.');
  if (r) importPayload(r, 'url');
  else if (status === 'ok') { state.awaiting = Date.now(); offerClipboard(); }
}
function offerClipboard() {
  if (!state || !state.awaiting || Date.now() - state.awaiting > 15 * 60e3) return;
  toast('Zurück vom Kurzbefehl.', 'Daten übernehmen', clipImport, 12000);
}

/* ========== Dialoge ========== */
const dlg = $('#dlg');
function openDlg(html, onSubmit) {
  dlg.innerHTML = `<form class="dlg-inner" method="dialog" novalidate>${html}</form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn && btn.value === 'cancel') return dlg.close();
    if (onSubmit && onSubmit(new FormData(form), btn && btn.value) !== false) dlg.close();
  });
  dlg.showModal();
  const first = $('input:not([type=hidden]):not([type=checkbox]), textarea', dlg);
  if (first && !isIOS) first.focus();
}
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
const head = t => `<div class="dlg-head"><h3>${t}</h3><button class="icon-btn" value="cancel" aria-label="Schließen">✕</button></div>`;
const listOptions = () => `<datalist id="lists">${[...new Set(state.data.reminders.map(r => r.list).filter(Boolean))].map(l => `<option value="${esc(l)}">`).join('')}</datalist>`;

function remDialog(r) {
  const isNew = !r; r = r || { title: '', list: settings.remList || '', due: null, notes: '', priority: 0, done: false };
  openDlg(`${head(isNew ? 'Neue Erinnerung' : 'Erinnerung')}
    <label>Titel<input name="title" value="${esc(r.title)}" required></label>
    <div class="two"><label>Liste<input name="list" list="lists" value="${esc(r.list)}" placeholder="Standard"></label>
    <label>Priorität<select name="priority">${[0, 1, 2, 3].map(p => `<option value="${p}" ${r.priority === p ? 'selected' : ''}>${['Keine', 'Niedrig !', 'Mittel !!', 'Hoch !!!'][p]}</option>`).join('')}</select></label></div>
    <label>Fällig<input type="datetime-local" name="due" value="${toLocalInput(r.due)}"></label>
    <label>Notiz<textarea name="notes" rows="3">${esc(r.notes)}</textarea></label>
    ${isNew ? '' : `<label class="inline-check"><input type="checkbox" name="done" ${r.done ? 'checked' : ''}> Erledigt</label>`}
    ${listOptions()}
    <div class="dlg-actions">${isNew ? '' : '<button class="pill sm danger" value="delete">Löschen</button>'}<span class="spacer"></span><button class="pill sm" value="cancel">Abbrechen</button><button class="pill sm primary" value="save">Sichern</button></div>`,
  (fd, action) => {
    if (action === 'delete') { if (confirm('Erinnerung in Apple Erinnerungen löschen?')) queue('reminder.delete', { match: { title: r.title, list: r.list } }); return; }
    const title = String(fd.get('title')).trim(); if (!title) return false;
    const dueISO = fromLocalInput(fd.get('due'));
    const data = { title, list: String(fd.get('list')).trim(), due: stamp(dueISO), dueISO, notes: String(fd.get('notes')), priority: +fd.get('priority') };
    if (isNew) queue('reminder.add', data);
    else queue('reminder.update', Object.assign({ match: { title: r.title, list: r.list }, done: !!fd.get('done') }, data));
  });
}
function eventDialog(e) {
  const start = calDay ? new Date(calDay) : new Date(); if (calDay) start.setHours(9); start.setMinutes(0, 0, 0); if (!calDay) start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600e3);
  const cals = [...new Set(state.data.events.map(x => x.calendar).filter(Boolean))];
  openDlg(`${head('Neuer Termin')}
    <label>Titel<input name="title" required></label>
    <div class="two"><label>Beginn<input type="datetime-local" name="start" value="${toLocalInput(start)}"></label>
    <label>Ende<input type="datetime-local" name="end" value="${toLocalInput(end)}"></label></div>
    <label class="inline-check"><input type="checkbox" name="allDay"> Ganztägig</label>
    <div class="two"><label>Kalender<input name="calendar" list="cals" placeholder="Standard"></label><label>Ort<input name="location"></label></div>
    <label>Notiz<textarea name="notes" rows="2"></textarea></label>
    <datalist id="cals">${cals.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="dlg-actions"><button class="pill sm" value="cancel">Abbrechen</button><button class="pill sm primary" value="save">Hinzufügen</button></div>`,
  fd => {
    const title = String(fd.get('title')).trim(); if (!title) return false;
    const startISO = fromLocalInput(fd.get('start')), endISO = fromLocalInput(fd.get('end')) || startISO;
    if (!startISO) return false;
    queue('event.add', { title, start: stamp(startISO), end: stamp(endISO), startISO, endISO, allDay: !!fd.get('allDay'), calendar: String(fd.get('calendar')).trim(), location: String(fd.get('location')).trim(), notes: String(fd.get('notes')) });
  });
}
function viewEvent(e) {
  openDlg(`${head(esc(e.title))}
    <p class="muted">${esc(fmt.day(e.start))}${e.allDay ? ' · ganztägig' : ` · ${fmt.time(e.start)} – ${fmt.time(e.end || e.start)}`}</p>
    ${e.calendar ? `<p>📅 ${esc(e.calendar)}</p>` : ''}${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    ${e.notes ? `<div class="note-body">${esc(e.notes)}</div>` : ''}
    <div class="dlg-actions"><button class="pill sm danger" value="delete">Löschen</button><span class="spacer"></span><a class="pill sm" href="calshow:${Math.floor(new Date(e.start).getTime() / 1000 - 978307200)}">In Kalender ↗</a><button class="pill sm" value="cancel">Schließen</button></div>`,
  (fd, action) => {
    if (action === 'delete' && confirm('Termin in Apple Kalender löschen?')) queue('event.delete', { match: { title: e.title, start: stamp(e.start) } });
  });
}
function noteDialog() {
  openDlg(`${head('Neue Notiz')}
    <label>Titel<input name="title" required></label>
    <label>Text<textarea name="body" rows="8" placeholder="Wird als Text in Apple Notizen angelegt."></textarea></label>
    <div class="dlg-actions"><button class="pill sm" value="cancel">Abbrechen</button><button class="pill sm primary" value="save">Anlegen</button></div>`,
  fd => { const title = String(fd.get('title')).trim(); if (!title) return false; queue('note.create', { title, body: String(fd.get('body')) }); });
}
function viewNote(n) {
  openDlg(`${head(esc(n.title || 'Notiz'))}
    <div class="note-body">${esc(n.body)}</div>
    <label>Anhängen<textarea name="append" rows="2" placeholder="Text, der unten angefügt wird"></textarea></label>
    <div class="dlg-actions"><button class="pill sm" value="page">Als Seite kopieren</button><span class="spacer"></span><a class="pill sm" href="mobilenotes://">Notizen ↗</a><button class="pill sm primary" value="save">Anhängen</button></div>`,
  (fd, action) => {
    if (action === 'page') { const p = newPage(n.title, n.body.replace(n.title, '').trim()); dlg.close(); openPage(p.id); return false; }
    const t = String(fd.get('append') || '').trim(); if (t) queue('note.append', { match: { title: n.title }, text: t });
  });
}
function viewFile(f) {
  const isText = TEXT_EXT.includes((f.ext || '').toLowerCase()) && f.text != null;
  const path = `shareddocuments:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/${encodeURIComponent(settings.folder)}/`;
  openDlg(`${head(esc(f.name))}
    <p class="muted">${esc(fmt.size(f.size))}${f.modified ? ' · ' + esc(fmt.day(f.modified)) : ''}</p>
    ${isText ? `<div class="note-body md">${/md|markdown/i.test(f.ext) ? MD.render(f.text) : esc(f.text)}</div>` : '<p class="muted">Keine Vorschau. Öffne die Datei in der Dateien-App.</p>'}
    <div class="dlg-actions">${isText ? '<button class="pill sm" value="page">In Seiten bearbeiten</button>' : ''}<span class="spacer"></span><a class="pill sm" href="${path}">In Dateien ↗</a><button class="pill sm primary" value="cancel">Schließen</button></div>`,
  (fd, action) => {
    if (action === 'page') {
      let p = state.pages.find(p => p.file === f.name);
      if (!p) { p = newPage(f.name.replace(/\.[^.]+$/, ''), f.text); p.file = f.name; save(); }
      dlg.close(); openPage(p.id); return false;
    }
  });
}
function pasteDialog() {
  openDlg(`${head('Daten einfügen')}
    <p class="muted">Füge hier die Ausgabe deines Kurzbefehls ein (JSON).</p>
    <label>Daten<textarea name="data" rows="8"></textarea></label>
    <div class="dlg-actions"><button class="pill sm" value="cancel">Abbrechen</button><button class="pill sm primary" value="ok">Übernehmen</button></div>`,
  fd => importPayload(fd.get('data'), 'paste'));
}
const OP_LABEL = { 'reminder.add': 'Erinnerung +', 'reminder.update': 'Erinnerung ✎', 'reminder.delete': 'Erinnerung ✕', 'event.add': 'Termin +', 'event.delete': 'Termin ✕', 'note.create': 'Notiz +', 'note.append': 'Notiz ✎', 'file.save': 'Datei ⤓' };
function outboxDialog() {
  const ops = state.outbox;
  openDlg(`${head('Synchronisieren')}
    <p class="muted">${ops.length ? `${ops.length} Änderung${ops.length > 1 ? 'en' : ''} warten darauf, an Apple gesendet zu werden.` : 'Keine ausstehenden Änderungen.'}</p>
    ${ops.length ? `<div class="ops">${ops.map(o => `<div class="op"><small>${OP_LABEL[o.type] || o.type}</small><span>${esc(o.payload.title || o.payload.name || (o.payload.match && o.payload.match.title) || '')}</span><button class="mini" value="del:${o.id}" aria-label="Verwerfen">✕</button></div>`).join('')}</div>` : ''}
    <div class="dlg-actions"><button class="pill sm" value="clip">Zwischenablage übernehmen</button><span class="spacer"></span>
    ${ops.length ? '<button class="pill sm primary" value="write">An Apple senden</button>' : '<button class="pill sm primary" value="read">Aktualisieren ↻</button>'}</div>`,
  (fd, action) => {
    if (action && action.startsWith('del:')) {
      const id = action.slice(4);
      state.outbox = state.outbox.filter(o => o.id !== id); state.sent = null;
      save(); toast('Verworfen. Aktualisiere, um den Originalzustand zu laden.'); renderBadge(); outboxDialog(); return false;
    }
    if (action === 'clip') { clipImport(); return; }
    if (action === 'write') syncWrite(); else if (action === 'read') syncRead();
  });
}
function quickDialog() {
  openDlg(`${head('Neu')}
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <button class="card" value="rem"><span class="ico">☑️</span><h3>Erinnerung</h3></button>
      <button class="card" value="ev"><span class="ico">📅</span><h3>Termin</h3></button>
      <button class="card" value="note"><span class="ico">🗒️</span><h3>Notiz</h3></button>
      <button class="card" value="page"><span class="ico">📄</span><h3>Seite</h3></button>
    </div>`,
  (fd, a) => {
    dlg.close();
    setTimeout(() => { if (a === 'rem') remDialog(); if (a === 'ev') eventDialog(); if (a === 'note') noteDialog(); if (a === 'page') openPage(newPage().id); }, 60);
    return false;
  });
}
function passDialog() {
  openDlg(`${head('Passphrase festlegen')}
    <p class="muted">Deine lokalen Daten werden mit AES-256 verschlüsselt. Ohne Passphrase sind sie nicht wiederherstellbar – nach einer Aktualisierung aus Apple sind Erinnerungen, Termine usw. aber sofort wieder da. Seiten vorher sichern (Backup oder iCloud).</p>
    <label>Passphrase<input type="password" name="p1" autocomplete="new-password" minlength="6" required></label>
    <label>Wiederholen<input type="password" name="p2" autocomplete="new-password" required></label>
    <p class="error" id="passErr"></p>
    <div class="dlg-actions"><button class="pill sm" value="cancel">Abbrechen</button><button class="pill sm primary" value="ok">Verschlüsseln</button></div>`,
  fd => {
    const a = String(fd.get('p1')), b = String(fd.get('p2'));
    if (a.length < 6) { $('#passErr').textContent = 'Mindestens 6 Zeichen.'; return false; }
    if (a !== b) { $('#passErr').textContent = 'Stimmt nicht überein.'; return false; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    deriveKey(a, salt).then(key => { vault = { key, salt }; settings.lock = true; saveSettings(); persist(); renderSettings(); toast('Verschlüsselung aktiv.'); });
  });
  dlg.addEventListener('close', renderSettings, { once: true });
}

/* ========== Seiten-Editor ========== */
const pageDlg = $('#pageDlg');
let curPage = null;
function newPage(title = '', body = '') {
  const p = { id: uid(), title, icon: '📄', body, tags: [], pinned: false, updated: Date.now(), created: Date.now() };
  state.pages.unshift(p); save(); renderPages(); return p;
}
function slug(t) { return (t || 'Seite').replace(/[\\/:*?"<>|#]/g, '').trim().slice(0, 80) || 'Seite'; }
function openPage(id) {
  const p = state.pages.find(x => x.id === id); if (!p) return;
  curPage = p;
  const mode = settings.edMode;
  pageDlg.innerHTML = `<div class="editor">
    <div class="ed-head">
      <button class="icon-btn" data-ed="close" aria-label="Schließen">✕</button>
      <span class="ed-status grow" id="edStatus">${p.syncedAt ? 'In iCloud gesichert' : 'Lokal'}</span>
      <div class="seg">${[['write', 'Schreiben'], ['split', 'Geteilt'], ['read', 'Lesen']].map(([v, l]) => `<button data-ed="mode" data-v="${v}" class="${mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="icon-btn" data-ed="pin" aria-label="Anheften" aria-pressed="${p.pinned}">${p.pinned ? '📌' : '📍'}</button>
      <button class="icon-btn" data-ed="more" aria-label="Mehr">⋯</button>
    </div>
    <div class="ed-meta"><input class="ed-icon" id="edIcon" value="${esc(p.icon)}" maxlength="4" aria-label="Symbol"><input class="ed-title" id="edTitle" value="${esc(p.title)}" placeholder="Ohne Titel" aria-label="Titel"></div>
    <input class="ed-tags" id="edTags" value="${esc(pageTags(p).map(t => '#' + t).join(' '))}" placeholder="#tags hinzufügen" aria-label="Tags">
    <div class="ed-tools">
      ${[['h1', 'H1'], ['h2', 'H2'], ['b', 'B'], ['i', 'I'], ['s', 'S'], ['hl', '==='], ['ul', '•'], ['todo', '☐'], ['ol', '1.'], ['q', '❝'], ['code', '</>'], ['link', '🔗'], ['wiki', '[[ ]]'], ['hr', '—'], ['date', '📅']].map(([k, l]) => `<button data-tool="${k}" type="button">${esc(l)}</button>`).join('')}
    </div>
    <div class="ed-area ${mode}" id="edArea">
      <textarea id="edBody" placeholder="Schreib los … Markdown wird unterstützt: # Überschrift, - [ ] Aufgabe, **fett**, [[Seite]]" spellcheck="true">${esc(p.body)}</textarea>
      <div class="md" id="edPreview"></div>
    </div>
  </div>`;
  pageDlg.showModal();
  updatePreview();
  if (!p.body && !isIOS) $('#edTitle').focus();
}
function updatePreview() { if (curPage) $('#edPreview').innerHTML = MD.render(curPage.body) || '<p class="muted">Leer</p>'; }
let edT;
function touchPage() {
  curPage.updated = Date.now(); curPage.syncedAt = null;
  const st = $('#edStatus'); if (st) st.textContent = 'Gespeichert · lokal';
  clearTimeout(edT); edT = setTimeout(() => { save(); renderPages(); renderToday(); }, 400);
}
pageDlg.addEventListener('input', e => {
  if (!curPage) return;
  if (e.target.id === 'edBody') { curPage.body = e.target.value; updatePreview(); }
  if (e.target.id === 'edTitle') curPage.title = e.target.value;
  if (e.target.id === 'edIcon') curPage.icon = e.target.value;
  if (e.target.id === 'edTags') curPage.tags = (e.target.value.match(/#?[\wäöüÄÖÜß-]+/g) || []).map(t => t.replace(/^#/, '')).slice(0, 20);
  touchPage();
});
// Listen beim Enter fortsetzen
pageDlg.addEventListener('keydown', e => {
  if (e.target.id !== 'edBody' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const ta = e.target, pos = ta.selectionStart, v = ta.value;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1, line = v.slice(lineStart, pos);
  const m = line.match(/^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)[.)] |> )/);
  if (!m) return;
  e.preventDefault();
  if (line.trim() === m[2].trim()) { ta.setRangeText('', lineStart, pos, 'end'); }
  else {
    let pre = m[1] + m[2];
    if (/\[[xX]\]/.test(pre)) pre = pre.replace(/\[[xX]\]/, '[ ]');
    if (m[3]) pre = m[1] + (+m[3] + 1) + m[2].slice(m[3].length);
    ta.setRangeText('\n' + pre, pos, ta.selectionEnd, 'end');
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
function tool(k) {
  const ta = $('#edBody'); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  const wrap = (a, b = a, ph = 'Text') => { ta.setRangeText(a + (sel || ph) + b, s, e, 'select'); if (!sel) { ta.selectionStart = s + a.length; ta.selectionEnd = s + a.length + ph.length; } };
  const prefix = p => { ta.setRangeText(p, lineStart, lineStart, 'end'); };
  const map = {
    h1: () => prefix('# '), h2: () => prefix('## '), ul: () => prefix('- '), todo: () => prefix('- [ ] '), ol: () => prefix('1. '), q: () => prefix('> '),
    b: () => wrap('**'), i: () => wrap('*'), s: () => wrap('~~'), hl: () => wrap('=='),
    code: () => sel.includes('\n') ? wrap('```\n', '\n```', 'code') : wrap('`', '`', 'code'),
    link: () => wrap('[', '](https://)', 'Link'), wiki: () => wrap('[[', ']]', 'Seite'),
    hr: () => ta.setRangeText('\n---\n', s, e, 'end'),
    date: () => ta.setRangeText(new Date().toLocaleDateString(DE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), s, e, 'end'),
  };
  map[k] && map[k]();
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
pageDlg.addEventListener('click', e => {
  const t = e.target.closest('[data-tool]'); if (t) return tool(t.dataset.tool);
  const cb = e.target.closest('#edPreview input[type=checkbox]');
  if (cb) { curPage.body = MD.toggleTask(curPage.body, +cb.dataset.line); $('#edBody').value = curPage.body; updatePreview(); touchPage(); return; }
  const w = e.target.closest('a.wiki');
  if (w) { e.preventDefault(); const name = w.dataset.wiki; let p = state.pages.find(x => x.title.toLowerCase() === name.toLowerCase()); if (!p) p = newPage(name); pageDlg.close(); setTimeout(() => openPage(p.id), 50); return; }
  const b = e.target.closest('[data-ed]'); if (!b) return;
  const a = b.dataset.ed;
  if (a === 'close') pageDlg.close();
  if (a === 'mode') { settings.edMode = b.dataset.v; saveSettings(); $('#edArea').className = 'ed-area ' + b.dataset.v; $$('[data-ed=mode]', pageDlg).forEach(x => x.classList.toggle('on', x === b)); }
  if (a === 'pin') { curPage.pinned = !curPage.pinned; b.textContent = curPage.pinned ? '📌' : '📍'; b.setAttribute('aria-pressed', curPage.pinned); save(); renderPages(); renderToday(); }
  if (a === 'more') pageMore();
});
pageDlg.addEventListener('close', () => { if (curPage) { if (!curPage.title && !curPage.body) state.pages = state.pages.filter(p => p !== curPage); save(); renderPages(); renderToday(); } curPage = null; });
function pageMore() {
  const p = curPage;
  const name = p.file || slug(p.title) + '.md';
  const menu = document.createElement('div');
  menu.className = 'dlg-actions';
  menu.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--line);justify-content:flex-start';
  menu.innerHTML = `<button class="pill sm" data-m="icloud">In iCloud Drive sichern (${esc(name)})</button><button class="pill sm" data-m="note">Als Apple Notiz</button><button class="pill sm" data-m="copy">Markdown kopieren</button><button class="pill sm" data-m="dup">Duplizieren</button><button class="pill sm danger" data-m="del">Löschen</button>`;
  const old = $('.page-more', pageDlg); if (old) { old.remove(); return; }
  menu.classList.add('page-more');
  $('.ed-head', pageDlg).after(menu);
  menu.addEventListener('click', ev => {
    const m = ev.target.closest('[data-m]'); if (!m) return;
    const k = m.dataset.m; menu.remove();
    if (k === 'icloud') {
      const text = `# ${p.title || 'Ohne Titel'}\n\n${p.tags.length ? p.tags.map(t => '#' + t).join(' ') + '\n\n' : ''}${p.body}`;
      state.outbox = state.outbox.filter(o => !(o.type === 'file.save' && o.payload.name === name));
      p.file = name; queue('file.save', { name, text, pageId: p.id }); toast('Vorgemerkt – wird beim nächsten „An Apple senden“ gespeichert.', 'Jetzt senden', syncWrite);
    }
    if (k === 'note') { queue('note.create', { title: p.title || 'Ohne Titel', body: p.body }); toast('Notiz vorgemerkt.', 'Jetzt senden', syncWrite); }
    if (k === 'copy') { navigator.clipboard.writeText(p.body).then(() => toast('Kopiert ✓'), () => toast('Kopieren nicht möglich')); }
    if (k === 'dup') { const c = newPage(p.title + ' (Kopie)', p.body); c.icon = p.icon; c.tags = p.tags.slice(); save(); pageDlg.close(); setTimeout(() => openPage(c.id), 50); }
    if (k === 'del' && confirm('Seite löschen? (Nur lokal, iCloud-Datei bleibt)')) { state.pages = state.pages.filter(x => x !== p); curPage = null; save(); pageDlg.close(); renderPages(); renderToday(); }
  });
}

/* ========== Events ========== */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) closeMenu();
  const a = e.target.closest('[data-act]');
  if (!a || a.tagName === 'INPUT') return;
  const act = a.dataset.act, id = a.dataset.id;
  const R = () => state.data.reminders.find(r => r.id === id);
  switch (act) {
    case 'top': e.preventDefault(); scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); break;
    case 'menu': toggleMenu(); break;
    case 'theme': {
      const cur = document.documentElement.dataset.theme;
      settings.theme = cur === 'dark' ? 'light' : 'dark'; saveSettings(); applySettings(); if (state) renderSettings(); break;
    }
    case 'sync': syncWrite(); break;
    case 'outbox': outboxDialog(); break;
    case 'quick': quickDialog(); break;
    case 'goto': if (a.dataset.f) { settings.remFilter = a.dataset.f; settings.remList = ''; saveSettings(); renderReminders(); } $('#' + a.dataset.to).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); break;
    case 'toggleRem': { const r = R(); if (r) queue('reminder.update', { match: { title: r.title, list: r.list }, done: !r.done }); break; }
    case 'editRem': { const r = R(); if (r) remDialog(r); break; }
    case 'remList': settings.remList = a.dataset.l; if (a.dataset.l && settings.remFilter === 'today') settings.remFilter = 'all'; saveSettings(); renderReminders(); break;
    case 'calDay': { const d = new Date(a.dataset.d); calDay = calDay && sameDay(calDay, d) ? null : d; renderCalendar(); break; }
    case 'newEvent': eventDialog(); break;
    case 'viewEvent': { const ev = state.data.events.find(x => x.id === id); if (ev) viewEvent(ev); break; }
    case 'newNote': noteDialog(); break;
    case 'viewNote': { const n = state.data.notes.find(x => x.id === id); if (n) viewNote(n); break; }
    case 'viewFile': { const f = state.data.files.find(x => x.id === id); if (f) viewFile(f); break; }
    case 'newPage': openPage(newPage().id); break;
    case 'openPage': openPage(id); break;
    case 'pageTag': pageTagFilter = a.dataset.t; renderPages(); break;
    case 'setSeg': {
      const k = a.dataset.k, v = a.dataset.v; settings[k] = v; saveSettings(); applySettings(); renderSettings(); break;
    }
    case 'accent': settings.accent = a.dataset.c; saveSettings(); applySettings(); renderSettings(); break;
    case 'move': {
      const o = settings.order, i = o.indexOf(a.dataset.k), j = i + +a.dataset.dir;
      if (j < 0 || j >= o.length) break;
      [o[i], o[j]] = [o[j], o[i]]; saveSettings(); layout(); renderSettings(); break;
    }
    case 'clipImport': clipImport(); break;
    case 'pasteImport': pasteDialog(); break;
    case 'demo': if (!state.data.syncedAt || confirm('Aktuelle Apple-Daten durch Demo-Daten ersetzen?')) loadDemo(); break;
    case 'lockNow': lockNow(); break;
    case 'export': exportBackup(); break;
    case 'wipe':
      if (confirm('Alle lokalen Daten (Seiten, Cache, Einstellungen) auf diesem Gerät löschen? Deine Apple-Daten bleiben unberührt.')) {
        LS.del('hub.state'); LS.del('hub.settings'); location.reload();
      }
      break;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'toggleSec') {
    const k = t.dataset.k;
    settings.hidden = t.checked ? settings.hidden.filter(x => x !== k) : [...settings.hidden, k];
    saveSettings(); layout(); return;
  }
  if (t.dataset.act === 'lockToggle') {
    if (t.checked) { t.checked = false; passDialog(); }
    else if (confirm('Verschlüsselung ausschalten? Daten werden unverschlüsselt gespeichert.')) { settings.lock = false; vault = null; saveSettings(); persist(); renderSettings(); }
    else t.checked = true;
    return;
  }
  if (t.id === 'importFile' && t.files[0]) { importBackup(t.files[0]); t.value = ''; return; }
  const k = t.dataset.set; if (!k) return;
  let v = t.type === 'checkbox' ? t.checked : t.type === 'range' || t.type === 'number' ? +t.value : t.value;
  if (k === 'days') v = Math.max(1, Math.min(90, v || 14));
  if (k === 'autolock') v = Math.max(0, Math.min(120, v || 0));
  settings[k] = v; saveSettings(); applySettings();
  if (['name', 'heroLead'].includes(k)) renderHero();
  if (k === 'days') renderCalendar();
  if (k === 'showDoneInAll') renderReminders();
  if (k === 'accent') renderSettings();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'range' && t.dataset.set) { settings[t.dataset.set] = +t.value; applySettings(); }
  if (t.id === 'remSearch') renderReminders();
  if (t.id === 'noteSearch') renderNotes();
  if (t.id === 'fileSearch') renderFiles();
  if (t.id === 'pageSearch') renderPages();
});
$('#remFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.remFilter = b.dataset.f; saveSettings(); renderReminders(); });
$('#remQuick').addEventListener('submit', e => {
  e.preventDefault();
  const inp = $('#remQuickInput'), v = inp.value.trim(); if (!v) return;
  const q = parseQuick(v); if (!q.title) return;
  const list = q.list || settings.remList || '';
  queue('reminder.add', { title: q.title, list, due: stamp(q.due), dueISO: q.due, notes: '', priority: q.priority });
  inp.value = '';
  toast(`„${q.title}“${q.due ? ' · ' + relDay(q.due) + (hasTime(q.due) ? ' ' + fmt.time(q.due) : '') : ''} vorgemerkt`, 'Senden', syncWrite);
});

/* Menü */
function toggleMenu(force) {
  const m = $('#mobileMenu'), b = $('.burger');
  const open = force != null ? force : !m.classList.contains('open');
  m.classList.toggle('open', open); b.setAttribute('aria-expanded', open);
}
function closeMenu() { toggleMenu(false); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/* Toast */
let toastT;
function toast(msg, actionLabel, action, ms = 3800) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) $('button', t).onclick = () => { t.classList.remove('show'); action(); };
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* Backup */
function exportBackup() {
  const data = { app: 'hub', v: 1, exported: new Date().toISOString(), settings, pages: state.pages };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup enthält deine Seiten unverschlüsselt – sicher aufbewahren.');
}
function importBackup(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'hub') throw 0;
      const pages = (Array.isArray(d.pages) ? d.pages : []).filter(p => p && typeof p.id === 'string').map(p => ({
        id: p.id, title: String(p.title || ''), icon: String(p.icon || '📄').slice(0, 4), body: String(p.body || ''), tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 20) : [],
        pinned: !!p.pinned, updated: +p.updated || Date.now(), created: +p.created || Date.now(), file: p.file ? String(p.file) : undefined,
      }));
      const known = new Set(state.pages.map(p => p.id));
      state.pages = state.pages.concat(pages.filter(p => !known.has(p.id)));
      if (d.settings && confirm('Auch Einstellungen übernehmen?')) { const keep = settings.lock; settings = Object.assign({}, DEFAULTS, d.settings, { lock: keep }); saveSettings(); applySettings(); layout(); }
      save(); renderAll(); toast(`${pages.length} Seiten importiert.`);
    } catch { toast('Ungültige Backup-Datei.'); }
  };
  r.readAsText(file);
}

/* Cursor */
let cursorOn = false;
function setupCursor() {
  const want = settings.cursor && matchMedia('(pointer: fine)').matches && !reduced();
  document.body.classList.toggle('has-cursor', want);
  if (!want || cursorOn) return;
  cursorOn = true;
  const dot = $('.cursor-dot'), ring = $('.cursor-ring');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px)`; }, { passive: true });
  addEventListener('pointerover', e => ring.classList.toggle('hover', !!e.target.closest('a,button,label,input,textarea,select,[data-act]')));
  (function loop() { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(loop); })();
}

/* Auto-Sperre & Rückkehr vom Kurzbefehl */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); persist(); return; }
  if (settings.lock && settings.autolock > 0 && state && Date.now() - hiddenAt > settings.autolock * 60e3) { lockNow(); return; }
  if (state) { renderHero(); offerClipboard(); }
});
addEventListener('pagehide', persist);

/* Demo */
function loadDemo() {
  const t = startOfDay(new Date()), at = (d, h, m = 0) => { const x = addDays(t, d); x.setHours(h, m); return x.toISOString(); };
  state.data = normalize({
    ts: new Date().toISOString(),
    reminders: [
      { title: 'Steuerunterlagen sortieren', list: 'Privat', due: at(-1, 18), priority: 2 },
      { title: 'Milch & Hafer kaufen', list: 'Einkauf', due: at(0, 17) },
      { title: 'Paket zurückschicken', list: 'Privat', due: at(0, 12), notes: 'Retourenschein liegt im Flur' },
      { title: 'Präsentation finalisieren', list: 'Arbeit', due: at(1, 10), priority: 3 },
      { title: 'Zahnarzttermin vereinbaren', list: 'Privat', due: at(3, 9) },
      { title: 'Buch für Lesekreis', list: 'Privat' },
      { title: 'Feedback an Team', list: 'Arbeit', due: at(-2, 9), done: true },
    ],
    events: [
      { title: 'Stand-up', calendar: 'Arbeit', start: at(0, 9, 30), end: at(0, 9, 45) },
      { title: 'Mittag mit Lea', calendar: 'Privat', location: 'Café Mitte', start: at(0, 12, 30), end: at(0, 13, 30) },
      { title: 'Laufen', calendar: 'Privat', start: at(0, 19), end: at(0, 20) },
      { title: 'Design-Review', calendar: 'Arbeit', start: at(1, 14), end: at(1, 15, 30) },
      { title: 'Geburtstag Mama', calendar: 'Familie', start: at(4, 0), end: at(4, 23, 59), allDay: true },
    ],
    notes: [
      { title: 'Ideen Wochenende', body: 'Ideen Wochenende\nWanderung am See\nFlohmarkt Samstag\nNeues Rezept testen', folder: 'Notizen', modified: at(0, 8) },
      { title: 'Packliste Urlaub', body: 'Packliste Urlaub\nPass, Ladekabel, Sonnencreme, Kamera', folder: 'Reisen', modified: at(-3, 20) },
    ],
    files: [
      { name: 'Wochenplan.md', ext: 'md', size: 820, modified: at(-1, 10), text: '# Wochenplan\n\n- [x] Montag: Sport\n- [ ] Mittwoch: Meeting vorbereiten\n- [ ] Freitag: **Abendessen** mit Freunden' },
      { name: 'Rechnung-Oktober.pdf', ext: 'pdf', size: 184320, modified: at(-6, 15) },
    ],
  });
  if (!state.pages.length) {
    const p = newPage('Willkommen', '## So funktioniert dein Hub\n\n- [x] Hub zum Home-Bildschirm hinzufügen\n- [ ] Kurzbefehle **Hub Sync** und **Hub Write** anlegen\n- [ ] Unter *Anpassen* Farben & Layout wählen\n\n> Tipp: Verlinke Seiten mit [[Ideen]] und nutze #tags.\n\n---\n\nSeiten sind lokal gespeichert und lassen sich über ⋯ als `.md` in iCloud Drive sichern.');
    p.icon = '👋'; p.pinned = true; p.tags = ['start'];
  }
  save(); renderAll(); toast('Demo-Daten geladen.');
}

/* ========== Start ========== */
function start() {
  layout();
  renderAll();
  readIncoming();
  if (!sessionStorage.getItem('hub.seen') && state.awaiting) offerClipboard();
  try { sessionStorage.setItem('hub.seen', '1'); } catch {}
}
function boot() {
  applySettings();
  $('#footYear').textContent = `© ${new Date().getFullYear()} ${settings.brand || 'Hub'}. Made with intention.`;
  const raw = LS.get('hub.state', null);
  if (raw && raw.enc) {
    if (!cryptoOK()) { showLock('Entschlüsselung braucht HTTPS.'); return; }
    layout(); showLock(); return;
  }
  state = Object.assign(EMPTY(), raw || {});
  state.data = Object.assign(EMPTY().data, state.data);
  if (settings.lock && !vault) { settings.lock = false; saveSettings(); }
  start();
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
