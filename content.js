// İzole dünyada çalışır.
//  1) inject.js'ten gelen oturumu storage'a yazar.
//  2) Service worker'ı canlı tutar.
//  3) EA Web App'in sol menüsünün EN ALTINA "GALERİ" sekmesi ekler; tıklanınca ana ekranda panel açar.
const SRC = 'fc-galeri';
const PANEL_SRC = 'fcg-panel';
const TAB_ID = 'fcg-tab';
const DOCK_ID = 'fcg-dock';
const PANEL_ID = 'fcg-panel';

// ------------------------------------------------------------------ 1) Oturum yakalama
let lastKey = '';
let lastWrite = 0;

function onSessionMessage(payload) {
  const { sid, headers, baseUrl } = payload || {};
  if (!sid) return;
  const key = JSON.stringify([sid, headers, baseUrl]);
  if (key === lastKey && Date.now() - lastWrite < 60000) return;
  lastKey = key;
  lastWrite = Date.now();
  const session = { sid, headers: headers || {}, baseUrl: baseUrl || null, capturedAt: Date.now() };
  try { chrome.storage.local.set({ session }); } catch (_) {}
}

// ------------------------------------------------------------------ 2) Keepalive
// Sayfa bfcache'e girince port kapatılır, geri dönünce yeniden açılır (aksi halde "Unchecked runtime.lastError").
let kaPort = null;
let kaTimer = null;
function closeKeepAlive() {
  clearInterval(kaTimer);
  const p = kaPort;
  kaPort = null;
  try { p?.disconnect(); } catch (_) {}
}
function connectKeepAlive() {
  if (kaPort || document.visibilityState === 'prerender') return;
  try {
    const port = chrome.runtime.connect({ name: 'keepalive' });
    kaPort = port;
    kaTimer = setInterval(() => { try { port.postMessage({ t: Date.now() }); } catch (_) { closeKeepAlive(); } }, 20000);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;           // hatayı "okundu" say
      if (kaPort !== port) return;             // bilerek kapattık
      closeKeepAlive();
      setTimeout(connectKeepAlive, 2000);
    });
  } catch (_) {}
}
addEventListener('pagehide', closeKeepAlive);
addEventListener('pageshow', (e) => { if (e.persisted) connectKeepAlive(); });
connectKeepAlive();

// ------------------------------------------------------------------ 3) Sol menü sekmesi + panel
let panelOpen = false;
let iframeLoaded = false;
let readyTimer = null;

const NAV_SELECTORS = ['nav.ut-tab-bar', '.ut-tab-bar', '.ut-tab-bar-view', 'nav[class*="tab-bar"]'];

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el[k] = v;
  }
  for (const c of [].concat(children)) el.appendChild(c);
  return el;
}

function findNav() {
  for (const sel of NAV_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.querySelector('.ut-tab-bar-item, button, a')) return el;
  }
  return null;
}

// Galeri ikonu: üst üste üç kart
function galleryIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'fcg-icon');
  const card = (x, y, rot, fill) => {
    const r = document.createElementNS(NS, 'rect');
    Object.entries({ x, y, width: 9, height: 13, rx: 1.6, transform: `rotate(${rot} ${x + 4.5} ${y + 6.5})`, fill, stroke: 'currentColor', 'stroke-width': 1.4 })
      .forEach(([k, v]) => r.setAttribute(k, v));
    return r;
  };
  svg.append(card(3, 6, -14, 'none'), card(12, 6, 14, 'none'), card(7.5, 4, 0, 'rgba(47,208,138,.25)'));
  return svg;
}

function buildTabItem(sample) {
  const base = sample ? sample.className : 'ut-tab-bar-item';
  const cls = base.replace(/\bicon-[\w-]+\b/g, '').replace(/\b(selected|active)\b/g, '').replace(/\s+/g, ' ').trim();
  const el = h(sample ? sample.tagName.toLowerCase() : 'button', { id: TAB_ID, class: `${cls} fcg-tab`, title: 'Gallery Grab' });
  el.appendChild(galleryIcon());
  el.appendChild(h('span', { class: 'fcg-lbl', text: 'GALLERY' }));
  return el;
}

function ensureEntry() {
  const nav = findNav();
  let tab = document.getElementById(TAB_ID);

  if (nav) {
    document.getElementById(DOCK_ID)?.remove();
    const sample = nav.querySelector(`.ut-tab-bar-item:not(#${TAB_ID}):not([id^="fc27-"])`);
    const host = sample ? sample.parentElement : nav;
    if (tab && tab.parentElement !== host) { tab.remove(); tab = null; }
    if (!tab) tab = buildTabItem(sample);
    // Her zaman menünün en altında (Kangal Snip gibi diğer eklenti sekmelerinin de altında)
    if (host.lastElementChild !== tab) host.appendChild(tab);
  } else if (!tab && !document.getElementById(DOCK_ID) && document.body) {
    const d = h('button', { id: DOCK_ID, class: 'fcg-dock', title: 'Gallery Grab' });
    d.appendChild(galleryIcon());
    document.body.appendChild(d);
  }
  syncActive();
}

function syncActive() {
  [document.getElementById(TAB_ID), document.getElementById(DOCK_ID)].filter(Boolean)
    .forEach((e) => e.classList.toggle('fcg-active', panelOpen));
}

function openExternal() {
  try { chrome.runtime.sendMessage({ type: 'openPanelTab' }); } catch (_) {}
}

function getPanel() {
  let p = document.getElementById(PANEL_ID);
  if (p) return p;
  const frame = h('iframe', { class: 'fcg-frame', title: 'Gallery Grab' });
  const fallback = h('div', { class: 'fcg-fallback', hidden: true }, [
    h('p', { text: 'Panel bu sayfada gömülü açılamadı (sayfa güvenlik politikası engelliyor olabilir).' }),
    h('button', { class: 'fcg-btn fcg-btn-primary', text: 'Paneli yeni sekmede aç', onclick: openExternal }),
  ]);
  const bar = h('div', { class: 'fcg-bar' }, [
    h('span', { class: 'fcg-title' }, [galleryIcon(), h('b', { text: 'GALLERY GRAB' })]),
    h('span', { class: 'fcg-spacer' }),
    h('button', { class: 'fcg-btn', text: 'Ayrı sekmede aç', onclick: openExternal }),
    h('button', { class: 'fcg-btn', text: '✕', title: 'Kapat', onclick: () => setOpen(false) }),
  ]);
  p = h('div', { id: PANEL_ID, class: 'fcg-panel', hidden: true }, [bar, h('div', { class: 'fcg-body' }, [frame, fallback])]);
  document.body.appendChild(p);
  return p;
}

function loadFrame(p) {
  if (iframeLoaded) return;
  iframeLoaded = true;
  p.querySelector('.fcg-frame').src = chrome.runtime.getURL('popup.html?embedded=1');
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => { p.querySelector('.fcg-fallback').hidden = false; }, 5000);
}

function position() {
  const p = document.getElementById(PANEL_ID);
  if (!p) return;
  let left = 0, top = 0, bottom = 0;
  const nav = findNav();
  const tab = document.getElementById(TAB_ID);
  if (nav && tab && nav.contains(tab)) {
    const r = nav.getBoundingClientRect();
    if (r.height >= r.width) left = Math.round(r.right);               // dikey sol menü
    else if (r.top < window.innerHeight / 2) top = Math.round(r.bottom); // üstte yatay menü
    else bottom = Math.round(window.innerHeight - r.top);              // altta yatay menü
  } else if (document.getElementById(DOCK_ID)) {
    left = 52;
  }
  p.style.setProperty('--fcg-left', `${left}px`);
  p.style.setProperty('--fcg-top', `${top}px`);
  p.style.setProperty('--fcg-bottom', `${bottom}px`);
}

function setOpen(open) {
  panelOpen = open;
  const p = getPanel();
  if (open) { position(); loadFrame(p); }
  p.hidden = !open;
  syncActive();
}

// Menü tıklamaları (capture: EA'nın kendi yönlendirmesinden önce yakala)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest(`#${TAB_ID}, #${DOCK_ID}`)) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!panelOpen);
    return;
  }
  // Başka bir menü sekmesine (EA'nın ya da Kangal Snip'in) geçilirse paneli kapat
  if (panelOpen && t.closest('.ut-tab-bar-item, .ut-tab-bar button, nav[class*="tab-bar"] button, #fc27-dock')) setOpen(false);
}, true);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) setOpen(false); });
window.addEventListener('resize', () => { if (panelOpen) position(); });

// EA Web App menüyü yeniden çizdiği için sekmeyi sürekli doğrula
let scheduled = false;
function scheduleEnsure() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; ensureEntry(); if (panelOpen) position(); }, 300);
}
function initUI() {
  ensureEntry();
  new MutationObserver(scheduleEnsure).observe(document.body, { childList: true, subtree: true });
}
if (document.body) initUI();
else document.addEventListener('DOMContentLoaded', initUI, { once: true });

// ------------------------------------------------------------------ Mesaj köprüsü
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || typeof d !== 'object') return;
  if (ev.source === window && d.source === SRC && d.type === 'session') return onSessionMessage(d.payload);
  if (d.source === PANEL_SRC && d.type === 'ready') {
    const p = document.getElementById(PANEL_ID);
    if (!p || ev.source !== p.querySelector('.fcg-frame')?.contentWindow) return;
    clearTimeout(readyTimer);
    p.querySelector('.fcg-fallback').hidden = true;
  }
});
