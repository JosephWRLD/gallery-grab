// ==UserScript==
// @name         Gallery Grab
// @namespace    https://github.com/JosephWRLD/gallery-grab
// @version      2.0.1
// @description  FC Web App: listedeki her oyuncudan en ucuz 1 kart alır (Galeri/koleksiyon doldurmak için)
// @author       JosephWRLD — Discord: yusuflnx
// @match        https://www.ea.com/*/ultimate-team/web-app/*
// @match        https://www.easports.com/*/ultimate-team/web-app/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_notification
// @updateURL    https://example.com/gallery-grab.user.js
// @downloadURL  https://example.com/gallery-grab.user.js
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
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('tr-TR'));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const PROBE_MAX = 5;   // en ucuzu bulmak için en fazla arama
  const RETRY_MAX = 3;   // ilan başkası tarafından alınırsa yeniden deneme
  const META_TTL = 7 * 24 * 60 * 60 * 1000;
  const META_V = 2;
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
  const settings = { budget: 0, skipOwned: false, expectClub: null, ...store.get('settings', {}) };
  const club = { ids: new Set(store.get('clubBaseIds', [])), at: store.get('clubScanAt', 0), fetched: store.get('clubFetched', 0), total: store.get('clubTotal', null) };
  const run = { running: false, spent: store.get('spent', 0), coins: null, text: 'Hazır', level: 'idle' };

  const saveList = () => { store.set('list', list); render(); };
  const saveSettings = () => { store.set('settings', settings); render(); };
  const setSpent = (v) => { run.spent = v; store.set('spent', v); render(); };
  const status = (text, level = 'ok') => { run.text = text; run.level = level; render(); };
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
        }
        return xSend.apply(this, a);
      };
    } catch (e) { console.warn('[Gallery Grab] XHR yakalama kurulamadı', e); }

    // Yedek: Web App'in kendi oturum nesnesi + ağ kayıtları
    setInterval(() => {
      try {
        const id = W.services?.Authentication?.sessionUtas?.id;
        if (id && id !== session.sid) session.sid = id;
        if (!session.baseUrl) {
          for (const e of performance.getEntriesByType('resource')) { const b = baseFrom(e.name); if (b) session.baseUrl = b; }
        }
      } catch (_) {}
    }, 4000);
  })();

  function sidNow() {
    if (session.sid) return session.sid;
    try { return (session.sid = W.services?.Authentication?.sessionUtas?.id || null); } catch (_) { return null; }
  }

  // ---------------------------------------------------------------- EA API
  class ApiError extends Error {
    constructor(status, body, msg) { super(msg || `HTTP ${status}`); this.status = status; this.body = body; }
  }

  const DEFAULT_BASE = 'https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27';

  function resolveBase() {
    if (session.baseUrl) return session.baseUrl;
    try {
      const l = performance.getEntriesByType('resource');
      for (let i = l.length - 1; i >= 0; i--) { const b = baseFrom(l[i].name); if (b) return (session.baseUrl = b); }
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

    if (res.status === 401 && !retried) {
      const fresh = W.services?.Authentication?.sessionUtas?.id;
      if (fresh && fresh !== sid) { session.sid = fresh; return call(method, path, opts, true); }
    }
    if (res.status === 401) throw new ApiError(401, json, 'Oturum geçersiz (401): sayfayı yenileyip giriş yapın, sonra Transfer Pazarı\'nda bir arama yapın');
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, json);
    return json;
  }

  const api = {
    search: ({ maskedDefId, maxb, num = 21, start = 0 }) => {
      const q = { num, start, type: 'player', maskedDefId };
      if (maxb) q.maxb = maxb;
      return call('GET', '/transfermarket', { query: q });
    },
    buyNow: (tradeId, price) => call('PUT', `/trade/${tradeId}/bid`, { body: { bid: price } }),
    club: ({ start = 0, count = 91, sort = 'desc', sortBy = 'value' } = {}) =>
      call('GET', '/club', { query: { start, count, sort, sortBy, type: 'player' } }),
    credits: () => call('GET', '/user/credits'),
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
    const url = res.find((n) => n.includes('items/web/players.json'));
    if (!url) throw new Error('Görsel/isim verisi okunamadı: Transfer Pazarı → Oyuncu Ara ekranını bir kez açın.');
    const imgBase = url.split('/items/web/players.json')[0] + '/items/images/mobile';

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

    const meta = { imgBase, teams: {}, leagues: {}, nations: {} };
    const teams = {}, leagues = {}, nations = {};
    try {
      for (const lu of locUrls.slice(0, 4)) {
        let j;
        try { j = await (await W.fetch(lu, { credentials: 'omit' })).json(); } catch (_) { continue; }
        for (const [key, val] of flatten(j, '', [], 0)) {
          const m = key.match(/([0-9]+)$/);
          if (!m) continue;
          const id = m[1];
          if (/team|club/i.test(key)) put(teams, id, key, val);
          else if (/league/i.test(key)) put(leagues, id, key, val);
          else if (/nation|country/i.test(key)) put(nations, id, key, val);
        }
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
      status(`Aranıyor: ${it.name}${attempt > 1 ? ` (deneme ${attempt})` : ''}`);
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
    if (s === 401 || s === 403) return 'Oturum geçersiz — sayfayı yenileyin';
    return null;
  }

  function handleError(e, it) {
    const why = stopReason(e);
    if (why) { fail(why); stop(why, 'error'); return false; }
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
          return stop('Art arda bağlantı hatası', 'error');
        }
        if (!handleError(e, it)) return;
      }
      await sleep(rnd(1000, 2500));
    }
    if (my !== token) return;
    const skipped = list.filter((x) => ['notfound', 'budget', 'error', 'owned'].includes(x.status)).length;
    const msg = `${bought} kart alındı, ${skipped} atlandı. Toplam harcama: ${fmt(run.spent)} coin`;
    notify('Gallery Grab bitti', msg);
    stop(`Bitti — ${msg}`, 'ok');
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
      status('Fiyat taranıyor: ' + it.name);
      try {
        const a = await findCheapest(it.baseId);
        patchItem(it.id, { market: a ? a.buyNowPrice : 0, marketAt: Date.now(), ...enrich(a?.itemData, m) });
        seen.add(it.id);
        n++;
      } catch (err) {
        const why = stopReason(err);
        if (why) { fail(why); return stop(why, 'error'); }
        seen.add(it.id);
        patchItem(it.id, { marketAt: Date.now(), note: 'Fiyat alınamadı: ' + (err?.message || 'hata') });
      }
      await sleep(rnd(900, 2000));
    }
    if (my === token) stop('Fiyat taraması bitti (' + n + ' oyuncu)', 'ok');
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
        status('Kulüp taranıyor: ' + owned.size + ' oyuncu' + (total ? ' / ' + total + ' kart' : ''));
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
      return stop(`${why} (${err?.status ?? ''} ${err?.message || ''})`, 'error');
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
    stop(`Kulüpte ${owned.size} farklı oyuncu (${fetched} kart okundu${total ? ' / ' + total : ''})`, 'ok');
  }

  function startTask(fn, label) {
    if (!sidNow()) { status('Oturum yok: Web App\'e giriş yapın', 'error'); return; }
    const my = ++token;
    run.running = true;
    status(label, 'ok');
    fn(my);
  }

  async function start() {
    if (!sidNow()) { status('Oturum yok: Web App\'e giriş yapın', 'error'); return; }
    if (!list.some((x) => x.status === 'pending')) { status('Bekleyen oyuncu yok', 'warn'); return; }
    try { run.coins = parseCoins(await api.credits()); } catch (e) { status(`Başlatılamadı: ${e.message}`, 'error'); return; }
    const my = ++token;
    run.running = true;
    status('Başladı', 'ok');
    runLoop(my);
  }

  function stop(text = 'Durduruldu', level = 'idle') {
    token++;
    run.running = false;
    status(text, level);
  }

  // ---------------------------------------------------------------- beklenen kulüp (v1.3 uyarısı)
  function clubCounts() {
    const m = new Map();
    for (const x of list) {
      if (!x.teamId) continue;
      const k = String(x.teamId);
      const e = m.get(k) || { teamId: x.teamId, club: x.club || '#' + x.teamId, n: 0 };
      e.n++;
      if (x.club && !String(x.club).startsWith('#')) e.club = x.club;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || String(a.club).localeCompare(b.club, 'tr'));
  }

  // Sabitlenmiş kulüp varsa o; yoksa çoğunluk. Beraberlikte ya da tek kulüpte uyarı verilmez.
  function expectedClub(counts, pinned) {
    if (pinned && counts.some((c) => c.teamId === pinned)) return { teamId: pinned, auto: false };
    if (counts.length < 2) return { teamId: null, auto: true, stale: !!pinned };
    if (counts[0].n === counts[1].n) return { teamId: null, auto: true, tie: true, stale: !!pinned };
    return { teamId: counts[0].teamId, auto: true, stale: !!pinned };
  }

  // ---------------------------------------------------------------- stil
  const CSS = `
#fcg-panel { position:fixed; left:var(--fcg-left,0); top:var(--fcg-top,0); right:0; bottom:var(--fcg-bottom,0);
  z-index:2147483000; display:flex; flex-direction:column; background:#0f1115; color:#e7e9ee;
  font:13px/1.4 "Segoe UI", system-ui, sans-serif; border-left:1px solid #2a2f3a; --err:#ef5a5a; }
#fcg-panel[hidden] { display:none !important; }
#fcg-panel * { box-sizing:border-box; }
#fcg-panel .fcg-bar { display:flex; align-items:center; gap:8px; height:40px; padding:0 12px; background:#181b22; border-bottom:1px solid #2a2f3a; flex:none; }
#fcg-panel .fcg-title { display:flex; align-items:center; gap:6px; font-size:14px; letter-spacing:1px; }
#fcg-panel .fcg-title b { color:#2fd08a; }
#fcg-panel .fcg-spacer { flex:1; }
#fcg-panel .fcg-body { flex:1; min-height:0; overflow:auto; }
#fcg-panel .fcg-in { max-width:760px; margin:0 auto; padding:4px 12px 16px; }
#fcg-panel section { padding:10px 0; border-bottom:1px solid #2a2f3a; }
#fcg-panel input, #fcg-panel textarea, #fcg-panel select { width:100%; background:#181b22; color:#e7e9ee; border:1px solid #2a2f3a;
  border-radius:6px; padding:6px 8px; font:inherit; }
#fcg-panel select { width:auto; max-width:200px; padding:3px 6px; }
#fcg-panel textarea { height:64px; resize:vertical; }
#fcg-panel button { background:#1f232c; color:#e7e9ee; border:1px solid #2a2f3a; border-radius:6px; padding:6px 10px;
  font:inherit; cursor:pointer; width:auto; text-transform:none; letter-spacing:normal; }
#fcg-panel button:hover { border-color:#8b93a3; }
#fcg-panel button.pri { background:#2fd08a; color:#06140d; border-color:#2fd08a; font-weight:600; }
#fcg-panel button.dan { background:var(--err); color:#fff; border-color:var(--err); font-weight:600; }
#fcg-panel .row { display:flex; gap:6px; align-items:center; }
#fcg-panel .row > input { flex:1; }
#fcg-panel .mut { color:#8b93a3; font-size:12px; }
#fcg-panel .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:8px; }
#fcg-panel .stats div { background:#181b22; border-radius:6px; padding:6px; text-align:center; }
#fcg-panel .stats b { display:block; font-size:14px; }
#fcg-panel .st { margin-top:6px; font-size:12px; }
#fcg-panel .st.error { color:var(--err); } #fcg-panel .st.warn { color:#f0b43c; } #fcg-panel .st.ok { color:#2fd08a; }
#fcg-panel .res { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:4px; cursor:pointer; }
#fcg-panel .res:hover { background:#181b22; }
#fcg-panel .res small { display:block; color:#8b93a3; font-size:11px; }
#fcg-panel .results { max-height:260px; overflow:auto; margin-top:6px; }
#fcg-panel .face { width:28px; height:28px; border-radius:4px; object-fit:cover; flex:none; background:#181b22; }
#fcg-panel .ic { width:14px; height:14px; object-fit:contain; }
#fcg-panel .meta { display:flex; align-items:center; gap:4px; color:#8b93a3; font-size:11px; margin-top:1px; }
#fcg-panel .price { color:#f0b43c; font-size:11px; margin-left:6px; }
#fcg-panel .opt { display:flex; align-items:center; gap:6px; color:#8b93a3; font-size:12px; margin-top:8px; }
#fcg-panel .opt input[type=checkbox] { width:auto; }
#fcg-panel .it { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #2a2f3a; }
#fcg-panel .it .n { flex:1; min-width:0; }
#fcg-panel .it .n small { display:block; color:#8b93a3; }
#fcg-panel .it .x { padding:2px 7px; }
#fcg-panel .tag { font-size:11px; padding:2px 6px; border-radius:10px; background:#181b22; white-space:nowrap; }
#fcg-panel .tag.done { color:#2fd08a; } #fcg-panel .tag.budget, #fcg-panel .tag.notfound { color:#f0b43c; }
#fcg-panel .tag.error { color:var(--err); } #fcg-panel .tag.owned { color:#2fd08a; margin-left:6px; }
/* Beklenen kulüpten farklı oyuncu: yanlış kart eklenmiş olabilir */
#fcg-panel .it.bad { background:rgba(239,90,90,.10); border-left:2px solid var(--err); padding-left:4px; }
#fcg-panel .it.bad > .n > span:first-child { color:var(--err); }
#fcg-panel .it.bad .meta { color:var(--err); }
#fcg-panel .tag.mismatch { color:var(--err); margin-left:6px; }
#fcg-panel .warnline { color:var(--err); font-size:12px; margin-top:6px; }
#fcg-panel .missing { color:var(--err); font-size:12px; margin-top:4px; }
#fcg-panel .fcg-foot { display:flex; align-items:center; gap:8px; padding:10px 0 0; color:#8b93a3; font-size:12px; border-bottom:0; }
#fcg-panel .fcg-foot b { color:#2fd08a; font-family:ui-monospace, Consolas, monospace; }
/* ---------- Sol menü sekmesi + yüzen buton ---------- */
.fcg-tab { display:flex !important; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; position:relative; }
.fcg-tab::before, .fcg-tab::after { content:none !important; }
.fcg-icon { width:34px; height:34px; padding:3px; box-sizing:border-box; color:#2fd08a; flex:none; pointer-events:none; }
.fcg-lbl { font:600 10px/1.1 "Segoe UI", Arial, sans-serif; color:inherit; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
.fcg-tab:hover .fcg-icon { filter:brightness(1.2); }
.fcg-tab.fcg-active { background:rgba(47,208,138,.16) !important; box-shadow:inset 3px 0 0 #2fd08a; }
.fcg-tab.fcg-active .fcg-lbl { color:#2fd08a; }
.fcg-dock { position:fixed; left:6px; top:calc(45% + 50px); z-index:2147483001; width:42px; height:42px; padding:0;
  border:1px solid #2a2f3a; border-radius:10px; background:#181b22; display:flex; align-items:center; justify-content:center;
  cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.45); }
.fcg-dock.fcg-active { border-color:#2fd08a; }
@media (max-width:600px) { #fcg-panel { left:0; } }
`;
  try { GM_addStyle(CSS); } catch (_) { document.documentElement.append(h('style', { textContent: CSS })); }

  // ---------------------------------------------------------------- panel arayüzü
  const TAB_ID = 'fcg-tab';
  const DOCK_ID = 'fcg-dock';
  const PANEL_ID = 'fcg-panel';
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

    const bar = el({ class: 'fcg-bar' }, [
      h('span', { class: 'fcg-title' }, [galleryIcon(), h('b', { text: 'GALLERY GRAB' })]),
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

    const panel = h('div', { id: PANEL_ID, class: 'fcg-panel', hidden: true }, [bar, body]);
    document.body.append(panel);

    ui = { panel, coins, spent, left, budget, toggle, st, q, results, bulk, bulkBtn, missing, warnline, rows, estimate, scanPricesBtn, scanClubBtn, clubInfo, metaInfo, expectClub, expectHint, skipOwned, count };

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
    expectClub.addEventListener('change', () => { settings.expectClub = Number(expectClub.value) || null; saveSettings(); });
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
    const bits = [x.position, x.club, x.league, x.nation].filter(Boolean).join(' · ');
    const crest = img.crest(x.teamId);
    const flag = img.flag(x.nationId);
    if (!bits && !crest && !flag) return null;
    return h('div', { class: 'meta' }, [icon(crest, 'ic', img.crestAlt(x.teamId)), icon(flag, 'ic'), bits ? h('span', { text: bits }) : null]);
  }

  function render() {
    if (!ui) return;
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
    const autoName = exp.auto && exp.teamId ? counts.find((c) => c.teamId === exp.teamId)?.club : null;
    ui.expectClub.replaceChildren(
      h('option', { value: '', text: autoName ? `Otomatik (${autoName})` : 'Otomatik (çoğunluk)' }),
      ...counts.map((c) => h('option', { value: String(c.teamId), text: `${c.club} (${c.n})` })),
    );
    ui.expectClub.value = exp.auto ? '' : String(exp.teamId);
    ui.expectClub.disabled = !counts.length;
    ui.expectHint.textContent = !known ? 'Kulüp bilgisi için "Fiyatları tara"'
      : exp.tie ? 'çoğunluk yok — kulüp seçin'
      : exp.stale && exp.auto ? 'seçilen kulüp listede yok' : '';

    const bad = (x) => !!exp.teamId && !!x.teamId && x.teamId !== exp.teamId;
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

  function ensureEntry() {
    const nav = findNav();
    let tab = document.getElementById(TAB_ID);
    if (nav) {
      document.getElementById(DOCK_ID)?.remove();
      const sample = nav.querySelector(`.ut-tab-bar-item:not(#${TAB_ID}):not([id^="fc27-"])`);
      const host = sample ? sample.parentElement : nav;
      if (tab && tab.parentElement !== host) { tab.remove(); tab = null; }
      if (!tab) tab = buildTabItem(sample);
      // Her zaman menünün en altında (Kangal Snip'in sekmesinin de altında)
      if (host.lastElementChild !== tab) host.append(tab);
    } else if (!tab && !document.getElementById(DOCK_ID) && document.body) {
      const d = h('button', { id: DOCK_ID, class: 'fcg-dock', title: 'Gallery Grab' });
      d.append(galleryIcon());
      document.body.append(d);
    }
    syncActive();
  }

  function syncActive() {
    [document.getElementById(TAB_ID), document.getElementById(DOCK_ID)].filter(Boolean)
      .forEach((e) => e.classList.toggle('fcg-active', panelOpen));
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
    } else if (document.getElementById(DOCK_ID)) left = 52;
    p.style.setProperty('--fcg-left', `${left}px`);
    p.style.setProperty('--fcg-top', `${top}px`);
    p.style.setProperty('--fcg-bottom', `${bottom}px`);
  }

  function setOpen(open) {
    panelOpen = open;
    const p = document.getElementById(PANEL_ID) || buildPanel();
    if (open) { render(); position(); metaOrNull(); }
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
    if (t.closest(`#${PANEL_ID}`)) return;
    // Başka bir menü sekmesine (EA'nın ya da Kangal Snip'in) geçilirse paneli kapat
    if (panelOpen && t.closest('.ut-tab-bar-item, .ut-tab-bar button, nav[class*="tab-bar"] button, #fc27-dock')) setOpen(false);
  }, true);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) setOpen(false); });
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
    ensureEntry();
    new MutationObserver(scheduleEnsure).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
