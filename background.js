import { api, ApiError, parseCoins } from './lib/ea-api.js';
import { searchPlayers, fetchMeta } from './lib/players.js';
import { imgUrls } from './lib/img.js';
import { prevPrice } from './lib/pricing.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const PROBE_MAX = 5;   // en ucuzu bulmak için en fazla arama sayısı
const RETRY_MAX = 3;   // ilan başkası tarafından alınırsa yeniden deneme
const DEFAULT_RUN = { running: false, spent: 0, coins: null, text: 'Hazır', level: 'idle', ts: 0 };

let token = 0;

// ---------------------------------------------------------------- sabit veri (görsel + isim sözlükleri)
const META_TTL = 7 * 24 * 60 * 60 * 1000;

const META_V = 2;

async function meta() {
  const { galleryMeta } = await chrome.storage.local.get('galleryMeta');
  const fresh = galleryMeta?.imgBase && galleryMeta.v === META_V && Date.now() - (galleryMeta.at || 0) < META_TTL;
  // Sözlükler boş kaldıysa önbelleğe güvenme, yeniden dene.
  if (fresh && Object.keys(galleryMeta.teams || {}).length) return galleryMeta;
  const m = await fetchMeta();
  const saved = {
    v: META_V, imgBase: m.imgBase, at: Date.now(),
    teams: m.teams || {}, leagues: m.leagues || {}, nations: m.nations || {},
    counts: m.counts || null, warn: m.warn || null, keys: m.keys || null, sample: m.sample || null,
  };
  await chrome.storage.local.set({ galleryMeta: saved });
  return saved;
}
const metaOrNull = () => meta().catch(() => null);

// Pazar/kulüp item verisinden kulüp, lig, ülke, mevki ve görselleri çıkarır.
function enrich(itemData, m) {
  if (!itemData) return {};
  const img = imgUrls(m?.imgBase);
  const team = Number(itemData.teamid ?? itemData.teamId ?? 0) || null;
  const league = Number(itemData.leagueId ?? itemData.leagueid ?? 0) || null;
  const nation = Number(itemData.nation ?? itemData.nationId ?? 0) || null;
  const name = (map, id) => (id ? (m?.[map]?.[String(id)] || '#' + id) : null);
  return {
    position: itemData.preferredPosition || null,
    teamId: team, leagueId: league, nationId: nation,
    club: name('teams', team),
    league: name('leagues', league),
    nation: name('nations', nation),
    crest: img.crest(team), crestAlt: img.crestAlt(team),
    leagueImg: img.league(league), flag: img.flag(nation),
  };
}

// ---------------------------------------------------------------- depolama
async function load() {
  const r = await chrome.storage.local.get(['galleryList', 'gallerySettings', 'galleryRun']);
  return {
    list: r.galleryList || [],
    settings: { budget: 0, skipOwned: false, ...(r.gallerySettings || {}) },
    run: { ...DEFAULT_RUN, ...(r.galleryRun || {}) },
  };
}
const saveList = (galleryList) => chrome.storage.local.set({ galleryList });
async function patchRun(p) {
  const { run } = await load();
  await chrome.storage.local.set({ galleryRun: { ...run, ...p, ts: Date.now() } });
}
async function patchItem(id, p) {
  const { list } = await load();
  const it = list.find((x) => x.id === id);
  if (!it) return;
  Object.assign(it, p);
  await saveList(list);
}
const status = (text, level = 'ok') => patchRun({ text, level });

async function ownedIds() {
  const { clubBaseIds } = await chrome.storage.local.get('clubBaseIds');
  return new Set(clubBaseIds || []);
}

function notify(title, message) {
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 }); } catch (_) {}
}

// ---------------------------------------------------------------- liste işlemleri
async function addPlayers(players) {
  const { list } = await load();
  const img = imgUrls((await metaOrNull())?.imgBase);
  let added = 0;
  for (const p of players) {
    if (!p?.baseId || list.some((x) => x.baseId === p.baseId)) continue;
    list.push({
      id: uid(), baseId: p.baseId, name: p.name, rating: p.rating || null,
      portrait: img.portrait(p.baseId), status: 'pending', price: null, note: '',
    });
    added++;
  }
  await saveList(list);
  return added;
}

// Her satır bir isim → en iyi eşleşme eklenir; bulunamayanlar geri döner.
async function bulkAdd(names) {
  const found = [];
  const missing = [];
  for (const n of names.map((s) => s.trim()).filter(Boolean)) {
    const [best] = await searchPlayers(n, 1);
    if (best) found.push(best); else missing.push(n);
  }
  const added = await addPlayers(found);
  return { added, missing };
}

// ---------------------------------------------------------------- alım
const activeBins = (res) => (res?.auctionInfo || [])
  .filter((a) => a.buyNowPrice > 0 && a.tradeId && (!a.tradeState || a.tradeState === 'active'));

// Tüm versiyonlar arasında en düşük BIN'li ilanı bulur (maxb'yi kademe kademe düşürerek).
async function findCheapest(baseId) {
  let best = null;
  let hi = 0;
  for (let i = 0; i < PROBE_MAX; i++) {
    const res = await api.search({ maskedDefId: baseId, num: 21, ...(hi > 0 ? { maxb: hi } : {}) });
    const list = activeBins(res);
    if (!list.length) break;
    const cand = list.reduce((m, a) => (a.buyNowPrice < m.buyNowPrice ? a : m));
    if (!best || cand.buyNowPrice < best.buyNowPrice) best = cand;
    if (best.buyNowPrice <= 200) break;
    hi = prevPrice(best.buyNowPrice);
    await sleep(rnd(400, 900));
  }
  return best;
}

// true dönerse döngü devam eder, false dönerse durdurulmuştur.
async function buyOne(item, my) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    if (my !== token) return false;
    await status(`Aranıyor: ${item.name}${attempt > 1 ? ` (deneme ${attempt})` : ''}`);
    const a = await findCheapest(item.baseId);
    if (!a) { await patchItem(item.id, { status: 'notfound', note: 'Pazarda ilan yok' }); return true; }

    const price = a.buyNowPrice;
    await patchItem(item.id, { market: price, marketAt: Date.now(), ...enrich(a.itemData, await metaOrNull()) });
    const { settings, run } = await load();
    if (settings.budget > 0 && run.spent + price > settings.budget) {
      await patchItem(item.id, { status: 'budget', note: `En ucuz ${fmt(price)} — bütçe yetmedi` });
      return true;
    }
    if (run.coins != null && price > run.coins) {
      await patchItem(item.id, { status: 'budget', note: `En ucuz ${fmt(price)} — coin yetersiz` });
      return true;
    }

    await sleep(rnd(300, 800));
    if (my !== token) return false;
    try {
      const r = await api.buyNow(a.tradeId, price);
      const it = r?.auctionInfo?.[0]?.itemData || a.itemData || {};
      const cur = await load();
      await patchRun({ spent: cur.run.spent + price, coins: parseCoins(r) ?? (cur.run.coins != null ? cur.run.coins - price : null) });
      await patchItem(item.id, { status: 'done', price, ...enrich(it, await metaOrNull()), note: it.rating ? `${it.rating} rating` : '' });
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 460 || e.status === 461)) { await sleep(rnd(600, 1200)); continue; }
      throw e;
    }
  }
  await patchItem(item.id, { status: 'error', note: 'İlanlar hep başkası tarafından alındı' });
  return true;
}

// Ciddi hatalarda tüm döngüyü durdurur; diğerlerinde yalnız o oyuncu "hata" olur.
function stopReason(e) {
  const s = e?.status;
  const body = typeof e?.body === 'string' ? e.body : JSON.stringify(e?.body || '');
  let stopWhy = null;
  if (s === 471) stopWhy = 'Hesapta işlem yasağı/yetki reddi (471)';
  else if (s === 494) stopWhy = 'Transfer pazarı kilitli (494)';
  else if (s === 429) stopWhy = 'Rate limit (429)';
  else if (s === 458 || s === 459 || /captcha/i.test(body)) stopWhy = `Captcha algılandı (${s ?? '?'}) — Web App'te çözün`;
  else if (s === 426 || s === 512 || /softban/i.test(body)) stopWhy = `Softban/servis hatası (${s})`;
  else if (s === 401 || s === 403) stopWhy = 'Oturum geçersiz — Web App sekmesini yenileyin';
  return stopWhy;
}

async function handleError(e, item) {
  const s = e?.status;
  const stopWhy = stopReason(e);
  if (stopWhy) {
    notify('Gallery Grab durdu', stopWhy);
    await stop(stopWhy, 'error');
    return false;
  }
  await patchItem(item.id, { status: 'error', note: s === 478 ? 'Liste dolu (478)' : `${e?.message || 'Hata'}` });
  return true;
}

async function runLoop(my) {
  let bought = 0;
  let netErr = 0;
  const owned = await ownedIds();
  while (my === token) {
    const { list, settings } = await load();
    const item = list.find((x) => x.status === 'pending');
    if (!item) break;

    if (settings.skipOwned && owned.has(item.baseId)) {
      await patchItem(item.id, { status: 'owned', note: 'Kulübünde zaten var' });
      continue;
    }

    try {
      const ok = await buyOne(item, my);
      if (!ok) return;
      netErr = 0;
      const { list: after } = await load();
      if (after.find((x) => x.id === item.id)?.status === 'done') bought++;
    } catch (e) {
      if (e?.status === 0 && ++netErr >= 3) {
        notify('Gallery Grab durdu', 'Art arda bağlantı hatası');
        return stop('Art arda bağlantı hatası (Web App sekmesi açık mı?)', 'error');
      }
      if (!(await handleError(e, item))) return;
    }
    await sleep(rnd(1000, 2500));
  }
  if (my !== token) return;

  const { run, list } = await load();
  const skipped = list.filter((x) => ['notfound', 'budget', 'error', 'owned'].includes(x.status)).length;
  const msg = `${bought} kart alındı, ${skipped} atlandı. Toplam harcama: ${fmt(run.spent)} coin`;
  notify('Gallery Grab bitti', msg);
  await stop(`Bitti — ${msg}`, 'ok');
}

// ---------------------------------------------------------------- taramalar
// Alım yapmadan her oyuncunun en ucuz BIN'ini ve kulüp/lig/ülke bilgisini doldurur.
async function scanPrices(my) {
  const m = await metaOrNull();
  let n = 0;
  const seen = new Set();   // bu taramada işlenenler — aynı oyuncuya geri dönülmesin
  while (my === token) {
    const { list } = await load();
    // 30 dakikadan eski fiyatlar tazelenir
    const stale = (x) => x.marketAt == null
      || Date.now() - x.marketAt > 30 * 60 * 1000
      || String(x.club || '').startsWith('#');   // isim sözlüğü sonradan yüklendiyse tazele
    const item = list.find((x) => x.status !== 'done' && stale(x) && !seen.has(x.id));
    if (!item) break;
    await status('Fiyat taranıyor: ' + item.name);
    try {
      const a = await findCheapest(item.baseId);
      await patchItem(item.id, {
        market: a ? a.buyNowPrice : 0,
        marketAt: Date.now(),
        ...enrich(a?.itemData, m),
      });
      seen.add(item.id);
      n++;
    } catch (err) {
      const why = stopReason(err);
      if (why) { notify('Gallery Grab durdu', why); return stop(why, 'error'); }
      seen.add(item.id);
      await patchItem(item.id, { marketAt: Date.now(), note: 'Fiyat alınamadı: ' + (err?.message || 'hata') });
    }
    await sleep(rnd(900, 2000));
  }
  if (my === token) await stop('Fiyat taraması bitti (' + n + ' oyuncu)', 'ok');
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
      for (const it of items) {
        const a = Number(it.assetId ?? it.assetid ?? it.definitionId ?? 0);
        if (a) owned.add(a);
      }
      fetched += items.length;
      start += items.length || COUNT;
      await status('Kulüp taranıyor: ' + owned.size + ' oyuncu' + (total ? ' / ' + total + ' kart' : ''));

      // Sayfalama: yanıt boş dönene kadar devam. (Sunucu 'count' kadar dolu sayfa
      // döndürmeyebiliyor, o yüzden kısa sayfa tek başına bitiş sayılmaz.)
      if (!items.length) break;
      if (total != null && fetched >= total) break;
      // Sunucu 'start' parametresini yok sayıyorsa aynı sayfa döner: sonsuz döngüyü engelle.
      const firstId = Number(items[0]?.id ?? items[0]?.assetId ?? 0);
      if (firstId && firstId === lastFirstId) break;
      lastFirstId = firstId;
      await sleep(rnd(600, 1300));
    }
  } catch (err) {
    const why = stopReason(err);
    notify('Gallery Grab durdu', why || 'Kulüp taraması başarısız');
    return stop((why || 'Kulüp taraması başarısız') + ' (' + (err?.status ?? '') + ' ' + (err?.message || '') + ')', 'error');
  }
  if (my !== token) return;
  await chrome.storage.local.set({ clubBaseIds: [...owned], clubScanAt: Date.now(), clubTotal: total, clubFetched: fetched });
  await stop('Kulüpte ' + owned.size + ' farklı oyuncu (' + fetched + ' kart okundu' + (total ? ' / ' + total : '') + ')', 'ok');
}

async function startTask(fn, label) {
  const { session } = await chrome.storage.local.get('session');
  if (!session?.sid) { await status("Oturum yok: EA Web App'i açıp giriş yapın", 'error'); return { ok: false }; }
  const my = ++token;
  await patchRun({ running: true, text: label, level: 'ok' });
  fn(my);
  return { ok: true };
}

async function start() {
  const { session } = await chrome.storage.local.get('session');
  if (!session?.sid) { await status('Oturum yok: EA Web App\'i açıp giriş yapın', 'error'); return { ok: false }; }
  const { list } = await load();
  if (!list.some((x) => x.status === 'pending')) { await status('Bekleyen oyuncu yok', 'warn'); return { ok: false }; }

  let coins = null;
  try { coins = parseCoins(await api.credits()); } catch (e) { await status(`Başlatılamadı: ${e.message}`, 'error'); return { ok: false }; }

  const my = ++token;
  await patchRun({ running: true, coins, text: 'Başladı', level: 'ok' });
  runLoop(my);
  return { ok: true };
}

async function stop(text = 'Durduruldu', level = 'idle') {
  token++;
  await patchRun({ running: false, text, level });
}

// ---------------------------------------------------------------- mesajlar
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    switch (msg?.type) {
      case 'search': {
        const players = await searchPlayers(msg.term, 20);
        const img = imgUrls((await metaOrNull())?.imgBase);
        return { ok: true, players: players.map((p) => ({ ...p, portrait: img.portrait(p.baseId) })) };
      }
      case 'add': return { ok: true, added: await addPlayers([msg.player]) };
      case 'bulkAdd': return { ok: true, ...(await bulkAdd(msg.names || [])) };
      case 'remove': { const { list } = await load(); await saveList(list.filter((x) => x.id !== msg.id)); return { ok: true }; }
      case 'clear': await saveList([]); return { ok: true };
      case 'retry': { // atlanan/hatalı olanları yeniden beklemeye al
        const { list } = await load();
        list.forEach((x) => { if (x.status !== 'done') { x.status = 'pending'; x.note = ''; } });
        await saveList(list);
        return { ok: true };
      }
      case 'resetSpent': await patchRun({ spent: 0 }); return { ok: true };
      case 'setBudget': {
        const { settings } = await load();
        await chrome.storage.local.set({ gallerySettings: { ...settings, budget: Math.max(0, Math.floor(msg.budget || 0)) } });
        return { ok: true };
      }
      case 'setSkipOwned': {
        const { settings } = await load();
        await chrome.storage.local.set({ gallerySettings: { ...settings, skipOwned: !!msg.value } });
        return { ok: true };
      }
      case 'refreshCoins': { const coins = parseCoins(await api.credits()); await patchRun({ coins }); return { ok: true, coins }; }
      case 'scanPrices': return startTask(scanPrices, 'Fiyat taraması başladı');
      case 'scanClub': return startTask(scanClub, 'Kulüp taraması başladı');
      case 'start': return start();
      case 'stop': await stop(); return { ok: true };
      case 'openPanelTab': await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); return { ok: true };
      default: return { ok: false };
    }
  })().then(reply).catch((e) => reply({ ok: false, error: e.message }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') port.onMessage.addListener(() => {});
});

// Service worker yeniden başlarsa yarım kalan çalışmayı "durdu" olarak işaretle
(async () => {
  const { run } = await load();
  if (run.running) await patchRun({ running: false, text: 'Eklenti yeniden başladı — tekrar Başlat\'a basın', level: 'warn' });
})();
