// ==UserScript==
// @name         Gallery Grab
// @namespace    https://github.com/JosephWRLD/gallery-grab
// @version      2.2.3
// @description  FC Web App: FUT Galeri setleri, notlar, fut.gg çözümleri, token planlayıcı ve eksik kartları alma; oyuncu listesinden en ucuz kart alma
// @author       JosephWRLD — Discord: yusuflnx
// @license      PolyForm-Noncommercial-1.0.0 (ticari kullanım/satış yasak)
// @homepageURL  https://github.com/JosephWRLD/gallery-grab
// @supportURL   https://github.com/JosephWRLD/gallery-grab/issues
// @match        https://www.ea.com/*/ultimate-team/web-app/*
// @match        https://www.easports.com/*/ultimate-team/web-app/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js
// @downloadURL  https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js
// ==/UserScript==

/* Eklenti sürümünün (MV3) userscript'e taşınmış hâli. Fark: her şey sayfa bağlamında
   çalıştığı için service worker, content script köprüsü ve iframe paneli yok.
   Alım döngüsü yalnız bu sekme açıkken sürer. */

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------------------------------------------------------------- yardımcılar
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  let LOC = 'tr-TR';   // Galeri dil seçimine göre (en → en-GB)
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString(LOC));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const PROBE_MAX = 5;   // en ucuzu bulmak için en fazla arama
  const PAGE_MAX = 3;    // tam sürüm aranırken aynı fiyat aralığında bakılan en fazla sayfa
  const RETRY_MAX = 3;   // ilan başkası tarafından alınırsa yeniden deneme
  const META_TTL = 7 * 24 * 60 * 60 * 1000;
  const META_V = 3;
  const CONTACT = 'yusuflnx';   // sorun/öneri için Discord kullanıcı adı

  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el[k] = v;
    }
    for (const c of [].concat(children)) if (c) el.append(c);
    return el;
  }

  // ---------------------------------------------------------------- depolama (GM, yoksa localStorage)
  const store = {
    get(key, def) {
      try {
        const v = GM_getValue(key, undefined);
        return v === undefined ? def : v;
      } catch (_) {
        try { const s = localStorage.getItem('fcg_' + key); return s == null ? def : JSON.parse(s); } catch (__) { return def; }
      }
    },
    set(key, val) {
      try { GM_setValue(key, val); } catch (_) {
        try { localStorage.setItem('fcg_' + key, JSON.stringify(val)); } catch (__) {}
      }
    },
  };

  let list = store.get('list', []);
  // galleryBudget / maxCard: Galeri'ye ayrı bütçe ve kart başına en fazla (lib'deki MAX_CARD_DEFAULT = 0 = yok;
  // lib aşağıda gömülü olduğu için burada sabit adı kullanılamıyor)
  const settings = { budget: 0, skipOwned: false, expectClub: null, galleryBudget: 0, maxCard: 0, afterBuy: 'relist', relist: { base: 'paid', pct: 0, dur: 3600 }, ...store.get('settings', {}) };
  const club = { ids: new Set(store.get('clubBaseIds', [])), at: store.get('clubScanAt', 0), fetched: store.get('clubFetched', 0), total: store.get('clubTotal', null) };
  const run = { running: false, spent: store.get('spent', 0), coins: null, text: '', level: 'idle' };

  // 2.1.5: eski varsayılan 50.000 (değiştirilmemiş) → 0; bir kez çalışır
  if (!settings.maxCardV2) {
    if (settings.maxCard === 50000) settings.maxCard = 0;
    settings.maxCardV2 = true;
    store.set('settings', settings);
  }
  const saveList = () => { store.set('list', list); render(); };
  const saveSettings = () => { store.set('settings', settings); render(); };
  const setSpent = (v) => { run.spent = v; store.set('spent', v); render(); };
  // my verilirse: görev durdurulmuş / yenisi başlamışsa eski görevin mesajı yeni durumu ezmesin
  const status = (text, level = 'ok', my = null) => { if (my != null && my !== token) return; run.text = text; run.level = level; render(); };
  const item = (id) => list.find((x) => x.id === id);
  function patchItem(id, p) { const it = item(id); if (it) { Object.assign(it, p); saveList(); } }

  // Ciddi hata bildiriminde iletişim bilgisi de görünsün.
  const fail = (why) => notify('Gallery Grab durdu', `${why}\nSorun sürerse yaz: Discord ${CONTACT}`);

  function notify(title, text) {
    try { GM_notification({ title, text, timeout: 8000 }); } catch (_) { console.log('[Gallery Grab]', title, text); }
  }

  // ---------------------------------------------------------------- oturum
  // Web App'in kendi UT isteklerinden X-UT-SID ve ek başlıkları yakala (eklentideki inject.js ile aynı).
  const session = { sid: null, headers: {}, baseUrl: null };
  const IGNORED = new Set(['content-type', 'accept', 'x-http-method-override']);
  const baseFrom = (u) => { const m = String(u).match(/^(https?:\/\/[^/]+\/ut\/game\/[^/?#]+)/); return m ? m[1] : null; };

  (function captureSession() {
    try {
      const X = W.XMLHttpRequest;
      const xOpen = X.prototype.open;
      const xSet = X.prototype.setRequestHeader;
      const xSend = X.prototype.send;
      X.prototype.open = function (method, url, ...rest) { this.__fcg = { url, headers: {} }; return xOpen.call(this, method, url, ...rest); };
      X.prototype.setRequestHeader = function (k, v) { if (this.__fcg) this.__fcg.headers[k] = v; return xSet.call(this, k, v); };
      X.prototype.send = function (...a) {
        const c = this.__fcg;
        if (c && /\/ut\/game\//.test(String(c.url))) {
          const b = baseFrom(c.url);
          if (b) session.baseUrl = b;
          for (const [k, v] of Object.entries(c.headers)) {
            const lk = k.toLowerCase();
            if (lk === 'x-ut-sid') session.sid = v;
            else if (!IGNORED.has(lk)) session.headers[k] = v;
          }
          if (/\/ut\/game\/[^?]*\/(transfermarket|tradepile|watchlist)\b/.test(String(c.url))) this.addEventListener('load', readCollected);
        }
        return xSend.apply(this, a);
      };
    } catch (e) { console.warn('[Gallery Grab] XHR yakalama kurulamadı', e); }

    // Yedek: Web App'in kendi oturum nesnesi + ağ kayıtları
    setInterval(() => {
      try {
        const id = liveSid();
        if (id && id !== session.sid) session.sid = id;
        if (!session.baseUrl) {
          for (const e of performance.getEntriesByType('resource')) { const b = baseFrom(e.name); if (b) session.baseUrl = b; }
        }
      } catch (_) {}
    }, 4000);
  })();

  // Bazı Web App sürümlerinde (Opera'da görüldü) kart nesnesi isCollected taşımıyor: pazar rozeti için
  // EA'nın ham pazar yanıtından okunur (kart id → isCollected)
  const collected = new Map();
  function readCollected() {
    try {
      const j = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || 'null');
      for (const a of j?.auctionInfo || []) {
        const it = a?.itemData;
        if (it?.id != null && typeof it.isCollected === 'boolean') collected.set(Number(it.id), it.isCollected);
      }
      if (collected.size > 5000) collected.clear();
    } catch (_) {}
  }
  const isCol = (item) => (typeof item?.isCollected === 'boolean' ? item.isCollected : collected.get(Number(item?.id)));

  // FC 27'de alan adı utasSession (eski sürümlerde sessionUtas); getUtasSession() yedek
  function liveSid() { try { return (W.services?.Authentication?.utasSession?.id || W.services?.Authentication?.getUtasSession?.()?.id || W.services?.Authentication?.sessionUtas?.id || null); } catch (_) { return null; } }

  // EA anahtarı arada yeniliyor: önce sayfadaki güncel oturum, yoksa yakalanan
  function sidNow() {
    const live = liveSid();
    if (live) return (session.sid = live);
    if (session.sid) return session.sid;
    return (session.sid = liveSid());
  }

  // ---------------------------------------------------------------- EA API
  class ApiError extends Error {
    constructor(status, body, msg) { super(msg || `HTTP ${status}`); this.status = status; this.body = body; }
  }

  const DEFAULT_BASE = 'https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27';

  const validBase = (u) => /^https:\/\/[a-z0-9.-]+\.ea\.com(:\d+)?\/ut\/game\/[^/?#]+$/i.test(String(u || ''));
  function resolveBase() {
    if (validBase(session.baseUrl)) return session.baseUrl;
    try {
      const l = performance.getEntriesByType('resource');
      for (let i = l.length - 1; i >= 0; i--) { const b = baseFrom(l[i].name); if (validBase(b)) return (session.baseUrl = b); }
    } catch (_) {}
    return DEFAULT_BASE;
  }

  async function call(method, path, opts = {}, retried = false) {
    const sid = sidNow();
    if (!sid) throw new ApiError(401, null, 'Oturum yok: Web App\'e giriş yapın');
    const base = resolveBase();
    let url = base + path;
    if (opts.query) url += '?' + new URLSearchParams(opts.query).toString();
    const headers = { ...session.headers, 'X-UT-SID': sid, Accept: 'application/json' };
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    // UT API çerez değil X-UT-SID ile doğrular; 'include' + ACAO:* CORS'u bozar.
    const init = { method, headers, credentials: 'omit' };
    if (method !== 'GET') init.body = JSON.stringify(opts.body || {});

    let res;
    try { res = await W.fetch(url, init); } catch (e) {
      const hint = base === DEFAULT_BASE ? ' — API adresi yakalanamadı; Transfer Pazarı\'nı açıp tekrar deneyin' : '';
      throw new ApiError(0, String(e), `Bağlantı hatası (${base}): ${String(e).slice(0, 120)}${hint}`);
    }
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }

    // EA anahtarı yenilerken araya giren istek 401 alabilir: kısa bekleyip güncel anahtarla bir kez daha dene
    // Web App'i kendi istemcisiyle küçük bir aramayla dürt: oturumun düştüğünü fark edip yeniden girişini yapsın
    if ((res.status === 401 || res.status === 403) && !retried) {
      try { await conceptPage({ club: 1 }, 0, 1); } catch (_) {}
      await sleep(1500);
      session.sid = liveSid() || session.sid;
      return call(method, path, opts, true);
    }
    if (res.status === 401) throw new ApiError(401, json, 'Oturum geçersiz (401): sayfayı yenileyip giriş yapın, sonra Transfer Pazarı\'nda bir arama yapın');
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, json);
    return json;
  }

  const api = {
    search: ({ maskedDefId, maxb, minb, num = 21, start = 0 }) => {
      const q = { num, start, type: 'player', maskedDefId };
      if (maxb) q.maxb = maxb;
      if (minb) q.minb = minb;
      return call('GET', '/transfermarket', { query: q });
    },
    buyNow: (tradeId, price) => call('PUT', `/trade/${tradeId}/bid`, { body: { bid: price } }),
    club: ({ start = 0, count = 91, sort = 'desc', sortBy = 'value' } = {}) =>
      call('GET', '/club', { query: { start, count, sort, sortBy, type: 'player' } }),
    credits: () => call('GET', '/user/credits'),
    tradepile: () => call('GET', '/tradepile'),
    toTradepile: (itemId) => call('PUT', '/item', { body: { itemData: [{ id: itemId, pile: 'trade' }] } }),
    list: (itemId, startingBid, buyNowPrice, duration = 3600) =>
      call('POST', '/auctionhouse', { body: { itemData: { id: itemId }, startingBid, duration, buyNowPrice } }),
  };

  function parseCoins(r) {
    if (!r) return null;
    if (typeof r.credits === 'number') return r.credits;
    if (Array.isArray(r.credits)) {
      const x = r.credits.find((v) => /coin/i.test(v.type || v.name || '')) || r.credits[0];
      return x?.count ?? x?.amount ?? null;
    }
    if (Array.isArray(r.currencies)) {
      const x = r.currencies.find((v) => /coin/i.test(v.name || ''));
      return x?.finalFunds ?? x?.funds ?? null;
    }
    return null;
  }

  // ---------------------------------------------------------------- fiyat basamakları
  const priceStep = (p) => (p < 1000 ? 50 : p < 10000 ? 100 : p < 50000 ? 250 : p < 100000 ? 500 : 1000);
  const prevPrice = (p) => (p <= 200 ? 150 : p - priceStep(p - 1));

  // ---------------------------------------------------------------- oyuncu veritabanı + sözlükler
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  let db = null;

  function dbUrl() {
    try { for (const e of performance.getEntriesByType('resource')) if (/items\/web\/players\.json/i.test(e.name)) return e.name; } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = String(localStorage.getItem(localStorage.key(i)) || '').match(/https?:\/\/[^"' ]+?players\.json/i);
        if (m) return m[0];
      }
    } catch (_) {}
    return null;
  }

  async function loadDb() {
    if (db) return db;
    const url = dbUrl();
    if (!url) throw new Error('Oyuncu veritabanı yüklenmemiş: Transfer Pazarı → Oyuncu Ara ekranını bir kez açın.');
    const r = await W.fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error(`Oyuncu veritabanı indirilemedi (HTTP ${r.status})`);
    const j = await r.json();
    const rows = Array.isArray(j) ? j : Object.values(j || {}).filter(Array.isArray).flat();
    db = rows.map((p) => {
      const first = String(p.f ?? p.firstName ?? '').trim();
      const last = String(p.l ?? p.lastName ?? '').trim();
      const common = String(p.c ?? p.commonName ?? '').trim();
      const full = [first, last].filter(Boolean).join(' ');
      return {
        id: Number(p.id ?? p.assetId ?? p.baseId ?? p.definitionId ?? 0),
        n: common || full,
        full: full !== (common || full) ? full : '',
        r: Number(p.r ?? p.rating ?? 0) || null,
      };
    }).filter((p) => p.id > 0 && p.n);
    return db;
  }

  async function searchPlayers(term, limit = 20) {
    const q = norm(term);
    if (q.length < 2) return [];
    await loadDb();
    const out = [];
    for (const p of db) {
      const forms = p.full ? [norm(p.n), norm(p.full)] : [norm(p.n)];
      let best = -1;
      for (const f of forms) {
        const i = f.indexOf(q);
        if (i < 0) continue;
        const s = (f === q ? 0 : i === 0 ? 1000 : 2000);
        if (best < 0 || s < best) best = s;
      }
      if (best < 0) continue;
      out.push({ baseId: p.id, name: p.n, fullName: p.full || p.n, rating: p.r, s: best - (p.r || 0) });
      if (out.length >= 600) break;
    }
    out.sort((a, b) => a.s - b.s);
    return out.slice(0, limit).map(({ s, ...p }) => p);
  }

  // Görsel kökü + kulüp/lig/ülke id→isim sözlükleri.
  // teamconfig.json isim içermiyor; isimler yerelleştirme (/loc/) dosyalarında, "...team...<id>" anahtarlarında.
  async function fetchMeta() {
    const res = (() => { try { return performance.getEntriesByType('resource').map((e) => e.name); } catch (_) { return []; } })();
    // Görsel kökü: players.json adresinden; o yüklenmediyse Web App'in yüklediği herhangi bir kart/arma görselinden
    const url = res.find((n) => n.includes('items/web/players.json'));
    const imgUrl = url ? null : res.find((n) => n.includes('/items/images/mobile/'));
    if (!url && !imgUrl) throw new Error('Görsel/isim verisi okunamadı: Transfer Pazarı → Oyuncu Ara ekranını bir kez açın.');
    const imgBase = url
      ? url.split('/items/web/players.json')[0] + '/items/images/mobile'
      : imgUrl.split('/items/images/mobile/')[0] + '/items/images/mobile';

    const locUrls = res.filter((n) => n.includes('/loc/') && n.includes('.json'));
    locUrls.sort((a, b) => (b.includes('/cdn/') ? 1 : 0) - (a.includes('/cdn/') ? 1 : 0));

    const flatten = (o, pre, out, depth) => {
      if (!o || depth > 5 || out.length > 80000) return out;
      for (const [k, v] of Object.entries(o)) {
        const key = pre ? pre + '.' + k : k;
        if (typeof v === 'string') { if (v.trim() && v.length <= 60) out.push([key, v.trim()]); }
        else if (v && typeof v === 'object') flatten(v, key, out, depth + 1);
      }
      return out;
    };
    // Aynı id için birden çok anahtar olabilir (tam ad / kısaltma); kısaltma olmayanı ve uzun olanı seç.
    const put = (map, id, key, val) => {
      const abbr = /abbr|short|initial|3letter|code/i.test(key);
      const prev = map[id];
      if (!prev || (prev.abbr && !abbr) || (prev.abbr === abbr && val.length > prev.v.length)) map[id] = { v: val, abbr };
    };
    const plain = (m) => { const o = {}; for (const [k, x] of Object.entries(m)) o[k] = x.v; return o; };

    // Asıl isim anahtarları binlerce id'yi aynı önekle taşır ("…team…<id>"); "…teamchem…1" gibi tekil
    // metin anahtarları (ör. "Chemistry Points … %1") yalnız baskın önekler kabul edilerek elenir.
    const collect = (pairs, re, exclude) => {
      const byPrefix = new Map();
      for (const [key, val] of pairs) {
        if (!re.test(key) || (exclude && exclude.test(key)) || /[%{}]/.test(val)) continue;
        const m = key.match(/^(.*?)([0-9]+)$/);
        if (!m) continue;
        const p = byPrefix.get(m[1]) || [];
        p.push([m[2], key, val]);
        byPrefix.set(m[1], p);
      }
      const max = Math.max(0, ...[...byPrefix.values()].map((p) => p.length));
      const map = {};
      for (const p of byPrefix.values()) if (p.length >= Math.max(10, max * 0.2)) for (const [id, key, val] of p) put(map, id, key, val);
      return map;
    };

    const meta = { imgBase, teams: {}, leagues: {}, nations: {} };
    let teams = {}, leagues = {}, nations = {};
    try {
      for (const lu of locUrls.slice(0, 4)) {
        let j;
        try { j = await (await W.fetch(lu, { credentials: 'omit' })).json(); } catch (_) { continue; }
        const pairs = flatten(j, '', [], 0);
        teams = collect(pairs, /team|club/i);
        leagues = collect(pairs, /league/i, /team|club/i);
        nations = collect(pairs, /nation|country/i, /team|club|league/i);
        if (Object.keys(teams).length) break;
      }
      meta.teams = plain(teams);
      meta.leagues = plain(leagues);
      meta.nations = plain(nations);
      meta.counts = { teams: Object.keys(meta.teams).length, leagues: Object.keys(meta.leagues).length, nations: Object.keys(meta.nations).length };
      if (!meta.counts.teams) meta.sample = JSON.stringify({ locUrls: locUrls.slice(0, 3) }).slice(0, 400);
    } catch (e) { meta.warn = String(e); }
    return meta;
  }

  let metaCache = store.get('meta', null);
  async function meta() {
    const fresh = metaCache?.imgBase && metaCache.v === META_V && Date.now() - (metaCache.at || 0) < META_TTL;
    if (fresh && Object.keys(metaCache.teams || {}).length) return metaCache;
    const m = await fetchMeta();
    metaCache = { v: META_V, at: Date.now(), ...m };
    store.set('meta', metaCache);
    render();
    return metaCache;
  }
  const metaOrNull = () => meta().catch(() => metaCache || null);

  // EA görsel adresleri: portraits/<baseId>.png, clubs/{light,dark}/<teamId>.png, flags/dark/<nationId>.png
  const imgUrl = (p, id) => (metaCache?.imgBase && id ? `${metaCache.imgBase}/${p}/${id}.png` : null);
  const img = {
    portrait: (id) => imgUrl('portraits', id),
    crest: (id) => imgUrl('clubs/dark', id),
    crestAlt: (id) => imgUrl('clubs/light', id),
    flag: (id) => imgUrl('flags/dark', id),
    league: (id) => imgUrl('leagues/dark', id),
    leagueAlt: (id) => imgUrl('leagues/light', id),
  };

  // Pazar/kulüp item verisinden kulüp, lig, ülke ve mevki çıkarır (sözlük adları ile).
  function enrich(itemData, m) {
    if (!itemData) return {};
    const team = Number(itemData.teamid ?? itemData.teamId ?? 0) || null;
    const league = Number(itemData.leagueId ?? itemData.leagueid ?? 0) || null;
    const nation = Number(itemData.nation ?? itemData.nationId ?? 0) || null;
    const name = (map, id) => (id ? (m?.[map]?.[String(id)] || '#' + id) : null);
    return {
      position: itemData.preferredPosition || null,
      teamId: team, leagueId: league, nationId: nation,
      club: name('teams', team), league: name('leagues', league), nation: name('nations', nation),
    };
  }

  // Görüntülemede adı güncel sözlükten çöz; listede kayıtlı eski/yanlış ad yeniden tarama gerektirmesin.
  const nameOf = (map, id, stored) => (id && metaCache?.[map]?.[String(id)]) || stored || null;
  const clubOf = (x) => nameOf('teams', x.teamId, x.club);

  // ---------------------------------------------------------------- liste işlemleri
  function addPlayers(players) {
    let added = 0;
    for (const p of players) {
      if (!p?.baseId || list.some((x) => x.baseId === p.baseId)) continue;
      list.push({ id: uid(), baseId: p.baseId, name: p.name, rating: p.rating || null, status: 'pending', price: null, note: '' });
      added++;
    }
    saveList();
    return added;
  }

  async function bulkAdd(names) {
    const found = [];
    const missing = [];
    for (const n of names.map((s) => s.trim()).filter(Boolean)) {
      const [best] = await searchPlayers(n, 1);
      if (best) found.push(best); else missing.push(n);
    }
    return { added: addPlayers(found), missing };
  }

  // ---------------------------------------------------------------- alım
  let token = 0;

  const activeBins = (res) => (res?.auctionInfo || [])
    .filter((a) => a.buyNowPrice > 0 && a.tradeId && (!a.tradeState || a.tradeState === 'active'));

  // Tüm versiyonlar arasında en düşük BIN'li ilanı bulur (maxb'yi kademe kademe düşürerek).
  async function findCheapest(baseId) {
    let best = null;
    let hi = 0;
    for (let i = 0; i < PROBE_MAX; i++) {
      const res = await api.search({ maskedDefId: baseId, num: 21, ...(hi > 0 ? { maxb: hi } : {}) });
      const bins = activeBins(res);
      if (!bins.length) break;
      const cand = bins.reduce((m, a) => (a.buyNowPrice < m.buyNowPrice ? a : m));
      if (!best || cand.buyNowPrice < best.buyNowPrice) best = cand;
      if (best.buyNowPrice <= 200) break;
      hi = prevPrice(best.buyNowPrice);
      await sleep(rnd(400, 900));
    }
    return best;
  }

  async function buyOne(it, my) {
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      if (my !== token) return false;
      status(`Aranıyor: ${it.name}${attempt > 1 ? ` (deneme ${attempt})` : ''}`, 'ok', my);
      const a = await findCheapest(it.baseId);
      if (!a) { patchItem(it.id, { status: 'notfound', note: 'Pazarda ilan yok' }); return true; }

      const price = a.buyNowPrice;
      patchItem(it.id, { market: price, marketAt: Date.now(), ...enrich(a.itemData, await metaOrNull()) });
      if (settings.budget > 0 && run.spent + price > settings.budget) {
        patchItem(it.id, { status: 'budget', note: `En ucuz ${fmt(price)} — bütçe yetmedi` });
        return true;
      }
      if (run.coins != null && price > run.coins) {
        patchItem(it.id, { status: 'budget', note: `En ucuz ${fmt(price)} — coin yetersiz` });
        return true;
      }

      await sleep(rnd(300, 800));
      if (my !== token) return false;
      try {
        const r = await api.buyNow(a.tradeId, price);
        const d = r?.auctionInfo?.[0]?.itemData || a.itemData || {};
        setSpent(run.spent + price);
        run.coins = parseCoins(r) ?? (run.coins != null ? run.coins - price : null);
        patchItem(it.id, { status: 'done', price, ...enrich(d, await metaOrNull()), note: d.rating ? `${d.rating} rating` : '' });
        return true;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 460 || e.status === 461)) { await sleep(rnd(600, 1200)); continue; }
        throw e;
      }
    }
    patchItem(it.id, { status: 'error', note: 'İlanlar hep başkası tarafından alındı' });
    return true;
  }

  // Ciddi hatalarda tüm döngü durur; diğerlerinde yalnız o oyuncu "hata" olur.
  function stopReason(e) {
    const s = e?.status;
    const body = typeof e?.body === 'string' ? e.body : JSON.stringify(e?.body || '');
    if (s === 471) return 'Hesapta işlem yasağı/yetki reddi (471)';
    if (s === 494) return 'Transfer pazarı kilitli (494)';
    if (s === 429) return 'Rate limit (429)';
    if (s === 458 || s === 459 || /captcha/i.test(body)) return `Captcha algılandı (${s ?? '?'}) — Web App'te çözün`;
    if (s === 426 || s === 512 || /softban/i.test(body)) return `Softban/servis hatası (${s})`;
    if (s === 401 || s === 403) return L('sr.session', { s });
    return null;
  }

  function handleError(e, it, my) {
    const why = stopReason(e);
    if (why) { fail(why); stop(why, 'error', my); return false; }
    patchItem(it.id, { status: 'error', note: e?.status === 478 ? 'Liste dolu (478)' : `${e?.message || 'Hata'}` });
    return true;
  }

  async function runLoop(my) {
    let bought = 0;
    let netErr = 0;
    while (my === token) {
      const it = list.find((x) => x.status === 'pending');
      if (!it) break;

      if (settings.skipOwned && club.ids.has(it.baseId)) {
        patchItem(it.id, { status: 'owned', note: 'Kulübünde zaten var' });
        continue;
      }
      try {
        if (!(await buyOne(it, my))) return;
        netErr = 0;
        if (item(it.id)?.status === 'done') bought++;
      } catch (e) {
        if (e?.status === 0 && ++netErr >= 3) {
          fail('Art arda bağlantı hatası');
          return stop('Art arda bağlantı hatası', 'error', my);
        }
        if (!handleError(e, it, my)) return;
      }
      await sleep(rnd(1000, 2500));
    }
    if (my !== token) return;
    const skipped = list.filter((x) => ['notfound', 'budget', 'error', 'owned'].includes(x.status)).length;
    const msg = `${bought} kart alındı, ${skipped} atlandı. Toplam harcama: ${fmt(run.spent)} coin`;
    notify('Gallery Grab bitti', msg);
    stop(`Bitti — ${msg}`, 'ok', my);
  }

  // ---------------------------------------------------------------- taramalar
  // Alım yapmadan her oyuncunun en ucuz BIN'ini ve kulüp/lig/ülke bilgisini doldurur.
  async function scanPrices(my) {
    const m = await metaOrNull();
    let n = 0;
    const seen = new Set();
    while (my === token) {
      const stale = (x) => x.marketAt == null
        || Date.now() - x.marketAt > 30 * 60 * 1000
        || String(x.club || '').startsWith('#');   // isim sözlüğü sonradan yüklendiyse tazele
      const it = list.find((x) => x.status !== 'done' && stale(x) && !seen.has(x.id));
      if (!it) break;
      status('Fiyat taranıyor: ' + it.name, 'ok', my);
      try {
        const a = await findCheapest(it.baseId);
        patchItem(it.id, { market: a ? a.buyNowPrice : 0, marketAt: Date.now(), ...enrich(a?.itemData, m) });
        seen.add(it.id);
        n++;
      } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); return stop(why, 'error', my); }
        seen.add(it.id);
        patchItem(it.id, { marketAt: Date.now(), note: 'Fiyat alınamadı: ' + (err?.message || 'hata') });
      }
      await sleep(rnd(900, 2000));
    }
    if (my === token) stop('Fiyat taraması bitti (' + n + ' oyuncu)', 'ok', my);
  }

  // Kulüpteki tüm oyuncuları sayfalayarak çeker, base id kümesini saklar.
  async function scanClub(my) {
    const owned = new Set();
    const COUNT = 91;
    let fetched = 0;
    let total = null;
    let lastFirstId = 0;
    try {
      for (let page = 0, start = 0; page < 80 && my === token; page++) {
        const r = await api.club({ start, count: COUNT });
        const items = r?.itemData || r?.items || [];
        if (total == null) total = Number(r?.totalResults ?? r?.total ?? r?.count ?? NaN) || null;
        for (const x of items) { const a = Number(x.assetId ?? x.assetid ?? x.definitionId ?? 0); if (a) owned.add(a); }
        fetched += items.length;
        start += items.length || COUNT;
        status('Kulüp taranıyor: ' + owned.size + ' oyuncu' + (total ? ' / ' + total + ' kart' : ''), 'ok', my);
        if (!items.length) break;
        if (total != null && fetched >= total) break;
        // Sunucu 'start' parametresini yok sayıyorsa aynı sayfa döner: sonsuz döngüyü engelle.
        const firstId = Number(items[0]?.id ?? items[0]?.assetId ?? 0);
        if (firstId && firstId === lastFirstId) break;
        lastFirstId = firstId;
        await sleep(rnd(600, 1300));
      }
    } catch (err) {
      const why = stopReason(err) || 'Kulüp taraması başarısız';
      fail(why);
      return stop(`${why} (${err?.status ?? ''} ${err?.message || ''})`, 'error', my);
    }
    if (my !== token) return;
    club.ids = owned;
    club.at = Date.now();
    club.fetched = fetched;
    club.total = total;
    store.set('clubBaseIds', [...owned]);
    store.set('clubScanAt', club.at);
    store.set('clubFetched', fetched);
    store.set('clubTotal', total);
    stop(`Kulüpte ${owned.size} farklı oyuncu (${fetched} kart okundu${total ? ' / ' + total : ''})`, 'ok', my);
  }

  function startTask(fn, label) {
    if (!sidNow()) { status('Oturum yok: Web App\'e giriş yapın', 'error'); return; }
    const my = ++token;
    run.running = true;
    status(label, 'ok');
    // Görev beklenmedik hata fırlatırsa "çalışıyor" durumunda takılı kalmasın
    Promise.resolve().then(() => fn(my)).catch((e) => stop(L('bg.taskFail', { e: e?.message || String(e) }), 'error', my));
  }

  async function start() {
    if (!sidNow()) { status('Oturum yok: Web App\'e giriş yapın', 'error'); return; }
    if (!list.some((x) => x.status === 'pending')) { status('Bekleyen oyuncu yok', 'warn'); return; }
    try { run.coins = parseCoins(await api.credits()); } catch (e) { status(`Başlatılamadı: ${e.message}`, 'error'); return; }
    const my = ++token;
    run.running = true;
    status('Başladı', 'ok');
    runLoop(my).catch((e) => stop(L('bg.taskFail', { e: e?.message || String(e) }), 'error', my));
  }

  // my verilirse: yalnız o görev hâlâ güncelse durdurur (Durdur'dan sonra başlatılan yeni görevi eski görevin bitişi öldürmesin)
  function stop(text = L('bg.stopped'), level = 'idle', my = null) {
    if (my != null && my !== token) return;
    token++;
    run.running = false;
    status(text, level);
  }

  // ---------------------------------------------------------------- beklenen kulüp (v1.3 uyarısı)
  // Kulüp anahtarı ada göre: erkek ve kadın takımı (ör. Arsenal) farklı teamId taşır ama aynı kulüptür.
  function clubKey(x) {
    if (!x.teamId) return null;
    const c = clubOf(x);
    return c && !String(c).startsWith('#') ? c.trim().toLocaleLowerCase('tr') : '#' + x.teamId;
  }

  function clubCounts() {
    const m = new Map();
    for (const x of list) {
      const k = clubKey(x);
      if (!k) continue;
      const e = m.get(k) || { key: k, club: clubOf(x) || '#' + x.teamId, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || String(a.club).localeCompare(b.club, 'tr'));
  }

  // Sabitlenmiş kulüp varsa o; yoksa çoğunluk. Beraberlikte ya da tek kulüpte uyarı verilmez.
  function expectedClub(counts, pinned) {
    if (pinned && counts.some((c) => c.key === pinned)) return { key: pinned, auto: false };
    if (counts.length < 2) return { key: null, auto: true, stale: !!pinned };
    if (counts[0].n === counts[1].n) return { key: null, auto: true, tie: true, stale: !!pinned };
    return { key: counts[0].key, auto: true, stale: !!pinned };
  }

  // @@BEGIN lib/gallery.js — tools/build-userscript.mjs üretir, elle düzenleme
  // Galeri ekranı dil sözlüğü (Türkçe / English). Anahtar → metin; {ad} yer tutucuları doldurulur.
  // Eklenti (gallery.js, background.js) ve userscript (tools/build-userscript.mjs ile gömülür) aynı sözlüğü kullanır.

  const LANGS = [['tr', 'Türkçe'], ['en', 'English']];

  // Dil seçicideki bayraklar (Windows'ta Chrome bayrak emojisi çizmediği için SVG)
  const FLAGS = {
    tr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#E30A17"/><circle cx="10.6" cy="10" r="5" fill="#fff"/><circle cx="11.85" cy="10" r="4" fill="#E30A17"/><polygon fill="#fff" points="13.80,10.00 15.49,9.41 15.53,7.62 16.61,9.05 18.32,8.53 17.30,10.00 18.32,11.47 16.61,10.95 15.53,12.38 15.49,10.59"/></svg>',
    en: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><clipPath id="fcg-uk"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#fcg-uk)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>',
  };

  const TR = {
    'intro': 'Galeri Tokenları Hall of FUT oyuncularını açar. Aldığın kartı sonra satsan da toplanmış sayılır; yani setin gerçek maliyeti fiyat değil, %5 satış vergisidir.',
    'contact': '💬 Destek & fikir: ',
    'contact.copied': '✓ Kopyalandı — Discord: ',
    'contact.title': 'Discord kullanıcı adını kopyala',
    'lang.title': 'Dil',
    'ov.level': 'Galeri seviyesi',
    'ov.level.title': 'Oyundaki Galeri Seviyeni yaz. Web App bu bilgiyi vermiyor, EA de puan → seviye formülünü açıklamadı; bu yüzden elle girilir.',
    'ov.level.next': 'sonraki ödül: seviye {n}',
    'ov.level.max': 'tüm ödüller alındı',
    'ov.level.ph': 'oyundan gir',
    'ov.score': 'Toplam galeri puanı',
    'ov.score.title': "Eşitlenmiş setlerin puanları toplamı (oyundaki bonus etiketler hariç). Oyundaki Galeri Seviyesi Web App verisinde bulunmadığı için gösterilemiyor.",
    'ov.earned': 'Kazanılan token',
    'ov.reachPts': 'Kazanılabilen galeri puanı',
    'ov.reachPts.title': "Her setin pazarda ulaşılabilen en yüksek notunun fut.gg çözümü alınırsa set puanlarının toplam artışı (eşitlenmiş setlerde sende olan kartlar ve EA puanları hesaba katılır; bonus etiketler hariç).",
    'row.reachPts': 'Alınabilen puan',
    'locale': 'tr-TR',
    'ov.reach': 'Şu an alınabilen token',
    'ov.reachCost': '≈ {c} alış · {t} vergi',
    'ov.reach.title': "fut.gg'ye göre pazarda ulaşılabilen notlardan henüz kazanmadığın token. Maliyet: her setin ulaşılabilen en yüksek notu için sende olmayan kartların alışı; aynı fiyattan geri satınca kayıp ≈ %5 vergi.",
    'ov.max': 'En fazla token',
    'ov.toGrade': 'Oyunda notlandırılacak',
    'ov.toGrade.title': "Kart aldığın ya da çözüm kartlarının hepsi sende olan setler. Tokenı almak için oyunda (konsol / PC) Galeri'den notlandırman gerekiyor; Web App notlandıramıyor. Tıklayınca bu setler listelenir.",
    'ov.toGrade.sub': 'set · listelemek için tıkla',
    'ov.sets': 'Tamamlanan set',
    'ov.tab': 'bu sekme: {v}',
    'ov.synced': '{n}/{m} set eşitlendi',
    'btn.planner': 'Token planlayıcı',
    'btn.planner.title': 'Hedef token ya da bütçeye göre en ucuz set planı',
    'btn.syncAll': 'Tümünü eşitle',
    'btn.syncAll.title': "Tüm kulüp, lig ve nadirlik setlerini EA'dan eşitler",
    'btn.catRefresh': 'Kataloğu yenile',
    'btn.diag': 'Teşhis',
    'btn.diag.title': "Setler 0/N görünüyorsa: EA'nın toplanma bilgisini ne döndürdüğünü raporlar (alım yapmaz)",
    'diag.title': 'Teşhis — toplanma bilgisi',
    'diag.body': "Oyunda notlandırdığın (✓ olması gereken) bir seti seç ve Çalıştır'a bas. Rapor alım yapmaz, kişisel bilgi içermez; Kopyala ile Discord'dan yusuflnx'e gönder.",
    'diag.set': 'Set:',
    'diag.run': 'Çalıştır',
    'diag.deep': 'Derin teşhis',
    'diag.deep.title': "Web App'in tamamını tarar (sınıflar, servisler, istek adresleri, uygulama kodu, dil dosyası): oyundaki galeri derecesi bir yerde var mı? EA'ya istek atmaz, 10-30 sn sürebilir.",
    'diag.deep.running': 'Derin teşhis çalışıyor (uygulama kodu taranıyor, 10-30 sn)…',
    'diag.running': 'Çalışıyor… (EA Web App sekmesi açık ve giriş yapılmış olmalı)',
    'diag.copy': 'Kopyala',
    'diag.copied': '✓ Kopyalandı',
    'diag.ph': 'Rapor burada görünecek',
    'diag.fail': 'Teşhis çalışmadı: {e}',
    'diag.all': 'Genel tarama (tümü)',
    'diag.all.title': "Bütün setlerin bütün takımlarını/liglerini EA'dan tek tek sorgular ve hepsini tek raporda toplar (alım yapmaz)",
    'diag.all.confirm': 'Başlat (~{d})',
    'diag.all.note': "Genel tarama {sets} set için {reqs} istek atar; eşitleme kadar sürer. Başlatmak için düğmeye tekrar bas. Bu sırada Web App'te işlem yapma.",
    'diag.progress': 'Taranıyor… {i}/{n} set',
    'diag.stop': 'Durdur',
    'sort': 'Sırala',
    'show': 'Göster',
    'toList': 'Oyuncu listesi →',
    'view.gallery': 'GALERİ',
    'view.list': 'OYUNCU LİSTESİ',
    'bar.coins': 'Coin',
    'bar.refreshCoins.title': "Coin'i EA'dan yenile (elle satıştan sonra)",
    'bar.refreshCoins.fail': 'Yenilenemedi: {e}',
    'bar.spent': 'Galeri harcaması',
    'bar.spent.title': 'Yalnız Galeri ekranından yapılan alımlar',
    'bar.reset': 'Sıfırla',
    'bar.budget': 'Galeri bütçesi',
    'bar.budget.ph': '0 = sınırsız',
    'bar.budget.title': 'Galeri alımları için toplam üst sınır: galeri harcaması bu tutara ulaşınca alım durur (↺ ile sıfırlanır). Oyuncu listesi ekranının bütçesinden ayrıdır. 0 = sınırsız.',
    'bar.maxCard': 'Kart başına en fazla',
    'bar.maxCard.ph': 'yok',
    'bar.maxCard.title': "Tek kart için ödenecek en yüksek tutar. Buna ek olarak otomatik sınır uygulanır: canlı fiyat bakıldıysa canlı fiyatın %25 fazlası, bakılmadıysa fut.gg fiyatının 2 katı (en az +2.000). Sınırı aşan kart alınmaz, raporda gerçek fiyatıyla yazılır. 0 = yalnız otomatik sınır.",
    'bar.after': 'Aldıktan sonra',
    'after.relist': 'Satışa koy',
    'after.tradepile': 'Transfer listesine taşı',
    'after.keep': "Unassigned'da bırak",
    'bar.sell': 'Satış',
    'rel.paid': 'Ödediğim',
    'rel.market': 'Piyasa (fut.gg)',
    'rel.base.title': 'Satış fiyatının dayanağı',
    'rel.pct.title': 'Fiyat ayarı',
    'rel.dur.title': 'İlan süresi',
    'dur.3600': '1 sa', 'dur.10800': '3 sa', 'dur.21600': '6 sa', 'dur.43200': '12 sa', 'dur.86400': '1 gün',
    'stop': 'Durdur',
    'ready': 'Hazır',
    'cancel': 'Vazgeç',
    'close': 'Kapat',
    'error': 'hata',
    // ızgara
    'card.collected': '{n} / {req} toplandı',
    'card.score': 'Set puanı',
    'card.untrackable': 'Web App ile izlenemiyor',
    'card.unsynced': 'eşitlenmedi',
    'card.est': '* set eşitlenmedi: maliyet tahmini',
    'row.next': 'Sonraki', 'row.earned': 'Kazanılan', 'row.reach': 'Alınabilen', 'row.max': 'En fazla',
    'row.nextVal': '+{gain} token · ~{tax} vergi',
    'row.ready': '+{gain} token · oyunda notlandır',
    'ready.tip': "Bu notun fut.gg çözümündeki kartların hepsi sende: oyunda Galeri'den seti notlandırarak tokenı alabilirsin. (Buradaki not bonus etiketleri içermediği için düşük görünebilir.)",
    'tokens': '{n} token',
    'grid.emptyFilter': 'Gösterilecek set yok (filtre)',
    'grid.empty': 'Bu sekmede set yok',
    'tab.info': '{synced}/{all} set eşitlendi · kazanılan ',
    'tab.max': ' / {max} token',
    'tab.last': ' · son eşitleme {d}',
    'cat': 'Katalog: {d}',
    'cat.checking': 'Katalog kontrol ediliyor…',
    'cat.fail': 'Katalog: {d} (güncelleme alınamadı: {e})',
    'cat.updated': 'Katalog güncellendi: {d}',
    'cat.loading': 'Katalog yükleniyor…',
    'cat.downloadFail': 'Katalog indirilemedi: {e}',
    'upd.avail': '⬆ Yeni sürüm {v} var',
    'upd.title': "Kurulu: {c}. Eklenti klasöründeki guncelle.bat'ı çalıştır, sonra chrome://extensions'ta Yenile'ye bas. (Tıkla: sürüm notları)",
    'retry': 'Tekrar dene',
    'grade.title': '{g}: {score} puan',
    'lbl.earned': 'kazanılan {n} · ',
    'lbl.reach': 'şu an alınabilen {r} · en fazla {max} token',
    'lbl.max': 'en fazla {max} token',
    'sort.': 'Varsayılan',
    'sort.tokens': 'Şu an en çok token alınabilen → en az',
    'sort.tokensAsc': 'Şu an en az token alınabilen → en çok',
    'sort.max': 'En fazla token (toplam) → en az',
    'sort.earned': 'Mevcut kartlarla en çok token',
    'sort.left': 'En çok kalan token',
    'sort.value': 'Token başına en ucuz',
    'sort.cheap': 'Sonraki token en ucuz',
    'sort.near': 'Sonraki tokena en yakın (en az kart)',
    'sort.progress': 'En çok tamamlanan (%)',
    'show.all': 'Tümü',
    'show.open': 'Şu an token alınabilenler',
    'show.grade': 'Oyunda notlandırılacaklar',
    'show.done': 'Tamamlananlar',
    'show.unsynced': 'Eşitlenmemişler',
    // süre
    'dur.s': '{s} sn', 'dur.m': '{m} dk', 'dur.ms': '{m} dk {s} sn', 'dur.h': '{h} sa {m} dk',
    // eşitleme onayı
    'sync.title': 'Tüm setler eşitlensin mi?',
    'sync.sets': '{n} set',
    'sync.body': ' eşitlenecek (kulüp {c} · lig {l} · nadirlik {r}), yaklaşık {q} istek.',
    'sync.avg': 'Set başına ortalama ~{s} sn',
    'sync.measured': ' (önceki eşitlemelerden ölçüldü)',
    'sync.first': ' (ilk eşitlemede tahmin; sonrakilerde ölçülen süre kullanılır)',
    'sync.keep': ". Bu sırada Web App sekmesi açık kalmalı; istediğin an Durdur'a basabilirsin.",
    'sync.skip': ' Son 6 saatte eşitlenenleri atla',
    'sync.skipped': ' ({n} set atlanıyor)',
    'sync.start': 'Eşitlemeyi başlat',
    'sync.none': 'Eşitlenecek set yok',
    // detay
    'unreachable': 'ulaşılamaz',
    'coins': '{n} coin',
    'st.need.live': 'Gereken coin (canlı {p}/{m})',
    'st.need.futgg': 'Gereken coin (fut.gg)',
    'st.need.title.live': 'Pazardaki güncel en ucuz fiyatlarla',
    'st.need.title.futgg': "fut.gg fiyatıyla — güncel fiyat için 'Eşitle + güncel fiyat'",
    'st.total': 'Toplam fiyat (fut.gg)',
    'st.tax': 'Vergi kaybı (%5)',
    'st.target': 'Puan hedefi',
    'st.sumPts': 'Puan (çözüm / hedef)',
    'st.sumPts.title': 'Çözüm kartlarının galeri puanları toplamı / notun puan eşiği. Oyunda bonus etiketler (aynı kulüp, ilk sahip vb.) eklenir.',
    'pts': '+{n} puan',
    'pts.tip': 'Galeri puanı: {n} ({src})',
    'bg.trail': '{name}: {p} bulundu · {lo} ve altında ilan yok',
    'st.tokens': 'Token (toplam)',
    'st.cards': 'Kart',
    'st.have': '{h}/{n} sende',
    'chip.all': 'Tümü', 'chip.missing': 'Eksik', 'chip.collected': 'Toplanan',
    'card.tip': '{name} · {r} · puan {sc} · {p} coin',
    'card.tip.col': ' · sende (toplandı)',
    'noListing': 'ilan yok',
    'live.tip': 'Güncel pazar fiyatı · fut.gg {p}',
    'futgg.tip': "fut.gg fiyatı — güncel fiyat için 'Eşitle + güncel fiyat'",
    'sync.hint': 'Hangi kartların sende olduğunu görmek ve güncel fiyatları almak için seti eşitle.',
    'btn.syncPrice': 'Eşitle + güncel fiyat',
    'btn.syncPrice.title': "Seti EA'dan eşitler ve bu notun eksik kartlarının pazardaki güncel en ucuz fiyatına bakar",
    'allOwned': "Bu çözümdeki kartların hepsi sende — oyunda Galeri'den seti notlandırarak {n} token alabilirsin.",
    'unsupported.note': 'Bu setin kartları Web App aramasıyla ayırt edilemediği için sende hangilerinin olduğu bilinemiyor; eşitleme ve alım kapalı. Kademeler yalnız bilgi amaçlı.',
    'grade.badge': 'oyunda notlandır',
    'grade.banner': "Bu sette kart aldın: tokenı almak için seti oyunda (konsol / PC) Galeri'den notlandır. Web App notlandıramıyor. Notlandırınca işareti kaldır.",
    'grade.done': '✓ Notlandırdım',
    'ingame.label': 'Oyundaki derece:',
    'ingame.auto': 'Otomatik',
    'ingame.reset': 'Sıfırla',
    'ingame.reset.title': 'Bu set için hatırlanan en yüksek puanı ve seçtiğin dereceyi siler; derece yeniden kulüpteki kartlardan hesaplanır.',
    'ingame.title': 'Oyunda notlandırdığın dereceyi seç. Kartları sattıktan sonra EA onları toplanmış saymadığı için eklenti dereceyi düşük hesaplar; seçtiğin derece altına inilmez.',
    'ingame.note': 'Oyundaki derece {g} kabul ediliyor — kulüpteki kartlarla hesaplanan {n} puan (not {lg}). Satılan kartları EA toplanmış saymıyor.',
    'sol.old': ' (fiyatlar {n} gün eski)',
    'buy.confirm': 'Eminim — {n} kartı al (≈ {c})',
    'buy.plan': 'Bu çözümü al ({n} kart ≈ {c})',
    'sol.note': "Kart listesi fut.gg'nin {g} notu için önerdiği çözüm. Alım pazardaki güncel en ucuz ilandan yapılır; sarı fiyatlar güncel, soluk olanlar fut.gg ({d}).",
    'sol.noListing': ' {n} kartın pazarda ilanı yok.',
    'sol.bonus': ' Kart puanlarına bonus etiketler dahil değil.',
    'cb.none': 'Bu set için fut.gg çözümü yok — en ucuz eksik kartlar kullanılıyor.',
    'cb.full': 'Tüm slotlar dolu.',
    'cb.plan': '{free} boş slot · en ucuz {n} kart ≈ ',
    'cb.tax': ' coin · vergi ≈ ',
    'cb.after': 'Sonrası: puan {s} · not {g} · {e}/{m} token',
    'cb.slots': '{free} boş slot · {x}',
    'cb.price': '"Fiyatla" ile en ucuz eksik kartlara bak',
    'cb.noprice': 'fiyatı bilinen eksik kart yok',
    'btn.sync': 'Eşitle',
    'btn.price': 'Fiyatla',
    'buy.missing': 'Eksikleri al ({n})',
    'buy.missing.confirm': 'Eminim — {n} kartı al',
    'notSynced': 'Bu set henüz eşitlenmedi.',
    'untrackable.long': 'Bu setin kartları Web App aramasıyla ayırt edilemiyor (holografik / başlangıç seti).',
    'noSol': 'Bu set için fut.gg çözümü yok.',
    'hd.line': '{c}/{r} toplandı · puan ',
    'hd.line2': ' · not {g} · kazanılan {e}/{m} token',
    'hd.next': 'Sonraki not {g}: {n} puan daha',
    'hd.nextPay': ' · token veren ilk not {g}: {n} puan daha',
    'hd.top': 'Set en yüksek notta',
    'special': 'özel kart',
    'untradeable': 'satılamaz',
    'list.sum': 'Setteki tüm kartlar ({n}) — sayılan {c}, eksik {m}',
    'list.counted': 'Sayılan kartlar ({c}/{r})',
    'list.extra': 'Diğer toplananlar ({n})',
    'list.missing': 'Eksikler ({n})',
    'dt.sub': '{r} kart · ',
    'dt.synced': ' · eşitlendi {d}',
    // planlayıcı
    'pl.title': 'Token planlayıcı',
    'pl.note': 'Her setten en fazla bir not seçilir; sende olan kartlar düşülür. Maliyet fut.gg fiyatlarıyla alış toplamı; aynı fiyattan geri satınca gerçek kayıp ≈ %5 vergi.',
    'pl.target': 'Hedef token',
    'pl.budget': 'Coin bütçesi',
    'pl.synced': ' Yalnız eşitlenmiş setler',
    'pl.tokens': 'Token',
    'pl.unreach': ' (hedefe ulaşılamıyor)',
    'pl.cost': 'Alış toplamı',
    'pl.tax': 'Vergi kaybı',
    'pl.sets': 'Set / kart',
    'pl.unsynced': '* {n} set eşitlenmemiş: maliyet, sende hiç kart yokmuş gibi hesaplandı ve bu setler "Planı al"da atlanır. Önce "Tümünü eşitle".',
    'pl.est': ' * eşitlenmedi',
    'pl.ready': ' · hazır: oyunda notlandır',
    'pl.row': '{n} kart · {c}',
    'pl.gain': '+{n} token',
    'pl.buy': 'Planı al',
    'pl.confirm': 'Eminim — {n} seti al (≈ {c})',
    // arka plan durum mesajları
    'bg.noSession': "Oturum yok: EA Web App'i açıp giriş yapın",
    'bg.stopped': 'Durduruldu',
    'bg.haltTitle': 'Gallery Grab durdu',
    'bg.syncStart': 'Eşitleme başladı',
    'bg.syncing': 'Eşitleniyor: {name} ({i}/{n}) · ~{left} kaldı',
    'bg.syncing1': 'Eşitleniyor: {name}',
    'bg.synced1': '{name} eşitlendi',
    'bg.syncFail': '{name} eşitlenemedi: {e}',
    'bg.syncDone': 'Eşitleme bitti: {n}/{m} set, {d}',
    'bg.live': 'Canlı fiyat: {name} ({i}/{n})',
    'bg.liveDone': '{name} {g}: {m} eksik kart, canlı toplam {c}',
    'bg.liveSame': ' (fut.gg ile aynı)',
    'bg.liveChange': '{name} {p} (fut.gg {f})',
    'bg.liveNone': '{name} ilan yok',
    'bg.priceStart': 'Fiyatlama başladı',
    'bg.priceOne': 'Fiyat: {name} ({i}/{n})',
    'bg.priceDone': '{name}: {n} kart ≈ {c} coin (vergi ≈ {t})',
    'bg.noCands': '{name}: fiyatı bakılacak eksik kart yok',
    'bg.needSync': 'Önce seti eşitleyin',
    'bg.noBuy': 'Alınacak kart yok — önce "Fiyatla"',
    'bg.missingStart': 'Eksikler alınıyor',
    'bg.buyStart': 'Çözüm alınıyor',
    'bg.planStart': 'Plan alınıyor',
    'bg.noSol': '{name}: {g} için fut.gg çözümü yok',
    'bg.allOwned': '{name}: çözümdeki kartların hepsi sende',
    'bg.unsyncedSkip': '{name}: eşitlenmemiş, atlandı',
    'bg.search': 'Aranıyor: {name} ({i}/{n})',
    'bg.bought': 'Alındı: {name} — {p}{x}',
    'bg.noListing': '{name}: pazarda ilan yok',
    'bg.overCap': '{name}: en ucuz {p} > sınır {c}',
    'bg.overRef': "{name}: {p} fut.gg fiyatının ({f}) çok üstünde, daha ucuzu doğrulanamadı — alınmadı",
    'bg.sniped': '{name}: ilanlar hep başkası tarafından alındı',
    'bg.unsupported': '{name}: bu setin kartları Web App ile doğrulanamıyor — eşitleme ve alım kapalı',
    'bg.tpFull': 'Transfer listesi dolu ({n}/100) — boşaltıp tekrar dene',
    'bg.syncFailN': ' · {n} set eşitlenemedi',
    'bg.restarted': 'Eklenti yeniden başladı — görevi tekrar başlatın',
    'bg.taskFail': 'Görev hata verdi: {e}',
    'bg.gradeHint': ' · oyunda notlandırmayı unutma',
    'us.extWarn': 'Gallery Grab Chrome eklentisi de yüklü görünüyor. İkisini birlikte kullanma: birini kapat, yoksa menü sekmesi ve alımlar karışabilir.',
    'bg.budget': 'bütçe doldu',
    'bg.coinsLow': 'coin yetmedi',
    'bg.relisted': " · {p}'den satışta (tahmini {net})",
    'bg.tp': ' · transfer listesinde',
    'bg.tpFail': ' · transfer listesine taşınamadı ({r})',
    'bg.listFail': ' · listelenemedi ({e})',
    'bg.done1': '{name}: {n} kart alındı',
    'bg.done1b': ' — {c}/{r}, not {g}',
    'bg.planDone': 'Plan bitti: {n} kart alındı',
    'bg.autoNone.none': '{name}: çözüm yok, atlandı',
    'bg.autoNone.done': '{name}: hedefe kadar tüm dereceler kazanılmış, atlandı',
    'bg.autoNone.coins': '{name}: coin/bütçe hiçbir dereceye yetmiyor, atlandı',
    'bg.autoNone.listing': '{name}: gereken kartların ilanı yok, atlandı',
    'bg.autoFell': '{name}: {from} ulaşılamıyor → {to}',
    'bg.autoReady': '{name}: {g} için kartların hepsi sende — oyunda notlandır',
    'sel.mode': 'Çoklu seçim',
    'sel.mode.title': 'Birden çok set seç, hedef dereceyi belirle, sırayla al',
    'sel.count': '{n} set seçildi',
    'sel.target': 'Hedef',
    'sel.target.max': 'En yüksek',
    'sel.auto': 'Oto',
    'sel.tabAll': 'Sekmedekileri seç',
    'sel.clear': 'Temizle',
    'sel.close': 'Kapat',
    'sel.empty': 'Kartlara tıklayarak set seç.',
    'sel.buy': 'Sırayla al ({n} set · {k} kart ≈ {c})',
    'sel.confirm': 'Eminim — {n} seti sırayla al (≈ {c})',
    'sel.fell': '{from} olmuyor',
    'sel.why.none': 'çözüm yok',
    'sel.why.done': 'yeni derece yok',
    'sel.avail': 'Kullanılabilir: {c}',
    'sel.avail.none': 'Kullanılabilir: sınırsız (coin bilinmiyor)',
    'sel.avail.title': 'Güncel coin; galeri bütçesi girildiyse bütçeden kalanla sınırlı',
    'sel.why.coins': 'coin yetmiyor',
    'sel.why.listing': 'ilan yok',
    'sel.unsynced': 'eşitlenmedi · atlanır',
    'sel.ready': 'hazır · oyunda notlandır',
    'sel.note': 'Setler bu sırayla alınır. Coin (ve galeri bütçesi) sırayla paylaştırılır: yetmeyen set otomatik alt dereceye düşer. Alım sırasında güncel coin ve fiyatla yeniden kontrol edilir.',
    'sel.remove': 'Listeden çıkar',
    'bg.catalog': 'Katalog',
    'sr.471': 'Hesapta işlem yasağı/yetki reddi (471)',
    'sr.494': 'Transfer pazarı kilitli (494)',
    'sr.429': 'Rate limit (429)',
    'sr.captcha': "Captcha algılandı ({s}) — Web App'te çözün",
    'sr.softban': 'Softban/servis hatası ({s})',
    'sr.session': "Oturum geçersiz ({s}) — EA oturumu kapattı. Web App'i yenileyip giriş yapın. Aynı hesapla konsolda / Companion'da FUT açılırsa ya da birden çok Web App sekmesi açıksa Web App oturumu düşer.",
  };

  const EN = {
    'intro': 'Gallery Tokens unlock Hall of FUT players. A card counts as collected even if you buy it and sell it again, so the real cost of a set is the 5% sale tax, not the price.',
    'contact': '💬 Support & ideas: ',
    'contact.copied': '✓ Copied — Discord: ',
    'contact.title': 'Copy Discord username',
    'lang.title': 'Language',
    'ov.level': 'Gallery level',
    'ov.level.title': "Enter your in-game Gallery Level. The Web App doesn't provide it and EA hasn't published the score → level formula, so it's entered manually.",
    'ov.level.next': 'next reward: level {n}',
    'ov.level.max': 'all rewards unlocked',
    'ov.level.ph': 'enter from game',
    'ov.score': 'Total gallery score',
    'ov.score.title': 'Sum of synced set scores (excluding in-game bonus tags). The in-game Gallery Level is not in the Web App data, so it cannot be shown.',
    'ov.earned': 'Tokens earned',
    'ov.reachPts': 'Gallery score available',
    'ov.reachPts.title': "Total increase in set scores if you buy fut.gg's solution for each set's highest grade reachable on the market (synced sets count the cards you own and EA scores; bonus tags excluded).",
    'row.reachPts': 'Score available',
    'locale': 'en-GB',
    'ov.reach': 'Tokens available now',
    'ov.reachCost': '≈ {c} to buy · {t} tax',
    'ov.reach.title': "Tokens you haven't earned yet from grades reachable on the market according to fut.gg. Cost: buying the cards you don't own for each set's highest reachable grade; relisting at the same price loses ≈ 5% tax.",
    'ov.max': 'Max tokens',
    'ov.toGrade': 'To grade in game',
    'ov.toGrade.title': "Sets you bought cards for, or where you own every solution card. Grade them in the in-game Gallery (console / PC) to claim tokens; the Web App can't grade. Click to list them.",
    'ov.toGrade.sub': 'sets · click to list',
    'ov.sets': 'Completed sets',
    'ov.tab': 'this tab: {v}',
    'ov.synced': '{n}/{m} sets synced',
    'btn.planner': 'Token planner',
    'btn.planner.title': 'Cheapest set plan for a token target or budget',
    'btn.syncAll': 'Sync all',
    'btn.syncAll.title': 'Syncs every club, league and rarity set from EA',
    'btn.catRefresh': 'Refresh catalog',
    'btn.diag': 'Diagnose',
    'btn.diag.title': "If sets show 0/N: reports what EA returns as collection status (buys nothing)",
    'diag.title': 'Diagnose — collection status',
    'diag.body': "Pick a set you have graded in game (it should show ✓) and press Run. The report buys nothing and has no personal data; Copy it and send it to yusuflnx on Discord.",
    'diag.set': 'Set:',
    'diag.run': 'Run',
    'diag.deep': 'Deep diagnosis',
    'diag.deep.title': "Scans the whole Web App (classes, services, request URLs, app code, language file): is the in-game gallery grade anywhere? Sends no requests to EA, may take 10-30 s.",
    'diag.deep.running': 'Deep diagnosis running (scanning app code, 10-30 s)…',
    'diag.running': 'Running… (the EA Web App tab must be open and logged in)',
    'diag.copy': 'Copy',
    'diag.copied': '✓ Copied',
    'diag.ph': 'The report will appear here',
    'diag.fail': 'Diagnose failed: {e}',
    'diag.all': 'Full scan (all)',
    'diag.all.title': "Queries every team/league of every set from EA one by one and puts it all in one report (buys nothing)",
    'diag.all.confirm': 'Start (~{d})',
    'diag.all.note': "The full scan sends {reqs} requests for {sets} sets; it takes about as long as a sync. Press the button again to start. Don't use the Web App meanwhile.",
    'diag.progress': 'Scanning… {i}/{n} sets',
    'diag.stop': 'Stop',
    'sort': 'Sort',
    'show': 'Show',
    'toList': 'Player list →',
    'view.gallery': 'GALLERY',
    'view.list': 'PLAYER LIST',
    'bar.coins': 'Coins',
    'bar.refreshCoins.title': 'Refresh coins from EA (after selling manually)',
    'bar.refreshCoins.fail': 'Could not refresh: {e}',
    'bar.spent': 'Gallery spend',
    'bar.spent.title': 'Only purchases made from the Gallery screen',
    'bar.reset': 'Reset',
    'bar.budget': 'Gallery budget',
    'bar.budget.ph': '0 = unlimited',
    'bar.budget.title': 'Total cap for Gallery purchases: buying stops when Gallery spend reaches this amount (reset with ↺). Separate from the Player list budget. 0 = unlimited.',
    'bar.maxCard': 'Max per card',
    'bar.maxCard.ph': 'none',
    'bar.maxCard.title': "Highest amount to pay for a single card. An automatic limit also applies: 25% above the live price if it was checked, otherwise 2× the fut.gg price (at least +2,000). Cards above the limit are skipped and reported with their real price. 0 = automatic limit only.",
    'bar.after': 'After buying',
    'after.relist': 'List on market',
    'after.tradepile': 'Send to transfer list',
    'after.keep': 'Keep in unassigned',
    'bar.sell': 'Sell at',
    'rel.paid': 'What I paid',
    'rel.market': 'Market (fut.gg)',
    'rel.base.title': 'Base for the sale price',
    'rel.pct.title': 'Price adjustment',
    'rel.dur.title': 'Listing duration',
    'dur.3600': '1 h', 'dur.10800': '3 h', 'dur.21600': '6 h', 'dur.43200': '12 h', 'dur.86400': '1 day',
    'stop': 'Stop',
    'ready': 'Ready',
    'cancel': 'Cancel',
    'close': 'Close',
    'error': 'error',
    'card.collected': '{n} / {req} collected',
    'card.score': 'Set score',
    'card.untrackable': 'Not trackable in the Web App',
    'card.unsynced': 'not synced',
    'card.est': '* set not synced: estimated cost',
    'row.next': 'Next', 'row.earned': 'Earned', 'row.reach': 'Available', 'row.max': 'Max',
    'row.nextVal': '+{gain} tokens · ~{tax} tax',
    'row.ready': '+{gain} tokens · grade in game',
    'ready.tip': "You own every card in fut.gg's solution for this grade: grade the set in the in-game Gallery to claim the tokens. (The grade here excludes bonus tags, so it may look lower.)",
    'tokens': '{n} tokens',
    'grid.emptyFilter': 'No sets to show (filter)',
    'grid.empty': 'No sets in this tab',
    'tab.info': '{synced}/{all} sets synced · earned ',
    'tab.max': ' / {max} tokens',
    'tab.last': ' · last sync {d}',
    'cat': 'Catalog: {d}',
    'cat.checking': 'Checking catalog…',
    'cat.fail': 'Catalog: {d} (update failed: {e})',
    'cat.updated': 'Catalog updated: {d}',
    'cat.loading': 'Loading catalog…',
    'cat.downloadFail': 'Could not download catalog: {e}',
    'upd.avail': '⬆ New version {v} available',
    'upd.title': 'Installed: {c}. Run guncelle.bat in the extension folder, then press Reload in chrome://extensions. (Click: release notes)',
    'retry': 'Retry',
    'grade.title': '{g}: {score} points',
    'lbl.earned': 'earned {n} · ',
    'lbl.reach': 'available now {r} · max {max} tokens',
    'lbl.max': 'max {max} tokens',
    'sort.': 'Default',
    'sort.tokens': 'Most tokens available now → least',
    'sort.tokensAsc': 'Fewest tokens available now → most',
    'sort.max': 'Most tokens (total) → least',
    'sort.earned': 'Most tokens with current cards',
    'sort.left': 'Most tokens left',
    'sort.value': 'Cheapest per token',
    'sort.cheap': 'Cheapest next token',
    'sort.near': 'Closest to next token (fewest cards)',
    'sort.progress': 'Most complete (%)',
    'show.all': 'All',
    'show.open': 'Tokens available now',
    'show.grade': 'To grade in game',
    'show.done': 'Completed',
    'show.unsynced': 'Not synced',
    'dur.s': '{s} s', 'dur.m': '{m} min', 'dur.ms': '{m} min {s} s', 'dur.h': '{h} h {m} min',
    'sync.title': 'Sync all sets?',
    'sync.sets': '{n} sets',
    'sync.body': ' will be synced (club {c} · league {l} · rarity {r}), about {q} requests.',
    'sync.avg': 'About {s} s per set',
    'sync.measured': ' (measured from previous syncs)',
    'sync.first': ' (first-run estimate; later syncs use the measured time)',
    'sync.keep': '. Keep the Web App tab open; you can press Stop at any time.',
    'sync.skip': ' Skip sets synced in the last 6 hours',
    'sync.skipped': ' ({n} sets skipped)',
    'sync.start': 'Start sync',
    'sync.none': 'Nothing to sync',
    'unreachable': 'unreachable',
    'coins': '{n} coins',
    'st.need.live': 'Coins needed (live {p}/{m})',
    'st.need.futgg': 'Coins needed (fut.gg)',
    'st.need.title.live': 'Using current cheapest market prices',
    'st.need.title.futgg': "fut.gg prices — press 'Sync + live prices' for current prices",
    'st.total': 'Total price (fut.gg)',
    'st.tax': 'Lost to tax (5%)',
    'st.target': 'Score target',
    'st.sumPts': 'Score (solution / target)',
    'st.sumPts.title': "Sum of the solution cards' gallery scores / the grade threshold. In-game bonus tags (same club, first owner, etc.) are added on top.",
    'pts': '+{n} pts',
    'pts.tip': 'Gallery score: {n} ({src})',
    'bg.trail': '{name}: found {p} · no listings at {lo} or below',
    'st.tokens': 'Tokens (total)',
    'st.cards': 'Cards',
    'st.have': '{h}/{n} owned',
    'chip.all': 'All', 'chip.missing': 'Missing', 'chip.collected': 'Collected',
    'card.tip': '{name} · {r} · score {sc} · {p} coins',
    'card.tip.col': ' · owned (collected)',
    'noListing': 'no listings',
    'live.tip': 'Current market price · fut.gg {p}',
    'futgg.tip': "fut.gg price — press 'Sync + live prices' for the current price",
    'sync.hint': 'Sync the set to see which cards you own and to get current prices.',
    'btn.syncPrice': 'Sync + live prices',
    'btn.syncPrice.title': "Syncs the set from EA and checks the current cheapest market price of this grade's missing cards",
    'allOwned': 'You own every card in this solution — grade the set in the in-game Gallery to claim {n} tokens.',
    'unsupported.note': "This set's cards can't be told apart with the Web App search, so it's unknown which ones you own; syncing and buying are disabled. Grades are for information only.",
    'grade.badge': 'grade in game',
    'grade.banner': "You bought cards for this set: grade it in the in-game Gallery (console / PC) to claim the tokens. The Web App can't grade. Clear the mark once graded.",
    'grade.done': '✓ I graded it',
    'ingame.label': 'In-game grade:',
    'ingame.auto': 'Auto',
    'ingame.reset': 'Reset',
    'ingame.reset.title': 'Clears the remembered best score and the grade you picked for this set; the grade is recalculated from the cards in your club.',
    'ingame.title': "Pick the grade you reached in-game. Once you sell the cards EA no longer counts them as collected, so the extension under-counts; the grade never drops below what you pick.",
    'ingame.note': 'In-game grade taken as {g} — cards in your club give {n} pts (grade {lg}). EA does not count sold cards as collected.',
    'sol.old': ' (prices {n} days old)',
    'buy.confirm': 'Confirm — buy {n} cards (≈ {c})',
    'buy.plan': 'Buy this solution ({n} cards ≈ {c})',
    'sol.note': "Card list is fut.gg's suggested solution for grade {g}. Purchases use the current cheapest market listing; yellow prices are live, faded ones are fut.gg ({d}).",
    'sol.noListing': ' {n} cards have no market listings.',
    'sol.bonus': ' Card scores exclude bonus tags.',
    'cb.none': 'No fut.gg solution for this set — using the cheapest missing cards.',
    'cb.full': 'All slots are filled.',
    'cb.plan': '{free} empty slots · cheapest {n} cards ≈ ',
    'cb.tax': ' coins · tax ≈ ',
    'cb.after': 'After: score {s} · grade {g} · {e}/{m} tokens',
    'cb.slots': '{free} empty slots · {x}',
    'cb.price': 'press "Price" to check the cheapest missing cards',
    'cb.noprice': 'no priced missing cards',
    'btn.sync': 'Sync',
    'btn.price': 'Price',
    'buy.missing': 'Buy missing ({n})',
    'buy.missing.confirm': 'Confirm — buy {n} cards',
    'notSynced': 'This set has not been synced yet.',
    'untrackable.long': "This set's cards can't be told apart with the Web App search (holographic / starter set).",
    'noSol': 'No fut.gg solution for this set.',
    'hd.line': '{c}/{r} collected · score ',
    'hd.line2': ' · grade {g} · earned {e}/{m} tokens',
    'hd.next': 'Next grade {g}: {n} more points',
    'hd.nextPay': ' · first paying grade {g}: {n} more points',
    'hd.top': 'Set is at the top grade',
    'special': 'special card',
    'untradeable': 'untradeable',
    'list.sum': 'All cards in the set ({n}) — counted {c}, missing {m}',
    'list.counted': 'Counted cards ({c}/{r})',
    'list.extra': 'Other collected ({n})',
    'list.missing': 'Missing ({n})',
    'dt.sub': '{r} cards · ',
    'dt.synced': ' · synced {d}',
    'pl.title': 'Token planner',
    'pl.note': 'At most one grade per set; cards you own are deducted. Cost is the purchase total at fut.gg prices; relisting at the same price loses ≈ 5% tax.',
    'pl.target': 'Token target',
    'pl.budget': 'Coin budget',
    'pl.synced': ' Synced sets only',
    'pl.tokens': 'Tokens',
    'pl.unreach': ' (target not reachable)',
    'pl.cost': 'Purchase total',
    'pl.tax': 'Lost to tax',
    'pl.sets': 'Sets / cards',
    'pl.unsynced': '* {n} sets not synced: cost assumes you own none of the cards and these sets are skipped by "Buy plan". Run "Sync all" first.',
    'pl.est': ' * not synced',
    'pl.ready': ' · ready: grade in game',
    'pl.row': '{n} cards · {c}',
    'pl.gain': '+{n} tokens',
    'pl.buy': 'Buy plan',
    'pl.confirm': 'Confirm — buy {n} sets (≈ {c})',
    'bg.noSession': 'No session: open the EA Web App and log in',
    'bg.stopped': 'Stopped',
    'bg.haltTitle': 'Gallery Grab stopped',
    'bg.syncStart': 'Sync started',
    'bg.syncing': 'Syncing: {name} ({i}/{n}) · ~{left} left',
    'bg.syncing1': 'Syncing: {name}',
    'bg.synced1': '{name} synced',
    'bg.syncFail': 'Could not sync {name}: {e}',
    'bg.syncDone': 'Sync finished: {n}/{m} sets, {d}',
    'bg.live': 'Live price: {name} ({i}/{n})',
    'bg.liveDone': '{name} {g}: {m} missing cards, live total {c}',
    'bg.liveSame': ' (same as fut.gg)',
    'bg.liveChange': '{name} {p} (fut.gg {f})',
    'bg.liveNone': '{name} no listings',
    'bg.priceStart': 'Pricing started',
    'bg.priceOne': 'Price: {name} ({i}/{n})',
    'bg.priceDone': '{name}: {n} cards ≈ {c} coins (tax ≈ {t})',
    'bg.noCands': '{name}: no missing cards to price',
    'bg.needSync': 'Sync the set first',
    'bg.noBuy': 'Nothing to buy — press "Price" first',
    'bg.missingStart': 'Buying missing cards',
    'bg.buyStart': 'Buying solution',
    'bg.planStart': 'Buying plan',
    'bg.noSol': '{name}: no fut.gg solution for {g}',
    'bg.allOwned': '{name}: you own every card in the solution',
    'bg.unsyncedSkip': '{name}: not synced, skipped',
    'bg.search': 'Searching: {name} ({i}/{n})',
    'bg.bought': 'Bought: {name} — {p}{x}',
    'bg.noListing': '{name}: no market listings',
    'bg.overCap': '{name}: cheapest {p} > limit {c}',
    'bg.overRef': '{name}: {p} is far above fut.gg ({f}) and no cheaper listing could be confirmed — skipped',
    'bg.sniped': '{name}: every listing was bought by someone else',
    'bg.unsupported': "{name}: this set's cards can't be verified in the Web App — syncing and buying are disabled",
    'bg.tpFull': 'Transfer list full ({n}/100) — clear it and try again',
    'bg.syncFailN': ' · {n} sets could not be synced',
    'bg.restarted': 'Extension restarted — start the task again',
    'bg.taskFail': 'Task failed: {e}',
    'bg.gradeHint': ' · remember to grade it in game',
    'us.extWarn': "The Gallery Grab Chrome extension also seems to be installed. Don't use both: disable one, or the menu tab and purchases may get mixed up.",
    'bg.budget': 'budget reached',
    'bg.coinsLow': 'not enough coins',
    'bg.relisted': ' · listed at {p} (est. {net})',
    'bg.tp': ' · in transfer list',
    'bg.tpFail': ' · could not move to transfer list ({r})',
    'bg.listFail': ' · could not list ({e})',
    'bg.done1': '{name}: {n} cards bought',
    'bg.done1b': ' — {c}/{r}, grade {g}',
    'bg.planDone': 'Plan finished: {n} cards bought',
    'bg.autoNone.none': '{name}: no solution, skipped',
    'bg.autoNone.done': '{name}: every grade up to the target is already earned, skipped',
    'bg.autoNone.coins': "{name}: coins/budget don't cover any grade, skipped",
    'bg.autoNone.listing': '{name}: required cards have no listings, skipped',
    'bg.autoFell': '{name}: {from} not reachable → {to}',
    'bg.autoReady': '{name}: you own every card for {g} — grade it in game',
    'sel.mode': 'Multi-select',
    'sel.mode.title': 'Pick several sets, set a target grade, buy them in order',
    'sel.count': '{n} sets selected',
    'sel.target': 'Target',
    'sel.target.max': 'Highest',
    'sel.auto': 'Auto',
    'sel.tabAll': 'Select this tab',
    'sel.clear': 'Clear',
    'sel.close': 'Close',
    'sel.empty': 'Click cards to select sets.',
    'sel.buy': 'Buy in order ({n} sets · {k} cards ≈ {c})',
    'sel.confirm': 'Confirm — buy {n} sets in order (≈ {c})',
    'sel.fell': '{from} not reachable',
    'sel.why.none': 'no solution',
    'sel.why.done': 'nothing higher',
    'sel.avail': 'Available: {c}',
    'sel.avail.none': 'Available: no limit (coins unknown)',
    'sel.avail.title': 'Current coins; limited to what is left of the gallery budget if one is set',
    'sel.why.coins': 'not enough coins',
    'sel.why.listing': 'no listings',
    'sel.unsynced': 'not synced · skipped',
    'sel.ready': 'ready · grade in game',
    'sel.note': 'Sets are bought in this order. Coins (and the gallery budget) are shared in order: a set that cannot afford its target drops to a lower grade automatically. Re-checked with current coins and prices while buying.',
    'sel.remove': 'Remove from list',
    'bg.catalog': 'Catalog',
    'sr.471': 'Account trade ban / permission denied (471)',
    'sr.494': 'Transfer market locked (494)',
    'sr.429': 'Rate limit (429)',
    'sr.captcha': 'Captcha detected ({s}) — solve it in the Web App',
    'sr.softban': 'Soft ban / service error ({s})',
    'sr.session': 'Session invalid ({s}) — EA closed the session. Reload the Web App and log in. Opening FUT on console / Companion with the same account, or having several Web App tabs open, ends the Web App session.',
  };

  function detectLang() {
    try { return String(navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'; } catch (_) { return 'tr'; }
  }
  const localeOf = (lang) => (lang === 'en' ? 'en-GB' : 'tr-TR');

  // t(anahtar, { yer: değer }) — eksik çeviride Türkçeye, o da yoksa anahtara düşer.
  function makeT(lang) {
    const d = lang === 'en' ? EN : TR;
    return (k, v = {}) => String(d[k] ?? TR[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (v[n] ?? ''));
  }

  // Galeri seti hesapları — saf fonksiyonlar (Chrome API'si yok; node ile de denenebilir).

  const TR_T = makeT('tr');   // metin üreten fonksiyonlarda t verilmezse Türkçe
  // Kart (def) biçimi: { def, base, name, r, rare, team, league, pos, col (isCollected), sc (gradingScore) }
  // Kural (Web App verisiyle doğrulandı): toplanan kartlar puana göre sıralanır, ilk `required` tanesinin
  // puanı toplanır; bu toplam not merdiveniyle karşılaştırılır.

  const GRADES = ['D', 'C', 'B', 'A', 'S'];
  const TAX = 0.05;

  function counted(set, defs) {
    return defs.filter((d) => d.col).sort((a, b) => b.sc - a.sc).slice(0, set.required);
  }

  function gradeFor(set, score) {
    const ladder = [...(set.grades || [])].sort((a, b) => a.score - b.score);
    let cur = null;
    for (const g of ladder) { if (score >= g.score) cur = g; else break; }
    const next = ladder.find((g) => g.score > score) || null;
    const nextPaying = ladder.find((g) => g.score > score && g.tokens > 0) || null;
    const earned = ladder.filter((g) => score >= g.score).reduce((a, g) => a + (g.tokens || 0), 0);
    return {
      grade: cur?.g || null, next, nextPaying, earned,
      need: next ? next.score - score : 0,
      needPaying: nextPaying ? nextPaying.score - score : 0,
      maxTokens: set.maxTokens ?? ladder.reduce((a, g) => a + (g.tokens || 0), 0),
    };
  }

  // Oyunda kazanılan derece geri gitmez, ama kartlar satılınca EA isCollected'ı false yapar ve hesap düşer.
  // set.floor = bilinen oyun puanı (applyFloors); score = max(kulüpteki kartlarla hesaplanan, floor), live = hesaplanan.
  function summarise(set, defs) {
    const top = counted(set, defs);
    const live = top.reduce((a, d) => a + (d.sc || 0), 0);
    const score = Math.max(live, set.floor || 0);
    return { collected: top.length, required: set.required, total: defs.length, score, live, ...gradeFor(set, score) };
  }

  // graded = galleryGraded[setId] = { best, manual } — best: eşitlemelerde görülen en yüksek puan,
  // manual: kullanıcının girdiği oyundaki derece (varsa best yerine o derecenin eşiği geçerli)
  function floorScore(set, graded) {
    if (!graded) return 0;
    if (graded.manual) return set.grades?.find((g) => g.g === graded.manual)?.score || 0;
    return graded.best || 0;
  }
  function applyFloors(sets, graded = {}) {
    for (const s of sets) s.floor = floorScore(s, graded[s.id]);
    return sets;
  }

  // Boş slotları en ucuz toplanmamış kartlarla doldurma planı.
  // prices: { [def]: coin } — fiyatı bilinmeyen ya da ilanı olmayan kartlar plana girmez.
  function cheapestFill(set, defs, prices, slots = null) {
    const free = slots ?? Math.max(0, set.required - counted(set, defs).length);
    const pick = defs
      .filter((d) => !d.col && prices[d.def] > 0)
      .sort((a, b) => prices[a.def] - prices[b.def] || b.sc - a.sc)
      .slice(0, free);
    const coins = pick.reduce((a, d) => a + prices[d.def], 0);
    // Satın alınan kartlar da toplanmış sayılır: yeni puan = eski ilk-N + seçilenler (yine ilk N).
    const after = summarise(set, defs.map((d) => (pick.includes(d) ? { ...d, col: true } : d)));
    return { pick, free, coins, tax: Math.ceil(coins * TAX), after };
  }

  // Fiyatı bakılacak adaylar: toplanmamış kartlar; düşük rating (ucuz olma ihtimali yüksek) önce.
  function priceCandidates(set, defs, extra = 3) {
    const free = Math.max(0, set.required - counted(set, defs).length);
    return defs.filter((d) => !d.col).sort((a, b) => a.r - b.r || a.sc - b.sc).slice(0, free + extra);
  }

  // EA definitionId = baseId + 2^24 * sürüm
  const baseOf = (def) => def % 16777216;

  // ---------------------------------------------------------------- eşitleme süresi tahmini
  // Setin istek sayısı: son eşitlemede ölçülen (summary.reqs); yoksa takım/lig sayısından tahmin.
  const SYNC_DEFAULT_SEC = 0.9;   // istek başına (ölçüm yoksa)
  const PAGE_GAP = 0.45;                 // background.js pause() ortalaması
  const SET_GAP = 0.5;                   // background.js setGap() ortalaması
  function setRequests(set, sum) {
    if (sum?.reqs) return sum.reqs;
    const f = set.filter || {};
    if (f.teams) return f.teams.length;
    if (f.leagues) return f.leagues.length * 6;
    if (f.rarities) return 2;
    return 0;
  }
  function syncEstimate(sets, summary = {}, secPerReq = null) {
    const per = secPerReq || SYNC_DEFAULT_SEC;
    let reqs = 0;
    let sec = 0;
    const kinds = { club: 0, league: 0, rarity: 0 };
    for (const s of sets) {
      const n = setRequests(s, summary[s.id]);
      if (!n) continue;
      reqs += n;
      sec += n * per + Math.max(0, n - 1) * PAGE_GAP + SET_GAP;
      kinds[s.filter.teams ? 'club' : s.filter.leagues ? 'league' : 'rarity']++;
    }
    return { sets: kinds.club + kinds.league + kinds.rarity, reqs, sec: Math.round(sec), kinds };
  }
  function fmtDur(sec, t = TR_T) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return t('dur.s', { s: sec });
    if (sec >= 3600) return t('dur.h', { h: Math.floor(sec / 3600), m: Math.round((sec % 3600) / 60) });
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? t('dur.ms', { m, s }) : t('dur.m', { m });
  }

  // ---------------------------------------------------------------- fut.gg çözümleri
  // set.sol = { cards: [[def, base, overall, rarity, score, price]], tiers: [{ g, cost, tokens, status, idx }] }
  // defs verilirse (eşitlenmiş set) kartlar EA'nın isCollected bilgisiyle ve adlarıyla eşleşir.
  // live = { [def]: coin } — pazardan az önce bakılan fiyat (0 = ilan yok); varsa fut.gg fiyatının yerine geçer.
  function planFromTier(set, grade, defs = null, live = null) {
    const tier = set.sol?.tiers?.find((t) => t.g === grade);
    if (!tier) return null;
    const byDef = new Map((defs || []).map((d) => [d.def, d]));
    const cards = tier.idx.map((i) => {
      const [def, base, r, rare, score, price] = set.sol.cards[i];
      const d = byDef.get(def);
      const lv = live && def in live ? live[def] : null;
      // sc: galeri puanı — set eşitlendiyse EA'nın gradingScore'u, değilse fut.gg puanı
      const sc = d?.sc > 0 ? d.sc : score;
      return { def, base, r, rare, score, sc, scSrc: d?.sc > 0 ? 'EA' : 'fut.gg', price, live: lv, cost: lv > 0 ? lv : price, name: d?.name || '', col: !!d?.col, known: !!d };
    });
    const open = cards.filter((c) => !c.col);
    const need = open.reduce((a, c) => a + c.cost, 0);
    const g = set.grades.find((x) => x.g === grade);
    return {
      grade, tier, cards, cost: tier.cost, need, tax: Math.ceil(need * TAX),
      tokens: tier.tokens, threshold: g?.score ?? null, synced: !!defs,
      missing: open.length,
      sumSc: cards.reduce((a, c) => a + c.sc, 0),   // çözüm kartlarının toplam puanı (bonus etiketler hariç)
      priced: open.filter((c) => c.live != null).length,   // canlı fiyatı bilinen eksik kart
      noListing: open.filter((c) => c.live === 0).length,
    };
  }

  // Varsayılan sekme: henüz ulaşılmamış, token veren ve çözümü olan ilk not; yoksa çözümü olan en yüksek not.
  function defaultTier(set, score = 0) {
    const tiers = set.sol?.tiers || [];
    const ladder = set.grades || [];
    const ok = (t) => { const g = ladder.find((x) => x.g === t.g); return g && g.score > score && (g.tokens || 0) > 0; };
    return (tiers.find(ok) || tiers[tiers.length - 1])?.g || null;
  }

  // Hedef dereceden (yoksa en yüksekten) aşağı doğru ulaşılabilir ilk derece.
  // Ulaşılabilir: fut.gg çözümü var, henüz kazanılmamış, eksik kartlardan ilanı olmadığı bilinen yok ve
  // eksiklerin maliyeti coins'i aşmıyor (coins null → sınır yok). Dönen: { g, plan, fell } | { g: null, why }
  // why: 'none' (çözüm yok/desteklenmiyor) | 'done' (hedefe kadar hepsi kazanılmış) | 'coins' | 'listing'
  function pickGrade(set, defs = null, live = null, target = null, coins = null) {
    const tiers = set.sol?.tiers || [];
    if (!tiers.length || set.filter?.unsupported) return { g: null, why: 'none' };
    const score = defs ? summarise(set, defs).score : 0;
    const top = target && GRADES.includes(target) ? GRADES.indexOf(target) : GRADES.length - 1;
    const cands = tiers.filter((t) => GRADES.indexOf(t.g) <= top).sort((a, b) => GRADES.indexOf(b.g) - GRADES.indexOf(a.g));
    let why = 'done';
    for (const t of cands) {
      const g = set.grades.find((x) => x.g === t.g);
      if (!g || g.score <= score) continue;   // zaten kazanılmış
      const plan = planFromTier(set, t.g, defs, live);
      if (plan.noListing) { why = 'listing'; continue; }
      if (coins != null && plan.need > coins) { if (why !== 'listing') why = 'coins'; continue; }
      return { g: t.g, plan, fell: !!target && t.g !== target };
    }
    return { g: null, why };
  }

  // Çoklu seçim: setler sırayla, coin'ler sırayla paylaştırılarak (her set kalan coin'le kendi en yüksek derecesini alır).
  // items = [{ set, defs, grade? }] (grade verilmişse o set için hedef odur). Dönen: [{ set, g, plan, fell, why }], toplam
  function pickBatch(items, live = null, target = null, coins = null) {
    let left = coins;
    const rows = items.map(({ set, defs, grade }) => {
      const r = pickGrade(set, defs, live, grade || target, left);
      if (r.g && left != null) left -= r.plan.need;
      return { set, ...r };
    });
    const need = rows.reduce((a, r) => a + (r.plan?.need || 0), 0);
    return { rows, need, tax: Math.ceil(need * TAX), cards: rows.reduce((a, r) => a + (r.plan?.missing || 0), 0) };
  }

  // ---------------------------------------------------------------- token planlayıcı
  // Setin henüz ulaşılmamış notları için seçenekler: kazanç = kademe tokenı − şu an kazanılan,
  // maliyet = çözümde sende olmayan kartların fut.gg fiyatı (set eşitlenmediyse tamamı → tahmini).
  function tierOptions(set, defs = null) {
    // Holografik / Başlangıç gibi setlerde sahiplik doğrulanamıyor: planlamaya ve alıma hiç girmez
    if (!set.sol?.tiers?.length || set.filter?.unsupported) return [];
    const score = defs ? summarise(set, defs).score : 0;
    const earned = defs ? gradeFor(set, score).earned : 0;
    const out = [];
    for (const t of set.sol.tiers) {
      const g = set.grades.find((x) => x.g === t.g);
      if (!g || g.score <= score) continue;
      const gain = t.tokens - earned;
      if (gain <= 0) continue;
      const p = planFromTier(set, t.g, defs);
      // ready: çözümün bütün kartları sende — alınacak kart yok, oyunda notlandırmak yeterli olabilir
      // (bizim puanımız bonus etiketleri içermediği için not burada düşük görünebilir)
      out.push({ setId: set.id, g: t.g, gain, cost: p.need, tax: p.tax, missing: p.missing, est: !defs, ready: !!defs && p.missing === 0 });
    }
    return out;
  }

  // Grid için: en ucuz token başı maliyetli sonraki seçenek
  function bestNext(set, defs = null) {
    const opts = tierOptions(set, defs);
    if (!opts.length) return null;
    return opts.reduce((a, o) => ((o.cost + 1) / o.gain < (a.cost + 1) / a.gain ? o : a));
  }

  // Çoklu seçim sırt çantası: her setten en fazla bir not. groups = [[opt,…], …]
  // target verilirse: target tokena en ucuz ulaşan plan. budget verilirse: bu bütçeyle en çok token.
  function planTokens(groups, { target = null, budget = null } = {}) {
    groups = groups.filter((g) => g.length);
    const cap = target ?? groups.reduce((a, g) => a + Math.max(...g.map((o) => o.gain)), 0);
    if (!cap || !groups.length) return { picks: [], tokens: 0, cost: 0, tax: 0, reached: !target };
    let dp = new Float64Array(cap + 1).fill(Infinity);
    dp[0] = 0;
    const choice = [];   // choice[k][t] = seçilen seçenek indeksi + 1 (0 = seçilmedi); t: yeni durum
    const from = [];
    for (const g of groups) {
      const nd = dp.slice();
      const ch = new Int16Array(cap + 1);
      const fr = new Int32Array(cap + 1).fill(-1);
      for (let t = 0; t <= cap; t++) {
        if (dp[t] === Infinity) continue;
        g.forEach((o, i) => {
          const nt = Math.min(cap, t + o.gain);
          const c = dp[t] + o.cost;
          if (c < nd[nt]) { nd[nt] = c; ch[nt] = i + 1; fr[nt] = t; }
        });
      }
      choice.push(ch); from.push(fr);
      dp = nd;
    }
    let end;
    if (target != null) end = dp[cap] < Infinity ? cap : -1;
    else {
      end = 0;
      for (let t = cap; t >= 0; t--) if (dp[t] <= (budget ?? Infinity)) { end = t; break; }
    }
    if (end < 0) {
      // hedefe ulaşılamıyor: ulaşılabilen en yüksek tokenı döndür
      for (let t = cap; t >= 0; t--) if (dp[t] < Infinity) { end = t; break; }
    }
    const picks = [];
    let t = end;
    for (let k = groups.length - 1; k >= 0; k--) {
      const c = choice[k][t];
      if (c && from[k][t] >= 0) { picks.push(groups[k][c - 1]); t = from[k][t]; }
    }
    picks.reverse();
    const tokens = picks.reduce((a, o) => a + o.gain, 0);
    const cost = picks.reduce((a, o) => a + o.cost, 0);
    return { picks, tokens, cost, tax: Math.ceil(cost * TAX), reached: target == null || tokens >= target };
  }

  // Hall of FUT token mağazası (FC 27)
  const HALL_OF_FUT = [
    { tokens: 300, names: 'McGeady, Layún' },
    { tokens: 400, names: 'Guarín, Florenzi, Gervinho, Błaszczykowski, Ibarbo' },
    { tokens: 500, names: 'David Luiz, Doumbia, Richards, Walcott, Valencia, Balotelli' },
    { tokens: 750, names: 'Pato, Hulk' },
  ];

  // ---------------------------------------------------------------- fiyat basamakları
  // EA BIN basamakları: <1.000 → 50, <10.000 → 100, <50.000 → 250, <100.000 → 500, üstü 1.000; en düşük BIN 200
  const binStep = (p) => (p < 1000 ? 50 : p < 10000 ? 100 : p < 50000 ? 250 : p < 100000 ? 500 : 1000);
  const roundBin = (p) => Math.max(200, Math.floor(p / binStep(p)) * binStep(p));

  // ---------------------------------------------------------------- yeniden listeleme fiyatı
  // cfg = { base: 'paid' | 'market', pct: -20…20 }; ref = fut.gg fiyatı (varsa)
  function relistPrice(paid, ref, cfg = {}) {
    const base = cfg.base === 'market' && ref > 0 ? ref : paid;
    return roundBin(base * (1 + (Number(cfg.pct) || 0) / 100));
  }

  // ---------------------------------------------------------------- alım fiyat sınırı
  // Kart başına en yüksek ödeme: canlı fiyat bakıldıysa canlı × 1,25; bakılmadıysa fut.gg fiyatının 1,4 katı ya da
  // fut.gg + 2.000 (hangisi büyükse). maxCard (kullanıcı ayarı, 0 = yok) her durumda üst sınırdır.
  // Dönen: geçerli BIN basamağına yuvarlanmış sınır; 0 = sınır yok (hiçbir referans ve ayar yoksa).
  const MAX_CARD_DEFAULT = 0;
  function priceCap(card, maxCard = MAX_CARD_DEFAULT) {
    const live = card?.live > 0 ? card.live : 0;
    const ref = card?.price > 0 ? card.price : 0;
    let cap = live ? Math.ceil(live * 1.25) : ref ? Math.max(ref * 1.4, ref + 2000) : 0;
    if (maxCard > 0) cap = cap ? Math.min(cap, maxCard) : maxCard;
    return cap ? roundBin(cap) : 0;
  }

  // Alım hedefleri: { def, name, ref, cap, range: { minb?, maxb? } }. maxb = fiyat sınırı; özel sürümlerde (rare > 1)
  // baz kart ilanları arasında kaybolmasın diye beklenen fiyatın yarısı alt sınır. ref: "piyasa" satış fiyatı dayanağı.
  function buyTargets(cards, maxCard = MAX_CARD_DEFAULT) {
    return cards.map((c) => {
      const ref = c.live > 0 ? c.live : c.price || 0;
      const cap = priceCap(c, maxCard);
      const minb = c.rare > 1 && ref >= 1000 ? roundBin(ref * 0.5) : 0;
      const range = {};
      if (minb && (!cap || minb < cap)) range.minb = minb;
      if (cap) range.maxb = cap;
      return { def: c.def, name: c.name || '#' + c.def, ref, gg: c.price || 0, cap, range: Object.keys(range).length ? range : null };
    });
  }

  // Şüpheli fiyat: bulunan fiyat fut.gg'nin 1,4 katından fazla VE arama "daha ucuzu yok" diye kesinleşmedi
  // (sayfalar başka sürümlerle doluydu). Böyle fiyat ne alınır ne canlı fiyat olarak saklanır.
  const OVER_REF = 1.4;
  function suspiciousPrice(price, gg, sure) {
    return !sure && gg >= 1000 && price > gg * OVER_REF;
  }

  // ---------------------------------------------------------------- şu an alınabilen token
  // fut.gg'nin ulaşılabilir notları (sol.tiers, kümülatif token) içinden en yükseği − kazanılan.
  // Çözümü olmayan (pazarda ulaşılamayan) notların tokenı sayılmaz. sol yoksa null (bilinmiyor).
  function reachableTokens(set, sum = null) {
    if (!set.sol?.tiers?.length || set.filter?.unsupported) return null;
    const top = Math.max(0, ...set.sol.tiers.map((t) => t.tokens || 0));
    const earned = sum?.earned ?? 0;
    return Math.max(0, top - earned);
  }
  function tokenLabel(set, sum = null, t = TR_T) {
    const r = reachableTokens(set, sum);
    const earned = sum?.earned ?? 0;
    const got = earned ? t('lbl.earned', { n: earned }) : '';
    return got + (r == null ? t('lbl.max', { max: set.maxTokens }) : t('lbl.reach', { r, max: set.maxTokens }));
  }

  // Şu an kazanılabilen galeri puanı: pazarda ulaşılabilen en yüksek notun fut.gg çözümü alınırsa set puanı
  // ne kadar artar. defs varsa (eşitlenmiş) EA puanları + sende olanlar; yoksa fut.gg puanlarıyla sıfırdan.
  function reachableScore(set, defs = null) {
    const tiers = set.sol?.tiers;
    if (!tiers?.length || set.filter?.unsupported) return null;
    const top = tiers.reduce((a, x) => (x.tokens >= a.tokens ? x : a));
    const pool = new Map((defs || []).map((d) => [d.def, d]));
    const before = defs ? summarise(set, defs).score : 0;
    for (const i of top.idx) {
      const [def, , , , score] = set.sol.cards[i];
      const d = pool.get(def);
      pool.set(def, { ...(d || { def, sc: score }), sc: d?.sc > 0 ? d.sc : score, col: true });
    }
    const after = summarise(set, [...pool.values()]).score;
    return Math.max(0, after - before);
  }

  // Set kartındaki token satırları (alt alta): [etiket, değer, sınıf]; rs = reachableScore
  function tokenRows(set, sum = null, next = null, t = TR_T, rs = null) {
    const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',') + 'K' : String(n));
    const r = reachableTokens(set, sum);
    const rows = [];
    if (next) {
      rows.push(next.ready
        ? [t('row.next'), t('row.ready', { gain: next.gain }), 'ok']
        : [t('row.next'), t('row.nextVal', { gain: next.gain, tax: k(next.tax) }) + (next.est ? ' *' : ''), 'nx']);
    }
    if (sum?.earned) rows.push([t('row.earned'), t('tokens', { n: sum.earned }), 'ok']);
    rows.push([t('row.reach'), r == null ? '—' : t('tokens', { n: r }), r ? 'acc' : 'zero']);
    if (rs != null) rows.push([t('row.reachPts'), rs ? t('pts', { n: rs.toLocaleString(t('locale')) }) : '—', rs ? 'g' : 'zero']);
    rows.push([t('row.max'), t('tokens', { n: set.maxTokens }), 'mut']);
    return rows;
  }

  // Galeri seviyesi kilometre taşları (ödül her 5 seviyede, en fazla 25)
  const nextMilestone = (lv) => (lv >= 25 ? null : Math.min(25, (Math.floor((lv || 0) / 5) + 1) * 5));

  // ---------------------------------------------------------------- genel özet (setlere tıklamadan)
  // sums: gallerySummary, defsOf(setId) → defs | null
  function overview(sets, sums = {}, defsOf = () => null) {
    let score = 0, earned = 0, reach = 0, reachCost = 0, max = 0, done = 0, synced = 0, reachPts = 0;
    for (const s of sets) {
      const m = sums[s.id];
      max += s.maxTokens;
      if (m) { synced++; score += m.score || 0; earned += m.earned || 0; if (m.collected >= m.required) done++; }
      reachPts += reachableScore(s, defsOf(s.id)) || 0;
      const r = reachableTokens(s, m);
      if (r) {
        reach += r;
        // ulaşılabilen en yüksek not için sende olmayan kartların alış toplamı
        const opts = tierOptions(s, defsOf(s.id));
        if (opts.length) reachCost += opts.reduce((a, o) => (o.gain > a.gain ? o : a)).cost;
      }
    }
    return { score, earned, reach, reachCost, reachTax: Math.ceil(reachCost * TAX), max, done, total: sets.length, synced, reachPts };
  }

  // ---------------------------------------------------------------- ızgara sıralama / filtre
  // sums: gallerySummary, next: Map(setId → bestNext seçeneği)
  // Etiketler i18n sözlüğünde: 'sort.<anahtar>' / 'show.<anahtar>'
  const SORT_KEYS = ['', 'tokens', 'tokensAsc', 'max', 'earned', 'left', 'value', 'cheap', 'near', 'progress'];
  const SHOW_KEYS = ['all', 'open', 'grade', 'done', 'unsynced'];
  const sortOptions = (t = TR_T) => SORT_KEYS.map((k) => [k, t('sort.' + k)]);
  const showOptions = (t = TR_T) => SHOW_KEYS.map((k) => [k, t('show.' + k)]);
  // toGrade: { setId: at } — kart alınıp oyunda notlandırılması gereken setler
  function sortFilterSets(sets, sums = {}, next = new Map(), sortBy = '', show = 'all', toGrade = {}) {
    const earned = (x) => sums[x.id]?.earned ?? 0;
    const left = (x) => Math.max(0, x.maxTokens - earned(x));
    const reach = (x) => reachableTokens(x, sums[x.id]) ?? -1;
    const n = (x) => next.get(x.id);
    let out = sets;
    if (show === 'open') out = out.filter((x) => reach(x) > 0 && !x.filter?.unsupported);
    else if (show === 'grade') out = out.filter((x) => toGrade[x.id] || n(x)?.ready);
    else if (show === 'done') out = out.filter((x) => sums[x.id] && left(x) === 0);
    else if (show === 'unsynced') out = out.filter((x) => !sums[x.id] && !x.filter?.unsupported);
    const by = {
      tokens: (a, b) => reach(b) - reach(a) || b.maxTokens - a.maxTokens,
      tokensAsc: (a, b) => reach(a) - reach(b) || a.maxTokens - b.maxTokens,
      max: (a, b) => b.maxTokens - a.maxTokens,
      earned: (a, b) => earned(b) - earned(a) || b.maxTokens - a.maxTokens,
      left: (a, b) => left(b) - left(a),
      value: (a, b) => (n(a) ? n(a).tax / n(a).gain : 9e12) - (n(b) ? n(b).tax / n(b).gain : 9e12),
      cheap: (a, b) => (n(a)?.tax ?? 9e12) - (n(b)?.tax ?? 9e12),
      near: (a, b) => (n(a)?.missing ?? 999) - (n(b)?.missing ?? 999) || (n(a)?.tax ?? 9e12) - (n(b)?.tax ?? 9e12),
      progress: (a, b) => (sums[b.id] ? sums[b.id].score / (b.grades.at(-1)?.score || 1) : -1) - (sums[a.id] ? sums[a.id].score / (a.grades.at(-1)?.score || 1) : -1),
    }[sortBy];
    return by ? [...out].sort(by) : out;
  }

  // ---------------------------------------------------------------- teşhis
  // "Eşitliyor ama her set 0/N" sorunu için: Web App'in konsept aramasının döndürdüğü nesne + aynı isteğin ham JSON'u.
  // Setin bütün takımları/ligleri sırayla sorgulanır. Sayfa bağlamında çalışır (eklentide executeScript MAIN,
  // userscript'te unsafeWindow). executeScript fonksiyonu kopyaladığı için kendi içinde bağımsız olmalı.
  // Kimlik bilgisi (persona, e-posta, SID değeri) döndürmez; kart alanları oyuncu verisidir.
  function diagProbe(crits, withRaw = true) {
    /* global unsafeWindow */
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const list = Array.isArray(crits) ? crits : [crits];
    const RX = /collect|grad|galler|owned|loan|untrad/i;
    const val = (v) => {
      if (typeof v === 'function') return 'fn';
      try { return v === undefined ? 'undefined' : JSON.stringify(v).slice(0, 40); } catch (_) { return typeof v; }
    };
    // Nesnenin ve prototip zincirinin ilgili alanları (getter'lar dahil)
    const fields = (o) => {
      const out = {};
      for (let p = o, d = 0; p && p !== Object.prototype && d < 5; p = Object.getPrototypeOf(p), d++) {
        for (const k of Object.getOwnPropertyNames(p)) {
          if (!RX.test(k) || k in out) continue;
          try { out[k] = val(o[k]); } catch (_) { out[k] = 'err'; }
        }
      }
      return out;
    };
    // Aynı alanın öğeler arasındaki değer dağılımı (en sık 6 değer)
    const dist = (items, get) => {
      const m = {};
      for (const it of items) { let k; try { k = val(get(it)); } catch (_) { k = 'err'; } m[k] = (m[k] || 0) + 1; }
      const e = Object.entries(m).sort((a, b) => b[1] - a[1]);
      const out = Object.fromEntries(e.slice(0, 6));
      if (e.length > 6) out['…'] = e.length - 6;
      return out;
    };
    const methods = (o) => {
      const out = new Set();
      for (let p = o, d = 0; p && p !== Object.prototype && d < 5; p = Object.getPrototypeOf(p), d++) {
        for (const k of Object.getOwnPropertyNames(p)) if (/collect|galler|grad|concept|album|progress/i.test(k)) out.add(k);
      }
      return [...out];
    };
    const sid = () => { try { return W.services?.Authentication?.utasSession?.id || W.services?.Authentication?.getUtasSession?.()?.id || null; } catch (_) { return null; } };
    const ua = navigator.userAgent || '';
    const env = {
      browser: /OPR\//.test(ua) ? 'Opera' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'other',
      path: location.pathname.replace(/[^/a-z-]/gi, '').slice(0, 60),
      sid: !!sid(),
      services: Object.keys(W.services || {}),
      itemMethods: methods(W.services?.Item),
    };
    // Ham yanıtta toplanmış ve toplanmamış kartlarda değer kümesi hiç kesişmeyen alanlar (toplanmayla ilişkili olabilir)
    const splitKeys = (arr) => {
      const yes = arr.filter((i) => i?.isCollected === true), no = arr.filter((i) => i?.isCollected !== true);
      if (!yes.length || !no.length) return null;
      const keys = new Set(arr.flatMap((i) => Object.keys(i || {})));
      const out = {};
      for (const k of keys) {
        if (k === 'isCollected') continue;
        const a = new Set(yes.map((i) => val(i[k]))), b = new Set(no.map((i) => val(i[k])));
        if (a.size + b.size === arr.length) continue;   // her kartta farklı (kimlik vb.) — anlamsız
        if ([...a].every((v) => !b.has(v))) out[k] = { toplanan: [...a].slice(0, 3), diger: [...b].slice(0, 3) };
      }
      return out;
    };
    const one = (crit) => new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve({ crit, ...v }); } };
      setTimeout(() => finish({ error: 'timeout' }), 25000);
      try {
        if (!W.services?.Item?.searchConceptItems || !W.UTSearchCriteriaDTO) { finish({ error: 'not-ready' }); return; }
        const t0 = performance.now();
        // Kayıt tamponu doluysa getEntriesByType yeni isteği göstermez; gözlemci her durumda görür
        let seen = null, po = null;
        try {
          po = new W.PerformanceObserver((l) => { for (const e of l.getEntries()) if (/\/defid\?/.test(e.name)) seen = e; });
          po.observe({ type: 'resource' });
        } catch (_) {}
        const c = new W.UTSearchCriteriaDTO();
        c.type = W.SearchType.PLAYER;
        c.count = 100;
        c.offset = 0;
        if (crit.club) c.club = crit.club;
        if (crit.league) c.league = crit.league;
        if (crit.rarities) c.rarities = crit.rarities;
        const ref = {};
        W.services.Item.searchConceptItems(c).observe(ref, async (o, res) => {
          o.unobserve(ref);
          await new Promise((r) => setTimeout(r, 50));
          try { po?.disconnect(); } catch (_) {}
          const items = res?.response?.items || [];
          const obj = {
            success: !!res?.success, status: res?.status ?? null, n: items.length,
            isCollected: dist(items, (i) => i.isCollected),
            scoreGt0: items.filter((i) => Number(i.gradingScore) > 0).length,
            first: items[0] ? fields(items[0]) : null,
            firstCollected: (() => { const i = items.find((x) => x.isCollected); return i ? fields(i) : null; })(),
          };
          // Genel taramada yalnız sayılar: nesne isCollected taşıyorsa ham yanıt isteği atılmaz,
          // taşımıyorsa (Opera'da görüldü) sayım ham yanıttan yapılır (eşitlemeyle aynı yol)
          const hasField = items.some((i) => typeof i.isCollected === 'boolean');
          if (!withRaw && (hasField || !items.length)) { finish({ obj: { success: obj.success, status: obj.status, n: obj.n, yes: items.filter((i) => i.isCollected === true).length } }); return; }
          // Aynı isteğin ham yanıtı: Web App'in attığı /defid adresi ağ kayıtlarından
          let raw = null;
          try {
            const all = performance.getEntriesByType('resource');
            let e = seen || all.filter((x) => x.startTime >= t0 - 5 && /\/defid\b/.test(x.name)).pop();
            // Kayıt yoksa (Web App önbellekten verdi ya da tarayıcının kayıt tamponu eşitlemede doldu):
            // adresi daha önceki bir UT isteğinin kökünden aynı biçimde kur
            if (!e && crit.club) {
              const base = all.map((x) => x.name.match(/^https:\/\/[^/]+\/ut\/game\/fc\d+\//)?.[0]).find(Boolean);
              if (base) e = { name: `${base}defid?count=100&sort=desc&start=0&type=player&team=${crit.club}`, built: true };
            }
            if (!e) raw = { error: 'no-request' };
            else {
              const r = await W.fetch(e.name, { headers: { 'X-UT-SID': sid() || '', Accept: 'application/json' }, credentials: 'omit' });
              const j = await r.json().catch(() => null);
              const arr = !j ? [] : Array.isArray(j) ? j : j.itemData || j.items || Object.values(j).find(Array.isArray) || [];
              if (!withRaw) {
                const yes = r.ok ? arr.filter((i) => i?.isCollected === true).length : null;
                finish({ obj: { success: obj.success, status: obj.status, n: obj.n, yes, src: 'raw' }, ...(r.ok ? {} : { error: `raw HTTP ${r.status}` }) });
                return;
              }
              const keys = new Set(arr.flatMap((i) => Object.keys(i || {})));
              raw = {
                status: r.status, built: !!e.built, query: e.name.split('?')[1]?.replace(/[^\w=&,.-]/g, '').slice(0, 160) || '',
                top: j && !Array.isArray(j) ? Object.keys(j).slice(0, 10) : [], n: arr.length,
                fields: Object.fromEntries([...keys].filter((k) => RX.test(k)).map((k) => [k, dist(arr, (i) => i?.[k])])),
                allKeys: [...keys].sort(),
                split: splitKeys(arr),
              };
            }
          } catch (err) { raw = { error: String(err).slice(0, 120) }; }
          if (!withRaw) { finish({ obj: { success: obj.success, status: obj.status, n: obj.n, yes: null }, error: raw?.error || 'raw' }); return; }
          finish({ obj, raw });
        });
      } catch (err) { finish({ error: String(err).slice(0, 120) }); }
    });
    return (async () => {
      const parts = [];
      for (const c of list) {
        parts.push(await one(c));
        if (list.length > 1) await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
      }
      return { env, parts };
    })();
  }

  // "Derin teşhis": oyundaki galeri derecesinin Web App'te bir yerde olup olmadığını aramak için Web App'in
  // tamamını tarar. EA sunucusuna istek ATMAZ: yalnız sayfadaki nesneler, tarayıcının zaten yüklediği
  // uygulama kodu (JS) ve dil dosyası okunur. Sayfa bağlamında çalışır, kendi içinde bağımsız olmalı.
  // Kimlik bilgisi döndürmez (SID/persona/e-posta değerleri, depolama değerleri yok; yalnız adlar).
  function deepProbe() {
    /* global unsafeWindow */
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const KW = /galler|grad(e|ing)|collect|album|concept|milestone|objective|reward|token|season|progress|achiev|trophy|stamp/i;
    const NARROW = /galler|grading|graded|gradescore|isgrade|collected|album|setgrade|tierreward/i;
    const ua = navigator.userAgent || '';
    const uniq = (a) => [...new Set(a)];
    const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
    const protoNames = (o, depth = 6) => {
      const out = new Set();
      for (let p = o, d = 0; p && p !== Object.prototype && p !== Function.prototype && d < depth; p = Object.getPrototypeOf(p), d++) {
        let ks = [];
        try { ks = Object.getOwnPropertyNames(p); } catch (_) {}
        for (const k of ks) if (k !== 'constructor') out.add(k);
      }
      return [...out];
    };
    const kind = (v) => (v == null ? String(v) : typeof v === 'function' ? (/^class\b/.test(Function.prototype.toString.call(v)) || v.prototype && Object.getOwnPropertyNames(v.prototype).length > 1 ? 'class' : 'fn') : Array.isArray(v) ? 'array' : typeof v);
    const out = { env: {}, globals: {}, services: {}, repositories: {}, enums: {}, requests: {}, bundle: {}, loc: {}, storage: {}, errors: [] };
    const err = (where, e) => out.errors.push(`${where}: ${String(e?.message || e).slice(0, 100)}`);

    // 1) Ortam
    try {
      out.env = {
        browser: /OPR\//.test(ua) ? 'Opera' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'other',
        path: location.pathname.replace(/[^/a-z0-9.-]/gi, '').slice(0, 80),
        ready: !!W.services?.Item, sid: !!(W.services?.Authentication?.utasSession?.id),
        versions: Object.fromEntries(Object.getOwnPropertyNames(W).filter((k) => /version|build|^APP_/i.test(k) && /string|number/.test(typeof W[k])).slice(0, 10).map((k) => [k, String(W[k]).slice(0, 40)])),
      };
    } catch (e) { err('env', e); }

    // 2) Global adlar: UT sınıfları ve anahtar kelimeli her şey
    let gnames = [];
    try {
      gnames = Object.getOwnPropertyNames(W);
      const ut = gnames.filter((k) => /^(UT|EA|FUT)/.test(k));
      const hit = gnames.filter((k) => KW.test(k));
      out.globals = {
        total: gnames.length, utCount: ut.length,
        keyword: hit.sort().map((k) => { let v; try { v = W[k]; } catch (_) {} return `${k}:${kind(v)}`; }),
        // Anahtar kelimeli sınıfların prototip metotları (ör. UTGalleryViewController.prototype.*)
        classMethods: Object.fromEntries(hit.filter((k) => { try { return typeof W[k] === 'function' && W[k].prototype; } catch (_) { return false; } })
          .slice(0, 60).map((k) => [k, protoNames(W[k].prototype).slice(0, 60)])),
        utSample: ut.slice(0, 400),
      };
    } catch (e) { err('globals', e); }

    // 3) Servisler + depolar: bütün metot adları, anahtar kelimeliler ayrıca
    const svcDump = (root) => {
      const r = {};
      for (const k of Object.keys(root || {})) {
        let o; try { o = root[k]; } catch (_) { continue; }
        if (!o || typeof o !== 'object') { r[k] = kind(o); continue; }
        const names = protoNames(o);
        const hits = names.filter((n) => KW.test(n));
        r[k] = { n: names.length, hits, all: names.slice(0, 120) };
      }
      return r;
    };
    try { out.services = svcDump(W.services); } catch (e) { err('services', e); }
    try { out.repositories = svcDump(W.repositories); } catch (e) { err('repositories', e); }

    // 4) Sabit/enum nesneleri: anahtar kelimeli sabitler (ör. GalleryGradeType = { S: 4, ... })
    try {
      for (const k of gnames) {
        let v; try { v = W[k]; } catch (_) { continue; }
        let ks;
        try {
          if (!v || typeof v !== 'object' || Array.isArray(v) || v === W || v.nodeType) continue;
          ks = Object.keys(v);
        } catch (_) { continue; }   // başka kökenli çerçeve (iframe) erişimi hata atar
        if (!ks.length || ks.length > 300) continue;
        if (!ks.every((x) => /string|number|boolean/.test(typeof v[x]))) continue;
        if (KW.test(k) || ks.some((x) => KW.test(x))) out.enums[k] = Object.fromEntries(ks.slice(0, 40).map((x) => [x, v[x]]));
      }
    } catch (e) { err('enums', e); }

    // 5) Web App'in bu oturumda attığı istekler (adresler normalleştirilir: sayılar {n}, sorgu yalnız anahtar adları)
    const entries = (() => { try { return performance.getEntriesByType('resource'); } catch (_) { return []; } })();
    try {
      const ut = {}, hosts = {};
      for (const e of entries) {
        let u; try { u = new URL(e.name); } catch (_) { continue; }
        hosts[u.host] = (hosts[u.host] || 0) + 1;
        const m = u.pathname.match(/\/ut\/(game\/fc\d+|auth|delete|shards)?(\/.*)?$/);
        if (!m) continue;
        const k = (m[2] || m[1] || '/').replace(/\/\d+/g, '/{n}') + (u.search ? '?' + [...u.searchParams.keys()].sort().join('&') : '');
        ut[k] = (ut[k] || 0) + 1;
      }
      out.requests = { total: entries.length, hosts: top(hosts, 15), ut: top(ut, 80) };
    } catch (e) { err('requests', e); }

    // 6) Uygulama kodu (tarayıcının yüklediği JS dosyaları): galeri ile ilgili adres ve ad geçen yerler
    const jsUrls = uniq([
      ...[...document.scripts].map((s) => s.src).filter(Boolean),
      ...entries.map((e) => e.name).filter((n) => /\.js(\?|$)/.test(n)),
    ]).filter((u) => /^https:/.test(u) && !/google|facebook|doubleclick|analytics|optimizely|onetrust|cookielaw/i.test(u)).slice(0, 25);
    const locUrls = uniq(entries.map((e) => e.name).filter((n) => /\/loc\/.*\.json(\?|$)/i.test(n))).slice(0, 4);

    return (async () => {
      const idents = {}, paths = {}, strs = {};
      const files = [], ctx = [];
      for (const u of jsUrls) {
        try {
          const r = await W.fetch(u, { credentials: 'omit', cache: 'force-cache' });
          const s = await r.text();
          files.push({ f: u.split('/').pop().split('?')[0].slice(0, 50), kb: Math.round(s.length / 1024) });
          // Tanımlayıcılar: isGraded, galleryGrade, gradingScore ...
          for (const m of s.matchAll(/[A-Za-z_$][\w$]{2,60}/g)) if (NARROW.test(m[0])) idents[m[0]] = (idents[m[0]] || 0) + 1;
          // Galeri geçen yerlerin çevresi (±90 karakter): kodun neyi çağırdığını görmek için
          let end = -1;
          for (const m of s.matchAll(/galler|isgraded|graded/gi)) {
            if (ctx.length >= 60) break;
            if (m.index < end) continue;   // önceki parçanın içinde kalan eşleşme
            end = m.index + 90;
            ctx.push(s.slice(Math.max(0, m.index - 90), end).replace(/[\s]+/g, ' '));
          }
          // Tırnak içi metinler: adres parçaları ve anahtar adları
          for (const m of s.matchAll(/["'`]([^"'`\n]{2,120})["'`]/g)) {
            const v = m[1];
            if (/^\/?[\w{}.-]+(\/[\w{}.?=&%-]*)+$/.test(v) && (/\/ut\/|game\/|\/club|defid|concept/i.test(v) || NARROW.test(v))) paths[v] = (paths[v] || 0) + 1;
            else if (NARROW.test(v) && v.length < 80) strs[v] = (strs[v] || 0) + 1;
          }
        } catch (e) { err('js ' + u.split('/').pop().slice(0, 40), e); }
      }
      out.bundle = {
        files,
        identifiers: top(idents, 150),
        paths: top(paths, 150),
        strings: top(strs, 120),
        ctx,
      };
      // 7) Dil dosyası: galeri/derece metinleri (oyunda hangi kavramlar var)
      for (const u of locUrls) {
        try {
          const j = await (await W.fetch(u, { credentials: 'omit', cache: 'force-cache' })).json();
          const flat = Object.entries(j || {}).filter(([k, v]) => typeof v === 'string' && (/galler/i.test(k) || /galler|(^|[^p])grad(e|es|ing)\b/i.test(v)));
          out.loc[u.split('/').slice(-2).join('/').split('?')[0]] = { n: flat.length, sample: flat.slice(0, 120).map(([k, v]) => `${k} = ${v.slice(0, 90)}`) };
        } catch (e) { err('loc', e); }
      }
      // 8) Sayfanın kendi depolaması: yalnız anahtar adları ve boyutları (değer yok)
      try {
        const ls = (st) => { const r = []; for (let i = 0; i < st.length; i++) { const k = st.key(i); r.push(`${k.replace(/\d{6,}/g, '{id}').slice(0, 60)} (${(st.getItem(k) || '').length})`); } return r.slice(0, 60); };
        out.storage = { local: ls(W.localStorage), session: ls(W.sessionStorage) };
        if (W.indexedDB?.databases) out.storage.indexedDB = (await W.indexedDB.databases()).map((d) => d.name);
      } catch (e) { err('storage', e); }
      return out;
    })();
  }

  function deepReport(r, meta = {}) {
    const j = (x) => (x == null ? '—' : JSON.stringify(x));
    const L = [`Gallery Grab DERİN teşhis · ${meta.app || '?'} · ${new Date().toISOString()}`, '(EA sunucusuna istek atılmadı; yalnız sayfa nesneleri, yüklü JS ve dil dosyası)'];
    if (!r) return L.concat('HATA: sonuç yok').join('\n');
    if (r.error) return L.concat(`HATA: ${r.error}`).join('\n');
    const sec = (t) => L.push('', `===== ${t}`);
    sec('Ortam'); L.push(j(r.env));
    if (r.errors?.length) { sec('Hatalar'); L.push(...r.errors); }
    sec(`Global adlar (toplam ${r.globals?.total}, UT* ${r.globals?.utCount}) — anahtar kelimeli`);
    L.push((r.globals?.keyword || []).join(', ') || '—');
    for (const [k, v] of Object.entries(r.globals?.classMethods || {})) L.push(`  ${k}: ${v.join(', ')}`);
    sec('Servisler (services.*) — anahtar kelimeli metotlar');
    for (const [k, v] of Object.entries(r.services || {})) L.push(typeof v === 'string' ? `${k}: ${v}` : `${k} (${v.n}): ${v.hits.join(', ') || '—'}`);
    sec('Depolar (repositories.*) — anahtar kelimeli metotlar');
    for (const [k, v] of Object.entries(r.repositories || {})) L.push(typeof v === 'string' ? `${k}: ${v}` : `${k} (${v.n}): ${v.hits.join(', ') || '—'}`);
    sec('Sabitler / enum');
    for (const [k, v] of Object.entries(r.enums || {})) L.push(`${k} ${j(v)}`);
    sec(`İstekler (kayıt ${r.requests?.total})`);
    L.push('hostlar: ' + j(r.requests?.hosts));
    for (const [k, n] of r.requests?.ut || []) L.push(`  ${n}× ${k}`);
    sec('Uygulama kodu: dosyalar'); L.push(j(r.bundle?.files));
    sec('Kod: galeri/derece adları (ad × sayı)'); L.push((r.bundle?.identifiers || []).map(([k, n]) => `${k}×${n}`).join(', ') || '—');
    sec('Kod: adres kalıpları'); for (const [k, n] of r.bundle?.paths || []) L.push(`  ${n}× ${k}`);
    sec('Kod: metinler'); L.push((r.bundle?.strings || []).map(([k, n]) => `${k}×${n}`).join(' | ') || '—');
    sec('Kod: galeri geçen yerlerin çevresi'); for (const c of r.bundle?.ctx || []) L.push('  … ' + c + ' …');
    sec('Dil dosyası: galeri/derece metinleri');
    for (const [k, v] of Object.entries(r.loc || {})) { L.push(`${k} (${v.n})`); L.push(...v.sample.map((x) => '  ' + x)); }
    sec('Sayfa depolaması (yalnız anahtar adları)'); L.push(j(r.storage));
    sec('Tüm servis metotları');
    for (const [k, v] of Object.entries(r.services || {})) if (typeof v !== 'string') L.push(`${k}: ${v.all.join(', ')}`);
    sec('Tüm depo metotları');
    for (const [k, v] of Object.entries(r.repositories || {})) if (typeof v !== 'string') L.push(`${k}: ${v.all.join(', ')}`);
    sec('UT global adları (ilk 400)'); L.push((r.globals?.utSample || []).join(', '));
    return L.join('\n');
  }

  // Kayıtlı eşitleme verisinin genel özeti (yeni istek atmaz): summary = gallerySummary, sets = katalog setleri
  function diagOverview(summary = {}, sets = [], extra = {}) {
    const rows = sets.map((s) => summary[s.id]).filter(Boolean);
    const ats = rows.map((r) => r.at).filter(Boolean).sort((a, b) => a - b);
    const day = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '—');
    const withC = sets.filter((s) => summary[s.id]?.collected > 0);
    return {
      katalogSet: sets.length, esitlenen: rows.length, toplananliSet: withC.length,
      toplamToplanan: rows.reduce((a, r) => a + (r.collected || 0), 0),
      enEski: day(ats[0]), enYeni: day(ats.at(-1)),
      sifir: rows.length - withC.length,
      ...extra,
    };
  }

  // Bütün setlerin kayıtlı toplanan/gereken değeri (istek atmaz), çok olandan aza
  function diagSetList(summary = {}, sets = []) {
    return sets.map((s) => ({ s, c: summary[s.id] ? summary[s.id].collected : null }))
      .sort((a, b) => (b.c ?? -1) - (a.c ?? -1) || a.s.name.localeCompare(b.s.name))
      .map(({ s, c }) => `${s.name} ${c ?? '?'}/${s.required}`);
  }

  // Genel tarama raporu: rows = [{ set, parts } | { set, error }], her setin her takımı/ligi canlı sorgulanmış (ham yanıt yok).
  // Satır: "Arsenal 9+9=18/20 (kart 28+28)"; kayıtlı özetten farklıysa "≠kayıtlı N", ilk sayfa dolduysa (100 kart) "+".
  function diagScan(rows, summary = {}) {
    let req = 0, err = 0, yes = 0, diff = 0, empty = 0, fromRaw = 0;
    const errs = {};
    const addErr = (k) => { err++; errs[k] = (errs[k] || 0) + 1; };
    const lines = rows.map(({ set, parts = [], error }) => {
      if (error) { addErr(error); return `${set.name} HATA ${error}`; }
      req += parts.length;
      const r = parts.filter((p) => p.obj?.src === 'raw').length;   // ham yanıttan sayılan (nesnede isCollected yok)
      req += r; fromRaw += r;
      const bad = parts.filter((p) => p.error || !p.obj?.success);
      for (const p of bad) addErr(p.error || `durum ${p.obj?.status}`);
      const ys = parts.map((p) => p.obj?.yes ?? 0);
      const sum = ys.reduce((a, b) => a + b, 0);
      yes += sum;
      if (parts.every((p) => !p.obj?.n)) empty++;
      const saved = summary[set.id]?.collected;
      const differs = saved != null && saved !== Math.min(sum, set.required);
      if (differs) diff++;
      const full = parts.some((p) => (p.obj?.n ?? 0) >= 100) ? '+' : '';
      const split = parts.length > 1 ? `${ys.join('+')}=` : '';
      const cards = parts.map((p) => p.obj?.n ?? '?').join('+');
      return `${set.name} ${split}${sum}${full}/${set.required} (kart ${cards})` +
        (differs ? ` ≠kayıtlı ${saved}` : '') + (bad.length ? ` HATA×${bad.length}` : '');
    });
    const head = { set: rows.length, istek: req, hata: err, bosSet: empty, toplanan: yes, kayitliylaFarkli: diff, hamYanittan: fromRaw, hatalar: errs };
    return ['', `Canlı tarama: ${JSON.stringify(head)}`, ...lines.map((l) => '  ' + l)].join('\n');
  }

  // Teşhis sonucunu kullanıcının kopyalayıp göndereceği düz metne çevirir
  function diagReport(r, meta = {}) {
    const j = (x) => (x == null ? '—' : JSON.stringify(x));
    const lines = [
      `Gallery Grab teşhis · ${meta.app || '?'} · ${new Date(meta.at || Date.now()).toISOString()}`,
      `Set: ${meta.set || '?'} · kayıtlı özet ${j(meta.saved)}`,
      `Genel: ${j(meta.overview)}`,
      `Ortam: ${j(r?.env)}`,
    ];
    if (meta.sets?.length && !meta.scan) lines.push(`Setler (toplanan/gereken, eşitlenmemiş = ?): ${meta.sets.join(' · ')}`);
    if (r?.error) lines.push(`HATA: ${r.error}`);
    for (const p of r?.parts || []) {
      lines.push('', `— kriter ${j(p.crit)}`);
      if (p.error) { lines.push(`  HATA: ${p.error}`); continue; }
      if (p.obj) {
        lines.push(`  Web App nesnesi: başarı=${p.obj.success} durum=${p.obj.status} kart=${p.obj.n} puan>0=${p.obj.scoreGt0}`);
        lines.push(`  isCollected dağılımı: ${j(p.obj.isCollected)}`);
        lines.push(`  ilk kart alanları: ${j(p.obj.first)}`);
        lines.push(`  toplanmış ilk kart: ${j(p.obj.firstCollected)}`);
      }
      if (p.raw) {
        if (p.raw.error) lines.push(`  Ham yanıt: HATA ${p.raw.error}`);
        else {
          lines.push(`  Ham yanıt: HTTP ${p.raw.status}${p.raw.built ? ' (adres kuruldu)' : ''} kart=${p.raw.n} üst=${j(p.raw.top)}`);
          lines.push(`  sorgu: ${p.raw.query}`);
          lines.push(`  alanlar: ${j(p.raw.fields)}`);
          lines.push(`  tüm alan adları: ${(p.raw.allKeys || []).join(',')}`);
          lines.push(`  toplanmayla ayrışan alanlar: ${j(p.raw.split)}`);
        }
      }
    }
    if (meta.scan) lines.push(meta.scan);
    return lines.join('\n');
  }

  // Teşhiste sorgulanacak kriterler: setin bütün takımları (ör. Arsenal erkek + kadın) ya da ligleri
  function diagCrit(set) {
    const f = set?.filter || {};
    if (f.teams?.length) return f.teams.map((club) => ({ club }));
    if (f.leagues?.length) return f.leagues.map((league) => ({ league }));
    return f.rarities ? [{ rarities: f.rarities }] : null;
  }
  // @@END lib/gallery.js

  // ================================================================ GALERİ (v2.1.0)
  // Chrome eklentisindeki Galeri ekranının userscript hâli. Hesaplar yukarıdaki gömülü lib/gallery.js'ten.
  // Toplanma durumu EA'nın konsept aramasından (isCollected + gradingScore), set kataloğu + fut.gg çözümleri
  // GitHub'daki data/gallery-sets.json'dan (her gün 21:00 TR güncellenir).
  const CAT_URL = 'https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/data/gallery-sets.json';
  const PRICE_TTL = 30 * 60 * 1000;
  const RECENT = 6 * 60 * 60 * 1000;
  const gal = {
    cat: store.get('gCatalog', null),
    catAt: store.get('gCatalogAt', 0),
    summary: store.get('gSummary', {}),
    stats: store.get('gSyncStats', {}),
    spent: store.get('gSpent', 0),
    view: store.get('gView', 'gallery'),
    tab: store.get('gTab', null),
    sort: store.get('gSort', ''),
    show: store.get('gShow', 'all'),
    defs: new Map(),
    openId: null, openGrade: null, confirmBuy: false, filter: 'all',
    modal: null,          // 'sync' | 'planner' | null
    skipRecent: true,
    pl: { mode: 'target', target: 500, budget: 100000, syncedOnly: false, confirm: false, result: null },
    catErr: null,
    prices: store.get('gPrices', {}),   // { [def]: { p, at } } — pazardaki güncel fiyat (0 = ilan yok)
    graded: store.get('gGraded', {}),   // { [setId]: { best, manual } } — oyundaki derece geri gitmez (summarise)
    toGrade: store.get('gToGrade', {}), // { [setId]: at } — kart alınıp oyunda notlandırılması gereken setler
    listOpen: false,
    // çoklu seçim: ids = alım sırası; grade[id] = sete özel hedef; target = genel hedef (null = en yüksek)
    sel: { on: false, ids: [], grade: {}, target: null, ...store.get('gSel', {}) },
    selConfirm: false,
  };
  const galSet = (k, v, key) => { gal[k] = v; store.set(key, v); };
  // Dil: Galeri ekranındaki TR/EN seçimi (yoksa tarayıcı dili). L(anahtar, {yer}) → metin
  let LANG = store.get('gLang', null) || detectLang();
  let L = makeT(LANG);
  LOC = localeOf(LANG);
  function setLang(l) { LANG = l === 'en' ? 'en' : 'tr'; L = makeT(LANG); LOC = localeOf(LANG); store.set('gLang', LANG); render(); }
  function loadAllDefs() {
    gal.defs.clear();
    for (const s of gal.cat?.sets || []) {
      // Holografik / Başlangıç: sahiplik doğrulanamıyor — eski sürümde oluşmuş boş kayıtları sil
      if (s.filter?.unsupported) {
        if (store.get('gdefs:' + s.id, null)) store.set('gdefs:' + s.id, null);
        if (gal.summary[s.id]) { delete gal.summary[s.id]; store.set('gSummary', gal.summary); }
        continue;
      }
      const d = store.get('gdefs:' + s.id, null);
      if (d?.defs) gal.defs.set(s.id, d.defs);
    }
  }
  // Oyundaki derece (null = otomatik): kartlar satılınca EA onları toplanmış saymaz, kullanıcı dereceyi sabitler
  function setGraded(id, value, reset = false) {
    if (reset) delete gal.graded[id];
    else gal.graded[id] = { ...(gal.graded[id] || {}), manual: value || null };
    store.set('gGraded', gal.graded);
    const set = gal.cat?.sets.find((s) => s.id === id);
    const defs = gal.defs.get(id);
    if (set && defs && gal.summary[id]) {
      set.floor = floorScore(set, gal.graded[id]);
      const s = summarise(set, defs);
      Object.assign(gal.summary[id], { score: s.score, grade: s.grade, earned: s.earned });
      store.set('gSummary', gal.summary);
    }
    render();
  }
  function markToGrade(id, on = true) {
    if (on) gal.toGrade[id] = Date.now(); else delete gal.toGrade[id];
    store.set('gToGrade', gal.toGrade);
  }

  // Katalog: GM_xmlhttpRequest (sayfanın CSP'si GitHub'a fetch'i engelleyebilir), yoksa fetch.
  function getJson(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, headers: { 'Cache-Control': 'no-cache' }, timeout: 30000,
          onload: (r) => { try { r.status === 200 ? resolve(JSON.parse(r.responseText)) : reject(new Error('HTTP ' + r.status)); } catch (e) { reject(e); } },
          onerror: () => reject(new Error('ağ hatası')), ontimeout: () => reject(new Error('zaman aşımı')),
        });
      } catch (_) {
        fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then(resolve, reject);
      }
    });
  }
  function lastPublish(now = new Date()) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 40));
    if (t > now) t.setUTCDate(t.getUTCDate() - 1);
    return t.getTime();
  }
  async function refreshCatalog(force = false) {
    if (!force && gal.cat && gal.catAt >= lastPublish()) return false;
    try {
      const c = await getJson(CAT_URL);
      if (!Array.isArray(c?.sets) || c.sets.length < 50) throw new Error('geçersiz katalog');
      const changed = c.updated !== gal.cat?.updated;
      galSet('cat', c, 'gCatalog');
      galSet('catAt', Date.now(), 'gCatalogAt');
      gal.catErr = null;
      if (changed) loadAllDefs();
      render();
      return changed;
    } catch (e) {
      gal.catErr = e.message;
      render();
      return false;
    }
  }
  const catDate = () => (gal.cat?.updated ? new Date(gal.cat.updated).toLocaleString(LOC, { dateStyle: 'short', timeStyle: 'short' }) : '?');
  const dt = (ms) => new Date(ms).toLocaleString(LOC, { dateStyle: 'short', timeStyle: 'short' });

  // ---------------------------------------------------------------- EA konsept araması
  function conceptPage(crit, offset, count = 100) {
    return new Promise((resolve, reject) => {
      try {
        if (!W.services?.Item?.searchConceptItems || !W.UTSearchCriteriaDTO) { reject(new ApiError(0, null, 'Web App henüz hazır değil — ana ekranın açılmasını bekleyin')); return; }
        const c = new W.UTSearchCriteriaDTO();
        c.type = W.SearchType.PLAYER;
        c.count = count;
        c.offset = offset;
        if (crit.club) c.club = crit.club;
        if (crit.league) c.league = crit.league;
        if (crit.rarities) c.rarities = crit.rarities;
        // Web App'in bu arama için attığı /defid adresi (kayıt tamponu dolu olsa da gözlemci görür)
        let url = null, po = null;
        try {
          po = new W.PerformanceObserver((l) => { for (const e of l.getEntries()) if (/\/defid\?/.test(e.name)) url = e.name; });
          po.observe({ type: 'resource' });
        } catch (_) {}
        const obs = W.services.Item.searchConceptItems(c);
        const ref = {};
        let done = false;
        const finish = (f) => { if (!done) { done = true; try { po?.disconnect(); } catch (_) {} f(); } };
        // Bazı Web App sürümlerinde (Opera'da görüldü) kart nesnesi isCollected/gradingScore taşımıyor ama EA'nın
        // ham yanıtında var: o zaman aynı isteğin ham JSON'undan oku. Dönen: resourceId/id → ham kart
        const rawMap = async (n) => {
          await sleep(50);
          if (!url && crit.club) url = `${resolveBase()}/defid?count=${count}&sort=desc&start=${offset}&type=player&team=${crit.club}`;
          if (!url) return null;
          const r = await W.fetch(url, { headers: { 'X-UT-SID': liveSid() || '', Accept: 'application/json' }, credentials: 'omit' });
          if (!r.ok) return null;
          const j = await r.json().catch(() => null);
          const arr = !j ? [] : Array.isArray(j) ? j : j.itemData || j.items || [];
          const m = new Map();
          for (const x of arr) for (const k of [x?.resourceId, x?.id]) if (k != null) m.set(Number(k), x);
          return { m, arr: arr.length === n ? arr : null };
        };
        obs.observe(ref, async (o, res) => {
          o.unobserve(ref);
          if (!res?.success) { finish(() => reject(new ApiError(res?.status ?? 0, null, `Galeri araması başarısız (HTTP ${res?.status})`))); return; }
          const src = res.response?.items || [];
          let raw = null;
          if (src.length && !src.some((i) => typeof i.isCollected === 'boolean')) {
            try { raw = await rawMap(src.length); } catch (_) {}
          }
          const items = src.map((i, idx) => {
            const x = raw ? raw.m.get(Number(i.definitionId)) || raw.arr?.[idx] || null : null;
            return {
              def: Number(i.definitionId), name: i._staticData?.name || '', r: Number(i.rating) || 0,
              rare: Number(i.rareflag) || 0, team: Number(i.teamId) || null, league: Number(i.leagueId) || null,
              pos: i.preferredPosition || null, col: x ? x.isCollected === true : !!i.isCollected,
              sc: Number(x ? x.gradingScore : i.gradingScore) || 0, tradable: !i.untradeable,
            };
          });
          finish(() => resolve(items));
        });
        setTimeout(() => finish(() => reject(new ApiError(0, null, 'Galeri araması zaman aşımı'))), 20000);
      } catch (e) { reject(new ApiError(0, null, String(e))); }
    });
  }
  async function fetchSetDefs(filter, onReq) {
    const crits = filter.teams ? filter.teams.map((club) => ({ club }))
      : filter.leagues ? filter.leagues.map((league) => ({ league }))
      : filter.rarities ? [{ rarities: filter.rarities }] : [];
    const byDef = new Map();
    for (const crit of crits) {
      for (let offset = 0, guard = 0; guard < 60; guard++) {
        const t0 = Date.now();
        const items = await conceptPage(crit, offset);
        onReq?.(Date.now() - t0);
        for (const it of items) if (it.def) byDef.set(it.def, it);
        if (items.length < 100) break;
        offset += items.length;
        await sleep(rnd(300, 600));
      }
      if (crits.length > 1) await sleep(rnd(300, 600));
    }
    return [...byDef.values()];
  }
  function saveSetDefs(set, defs, reqs = null) {
    const g = gal.graded[set.id] || {};
    const live = summarise({ ...set, floor: 0 }, defs).live;
    if (live > (g.best || 0)) { gal.graded[set.id] = { ...g, best: live }; store.set('gGraded', gal.graded); }
    set.floor = floorScore(set, gal.graded[set.id]);
    const s = summarise(set, defs);
    gal.summary[set.id] = {
      collected: s.collected, required: s.required, total: s.total, score: s.score, grade: s.grade, earned: s.earned,
      reqs: reqs ?? gal.summary[set.id]?.reqs ?? null, at: Date.now(),
    };
    store.set('gdefs:' + set.id, { at: Date.now(), defs });
    store.set('gSummary', gal.summary);
    gal.defs.set(set.id, defs);
  }

  // ---------------------------------------------------------------- galeri görevleri
  async function syncSets(my, ids) {
    const sets = ids.map((id) => gal.cat.sets.find((s) => s.id === id)).filter((s) => s && !s.filter.unsupported);
    let per = gal.stats.secPerReq || null;
    const started = Date.now();
    let n = 0;
    let failed = 0;
    let streak = 0;   // art arda başarısız set
    for (const [i, set] of sets.entries()) {
      if (my !== token) return;
      status(L('bg.syncing', { name: set.name, i: i + 1, n: sets.length, left: fmtDur(syncEstimate(sets.slice(i), gal.summary, per).sec, L) }), 'ok', my);
      let reqs = 0;
      let defs = null;
      let lastErr = null;
      // Web App anlık meşgulse / zaman aşımı: 2 sn sonra bir kez daha dene, olmazsa seti atla
      for (let attempt = 0; attempt < 2 && !defs && my === token; attempt++) {
        try {
          defs = await fetchSetDefs(set.filter, (ms) => { reqs++; per = per ? per * 0.8 + (ms / 1000) * 0.2 : ms / 1000; });
        } catch (err) {
          lastErr = err;
          const why = stopReason(err);
          if (why) { fail(why); return stop(why, 'error', my); }
          if (attempt === 0) await sleep(2000);
        }
      }
      if (my !== token) return;
      if (defs) {
        saveSetDefs(set, defs, reqs);
        galSet('stats', { secPerReq: per }, 'gSyncStats');
        n++;
        streak = 0;
      } else {
        failed++;
        const e = lastErr?.message || L('error');
        if (++streak >= 3) { fail(e); return stop(L('bg.syncFail', { name: set.name, e }) + L('bg.syncFailN', { n: failed }), 'error', my); }
        status(L('bg.syncFail', { name: set.name, e }), 'warn', my);
      }
      await sleep(rnd(300, 700));
    }
    if (my === token) stop(L('bg.syncDone', { n, m: sets.length, d: fmtDur((Date.now() - started) / 1000, L) }) + (failed ? L('bg.syncFailN', { n: failed }) : ''), failed ? 'warn' : 'ok', my);
  }

  // Belirli sürümün (definitionId) en ucuz ilanı; range: beklenen fiyat çevresi (özel sürümler kaybolmasın)
  // Bulunan en ucuzdan bir basamak aşağısı (maxb) ile tekrar aranır; trail.lo = ilan çıkmayan son üst sınır,
  // trail.sure = "daha ucuzu yok" kesinleşti. EA sonucu bitiş süresine göre sıralar ve maskedDefId tüm sürümleri getirir:
  // sayfa başka sürümlerle doluysa aranan sürüm sonraki sayfalarda olabilir — boş süzülmüş sayfa "ilan yok" demek değildir.
  async function findCheapestDef(def, range = null, trail = null) {
    let best = null;
    let hi = range?.maxb || 0;
    let sure = false;
    probe: for (let i = 0; i < PROBE_MAX; i++) {
      let bins = [];
      for (let pg = 0; pg < PAGE_MAX; pg++) {
        if (pg) await sleep(rnd(400, 900));
        const q = { maskedDefId: baseOf(def), num: 21, start: pg * 20, ...(hi > 0 ? { maxb: hi } : {}), ...(range?.minb ? { minb: range.minb } : {}) };
        const res = await api.search(q);
        bins = activeBins(res).filter((a) => Number(a.itemData?.resourceId ?? a.itemData?.definitionId) === def);
        if (bins.length) break;
        if ((res?.auctionInfo || []).length < 21) { if (best && trail) trail.lo = hi; sure = true; break probe; }
      }
      if (!bins.length) break;   // PAGE_MAX sayfa başka sürümlerle dolu: emin değiliz
      const cand = bins.reduce((m, a) => (a.buyNowPrice < m.buyNowPrice ? a : m));
      if (!best || cand.buyNowPrice < best.buyNowPrice) best = cand;
      if (best.buyNowPrice <= 200 || (range?.minb && best.buyNowPrice <= range.minb)) { sure = true; break; }
      hi = prevPrice(best.buyNowPrice);
      await sleep(rnd(400, 900));
    }
    if (trail) trail.sure = sure;
    return best;
  }

  // Dönen: { note, tp } — tp: 'ok' (transfer listesine girdi) | 'fail' (liste dolu / taşınamadı) | null (unassigned)
  async function afterBuy(itemId, price, ref) {
    const mode = settings.afterBuy || 'relist';
    if (!itemId || mode === 'keep') return { note: '', tp: null };
    await sleep(rnd(500, 1200));
    const mv = await api.toTradepile(itemId);
    if (mv?.itemData?.[0]?.success === false) return { note: L('bg.tpFail', { r: mv.itemData[0].reason || '?' }), tp: 'fail' };
    if (mode !== 'relist') return { note: L('bg.tp'), tp: 'ok' };
    const cfg = settings.relist || {};
    const sell = relistPrice(price, ref, cfg);
    await sleep(rnd(500, 1200));
    try {
      await api.list(itemId, Math.max(150, prevPrice(sell)), sell, cfg.dur || 3600);
    } catch (e) {
      if (stopReason(e)) throw e;
      return { note: L('bg.listFail', { e: e?.status || e?.message }), tp: 'ok' };
    }
    const net = Math.floor(sell * 0.95) - price;
    return { note: L('bg.relisted', { p: fmt(sell), net: (net >= 0 ? '+' : '') + fmt(net) }), tp: 'ok' };
  }

  // Transfer listesi doluluğu ("Unassigned'da bırak" dışında izlenir). tp: ilan sayısı, null = izlenmiyor
  const TP_MAX = 100;
  async function buyContext() {
    if ((settings.afterBuy || 'relist') === 'keep') return { tp: null, full: false };
    let tp = null;
    try { tp = (await api.tradepile())?.auctionInfo?.length ?? null; } catch (e) { if (stopReason(e)) throw e; }
    return { tp, full: tp != null && tp >= TP_MAX };
  }

  function livePrices() {
    const out = {};
    for (const [d, x] of Object.entries(gal.prices)) if (Date.now() - x.at < PRICE_TTL) out[d] = x.p;
    return out;
  }
  // Canlı fiyatı sakla; 24 saatten eski kayıtları at
  function savePrice(def, p) {
    const now = Date.now();
    for (const [k, x] of Object.entries(gal.prices)) if (now - x.at > 24 * 60 * 60 * 1000) delete gal.prices[k];
    gal.prices[def] = { p, at: now };
    store.set('gPrices', gal.prices);
  }

  // Detaydaki "Eşitle + güncel fiyat": seti eşitle, seçili notun eksik kartlarına pazardan fiyat bak
  async function syncPrice(my, setId, grade) {
    const set = gal.cat.sets.find((x) => x.id === setId);
    if (!set) return stop(L('error'), 'error', my);
    if (set.filter?.unsupported) return stop(L('bg.unsupported', { name: set.name }), 'warn', my);
    status(L('bg.syncing1', { name: set.name }), 'ok', my);
    let defs;
    try { defs = await fetchSetDefs(set.filter); saveSetDefs(set, defs); } catch (err) { return stop(L('bg.syncFail', { name: set.name, e: stopReason(err) || err?.message || L('error') }), 'error', my); }
    const plan = grade ? planFromTier(set, grade, defs) : null;
    const todo = plan ? plan.cards.filter((c) => !c.col) : [];
    const changes = [];
    const trails = [];
    for (const [i, c] of todo.entries()) {
      if (my !== token) return;
      const name = c.name || '#' + c.def;
      status(L('bg.live', { name, i: i + 1, n: todo.length }), 'ok', my);
      try {
        const tr = {};
        const a = await findCheapestDef(c.def, c.rare > 1 && c.price >= 1000 ? { minb: Math.floor(c.price * 0.5) } : null, tr);
        const p = a ? a.buyNowPrice : 0;
        if (a && suspiciousPrice(p, c.price, tr.sure)) { changes.push(L('bg.overRef', { name, p: fmt(p), f: fmt(c.price) })); await sleep(rnd(700, 1500)); continue; }
        if (a && tr.lo) trails.push(L('bg.trail', { name, p: fmt(p), lo: fmt(tr.lo) }));
        savePrice(c.def, p);
        if (p !== c.price) changes.push(p ? L('bg.liveChange', { name, p: fmt(p), f: fmt(c.price) }) : L('bg.liveNone', { name }));
      } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); return stop(why, 'error', my); }
      }
      await sleep(rnd(700, 1500));
    }
    if (my !== token) return;
    if (!plan) return stop(L('bg.synced1', { name: set.name }), 'ok', my);
    const p2 = planFromTier(set, grade, defs, livePrices());
    const head = L('bg.liveDone', { name: set.name, g: grade, m: p2.missing, c: fmt(p2.need) });
    const trail = trails.length ? ' · ' + trails.slice(0, 2).join(' · ') : '';
    stop((changes.length ? `${head} · ${changes.slice(0, 4).join(' · ')}` : head + L('bg.liveSame')) + trail, 'ok', my);
  }

  // Dönen: { bought, notes, halt } — halt: 'budget' | 'coins' | 'tpfull' | 'stopped' | 'error'. ctx.tp: transfer listesi sayacı
  async function buyCards(my, targets, label = '', ctx = {}) {
    let bought = 0;
    const notes = [];
    for (const [i, t] of targets.entries()) {
      if (my !== token) return { bought, notes, halt: 'stopped' };
      if (ctx.tp != null && ctx.tp >= TP_MAX) return { bought, notes: [...notes, L('bg.tpFull', { n: ctx.tp })], halt: 'tpfull' };
      try {
        status(label + L('bg.search', { name: t.name, i: i + 1, n: targets.length }), 'ok', my);
        let done = false;
        const noted = notes.length;
        for (let attempt = 1; attempt <= RETRY_MAX && !done; attempt++) {
          const tr = {};
          const a = await findCheapestDef(t.def, t.range, tr);
          if (!a) {
            // Sınırın altında ilan yok: gerçek en ucuz fiyatı bul — rapora yazılır, canlı fiyat olarak saklanır
            const real = t.range?.maxb ? await findCheapestDef(t.def, t.range.minb ? { minb: t.range.minb } : null) : null;
            savePrice(t.def, real ? real.buyNowPrice : 0);
            notes.push(real ? L('bg.overCap', { name: t.name, p: fmt(real.buyNowPrice), c: fmt(t.range.maxb) }) : L('bg.noListing', { name: t.name }));
            break;
          }
          const price = a.buyNowPrice;
          // fut.gg'nin çok üstünde ve daha ucuzunun olmadığı kesinleşmedi: alma, canlı fiyat diye de saklama
          if (suspiciousPrice(price, t.gg, tr.sure)) { notes.push(L('bg.overRef', { name: t.name, p: fmt(price), f: fmt(t.gg) })); break; }
          savePrice(t.def, price);
          if (t.cap && price > t.cap) { notes.push(L('bg.overCap', { name: t.name, p: fmt(price), c: fmt(t.cap) })); break; }
          if (settings.galleryBudget > 0 && gal.spent + price > settings.galleryBudget) return { bought, notes: [...notes, L('bg.budget')], halt: 'budget' };
          if (run.coins != null && price > run.coins) return { bought, notes: [...notes, L('bg.coinsLow')], halt: 'coins' };
          await sleep(rnd(300, 800));
          if (my !== token) return { bought, notes, halt: 'stopped' };
          try {
            const r = await api.buyNow(a.tradeId, price);
            const it = r?.auctionInfo?.[0]?.itemData || a.itemData || {};
            galSet('spent', gal.spent + price, 'gSpent');
            run.coins = parseCoins(r) ?? (run.coins != null ? run.coins - price : null);
            bought++;
            done = true;
            const ab = await afterBuy(it.id, price, t.ref);
            status(label + L('bg.bought', { name: t.name, p: fmt(price), x: ab.note }), 'ok', my);
            if (ab.tp === 'ok' && ctx.tp != null) ctx.tp++;
            if (ab.tp === 'fail') return { bought, notes: [...notes, L('bg.tpFull', { n: ctx.tp ?? TP_MAX })], halt: 'tpfull' };
          } catch (e) {
            if (e instanceof ApiError && (e.status === 460 || e.status === 461)) { await sleep(rnd(600, 1200)); continue; }
            throw e;
          }
        }
        if (!done && notes.length === noted) notes.push(L('bg.sniped', { name: t.name }));
      } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); stop(why, 'error', my); return { bought, notes, halt: 'error' }; }
        notes.push(`${t.name}: ${err?.message || L('error')}`);
      }
      await sleep(rnd(1000, 2500));
    }
    return { bought, notes, halt: null };
  }

  async function resync(set) { try { saveSetDefs(set, await fetchSetDefs(set.filter)); } catch (_) {} }

  async function buyPlan(my, setId, grade) {
    const set = gal.cat.sets.find((s) => s.id === setId);
    if (set?.filter?.unsupported) return stop(L('bg.unsupported', { name: set.name }), 'warn', my);
    const defs = gal.defs.get(setId);
    if (!set || !defs) return stop(L('bg.needSync'), 'warn', my);
    const plan = planFromTier(set, grade, defs, livePrices());
    const todo = plan ? plan.cards.filter((c) => !c.col) : [];
    if (!todo.length) return stop(L('bg.allOwned', { name: set.name }), 'ok', my);
    try { run.coins = parseCoins(await api.credits()); } catch (_) {}
    const ctx = await buyContext();
    if (ctx.full) return stop(L('bg.tpFull', { n: ctx.tp }), 'warn', my);
    const r = await buyCards(my, buyTargets(todo, settings.maxCard), '', ctx);
    if (r.halt === 'stopped' || r.halt === 'error') { if (r.bought) markToGrade(set.id); return; }
    await resync(set);
    if (r.bought) markToGrade(set.id);
    const s = gal.summary[set.id];
    const note = r.notes.length ? ' · ' + r.notes.slice(0, 3).join(' · ') + (r.notes.length > 3 ? ` (+${r.notes.length - 3})` : '') : '';
    const msg = L('bg.done1', { name: set.name, n: r.bought }) + note + (s ? L('bg.done1b', { c: s.collected, r: s.required, g: s.grade || '-' }) : '') + (r.bought ? L('bg.gradeHint') : '');
    notify('Gallery Grab', msg);
    stop(msg, r.halt || r.notes.length ? 'warn' : 'ok', my);
  }

  // Çoklu alımda derece kararından önce: derecenin eksik kartlarına pazardan güncel fiyat.
  // Son 10 dk'da bakılan kart atlanır (alt dereceye düşülünce ortak kartlar yeniden aranmaz). false = durduruldu.
  const RECHECK_MS = 10 * 60 * 1000;
  async function priceFresh(my, set, grade, defs, label) {
    const plan = planFromTier(set, grade, defs);
    const todo = (plan ? plan.cards.filter((c) => !c.col) : []).filter((c) => !(gal.prices[c.def] && Date.now() - gal.prices[c.def].at < RECHECK_MS));
    for (const [i, c] of todo.entries()) {
      if (my !== token) return false;
      status(label + L('bg.live', { name: c.name || '#' + c.def, i: i + 1, n: todo.length }), 'ok', my);
      try {
        const tr = {};
        const a = await findCheapestDef(c.def, c.rare > 1 && c.price >= 1000 ? { minb: Math.floor(c.price * 0.5) } : null, tr);
        if (!a || !suspiciousPrice(a.buyNowPrice, c.price, tr.sure)) savePrice(c.def, a ? a.buyNowPrice : 0);
      } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); stop(why, 'error', my); return false; }
      }
      await sleep(rnd(700, 1500));
    }
    return my === token;
  }

  // Her setten önce set eşitlenir (oyunda alınan/satılan kartlar), oto derecede seçilen derecenin kartlarına canlı fiyat bakılır
  async function buyBatch(my, items) {
    try { run.coins = parseCoins(await api.credits()); } catch (_) {}
    const ctx = await buyContext();
    if (ctx.full) return stop(L('bg.tpFull', { n: ctx.tp }), 'warn', my);
    let total = 0;
    let halt = null;
    const notes = [];
    for (const [i, it] of items.entries()) {
      if (my !== token) return;
      const set = gal.cat.sets.find((s) => s.id === it.setId);
      if (!set) continue;
      if (set.filter?.unsupported) { notes.push(L('bg.unsupported', { name: set.name })); continue; }
      const label = `[${i + 1}/${items.length}] ${set.name} · `;
      let defs = gal.defs.get(it.setId) || null;
      status(label + L('bg.syncing1', { name: set.name }), 'ok', my);
      try { defs = await fetchSetDefs(set.filter); saveSetDefs(set, defs); } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); return stop(why, 'error', my); }
      }
      if (my !== token) return;
      if (!defs) { notes.push(L('bg.unsyncedSkip', { name: set.name })); continue; }
      let grade = it.grade;
      // Çoklu seçim (auto): o anki coin/bütçe ve CANLI fiyatlarla hedeften aşağı ulaşılabilir en yüksek derece.
      // Seçilen derecenin kartları fiyatlanır, karar yeniden verilir; derece değişirse yenisi de fiyatlanır (en çok 3 derece).
      if (it.auto) {
        const avail = availCoins();
        const seen = new Set();
        let p;
        for (;;) {
          p = pickGrade(set, defs, livePrices(), it.grade || null, avail);
          if (!p.g || seen.has(p.g) || seen.size >= 3) break;
          seen.add(p.g);
          if (!(await priceFresh(my, set, p.g, defs, label))) return;
        }
        if (!p.g) { notes.push(L('bg.autoNone.' + p.why, { name: set.name })); continue; }
        if (p.fell) notes.push(L('bg.autoFell', { name: set.name, from: it.grade, to: p.g }));
        grade = p.g;
      }
      const plan = planFromTier(set, grade, defs, livePrices());
      const todo = plan ? plan.cards.filter((c) => !c.col) : [];
      if (!todo.length) { if (plan) notes.push(L('bg.autoReady', { name: set.name, g: grade })); continue; }
      const r = await buyCards(my, buyTargets(todo, settings.maxCard), label, ctx);
      total += r.bought;
      if (r.halt === 'stopped' || r.halt === 'error') { if (r.bought) markToGrade(set.id); return; }
      await resync(set);
      if (r.bought) markToGrade(set.id);
      notes.push(...r.notes.filter((x) => !notes.includes(x)));
      if (r.halt) { halt = r.halt; break; }
    }
    if (my !== token) return;
    const msg = L('bg.planDone', { n: total }) + (notes.length ? ' · ' + notes.slice(0, 3).join(' · ') + (notes.length > 3 ? ` (+${notes.length - 3})` : '') : '') + (total ? L('bg.gradeHint') : '');
    notify('Gallery Grab', msg);
    stop(msg, halt ? 'warn' : 'ok', my);
  }

  // ---------------------------------------------------------------- transfer pazarı rozeti
  (function badge() {
    const B = 'fcg-collected';
    const paint = (root, item, col) => {
      const show = col && !!item?._auction?.tradeId;
      let b = root.querySelector(':scope > .' + B);
      if (show && !b) { b = h('div', { class: B, title: 'Gallery Grab: bu kart galeride zaten toplandı' }, [h('span', { text: '✓ Galeride' })]); root.append(b); }
      else if (!show && b) b.remove();
    };
    const tryPatch = () => {
      const V = W.UTPlayerItemView;
      if (!V?.prototype?.renderItem) return false;
      if (V.prototype.__fcgBadge) return true;
      const orig = V.prototype.renderItem;
      V.prototype.renderItem = function (item, ...rest) {
        const r = orig.call(this, item, ...rest);
        try {
          const root = this.getRootElement?.();
          if (root) {
            const col = isCol(item);
            // yanıt henüz okunmadıysa: aynı kart hâlâ bu görünümdeyse kısa süre sonra yeniden bak
            if (col === undefined && item?._auction?.tradeId) {
              const view = this;
              setTimeout(() => { if (view.__fcgItem === item && isCol(item) === true) paint(root, item, true); }, 400);
            }
            this.__fcgItem = item;
            paint(root, item, col === true);
          }
        } catch (_) {}
        return r;
      };
      V.prototype.__fcgBadge = true;
      return true;
    };
    const t = setInterval(() => { if (tryPatch()) clearInterval(t); }, 1000);
  })();

  // ---------------------------------------------------------------- galeri arayüzü
  const KF = (n) => { const d = LANG === 'en' ? '.' : ','; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', d) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace('.', d) + 'K' : String(n); };
  const sumEarned = (set, s) => s.earned ?? set.grades.filter((g) => s.score >= g.score).reduce((a, g) => a + (g.tokens || 0), 0);

  function setArt(set, cls = 'crest') {
    const f = set.filter || {};
    if (f.teams) { const t = set.club || f.teams[0]; return icon(img.crest(t), cls, img.crestAlt(t)); }
    if (f.leagues) return icon(img.league(f.leagues[0]), cls, img.leagueAlt?.(f.leagues[0]));
    return h('div', { class: 'ph', text: set.name.slice(0, 1) });
  }
  function gradeTitle(set, g) {
    const x = set.grades.find((y) => y.g === g);
    if (!x) return g;
    const rw = [x.tokens ? L('tokens', { n: x.tokens }) : null, ...(x.items || [])].filter(Boolean).join(', ');
    return L('grade.title', { g, score: fmt(x.score) }) + (rw ? ' — ' + rw : '');
  }
  function diamonds(set, grade) {
    const got = new Set();
    for (const g of set.grades) { got.add(g.g); if (g.g === grade) break; }
    return h('div', { class: 'grades' }, set.grades.map((g) => h('div', {
      class: `gd ${g.g}${grade && got.has(g.g) ? (g.g === grade ? ' cur' : ' got') : ''}`, title: gradeTitle(set, g.g),
    }, [h('span', { text: g.g })])));
  }
  const taskBtn = (props) => { const b = h('button', props); if (run.running) b.disabled = true; return b; };

  function renderGallery() {
    const g = ui.gal;
    // Galeri içindeki bir kutuya yazılırken yeniden çizme (kutu silinmesin); odak kalkınca çizilir (focusout)
    if (document.activeElement?.tagName === 'INPUT' && ui.galEl.contains(document.activeElement)) { gal.dirty = true; return; }
    gal.dirty = false;
    if (!gal.cat) {
      g.body.replaceChildren(h('div', { class: 'empty', text: gal.catErr ? L('cat.downloadFail', { e: gal.catErr }) : L('cat.loading') }),
        h('button', { text: L('retry'), onclick: () => refreshCatalog(true) }));
      return;
    }
    if (!gal.cat.categories.some((c) => c.id === gal.tab)) gal.tab = gal.cat.categories[0].id;
    const sums = gal.summary;
    const next = new Map();
    for (const s of gal.cat.sets) { const n = bestNext(s, gal.defs.get(s.id) || null); if (n) next.set(s.id, n); }
    const all = gal.cat.sets.filter((s) => s.cat === gal.tab).length;
    const sets = sortFilterSets(gal.cat.sets.filter((s) => s.cat === gal.tab), sums, next, gal.sort, gal.show, gal.toGrade);
    gal.next = next;

    const card = (set) => {
      const sum = sums[set.id];
      const full = sum && sum.collected >= sum.required;
      const n = next.get(set.id);
      const picked = gal.sel.on && gal.sel.ids.includes(set.id);
      return h('div', { class: 'set' + (full ? ' full' : '') + (picked ? ' picked' : ''), onclick: () => { if (gal.sel.on) { toggleSel(set.id); return; } gal.openId = set.id; gal.openGrade = null; gal.confirmBuy = false; gal.filter = 'all'; gal.listOpen = false; render(); } }, [
        full && !gal.sel.on ? h('span', { class: 'chk', text: '✓' }) : null,
        gal.sel.on ? h('span', { class: 'pick', text: picked ? String(gal.sel.ids.indexOf(set.id) + 1) : '' }) : null,
        gal.toGrade[set.id] || n?.ready ? h('span', { class: 'gbadge', text: L('grade.badge'), title: L('ov.toGrade.title') }) : null,
        h('div', { class: 'hd' }, [setArt(set), h('div', {}, [
          h('div', { class: 'nm', text: set.name }),
          h('div', { class: 'cnt', text: sum ? L('card.collected', { n: sum.collected, req: set.required }) : `— / ${set.required}` }),
          sum ? h('div', { class: 'sc', title: L('card.score') }, [h('i', { class: 'dia' }), fmt(sum.score)])
            : h('div', { class: 'mut', text: set.filter?.unsupported ? L('card.untrackable') : L('card.unsynced') }),
        ])]),
        diamonds(set, sum?.grade),
        h('div', { class: 'tk', title: n?.est ? L('card.est') : '' }, tokenRows(set, sum, n, L, reachableScore(set, gal.defs.get(set.id) || null)).flatMap(([l, v, c]) => [h('span', { text: l }), h('b', { class: c, text: v })])),
      ]);
    };
    const synced = gal.cat.sets.filter((s) => s.cat === gal.tab && sums[s.id]);
    const earned = synced.reduce((a, s) => a + sumEarned(s, sums[s.id]), 0);
    const sel = (opts, val, on) => { const s = h('select', { onchange: (e) => on(e.target.value) }, opts.map(([k, x]) => h('option', { value: k, text: x }))); s.value = val; return s; };

    // Chrome eklentisi de yüklüyse (aynı sayfada kendi menü sekmesi var) uyar
    const extOn = !!document.getElementById('fcg-tab');
    g.body.replaceChildren(
      extOn ? h('div', { class: 'unsup', text: L('us.extWarn') }) : null,
      h('div', { class: 'introw' }, [
        h('p', { class: 'mut', text: L('intro') }),
        h('span', { class: 'flags', title: L('lang.title') }, LANGS.map(([v, x]) => {
          const b = h('button', { class: v === LANG ? 'on' : '', title: x, onclick: () => { if (v !== LANG) setLang(v); } });
          b.append(document.importNode(new DOMParser().parseFromString(FLAGS[v], 'image/svg+xml').documentElement, true));
          return b;
        })),
        contactBtn(),
      ]),
      overviewStrip(sums),
      h('div', { class: 'top' }, [
        h('div', { class: 'tabs' }, gal.cat.categories.map((c) => h('button', { class: c.id === gal.tab ? 'on' : '', text: c.name, onclick: () => { galSet('tab', c.id, 'gTab'); render(); } }))),
        h('button', { class: gal.sel.on ? 'dan' : 'b', text: L('sel.mode'), title: L('sel.mode.title'), onclick: () => { gal.sel.on = !gal.sel.on; gal.selConfirm = false; saveSel(); render(); } }),
        taskBtn({ class: 'b', text: L('btn.planner'), title: L('btn.planner.title'), onclick: () => { gal.modal = 'planner'; gal.pl.confirm = false; runPlanner(); render(); } }),
        taskBtn({ class: 'b', text: L('btn.syncAll'), title: L('btn.syncAll.title'), onclick: () => { gal.modal = 'sync'; render(); } }),
      ]),
      h('div', { class: 'sub' }, [
        h('span', {}, [L('tab.info', { synced: synced.length, all }), h('b', { text: String(earned) }), L('tab.max', { max: gal.cat.sets.filter((x) => x.cat === gal.tab).reduce((a, x) => a + x.maxTokens, 0) })]),
        h('span', { text: gal.catErr ? L('cat.fail', { d: catDate(), e: gal.catErr }) : L('cat', { d: catDate() }) }),
        h('button', { class: 'g', text: L('btn.catRefresh'), onclick: () => refreshCatalog(true) }),
        h('button', { class: 'g', text: L('btn.diag'), title: L('btn.diag.title'), onclick: () => { gal.modal = 'diag'; render(); } }),
        h('label', {}, [L('sort') + ' ', sel(sortOptions(L), gal.sort, (x) => { galSet('sort', x, 'gSort'); render(); })]),
        h('label', {}, [L('show') + ' ', sel(showOptions(L), gal.show, (x) => { galSet('show', x, 'gShow'); render(); })]),
      ]),
      gal.sel.on ? selBar() : null,
      h('div', { class: 'grid' }, sets.length ? sets.map(card) : [h('div', { class: 'empty', text: all ? L('grid.emptyFilter') : L('grid.empty') })]),
    );

    // alt çubuk
    const relBox = settings.afterBuy === 'keep' || settings.afterBuy === 'tradepile' ? null : h('span', {}, [' ' + L('bar.sell') + ' ',
      sel([['paid', L('rel.paid')], ['market', L('rel.market')]], settings.relist?.base || 'paid', (x) => { settings.relist = { ...settings.relist, base: x }; saveSettings(); }),
      sel(Array.from({ length: 41 }, (_, i) => [String(i - 20), `${i > 20 ? '+' : ''}${i - 20}%`]), String(settings.relist?.pct || 0), (x) => { settings.relist = { ...settings.relist, pct: Number(x) }; saveSettings(); }),
      sel(['3600', '10800', '21600', '43200', '86400'].map((d) => [d, L('dur.' + d)]), String(settings.relist?.dur || 3600), (x) => { settings.relist = { ...settings.relist, dur: Number(x) }; saveSettings(); }),
    ]);
    const budget = h('input', { type: 'number', min: '0', step: '1000', placeholder: L('bar.budget.ph'), value: settings.galleryBudget || '', onchange: (e) => { settings.galleryBudget = Math.max(0, Math.floor(Number(e.target.value) || 0)); saveSettings(); } });
    const maxCard = h('input', { type: 'number', min: '0', step: '1000', placeholder: L('bar.maxCard.ph'), value: settings.maxCard ?? 0, onchange: (e) => { settings.maxCard = Math.max(0, Math.floor(Number(e.target.value) || 0)); saveSettings(); } });
    g.foot.replaceChildren(
      h('span', {}, [L('bar.coins') + ' ', h('b', { text: fmt(run.coins) }), ' ', h('button', {
        class: 'g', text: '↻', title: L('bar.refreshCoins.title'),
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = '…';
          try { run.coins = parseCoins(await api.credits()); render(); } catch (err) { b.disabled = false; b.textContent = '!'; b.title = L('bar.refreshCoins.fail', { e: err?.message || L('error') }); }
        },
      })]),
      h('span', { title: L('bar.spent.title') }, [L('bar.spent') + ' ', h('b', { text: fmt(gal.spent) }), ' ', h('button', { class: 'g', text: '↺', title: L('bar.reset'), onclick: () => { galSet('spent', 0, 'gSpent'); render(); } })]),
      h('label', { title: L('bar.budget.title') }, [L('bar.budget') + ' ', budget]),
      h('label', { title: L('bar.maxCard.title') }, [L('bar.maxCard') + ' ', maxCard]),
      h('label', {}, [L('bar.after') + ' ', sel(['relist', 'tradepile', 'keep'].map((k) => [k, L('after.' + k)]), settings.afterBuy || 'relist', (x) => { settings.afterBuy = x; saveSettings(); })]),
      relBox,
      h('span', { class: 'st ' + (run.level || ''), text: run.text || L('ready'), title: run.text || '' }),
      run.running ? h('button', { class: 'dan', text: L('stop'), onclick: () => stop() }) : null,
    );

    g.over.replaceChildren(...[gal.openId ? detailView() : null, gal.modal === 'sync' ? syncModal() : gal.modal === 'planner' ? plannerModal() : gal.modal === 'diag' ? diagModal() : null].filter(Boolean));
  }

  // ---------------------------------------------------------------- çoklu seçim
  const saveSel = () => store.set('gSel', { on: gal.sel.on, ids: gal.sel.ids, grade: gal.sel.grade, target: gal.sel.target });
  function toggleSel(id) {
    const S = gal.sel;
    S.ids = S.ids.includes(id) ? S.ids.filter((x) => x !== id) : [...S.ids, id];
    gal.selConfirm = false;
    saveSel();
    render();
  }
  // Kullanılabilir coin: güncel coin, galeri bütçesi varsa kalanıyla sınırlı (ikisi de bilinmiyorsa null = sınır yok)
  function availCoins() {
    let a = run.coins ?? null;
    if (settings.galleryBudget > 0) a = Math.min(a ?? Infinity, Math.max(0, settings.galleryBudget - (gal.spent || 0)));
    return a === Infinity ? null : a;
  }
  function selBar() {
    const S = gal.sel;
    const byId = new Map(gal.cat.sets.map((x) => [x.id, x]));
    S.ids = S.ids.filter((id) => byId.has(id));
    const b = pickBatch(S.ids.map((id) => ({ set: byId.get(id), defs: gal.defs.get(id) || null, grade: S.grade[id] || null })), livePrices(), S.target, availCoins());
    const buyable = b.rows.filter((r) => r.g && gal.defs.has(r.set.id) && r.plan.missing);
    const need = buyable.reduce((a, r) => a + r.plan.need, 0);
    const cards = buyable.reduce((a, r) => a + r.plan.missing, 0);
    const gsel = (value, first, on, grades = GRADES) => {
      const el = h('select', { onchange: (e) => on(e.target.value) }, [h('option', { value: '', text: first }), ...grades.slice().reverse().map((g) => h('option', { value: g, text: g }))]);
      el.value = value || '';
      return el;
    };
    const row = (r, i) => {
      const x = r.set;
      const tiers = GRADES.filter((g) => x.sol?.tiers?.some((y) => y.g === g));
      let info;
      if (!r.g) info = h('span', { class: 'why', text: L('sel.why.' + r.why) });
      else if (!gal.defs.has(x.id)) info = h('span', { class: 'why', text: L('sel.unsynced') });
      else if (!r.plan.missing) info = h('span', { class: 'why mut', text: L('sel.ready') });
      else info = h('span', { class: 'i', text: L('pl.row', { n: r.plan.missing, c: KF(r.plan.need) }) });
      return h('div', { class: 'srow' }, [
        h('span', { class: 'i', text: String(i + 1) }),
        setArt(x),
        h('div', { class: 'snm', text: x.name, onclick: () => { gal.openId = x.id; gal.openGrade = null; gal.confirmBuy = false; gal.filter = 'all'; gal.listOpen = false; render(); } }),
        gsel(S.grade[x.id], L('sel.auto'), (v) => { if (v) S.grade[x.id] = v; else delete S.grade[x.id]; gal.selConfirm = false; saveSel(); render(); }, tiers),
        h('span', { class: 'gg ' + (r.g || ''), text: r.g || '—', title: r.fell ? L('sel.fell', { from: S.grade[x.id] || S.target }) : '' }),
        info,
        h('button', { class: 'x', text: '✕', title: L('sel.remove'), onclick: () => toggleSel(x.id) }),
      ]);
    };
    return h('div', { class: 'selbar' }, [
      h('div', { class: 'hd' }, [
        h('b', { text: L('sel.count', { n: S.ids.length }) }),
        h('span', { class: 'mut', title: L('sel.avail.title'), text: availCoins() == null ? L('sel.avail.none') : L('sel.avail', { c: fmt(availCoins()) }) }),
        h('label', {}, [L('sel.target') + ' ', gsel(S.target, L('sel.target.max'), (v) => { S.target = v || null; gal.selConfirm = false; saveSel(); render(); })]),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'g', text: L('sel.tabAll'), onclick: () => {
          for (const x of gal.cat.sets) if (x.cat === gal.tab && x.sol?.tiers?.length && !x.filter?.unsupported && !S.ids.includes(x.id)) S.ids.push(x.id);
          saveSel(); render();
        } }),
        h('button', { class: 'g', text: L('sel.clear'), onclick: () => { S.ids = []; S.grade = {}; gal.selConfirm = false; saveSel(); render(); } }),
      ]),
      S.ids.length ? h('div', { class: 'selrows' }, b.rows.map(row)) : h('div', { class: 'mut', text: L('sel.empty') }),
      h('div', { class: 'ft' }, [
        h('span', { class: 'mut', text: L('sel.note') }),
        h('button', {
          class: gal.selConfirm ? 'dan' : 'b', disabled: run.running || !buyable.length,
          text: gal.selConfirm ? L('sel.confirm', { n: buyable.length, c: fmt(need) }) : L('sel.buy', { n: buyable.length, k: cards, c: fmt(need) }),
          onclick: () => {
            if (!gal.selConfirm) { gal.selConfirm = true; render(); return; }
            gal.selConfirm = false;
            // Derece alım anında yeniden seçilir (auto): hedef = sete özel ya da genel hedef
            startTask((my) => buyBatch(my, buyable.map((r) => ({ setId: r.set.id, grade: S.grade[r.set.id] || S.target || null, auto: true }))), L('bg.planStart'));
          },
        }),
        gal.selConfirm ? h('button', { class: 'g', text: L('cancel'), onclick: () => { gal.selConfirm = false; render(); } }) : null,
      ]),
    ]);
  }

  // Üst özet: tüm galeri (büyük) + seçili sekme (küçük)
  function overviewStrip(sums) {
    const defsOf = (id) => gal.defs.get(id) || null;
    const all = overview(gal.cat.sets, sums, defsOf);
    const tb = overview(gal.cat.sets.filter((x) => x.cat === gal.tab), sums, defsOf);
    const box = (label, value, sub, cls = '', title = '') => h('div', { title }, [
      h('div', { class: 'l', text: label }), h('div', { class: 'v ' + cls, text: value }), sub ? h('div', { class: 's', text: sub }) : null,
    ]);
    const lv = store.get('gLevel', 0);
    const nm = nextMilestone(lv);
    const lvIn = h('input', { type: 'number', min: 0, max: 25, value: lv || '', placeholder: L('ov.level.ph'), class: 'lvin',
      onchange: (e) => { store.set('gLevel', Math.max(0, Math.min(25, Math.floor(Number(e.target.value) || 0)))); render(); } });
    return h('div', { class: 'ovw' }, [
      h('div', { title: L('ov.level.title') }, [h('div', { class: 'l', text: L('ov.level') }), h('div', { class: 'v a' }, [lvIn, h('span', { class: 'of', text: ' / 25' })]),
        h('div', { class: 's', text: lv ? (nm ? L('ov.level.next', { n: nm }) : L('ov.level.max')) : '' })]),
      box(L('ov.score'), fmt(all.score), L('ov.synced', { n: all.synced, m: all.total }), 'g', L('ov.score.title')),
      box(L('ov.earned'), fmt(all.earned), L('ov.tab', { v: fmt(tb.earned) }), 'g'),
      box(L('ov.reachPts'), '+' + fmt(all.reachPts), L('ov.tab', { v: '+' + fmt(tb.reachPts) }), 'g', L('ov.reachPts.title')),
      box(L('ov.reach'), fmt(all.reach), L('ov.reachCost', { c: KF(all.reachCost), t: KF(all.reachTax) }) + ' · ' + L('ov.tab', { v: fmt(tb.reach) }), 'a', L('ov.reach.title')),
      box(L('ov.max'), fmt(all.max), L('ov.tab', { v: fmt(tb.max) })),
      box(L('ov.sets'), `${all.done}/${all.total}`, L('ov.tab', { v: `${tb.done}/${tb.total}` })),
      (() => {
        const n = gal.cat.sets.filter((x) => gal.toGrade[x.id] || gal.next?.get(x.id)?.ready).length;
        return h('div', { class: 'click', title: L('ov.toGrade.title'), onclick: () => { galSet('show', 'grade', 'gShow'); render(); } }, [
          h('div', { class: 'l', text: L('ov.toGrade') }), h('div', { class: 'v ' + (n ? 'a' : ''), text: String(n) }), h('div', { class: 's', text: L('ov.toGrade.sub') }),
        ]);
      })(),
    ]);
  }

  function contactBtn() {
    const b = h('button', { class: 'contact', title: L('contact.title') }, [L('contact'), h('b', { text: `Discord ${CONTACT}` })]);
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(CONTACT); b.replaceChildren(L('contact.copied'), h('b', { text: CONTACT })); } catch (_) { b.replaceChildren('Discord: ', h('b', { text: CONTACT })); }
      setTimeout(() => b.replaceChildren(L('contact'), h('b', { text: `Discord ${CONTACT}` })), 2000);
    });
    return b;
  }

  // Teşhis: kullanıcı oyunda notlandırdığı bir seti seçer; EA'nın döndürdüğü toplanma bilgisi rapor olarak kopyalanır
  const diag = { id: null, text: '', running: false, armed: false, tok: 0 };
  function diagModal() {
    const sets = gal.cat.sets.filter((s) => !s.filter?.unsupported).slice().sort((a, b) => a.name.localeCompare(b.name, LOC));
    if (diag.id == null) diag.id = (sets.find((s) => s.filter?.teams) || sets[0])?.id ?? null;
    const close = () => { diag.tok++; gal.modal = null; render(); };   // açık genel tarama varsa durur
    const okSets = gal.cat.sets.filter((x) => !x.filter?.unsupported);
    const reqs = okSets.reduce((a, x) => a + (diagCrit(x)?.length || 0), 0);
    const run = async (full = false) => {
      const set = sets.find((x) => x.id === diag.id);
      const crit = diagCrit(set);
      if (!crit) return;
      diag.running = true; diag.full = full; diag.armed = false; diag.text = L('diag.running'); render();
      let r;
      try { r = await diagProbe(crit); } catch (e) { r = { error: String(e?.message || e) }; }
      const sm = gal.summary[set.id];
      const app = 'userscript v' + (typeof GM_info !== 'undefined' ? GM_info.script?.version : '?') + ' · ' + (typeof GM_info !== 'undefined' ? GM_info.scriptHandler || '' : '');
      const overview = diagOverview(gal.summary, okSets, {
        katalog: gal.cat.updated || null, alimSonrasi: settings.afterBuy || 'relist', notlandirilacak: Object.keys(gal.toGrade || {}).length,
      });
      // Genel tarama: bütün setlerin bütün takımları/ligleri, yalnız sayılar
      let scan = null;
      if (full) {
        const my = ++diag.tok;
        const rows = [];
        for (const [i, x] of okSets.entries()) {
          if (my !== diag.tok) break;
          const ta0 = document.getElementById('fcgu-diag-ta');
          if (ta0) ta0.value = L('diag.progress', { i: i + 1, n: okSets.length });
          try { rows.push({ set: x, parts: (await diagProbe(diagCrit(x), false)).parts || [] }); }
          catch (e) { rows.push({ set: x, error: String(e?.message || e).slice(0, 80) }); }
          await sleep(rnd(300, 700));
        }
        scan = diagScan(rows, gal.summary) + (rows.length < okSets.length ? `
  (durduruldu: ${rows.length}/${okSets.length})` : '');
      }
      diag.text = diagReport(r, { app, set: set.name, overview, scan, sets: diagSetList(gal.summary, okSets), saved: sm ? { c: sm.collected, n: sm.total, sc: sm.score } : null });
      diag.running = false; render();
    };
    const deep = async () => {
      diag.running = true; diag.full = false; diag.armed = false; diag.text = L('diag.deep.running'); render();
      let r;
      try { r = await deepProbe(); } catch (e) { r = { error: String(e?.message || e) }; }
      const app = 'userscript v' + (typeof GM_info !== 'undefined' ? GM_info.script?.version : '?') + ' · ' + (typeof GM_info !== 'undefined' ? GM_info.scriptHandler || '' : '');
      diag.text = deepReport(r, { app });
      diag.running = false; render();
    };
    const ta = h('textarea', { id: 'fcgu-diag-ta', readOnly: true, value: diag.armed ? L('diag.all.note', { sets: okSets.length, reqs }) : diag.text, placeholder: L('diag.ph'), style: 'width:100%;height:220px;margin-top:10px;font:11px/1.4 ui-monospace,Consolas,monospace;box-sizing:border-box' });
    return h('div', { class: 'md', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [h('div', { class: 'box', style: 'width:min(720px,100%)' }, [
      h('h3', { text: L('diag.title') }),
      h('div', { class: 'mut', text: L('diag.body') }),
      h('label', { class: 'opt' }, [L('diag.set') + ' ', h('select', { onchange: (e) => { diag.id = Number(e.target.value); } },
        sets.map((x) => h('option', { value: String(x.id), selected: x.id === diag.id, text: x.name + (gal.summary[x.id] ? ` (${gal.summary[x.id].collected}/${gal.summary[x.id].total})` : '') })))]),
      ta,
      h('div', { class: 'row end' }, [
        h('button', { class: 'g', text: L('close'), onclick: close }),
        h('button', { class: 'g', text: L('diag.deep'), title: L('diag.deep.title'), disabled: diag.running, onclick: deep }),
        h('button', { class: 'g', text: L('diag.copy'), disabled: !diag.text || diag.running, onclick: async (e) => {
          const b = e.currentTarget;
          try { await navigator.clipboard.writeText(diag.text); b.textContent = L('diag.copied'); } catch (_) { ta.select(); }
        } }),
        diag.running && diag.full
          ? h('button', { class: 'g', text: L('diag.stop'), onclick: () => { diag.tok++; } })
          : h('button', { class: 'g', text: diag.armed ? L('diag.all.confirm', { d: fmtDur(reqs * 1.3 + okSets.length * 0.5, L) }) : L('diag.all'), title: L('diag.all.title'), disabled: diag.running,
            onclick: () => { if (diag.armed) run(true); else { diag.armed = true; render(); } } }),
        h('button', { class: 'b', text: L('diag.run'), disabled: diag.running, onclick: () => run(false) }),
      ]),
    ])]);
  }
  function syncModal() {
    const all = gal.cat.sets.filter((s) => !s.filter?.unsupported);
    const sets = gal.skipRecent ? all.filter((s) => !(gal.summary[s.id]?.at > Date.now() - RECENT)) : all;
    const est = syncEstimate(sets, gal.summary, gal.stats.secPerReq);
    const close = () => { gal.modal = null; render(); };
    return h('div', { class: 'md', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [h('div', { class: 'box' }, [
      h('h3', { text: L('sync.title') }),
      h('div', {}, [h('b', { text: L('sync.sets', { n: est.sets }) }), L('sync.body', { c: est.kinds.club, l: est.kinds.league, r: est.kinds.rarity, q: est.reqs })]),
      h('div', { class: 'big', text: `~${fmtDur(est.sec, L)}` }),
      h('div', { class: 'mut', text: L('sync.avg', { s: (est.sec / Math.max(1, est.sets)).toFixed(1).replace('.', LANG === 'en' ? '.' : ',') }) + (gal.stats.secPerReq ? L('sync.measured') : L('sync.first')) + L('sync.keep') }),
      h('label', { class: 'opt' }, [h('input', { type: 'checkbox', checked: gal.skipRecent, onchange: (e) => { gal.skipRecent = e.target.checked; render(); } }), L('sync.skip') + (all.length - sets.length ? L('sync.skipped', { n: all.length - sets.length }) : '')]),
      h('div', { class: 'row end' }, [
        h('button', { class: 'g', text: L('cancel'), onclick: close }),
        h('button', { class: 'b', text: sets.length ? L('sync.start') : L('sync.none'), disabled: !sets.length, onclick: () => { gal.modal = null; startTask((my) => syncSets(my, sets.map((s) => s.id)), L('bg.syncStart')); } }),
      ]),
    ])]);
  }

  function runPlanner() {
    const P = gal.pl;
    const groups = gal.cat.sets.filter((x) => !P.syncedOnly || gal.defs.has(x.id)).map((x) => tierOptions(x, gal.defs.get(x.id) || null));
    P.result = P.mode === 'target' ? planTokens(groups, { target: Math.max(1, P.target | 0) }) : planTokens(groups, { budget: Math.max(0, P.budget | 0) });
  }
  function plannerModal() {
    const P = gal.pl;
    const r = P.result;
    const byId = new Map(gal.cat.sets.map((x) => [x.id, x]));
    const redo = () => { P.confirm = false; runPlanner(); render(); };
    const close = () => { gal.modal = null; render(); };
    const buyable = r.picks.filter((o) => !o.est && !o.ready);   // "hazır" satırlarda alınacak kart yok
    return h('div', { class: 'md', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [h('div', { class: 'box wide' }, [
      h('div', { class: 'row' }, [h('h3', { text: L('pl.title'), style: 'flex:1' }), h('button', { class: 'g', text: '✕', onclick: close })]),
      h('div', { class: 'mut', text: L('pl.note') }),
      h('div', { class: 'row' }, [
        (() => { const s = h('select', { onchange: (e) => { P.mode = e.target.value; redo(); } }, [h('option', { value: 'target', text: L('pl.target') }), h('option', { value: 'budget', text: L('pl.budget') })]); s.value = P.mode; return s; })(),
        h('input', { type: 'number', value: P.mode === 'target' ? P.target : P.budget, style: 'width:120px', onchange: (e) => { if (P.mode === 'target') P.target = Number(e.target.value) || 0; else P.budget = Number(e.target.value) || 0; redo(); } }),
        h('label', { class: 'opt' }, [h('input', { type: 'checkbox', checked: P.syncedOnly, onchange: (e) => { P.syncedOnly = e.target.checked; redo(); } }), L('pl.synced')]),
      ]),
      P.mode === 'target' ? h('div', { class: 'presets' }, HALL_OF_FUT.map((x) => h('button', { onclick: () => { P.target = x.tokens; redo(); } }, [h('b', { text: L('tokens', { n: x.tokens }) }), h('small', { text: x.names })]))) : null,
      h('div', { class: 'ptot' }, [
        h('div', {}, [L('pl.tokens'), h('b', { text: `+${r.tokens}${P.mode === 'target' && !r.reached ? L('pl.unreach') : ''}` })]),
        h('div', {}, [L('pl.cost'), h('b', { text: fmt(r.cost) })]),
        h('div', {}, [L('pl.tax'), h('b', { text: fmt(r.tax) })]),
        h('div', {}, [L('pl.sets'), h('b', { text: `${r.picks.length} / ${r.picks.reduce((a, o) => a + o.missing, 0)}` })]),
      ]),
      r.picks.some((o) => o.est) ? h('div', { class: 'mut', text: L('pl.unsynced', { n: r.picks.filter((o) => o.est).length }) }) : null,
      h('div', { class: 'pres' }, r.picks.map((o) => {
        const x = byId.get(o.setId);
        return h('div', { class: 'prow', onclick: () => { gal.modal = null; gal.openId = o.setId; gal.openGrade = o.g; render(); } }, [
          setArt(x), h('div', {}, [x.name, o.est ? h('span', { class: 'est', text: ' *' }) : null, o.ready ? h('span', { class: 'est', text: L('pl.ready'), title: L('ready.tip') }) : null]),
          h('b', { text: o.g }), h('span', { text: L('pl.gain', { n: o.gain }) }), h('span', { class: 'mut', text: L('pl.row', { n: o.missing, c: KF(o.cost) }) }),
        ]);
      })),
      h('div', { class: 'row end' }, [
        h('button', { class: 'g', text: L('close'), onclick: close }),
        taskBtn({
          class: P.confirm ? 'dan' : 'b', disabled: !buyable.length,
          text: P.confirm ? L('pl.confirm', { n: buyable.length, c: fmt(buyable.reduce((a, o) => a + o.cost, 0)) }) : L('pl.buy'),
          onclick: () => {
            if (!P.confirm) { P.confirm = true; render(); return; }
            P.confirm = false; gal.modal = null;
            startTask((my) => buyBatch(my, buyable.map((o) => ({ setId: o.setId, grade: o.g }))), L('bg.planStart'));
          },
        }),
      ]),
    ])]);
  }

  function detailView() {
    const set = gal.cat.sets.find((s) => s.id === gal.openId);
    if (!set) { gal.openId = null; return null; }
    const defs = gal.defs.get(set.id) || null;
    const saved = defs ? store.get('gdefs:' + set.id, null) : null;
    const sum = defs ? summarise(set, defs) : null;
    // Varsayılan: şu an ulaşılabilir en yüksek derece (coin/bütçe + ilan); yoksa eski kural
    if (!gal.openGrade || !set.sol?.tiers?.some((t) => t.g === gal.openGrade)) gal.openGrade = pickGrade(set, gal.defs.get(set.id) || null, livePrices(), null, availCoins()).g || defaultTier(set, sum?.score || 0);
    const close = () => { gal.openId = null; render(); };
    const live = livePrices();
    const sync1 = () => startTask((my) => syncPrice(my, set.id, gal.openGrade), L('bg.syncStart'));

    const head = sum ? h('div', {}, [
      h('div', {}, [L('hd.line', { c: sum.collected, r: set.required }), h('b', { text: fmt(sum.score) }), L('hd.line2', { g: sum.grade || '—', e: sum.earned, m: sum.maxTokens })]),
      h('div', { class: 'mut', text: sum.next ? L('hd.next', { g: sum.next.g, n: fmt(sum.need) }) : L('hd.top') }),
      (() => {
        const sel = h('select', { title: L('ingame.title'), onchange: (e) => setGraded(set.id, e.target.value) },
          [h('option', { value: '', text: L('ingame.auto') }), ...set.grades.map((g) => h('option', { value: g.g, text: g.g }))]);
        sel.value = gal.graded[set.id]?.manual || '';
        return h('div', { class: 'mut', style: 'margin-top:6px' }, [L('ingame.label') + ' ', sel, ' ',
          gal.graded[set.id] ? h('button', { class: 'g', text: L('ingame.reset'), title: L('ingame.reset.title'), onclick: () => setGraded(set.id, null, true) }) : null,
          sum.score > sum.live ? h('div', { text: L('ingame.note', { g: sum.grade || '—', n: fmt(sum.live), lg: gradeFor(set, sum.live).grade || '—' }) }) : null]);
      })(),
    ]) : null;

    const tabs = set.sol ? h('div', { class: 'gtabs' }, set.grades.map((g) => {
      const p = planFromTier(set, g.g, defs, live);
      return h('div', {
        class: `gt ${g.g}${g.g === gal.openGrade ? ' on' : ''}${p ? '' : ' na'}${sum && sum.score >= g.score ? ' got' : ''}`, title: gradeTitle(set, g.g),
        onclick: () => { if (p) { gal.openGrade = g.g; gal.confirmBuy = false; render(); } },
      }, [h('b', { text: g.g }), h('div', { class: 'c', text: p ? L('coins', { n: fmt(defs ? p.need : p.cost) }) : L('unreachable') }), h('div', { class: 't', text: L('tokens', { n: p ? p.tokens : g.tokens || 0 }) })]);
    })) : null;

    let body;
    const plan = set.sol && gal.openGrade ? planFromTier(set, gal.openGrade, defs, live) : null;
    if (plan) {
      const act = set.filter?.unsupported
        ? h('div', { class: 'unsup', text: L('unsupported.note') })
        : !plan.synced
        ? h('div', { class: 'row' }, [h('span', { class: 'mut', text: L('sync.hint') }), taskBtn({ class: 'b', text: L('btn.syncPrice'), onclick: sync1 })])
        : !plan.missing ? h('div', { class: 'mut', text: L('allOwned', { n: Math.max(0, plan.tokens - (sum?.earned || 0)) }), title: L('ready.tip') })
        : h('div', { class: 'row' }, [
          taskBtn({ class: plan.priced < plan.missing ? 'b' : 'g', text: L('btn.syncPrice'), title: L('btn.syncPrice.title'), onclick: sync1 }),
          taskBtn({
            class: gal.confirmBuy ? 'dan' : 'b',
            text: gal.confirmBuy ? L('buy.confirm', { n: plan.missing, c: fmt(plan.need) }) : L('buy.plan', { n: plan.missing, c: fmt(plan.need) }),
            onclick: () => {
              if (!gal.confirmBuy) { gal.confirmBuy = true; render(); return; }
              gal.confirmBuy = false;
              startTask((my) => buyPlan(my, set.id, plan.grade), L('bg.buyStart'));
            },
          }),
          gal.confirmBuy ? h('button', { class: 'g', text: L('cancel'), onclick: () => { gal.confirmBuy = false; render(); } }) : null,
        ]);
      const chips = plan.synced ? h('div', { class: 'chips' }, [['all', plan.cards.length], ['missing', plan.missing], ['collected', plan.cards.length - plan.missing]].map(([k, n]) =>
        h('button', { class: gal.filter === k ? 'on' : '', text: `${L('chip.' + k)} (${n})`, onclick: () => { gal.filter = k; render(); } }))) : null;
      body = h('div', { class: 'plan' }, [
        h('div', { class: 'stats6' }, [
          h('div', { title: plan.priced ? L('st.need.title.live') : L('st.need.title.futgg') }, [plan.priced ? L('st.need.live', { p: plan.priced, m: plan.missing }) : L('st.need.futgg'), h('b', { text: plan.synced ? fmt(plan.need) : '—' })]),
          h('div', {}, [L('st.total'), h('b', { text: fmt(plan.cost) })]),
          h('div', {}, [L('st.tax'), h('b', { text: fmt(plan.synced ? plan.tax : Math.ceil(plan.cost * 0.05)) })]),
          h('div', { title: L('st.sumPts.title') }, [L('st.sumPts'), h('b', { text: `${fmt(plan.sumSc)} / ${fmt(plan.threshold)}` })]),
          h('div', {}, [L('st.tokens'), h('b', { text: String(plan.tokens) })]),
          h('div', {}, [L('st.cards'), h('b', { text: plan.synced ? L('st.have', { h: plan.cards.length - plan.missing, n: plan.cards.length }) : String(plan.cards.length) })]),
        ]),
        act,
        h('div', { class: 'mut', text: L('sol.note', { g: plan.grade, d: solDate(set) }) + solAge(set) + (plan.noListing ? L('sol.noListing', { n: plan.noListing }) : '') + L('sol.bonus') }),
        chips,
        h('div', { class: 'solg' }, plan.cards
          .filter((c) => gal.filter === 'all' || (gal.filter === 'missing' ? !c.col : c.col))
          .sort((a, b) => (a.col - b.col) || b.price - a.price)
          .map((c) => h('div', { class: 'sc2' + (c.col ? ' col' : '') + (c.rare > 1 ? ' sp' : ''), title: L('card.tip', { name: c.name || '#' + c.def, r: c.r, sc: fmt(c.sc), p: fmt(c.cost) }) + (c.col ? L('card.tip.col') : '') }, [
            h('span', { class: 'rt', text: c.r }), c.col ? h('span', { class: 'ok', text: '✓' }) : null,
            icon(img.portrait(c.base), 'face'), h('div', { class: 'nm', text: c.name || '—' }),
            h('div', { class: 'ft' }, [h('span', { class: 'v', text: L('pts', { n: fmt(c.sc) }), title: L('pts.tip', { n: fmt(c.sc), src: c.scSrc }) }),
              c.col ? h('span', { class: 'p', text: KF(c.price) })
                : c.live === 0 ? h('span', { class: 'p none', text: L('noListing') })
                : c.live > 0 ? h('span', { class: 'p live', text: KF(c.live), title: L('live.tip', { p: fmt(c.price) }) })
                : h('span', { class: 'p', text: KF(c.price), title: L('futgg.tip') })]),
          ]))),
      ]);
    } else if (!defs && !set.filter?.unsupported) {
      body = h('div', { class: 'plan' }, [L('notSynced') + ' ', taskBtn({ class: 'b', text: L('btn.sync'), onclick: sync1 })]);
    } else {
      body = h('div', { class: 'plan mut', text: set.filter?.unsupported ? L('untrackable.long') : L('noSol') });
    }

    return h('div', { class: 'ov', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [h('div', { class: 'dr' }, [
      h('div', { class: 'row' }, [setArt(set), h('div', { style: 'flex:1' }, [h('h2', { text: set.name }), h('div', { class: 'mut', text: L('dt.sub', { r: set.required }) + tokenLabel(set, sum, L) + (saved ? L('dt.synced', { d: dt(saved.at) }) : '') })]), h('button', { class: 'g', text: '✕', onclick: close })]),
      gal.toGrade[set.id] ? h('div', { class: 'gbanner' }, [
        h('span', { text: L('grade.banner') }),
        h('button', { class: 'b', text: L('grade.done'), onclick: () => { markToGrade(set.id, false); render(); } }),
      ]) : null,
      head, tabs, body,
    ])]);
  }
  // Setin fut.gg çözümünün çekildiği tarih (yoksa katalog tarihi); 2 günden eskiyse uyarı
  const solDate = (set) => (set.sol?.at ? dt(Date.parse(set.sol.at)) : catDate());
  function solAge(set) {
    const at = set.sol?.at ? Date.parse(set.sol.at) : null;
    const days = at ? Math.floor((Date.now() - at) / 86400000) : 0;
    return days >= 2 ? L('sol.old', { n: days }) : '';
  }

  // ---------------------------------------------------------------- stil
  const CSS = `
#fcgu-panel { position:fixed; left:var(--fcg-left,0); top:var(--fcg-top,0); right:0; bottom:var(--fcg-bottom,0);
  z-index:2147483000; display:flex; flex-direction:column; background:#0f1115; color:#e7e9ee;
  font:13px/1.4 "Segoe UI", system-ui, sans-serif; border-left:1px solid #2a2f3a; --err:#ef5a5a; }
#fcgu-panel[hidden] { display:none !important; }
#fcgu-panel * { box-sizing:border-box; }
#fcgu-panel .fcg-bar { display:flex; align-items:center; gap:8px; height:40px; padding:0 12px; background:#181b22; border-bottom:1px solid #2a2f3a; flex:none; }
#fcgu-panel .fcg-title { display:flex; align-items:center; gap:6px; font-size:14px; letter-spacing:1px; }
#fcgu-panel .fcg-title b { color:#2fd08a; }
#fcgu-panel .fcg-spacer { flex:1; }
#fcgu-panel .fcg-body { flex:1; min-height:0; overflow:auto; }
#fcgu-panel .fcg-in { max-width:760px; margin:0 auto; padding:4px 12px 16px; }
#fcgu-panel section { padding:10px 0; border-bottom:1px solid #2a2f3a; }
#fcgu-panel input, #fcgu-panel textarea, #fcgu-panel select { width:100%; background:#181b22; color:#e7e9ee; border:1px solid #2a2f3a;
  border-radius:6px; padding:6px 8px; font:inherit; }
#fcgu-panel select { width:auto; max-width:200px; padding:3px 6px; }
#fcgu-panel textarea { height:64px; resize:vertical; }
#fcgu-panel button { background:#1f232c; color:#e7e9ee; border:1px solid #2a2f3a; border-radius:6px; padding:6px 10px;
  font:inherit; cursor:pointer; width:auto; text-transform:none; letter-spacing:normal; }
#fcgu-panel button:hover { border-color:#8b93a3; }
#fcgu-panel button.pri { background:#2fd08a; color:#06140d; border-color:#2fd08a; font-weight:600; }
#fcgu-panel button.dan { background:var(--err); color:#fff; border-color:var(--err); font-weight:600; }
#fcgu-panel .row { display:flex; gap:6px; align-items:center; }
#fcgu-panel .row > input { flex:1; }
#fcgu-panel .mut { color:#8b93a3; font-size:12px; }
#fcgu-panel .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:8px; }
#fcgu-panel .stats div { background:#181b22; border-radius:6px; padding:6px; text-align:center; }
#fcgu-panel .stats b { display:block; font-size:14px; }
#fcgu-panel .st { margin-top:6px; font-size:12px; }
#fcgu-panel .st.error { color:var(--err); } #fcgu-panel .st.warn { color:#f0b43c; } #fcgu-panel .st.ok { color:#2fd08a; }
#fcgu-panel .res { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:4px; cursor:pointer; }
#fcgu-panel .res:hover { background:#181b22; }
#fcgu-panel .res small { display:block; color:#8b93a3; font-size:11px; }
#fcgu-panel .results { max-height:260px; overflow:auto; margin-top:6px; }
#fcgu-panel .face { width:28px; height:28px; border-radius:4px; object-fit:cover; flex:none; background:#181b22; }
#fcgu-panel .ic { width:14px; height:14px; object-fit:contain; }
#fcgu-panel .meta { display:flex; align-items:center; gap:4px; color:#8b93a3; font-size:11px; margin-top:1px; }
#fcgu-panel .price { color:#f0b43c; font-size:11px; margin-left:6px; }
#fcgu-panel .opt { display:flex; align-items:center; gap:6px; color:#8b93a3; font-size:12px; margin-top:8px; }
#fcgu-panel .opt input[type=checkbox] { width:auto; }
#fcgu-panel .it { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #2a2f3a; }
#fcgu-panel .it .n { flex:1; min-width:0; }
#fcgu-panel .it .n small { display:block; color:#8b93a3; }
#fcgu-panel .it .x { padding:2px 7px; }
#fcgu-panel .tag { font-size:11px; padding:2px 6px; border-radius:10px; background:#181b22; white-space:nowrap; }
#fcgu-panel .tag.done { color:#2fd08a; } #fcgu-panel .tag.budget, #fcgu-panel .tag.notfound { color:#f0b43c; }
#fcgu-panel .tag.error { color:var(--err); } #fcgu-panel .tag.owned { color:#2fd08a; margin-left:6px; }
/* Beklenen kulüpten farklı oyuncu: yanlış kart eklenmiş olabilir */
#fcgu-panel .it.bad { background:rgba(239,90,90,.10); border-left:2px solid var(--err); padding-left:4px; }
#fcgu-panel .it.bad > .n > span:first-child { color:var(--err); }
#fcgu-panel .it.bad .meta { color:var(--err); }
#fcgu-panel .tag.mismatch { color:var(--err); margin-left:6px; }
#fcgu-panel .warnline { color:var(--err); font-size:12px; margin-top:6px; }
#fcgu-panel .missing { color:var(--err); font-size:12px; margin-top:4px; }
#fcgu-panel .fcg-foot { display:flex; align-items:center; gap:8px; padding:10px 0 0; color:#8b93a3; font-size:12px; border-bottom:0; }
#fcgu-panel .fcg-foot b { color:#2fd08a; font-family:ui-monospace, Consolas, monospace; }
/* ---------- Sol menü sekmesi ---------- */
.fcg-tab { display:flex !important; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; position:relative; }
.fcg-tab::before, .fcg-tab::after { content:none !important; }
.fcg-icon { width:34px; height:34px; padding:3px; box-sizing:border-box; color:#2fd08a; flex:none; pointer-events:none; }
.fcg-lbl { font:600 10px/1.1 "Segoe UI", Arial, sans-serif; color:inherit; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
.fcg-tab:hover .fcg-icon { filter:brightness(1.2); }
.fcg-tab.fcg-active { background:rgba(47,208,138,.16) !important; box-shadow:inset 3px 0 0 #2fd08a; }
.fcg-tab.fcg-active .fcg-lbl { color:#2fd08a; }
@media (max-width:600px) { #fcgu-panel { left:0; } }
/* ---------- görünüm sekmeleri ---------- */
#fcgu-panel .fcg-views { display:flex; gap:4px; margin-left:10px; }
#fcgu-panel .fcg-views button { background:none; border:1px solid transparent; color:#8b93a3; font-weight:700; letter-spacing:.5px; padding:4px 10px; }
#fcgu-panel .fcg-views button.on { color:#f5c518; border-color:rgba(245,197,24,.45); background:rgba(245,197,24,.08); }
/* ---------- Galeri ---------- */
#fcgu-panel .fcg-gal { flex:1; min-height:0; display:flex; flex-direction:column; position:relative;
  background:radial-gradient(1200px 600px at 10% -10%, #1b2d55 0%, transparent 60%), linear-gradient(160deg,#0b1322 0%,#0c2230 60%,#0b3b3a 100%); }
#fcgu-panel .fcg-gal[hidden] { display:none; }
#fcgu-panel .gbody { flex:1; min-height:0; overflow:auto; padding:14px 16px; }
#fcgu-panel .gfoot { flex:none; display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:8px 16px; background:rgba(7,12,22,.94); border-top:1px solid #23324d; font-size:12px; color:#8a97ad; }
#fcgu-panel .gfoot b { color:#e9eef7; }
#fcgu-panel .gfoot input { width:110px; padding:4px 6px; }
#fcgu-panel .gfoot .st { flex:1; min-width:180px; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#fcgu-panel .gfoot select, #fcgu-panel .sub select { padding:3px 6px; }
#fcgu-panel button.b { background:rgba(245,197,24,.12); color:#f5c518; border-color:rgba(245,197,24,.45); font-weight:700; }
#fcgu-panel button.g { background:none; color:#8a97ad; }
#fcgu-panel .introw { display:flex; gap:12px; justify-content:space-between; align-items:flex-start; }
#fcgu-panel .introw p { margin:0 0 10px; flex:1; }
#fcgu-panel .contact { background:rgba(88,101,242,.15); color:#c9cdfb; border-color:rgba(88,101,242,.5); border-radius:999px; font-size:12px; white-space:nowrap; }
#fcgu-panel .contact b { color:#fff; }
#fcgu-panel .top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#fcgu-panel .tabs { flex:1; min-width:0; display:flex; gap:4px; overflow-x:auto; background:rgba(8,14,26,.8); border:1px solid #23324d; border-radius:10px; padding:4px; }
#fcgu-panel .tabs button { flex:none; background:none; border:0; font-weight:700; padding:7px 12px; white-space:nowrap; }
#fcgu-panel .tabs button.on { background:#f5c518; color:#1a1400; }
#fcgu-panel .sub { display:flex; gap:12px; align-items:center; flex-wrap:wrap; color:#8a97ad; font-size:12px; margin:8px 2px 12px; }
#fcgu-panel .sub b { color:#e9eef7; }
#fcgu-panel .sub input[type=checkbox], #fcgu-panel .opt input[type=checkbox] { width:auto; }
#fcgu-panel .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
#fcgu-panel .set { position:relative; background:linear-gradient(180deg,#14223a,#101b2e); border:1px solid #23324d; border-radius:12px; padding:12px; cursor:pointer; }
#fcgu-panel .set:hover { border-color:#3a5078; }
#fcgu-panel .set.full { border-color:rgba(47,208,138,.45); }
#fcgu-panel .set .pick { position:absolute; top:10px; right:12px; width:18px; height:18px; border:1.5px solid #8a97ad; border-radius:5px; display:grid; place-items:center; font-weight:800; font-size:12px; color:#1a1400; }
#fcgu-panel .set.picked { border-color:#f5c518; box-shadow:0 0 0 1px #f5c518 inset; }
#fcgu-panel .set.picked .pick { background:#f5c518; border-color:#f5c518; }
#fcgu-panel .selbar { position:sticky; top:0; z-index:3; background:rgba(9,16,29,.97); border:1px solid rgba(245,197,24,.45); border-radius:12px; padding:10px 12px; margin:0 0 12px; }
#fcgu-panel .selbar .hd { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#fcgu-panel .selbar .hd b { color:#f5c518; }
#fcgu-panel .selrows { max-height:34vh; overflow:auto; margin-top:8px; border-top:1px solid #23324d; }
#fcgu-panel .srow { display:grid; grid-template-columns:22px 26px 1fr auto auto auto 26px; gap:8px; align-items:center; padding:5px 2px; border-bottom:1px solid rgba(35,50,77,.6); font-size:12px; }
#fcgu-panel .srow .crest, #fcgu-panel .srow .ph { width:24px; height:24px; font-size:11px; }
#fcgu-panel .srow .i { color:#8a97ad; text-align:right; }
#fcgu-panel .srow .snm { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
#fcgu-panel .srow .gg { font-weight:800; min-width:18px; text-align:center; }
#fcgu-panel .srow .gg.D { color:#e0772e; } #fcgu-panel .srow .gg.C { color:#c9d1dc; } #fcgu-panel .srow .gg.B { color:#f5c518; } #fcgu-panel .srow .gg.A { color:#3d9bff; } #fcgu-panel .srow .gg.S { color:#a66bff; }
#fcgu-panel .srow .why { color:#f0b43c; font-size:11px; } #fcgu-panel .srow .why.mut { color:#8a97ad; }
#fcgu-panel .srow button.x { background:none; border:0; color:#8a97ad; padding:0; }
#fcgu-panel .srow button.x:hover { color:#ef5a5a; }
#fcgu-panel .selbar .ft { display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-top:8px; }
#fcgu-panel .selbar .ft .mut { flex:1; min-width:220px; font-size:11px; }
#fcgu-panel .set .hd { display:flex; gap:10px; }
#fcgu-panel .crest { width:34px; height:34px; object-fit:contain; flex:none; }
#fcgu-panel .ph { width:34px; height:34px; border-radius:8px; flex:none; display:grid; place-items:center; background:#1c2b47; color:#f5c518; font-weight:800; }
#fcgu-panel .set .nm { font-weight:700; }
#fcgu-panel .set .cnt { color:#8a97ad; font-size:11.5px; }
#fcgu-panel .set .sc { color:#2fd08a; font-weight:700; font-size:12px; display:flex; align-items:center; gap:4px; }
#fcgu-panel .dia { width:8px; height:8px; background:#2fd08a; transform:rotate(45deg); display:inline-block; }
#fcgu-panel .chk { position:absolute; top:10px; right:12px; color:#2fd08a; font-weight:800; }
#fcgu-panel .grades { display:flex; gap:14px; margin:10px 0 8px 4px; }
#fcgu-panel .gd { width:22px; height:22px; transform:rotate(45deg); border:1.5px solid #34425e; border-radius:3px; display:grid; place-items:center; opacity:.45; }
#fcgu-panel .gd span { transform:rotate(-45deg); font-size:10px; font-weight:800; color:#8a97ad; }
#fcgu-panel .gd.got { opacity:.8; } #fcgu-panel .gd.cur { opacity:1; box-shadow:0 0 10px currentColor; }
#fcgu-panel .gd.D, #fcgu-panel .gt.D b { color:#e0772e; } #fcgu-panel .gd.C, #fcgu-panel .gt.C b { color:#c9d1dc; } #fcgu-panel .gd.B, #fcgu-panel .gt.B b { color:#f5c518; }
#fcgu-panel .gd.A, #fcgu-panel .gt.A b { color:#3d9bff; } #fcgu-panel .gd.S, #fcgu-panel .gt.S b { color:#a66bff; }
#fcgu-panel .gd.got, #fcgu-panel .gd.cur { border-color:currentColor; } #fcgu-panel .gd.got span, #fcgu-panel .gd.cur span { color:currentColor; }
#fcgu-panel .tok { color:#f5c518; font-size:11.5px; font-weight:600; }
#fcgu-panel .tok.zero { color:#8a97ad; }
#fcgu-panel .tk { display:grid; grid-template-columns:auto 1fr; gap:1px 10px; font-size:11.5px; color:#8a97ad; }
#fcgu-panel .tk b { text-align:right; font-weight:600; color:#e9eef7; white-space:nowrap; }
#fcgu-panel .tk b.nx, #fcgu-panel .tk b.acc { color:#f5c518; } #fcgu-panel .tk b.ok, #fcgu-panel .tk b.g { color:#2fd08a; } #fcgu-panel .tk b.zero, #fcgu-panel .tk b.mut { color:#8a97ad; font-weight:500; }
#fcgu-panel .nx { color:#8a97ad; font-size:11px; } #fcgu-panel .nx b { color:#f5c518; }
#fcgu-panel .empty { color:#8a97ad; padding:30px; text-align:center; }
#fcgu-panel .ov, #fcgu-panel .md { position:absolute; inset:0; background:rgba(3,6,12,.6); z-index:5; }
#fcgu-panel .ov { display:flex; justify-content:flex-end; }
#fcgu-panel .md { display:grid; place-items:center; padding:16px; z-index:6; }
#fcgu-panel .dr { width:min(560px,100%); height:100%; overflow:auto; background:#0d1628; border-left:1px solid #23324d; padding:16px; }
#fcgu-panel .dr h2 { margin:0; font-size:18px; }
#fcgu-panel .box { width:min(440px,100%); max-height:100%; overflow:auto; background:#0f1a2e; border:1px solid #23324d; border-radius:12px; padding:18px; }
#fcgu-panel .box.wide { width:min(720px,100%); }
#fcgu-panel .box h3 { margin:0 0 8px; }
#fcgu-panel .big { font-size:22px; font-weight:800; color:#f5c518; margin:6px 0; }
#fcgu-panel .row.end { justify-content:flex-end; margin-top:14px; }
#fcgu-panel .gtabs { display:grid; grid-template-columns:repeat(5,1fr); border:1px solid #23324d; border-radius:10px; overflow:hidden; margin:12px 0 10px; }
#fcgu-panel .gt { padding:8px 6px; text-align:center; cursor:pointer; border-right:1px solid #23324d; }
#fcgu-panel .gt:last-child { border-right:0; }
#fcgu-panel .gt.on { background:rgba(245,197,24,.08); box-shadow:inset 0 -2px 0 #f5c518; }
#fcgu-panel .gt.na { opacity:.4; cursor:default; }
#fcgu-panel .gt b { display:block; font-size:15px; } #fcgu-panel .gt.got b::after { content:' ✓'; color:#2fd08a; font-size:11px; }
#fcgu-panel .gt .c { font-size:11.5px; } #fcgu-panel .gt .t { font-size:10.5px; color:#8a97ad; }
#fcgu-panel .plan { background:#101b2e; border:1px solid #23324d; border-radius:10px; padding:10px 12px; margin:10px 0; }
#fcgu-panel .plan .row { margin:8px 0; flex-wrap:wrap; }
#fcgu-panel .stats6, #fcgu-panel .ptot { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
#fcgu-panel .ptot { grid-template-columns:repeat(4,1fr); margin-top:10px; }
#fcgu-panel .stats6 div, #fcgu-panel .ptot div { background:#0f1a2e; border:1px solid #23324d; border-radius:8px; padding:6px 8px; font-size:11px; color:#8a97ad; }
#fcgu-panel .stats6 b, #fcgu-panel .ptot b { display:block; font-size:14px; color:#e9eef7; }
#fcgu-panel .chips { display:flex; gap:6px; margin-top:8px; }
#fcgu-panel .chips button { border-radius:999px; padding:3px 10px; font-size:11.5px; color:#8a97ad; background:none; }
#fcgu-panel .chips button.on { border-color:#f5c518; color:#f5c518; }
#fcgu-panel .solg { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; margin-top:10px; }
#fcgu-panel .sc2 { position:relative; background:linear-gradient(180deg,#1b2a45,#121d33); border:1px solid #23324d; border-radius:10px; padding:6px; text-align:center; }
#fcgu-panel .sc2.col { opacity:.45; } #fcgu-panel .sc2.sp { border-color:rgba(166,107,255,.55); }
#fcgu-panel .sc2 .face { width:56px; height:56px; border-radius:8px; }
#fcgu-panel .sc2 .rt { position:absolute; top:6px; left:8px; font-weight:800; }
#fcgu-panel .sc2 .ok { position:absolute; top:4px; right:6px; color:#2fd08a; font-weight:800; }
#fcgu-panel .sc2 .nm { font-size:11px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#fcgu-panel .sc2 .ft { display:flex; justify-content:space-between; font-size:10.5px; }
#fcgu-panel .sc2 .v { color:#2fd08a; } #fcgu-panel .sc2 .p { color:#8a97ad; } #fcgu-panel .sc2 .p.live { color:#f0b43c; font-weight:700; } #fcgu-panel .sc2 .p.none { color:#ef5a5a; }
#fcgu-panel .presets { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0; }
#fcgu-panel .presets button { text-align:left; font-size:11.5px; }
#fcgu-panel .presets button b { color:#f5c518; }
#fcgu-panel .presets button small { display:block; color:#8a97ad; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#fcgu-panel .pres { max-height:40vh; overflow:auto; border:1px solid #23324d; border-radius:8px; margin-top:8px; }
#fcgu-panel .prow { display:grid; grid-template-columns:28px 1fr auto auto auto; gap:8px; align-items:center; padding:6px 8px; border-bottom:1px solid rgba(35,50,77,.6); font-size:12px; cursor:pointer; }
#fcgu-panel .prow .crest { width:24px; height:24px; }
#fcgu-panel .est { color:#f0b43c; }
#fcgu-panel .gbadge { position:absolute; top:9px; right:30px; font-size:10px; font-weight:700; color:#1a1400; background:#f5c518; border-radius:999px; padding:1px 7px; }
#fcgu-panel .gbanner { display:flex; gap:10px; align-items:center; justify-content:space-between; background:rgba(245,197,24,.1); border:1px solid rgba(245,197,24,.45); border-radius:10px; padding:8px 10px; margin:10px 0; font-size:12px; }
#fcgu-panel .unsup { background:rgba(239,90,90,.08); border:1px solid rgba(239,90,90,.4); border-radius:10px; padding:8px 10px; margin:8px 0; font-size:12px; }
#fcgu-panel .ovw > div.click { cursor:pointer; }
#fcgu-panel .ovw > div.click:hover { border-color:#3a5078; }
#fcgu-panel .flags { flex:none; display:flex; gap:4px; }
#fcgu-panel .flags button { background:none; border:1px solid transparent; border-radius:6px; padding:3px; opacity:.5; line-height:0; }
#fcgu-panel .flags button:hover { opacity:.85; }
#fcgu-panel .flags button.on { opacity:1; border-color:#f5c518; }
#fcgu-panel .flags svg { width:26px; height:17px; border-radius:2px; display:block; }
#fcgu-panel .ovw { display:grid; grid-template-columns:repeat(auto-fit,minmax(135px,1fr)); gap:8px; margin:0 0 12px; }
#fcgu-panel .ovw .lvin { width:52px; font:inherit; font-size:18px; font-weight:800; color:#f5c518; background:transparent; border:1px dashed #23324d; border-radius:6px; padding:0 4px; }
#fcgu-panel .ovw .lvin::placeholder { font-size:11px; font-weight:500; color:#8a97ad; }
#fcgu-panel .ovw .of { color:#8a97ad; font-size:13px; font-weight:600; }
#fcgu-panel .ovw > div { background:linear-gradient(180deg,rgba(20,34,58,.9),rgba(16,27,46,.9)); border:1px solid #23324d; border-radius:10px; padding:8px 10px; }
#fcgu-panel .ovw .l, #fcgu-panel .ovw .s { color:#8a97ad; font-size:11px; }
#fcgu-panel .ovw .v { font-size:18px; font-weight:800; line-height:1.3; }
#fcgu-panel .ovw .v.g { color:#2fd08a; } #fcgu-panel .ovw .v.a { color:#f5c518; }
@media (max-width:760px) { #fcgu-panel .ovw { grid-template-columns:repeat(2,minmax(0,1fr)); } }
/* ---------- transfer pazarı rozeti ---------- */
.fcg-collected { position:absolute; left:50%; bottom:2px; transform:translateX(-50%); z-index:5; background:rgba(8,40,26,.92); color:#2fd08a;
  border:1px solid rgba(47,208,138,.7); border-radius:999px; font:700 10px/1.5 system-ui, "Segoe UI", sans-serif; padding:0 7px; white-space:nowrap; }
.small > .fcg-collected { font-size:9px; padding:0 4px; bottom:1px; }
.small > .fcg-collected::before { content:'✓'; }
.small > .fcg-collected span { display:none; }
`;
  try { GM_addStyle(CSS); } catch (_) { document.documentElement.append(h('style', { textContent: CSS })); }

  // ---------------------------------------------------------------- panel arayüzü
  // Chrome eklentisi #fcg-tab / #fcgu-panel kullanıyor: ikisi birlikte kuruluysa karışmasın diye ayrı kimlikler
  const TAB_ID = 'fcgu-tab';
  const PANEL_ID = 'fcgu-panel';
  const NAV_SELECTORS = ['nav.ut-tab-bar', '.ut-tab-bar', '.ut-tab-bar-view', 'nav[class*="tab-bar"]'];
  let panelOpen = false;
  let ui = null;

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

  // Görsel yoksa/404 ise satırı bozma: varsa yedek adrese geç, yoksa gizle.
  function icon(src, cls, alt) {
    if (!src) return null;
    const el = h('img', { class: cls, src, loading: 'lazy', alt: '' });
    el.onerror = () => { if (alt && el.src !== alt) { el.src = alt; return; } el.style.display = 'none'; };
    return el;
  }

  const LABEL = { pending: 'bekliyor', done: 'alındı', notfound: 'bulunamadı', budget: 'bütçe yetmedi', owned: 'kulübünde var', error: 'hata' };

  function buildPanel() {
    const el = (props, children) => h('div', props, children);
    const coins = h('b', { text: '—' }), spent = h('b', { text: '0' }), left = h('b', { text: '—' });
    const budget = h('input', { type: 'number', min: '0', step: '100', placeholder: 'Toplam bütçe (coin, 0 = sınırsız)' });
    const toggle = h('button', { class: 'pri', text: 'Başlat' });
    const st = h('div', { class: 'st mut', text: 'Hazır' });
    const q = h('input', { placeholder: 'Oyuncu ara (ör. Mbappé)' });
    const results = el({ class: 'results' });
    const bulk = h('textarea', { placeholder: 'Salah\nArda Güler\nKerem Aktürkoğlu' });
    const bulkBtn = h('button', { text: 'Listeye ekle' });
    const missing = el({ class: 'missing' });
    const warnline = el({ class: 'warnline' });
    const rows = el({ class: 'rows' });
    const estimate = el({ class: 'mut' });
    const scanPricesBtn = h('button', { text: 'Fiyatları tara', title: 'Alım yapmadan en ucuz fiyatları ve kulüp/lig/ülke bilgisini doldurur' });
    const scanClubBtn = h('button', { text: 'Kulübü tara', title: 'Kulübündeki oyuncuları okur' });
    const clubInfo = h('span', { class: 'mut', text: 'taranmadı' });
    const metaInfo = el({ class: 'mut' });
    const expectClub = h('select');
    const expectHint = h('span', { class: 'mut' });
    const skipOwned = h('input', { type: 'checkbox' });
    const retry = h('button', { text: 'Atlananları tekrar dene' });
    const resetSpent = h('button', { text: 'Harcananı sıfırla' });
    const clear = h('button', { text: 'Listeyi temizle' });
    const count = h('span', { class: 'mut' });

    const views = el({ class: 'fcg-views' }, [
      h('button', { text: L('view.gallery'), onclick: () => { galSet('view', 'gallery', 'gView'); render(); } }),
      h('button', { text: L('view.list'), onclick: () => { galSet('view', 'list', 'gView'); render(); } }),
    ]);
    const bar = el({ class: 'fcg-bar' }, [
      h('span', { class: 'fcg-title' }, [galleryIcon(), h('b', { text: 'GALLERY GRAB' })]),
      views,
      count,
      h('span', { class: 'fcg-spacer' }),
      h('button', { text: '✕', title: 'Kapat', onclick: () => setOpen(false) }),
    ]);

    const body = el({ class: 'fcg-body' }, [el({ class: 'fcg-in' }, [
      h('section', {}, [
        el({ class: 'stats' }, [
          el({}, [h('span', { class: 'mut', text: 'Coin' }), coins]),
          el({}, [h('span', { class: 'mut', text: 'Harcanan' }), spent]),
          el({}, [h('span', { class: 'mut', text: 'Kalan bütçe' }), left]),
        ]),
        el({ class: 'row' }, [budget, toggle]),
        st,
      ]),
      h('section', {}, [
        el({ class: 'row' }, [q]),
        results,
        (() => {
          const d = h('details', { style: 'margin-top:8px' });
          d.append(h('summary', { class: 'mut', text: 'Toplu ekle (her satıra bir isim)' }), bulk, el({ class: 'row', style: 'margin-top:6px' }, [bulkBtn]), missing);
          return d;
        })(),
      ]),
      h('section', {}, [
        warnline, rows, estimate,
        el({ class: 'row', style: 'margin-top:8px' }, [scanPricesBtn, scanClubBtn, clubInfo]),
        metaInfo,
        el({ class: 'opt' }, [h('span', { text: 'Beklenen kulüp' }), expectClub, expectHint]),
        (() => { const l = h('label', { class: 'opt' }); l.append(skipOwned, document.createTextNode(' Kulübümde olanları atla')); return l; })(),
        el({ class: 'row', style: 'margin-top:8px' }, [retry, resetSpent, clear]),
      ]),
      // Sorun/öneri için iletişim
      el({ class: 'fcg-foot' }, [
        h('span', { text: 'Sorun, hata ya da öneri olursa yaz — Discord:' }),
        h('b', { text: CONTACT }),
        (() => {
          const b = h('button', { text: 'Kopyala', title: 'Discord kullanıcı adını kopyala' });
          b.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(CONTACT); b.textContent = 'Kopyalandı'; }
            catch (_) { b.textContent = CONTACT; }
            setTimeout(() => { b.textContent = 'Kopyala'; }, 2000);
          });
          return b;
        })(),
      ]),
    ])]);

    const gal0 = { body: el({ class: 'gbody' }), foot: el({ class: 'gfoot' }), over: el({}) };
    const galEl = el({ class: 'fcg-gal' }, [gal0.body, gal0.foot, gal0.over]);
    // odaktaki kutu yüzünden ertelenen çizim, odak kalkınca yapılır
    galEl.addEventListener('focusout', () => setTimeout(() => { if (gal.dirty) render(); }, 0));
    const panel = h('div', { id: PANEL_ID, class: 'fcg-panel', hidden: true }, [bar, body, galEl]);
    document.body.append(panel);

    ui = { gal: gal0, galEl, listEl: body, views, panel, coins, spent, left, budget, toggle, st, q, results, bulk, bulkBtn, missing, warnline, rows, estimate, scanPricesBtn, scanClubBtn, clubInfo, metaInfo, expectClub, expectHint, skipOwned, count };

    // olaylar
    budget.addEventListener('change', () => { settings.budget = Math.max(0, Math.floor(Number(budget.value) || 0)); saveSettings(); });
    toggle.addEventListener('click', () => {
      if (run.running) return stop();
      settings.budget = Math.max(0, Math.floor(Number(budget.value) || 0));
      saveSettings();
      start();
    });
    scanPricesBtn.addEventListener('click', () => startTask(scanPrices, 'Fiyat taraması başladı'));
    scanClubBtn.addEventListener('click', () => startTask(scanClub, 'Kulüp taraması başladı'));
    skipOwned.addEventListener('change', () => { settings.skipOwned = skipOwned.checked; saveSettings(); });
    expectClub.addEventListener('change', () => { settings.expectClub = expectClub.value || null; saveSettings(); });
    retry.addEventListener('click', () => { list.forEach((x) => { if (x.status !== 'done') { x.status = 'pending'; x.note = ''; } }); saveList(); });
    resetSpent.addEventListener('click', () => { if (!run.running) setSpent(0); });
    clear.addEventListener('click', () => { list = []; saveList(); });

    let timer = null;
    let seq = 0;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const term = q.value.trim();
        const my = ++seq;
        if (term.length < 2) { results.replaceChildren(); return; }
        let players;
        try { players = await searchPlayers(term, 20); } catch (e) {
          if (my === seq) results.replaceChildren(h('div', { class: 'mut', text: e.message }));
          return;
        }
        metaOrNull();
        if (my !== seq) return;
        results.replaceChildren(...(players.length ? players.map((p) => h('div', {
          class: 'res',
          onclick: () => { addPlayers([p]); q.value = ''; results.replaceChildren(); },
        }, [
          icon(img.portrait(p.baseId), 'face'),
          h('div', {}, [
            h('span', { text: `${p.name}${p.rating ? ` (${p.rating})` : ''}` }),
            p.fullName && p.fullName !== p.name ? h('small', { text: p.fullName }) : null,
          ]),
        ])) : [h('div', { class: 'mut', text: 'Sonuç yok' })]));
      }, 300);
    });

    bulkBtn.addEventListener('click', async () => {
      const names = bulk.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!names.length) return;
      bulkBtn.disabled = true;
      missing.textContent = 'Aranıyor…';
      try {
        const r = await bulkAdd(names);
        bulk.value = r.missing.join('\n');
        missing.textContent = r.missing.length ? `${r.added} eklendi. Bulunamayanlar kutuda bırakıldı.` : `${r.added} eklendi.`;
      } catch (e) { missing.textContent = e.message || 'Hata'; }
      bulkBtn.disabled = false;
    });

    return panel;
  }

  // Kulüp / lig / ülke satırı — bu bilgi ancak fiyat taraması veya alım sonrası dolar.
  function metaRow(x) {
    const bits = [x.position, clubOf(x), nameOf('leagues', x.leagueId, x.league), nameOf('nations', x.nationId, x.nation)].filter(Boolean).join(' · ');
    const crest = img.crest(x.teamId);
    const flag = img.flag(x.nationId);
    if (!bits && !crest && !flag) return null;
    return h('div', { class: 'meta' }, [icon(crest, 'ic', img.crestAlt(x.teamId)), icon(flag, 'ic'), bits ? h('span', { text: bits }) : null]);
  }

  // Çizimler kareye bir kez birleştirilir; panel kapalıyken hiç çizilmez (EA sayfasının ana iş parçacığını yormasın)
  let renderQueued = false;
  function render() {
    if (!ui || !panelOpen || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderNow(); });
  }
  function renderNow() {
    if (!ui) return;
    if (gal.cat) applyFloors(gal.cat.sets, gal.graded);
    const g = gal.view !== 'list';
    ui.galEl.hidden = !g;
    ui.listEl.hidden = g;
    ui.count.hidden = g;
    [...ui.views.children].forEach((b, i) => { b.classList.toggle('on', (i === 0) === g); b.textContent = L(i === 0 ? 'view.gallery' : 'view.list'); });
    if (g) { try { renderGallery(); } catch (e) { console.error('[Gallery Grab]', e); } return; }
    renderList();
  }

  function renderList() {
    ui.coins.textContent = fmt(run.coins);
    ui.spent.textContent = fmt(run.spent);
    ui.left.textContent = settings.budget > 0 ? fmt(Math.max(0, settings.budget - run.spent)) : '∞';
    if (document.activeElement !== ui.budget) ui.budget.value = settings.budget || '';
    ui.skipOwned.checked = !!settings.skipOwned;
    ui.clubInfo.textContent = club.at
      ? `${club.ids.size} oyuncu · ${club.fetched} kart · ${new Date(club.at).toLocaleDateString('tr-TR')}`
      : 'taranmadı';

    // Sözlük yüklüyse sessiz kal; yalnız sorun varsa sebebini göster.
    ui.metaInfo.textContent = !metaCache || metaCache.counts?.teams ? ''
      : 'İsim sözlüğü yüklenemedi — ' + (metaCache.warn || '') + ' ' + (metaCache.sample || '');

    ui.toggle.textContent = run.running ? 'Durdur' : 'Başlat';
    ui.toggle.className = run.running ? 'dan' : 'pri';
    ui.st.textContent = run.text || 'Hazır';
    ui.st.className = 'st ' + (run.level || 'mut');
    ui.scanPricesBtn.disabled = run.running;
    ui.scanClubBtn.disabled = run.running;

    const done = list.filter((x) => x.status === 'done').length;
    ui.count.textContent = list.length ? `${done}/${list.length}` : '';
    const total = list.reduce((a, x) => a + (x.status === 'done' ? 0 : x.market || 0), 0);
    ui.estimate.textContent = total ? `Tahmini kalan maliyet: ${fmt(total)} coin` : '';

    // Beklenen kulüp seçici + uyumsuzluk uyarısı
    const counts = clubCounts();
    const exp = expectedClub(counts, settings.expectClub || null);
    const known = counts.reduce((a, c) => a + c.n, 0);
    const autoName = exp.auto && exp.key ? counts.find((c) => c.key === exp.key)?.club : null;
    ui.expectClub.replaceChildren(
      h('option', { value: '', text: autoName ? `Otomatik (${autoName})` : 'Otomatik (çoğunluk)' }),
      ...counts.map((c) => h('option', { value: c.key, text: `${c.club} (${c.n})` })),
    );
    ui.expectClub.value = exp.auto ? '' : exp.key;
    ui.expectClub.disabled = !counts.length;
    ui.expectHint.textContent = !known ? 'Kulüp bilgisi için "Fiyatları tara"'
      : exp.tie ? 'çoğunluk yok — kulüp seçin'
      : exp.stale && exp.auto ? 'seçilen kulüp listede yok' : '';

    const bad = (x) => { const k = clubKey(x); return !!exp.key && !!k && k !== exp.key; };
    const badCount = list.filter(bad).length;
    ui.warnline.textContent = badCount ? `${badCount} oyuncu farklı kulüpte — yanlış oyuncu eklenmiş olabilir` : '';

    ui.rows.replaceChildren(...(list.length ? list.map((x) => {
      const tag = x.status === 'done' ? `alındı · ${fmt(x.price)}` : LABEL[x.status] || x.status;
      const price = x.status !== 'done' && x.marketAt ? (x.market ? `~${fmt(x.market)}` : 'ilan yok') : null;
      return h('div', { class: bad(x) ? 'it bad' : 'it' }, [
        icon(img.portrait(x.baseId), 'face'),
        h('div', { class: 'n' }, [
          h('span', { text: `${x.name}${x.rating ? ` (${x.rating})` : ''}` }),
          price ? h('span', { class: 'price', text: price }) : null,
          bad(x) ? h('span', { class: 'tag mismatch', text: 'farklı kulüp' }) : null,
          club.ids.has(x.baseId) && x.status !== 'owned' ? h('span', { class: 'tag owned', text: 'sende var' }) : null,
          metaRow(x),
          x.note ? h('small', { text: x.note }) : null,
        ]),
        h('span', { class: `tag ${x.status}`, text: tag }),
        h('button', { class: 'x', text: '✕', title: 'Sil', onclick: () => { list = list.filter((y) => y.id !== x.id); saveList(); } }),
      ]);
    }) : [h('div', { class: 'mut', text: 'Liste boş — yukarıdan oyuncu ekleyin.' })]));
  }

  // ---------------------------------------------------------------- sol menü sekmesi
  function findNav() {
    for (const sel of NAV_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.querySelector('.ut-tab-bar-item, button, a')) return el;
    }
    return null;
  }

  function buildTabItem(sample) {
    const base = sample ? sample.className : 'ut-tab-bar-item';
    const cls = base.replace(/\bicon-[\w-]+\b/g, '').replace(/\b(selected|active)\b/g, '').replace(/\s+/g, ' ').trim();
    const el = h(sample ? sample.tagName.toLowerCase() : 'button', { id: TAB_ID, class: `${cls} fcg-tab`, title: 'Gallery Grab' });
    el.append(galleryIcon(), h('span', { class: 'fcg-lbl', text: 'GALLERY' }));
    return el;
  }

  // Sekme yalnız oyun açıkken (sol menü varken) görünür; giriş / yükleme ekranında hiçbir şey eklenmez.
  let navLostAt = 0;
  function ensureEntry() {
    const nav = findNav();
    if (!nav) {
      // Oyun menüsü yok (giriş / yükleme ekranı ya da oturum kapandı): açık panel de kapansın.
      // Menü yeniden çizilirken bir anlığına kaybolabilir; 1,5 sn yoksa kapat.
      if (panelOpen) {
        navLostAt ||= Date.now();
        if (Date.now() - navLostAt > 1500) setOpen(false); else scheduleEnsure();
      }
      return;
    }
    navLostAt = 0;
    let tab = document.getElementById(TAB_ID);
    const sample = nav.querySelector(`.ut-tab-bar-item:not(#${TAB_ID}):not(#fcg-tab):not([id^="fc27-"])`);
    const host = sample ? sample.parentElement : nav;
    if (tab && tab.parentElement !== host) { tab.remove(); tab = null; }
    if (!tab) tab = buildTabItem(sample);
    // Her zaman menünün en altında (Kangal Snip'in sekmesinin de altında)
    if (host.lastElementChild !== tab) host.append(tab);
    syncActive();
  }

  function syncActive() {
    document.getElementById(TAB_ID)?.classList.toggle('fcg-active', panelOpen);
  }

  function position() {
    const p = document.getElementById(PANEL_ID);
    if (!p) return;
    let left = 0, top = 0, bottom = 0;
    const nav = findNav();
    const tab = document.getElementById(TAB_ID);
    if (nav && tab && nav.contains(tab)) {
      const r = nav.getBoundingClientRect();
      if (r.height >= r.width) left = Math.round(r.right);                  // dikey sol menü
      else if (r.top < window.innerHeight / 2) top = Math.round(r.bottom);  // üstte yatay menü
      else bottom = Math.round(window.innerHeight - r.top);                 // altta yatay menü
    }
    p.style.setProperty('--fcg-left', `${left}px`);
    p.style.setProperty('--fcg-top', `${top}px`);
    p.style.setProperty('--fcg-bottom', `${bottom}px`);
  }

  function setOpen(open) {
    panelOpen = open;
    const p = document.getElementById(PANEL_ID) || buildPanel();
    if (open) { renderNow(); position(); metaOrNull(); refreshCatalog(); }
    p.hidden = !open;
    syncActive();
  }

  // Menü tıklamaları (capture: EA'nın kendi yönlendirmesinden önce yakala)
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(`#${TAB_ID}`)) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!panelOpen);
      return;
    }
    if (t.closest(`#${PANEL_ID}`)) return;
    // Başka bir menü sekmesine (EA'nın ya da Kangal Snip'in) geçilirse paneli kapat
    if (panelOpen && t.closest('.ut-tab-bar-item, .ut-tab-bar button, nav[class*="tab-bar"] button')) setOpen(false);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen) return;
    if (gal.view !== 'list' && gal.modal) { gal.modal = null; render(); return; }
    if (gal.view !== 'list' && gal.openId) { gal.openId = null; render(); return; }
    setOpen(false);
  });
  window.addEventListener('resize', () => { if (panelOpen) position(); });

  // Çalışırken sekme kapatılırsa uyar (döngü sekmeye bağlı)
  window.addEventListener('beforeunload', (e) => {
    if (!run.running) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // EA Web App menüyü yeniden çizdiği için sekmeyi sürekli doğrula
  let scheduled = false;
  function scheduleEnsure() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensureEntry(); if (panelOpen) position(); }, 300);
  }

  function init() {
    loadAllDefs();
    ensureEntry();
    new MutationObserver(scheduleEnsure).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
