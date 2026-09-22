import { api, ApiError, parseCoins } from './lib/ea-api.js';
import { searchPlayers } from './lib/players.js';
import { prevPrice } from './lib/pricing.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const PROBE_MAX = 5;   // en ucuzu bulmak için en fazla arama sayısı
const RETRY_MAX = 3;   // ilan başkası tarafından alınırsa yeniden deneme
const DEFAULT_RUN = { running: false, spent: 0, coins: null, text: 'Hazır', level: 'idle', ts: 0 };

let token = 0;

// ---------------------------------------------------------------- depolama
async function load() {
  const r = await chrome.storage.local.get(['galleryList', 'gallerySettings', 'galleryRun']);
  return {
    list: r.galleryList || [],
    settings: { budget: 0, ...(r.gallerySettings || {}) },
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

function notify(title, message) {
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 }); } catch (_) {}
}

// ---------------------------------------------------------------- liste işlemleri
async function addPlayers(players) {
  const { list } = await load();
  let added = 0;
  for (const p of players) {
    if (!p?.baseId || list.some((x) => x.baseId === p.baseId)) continue;
    list.push({ id: uid(), baseId: p.baseId, name: p.name, rating: p.rating || null, status: 'pending', price: null, note: '' });
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
      await patchItem(item.id, { status: 'done', price, note: it.rating ? `${it.rating} rating` : '' });
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
async function handleError(e, item) {
  const s = e?.status;
  const body = typeof e?.body === 'string' ? e.body : JSON.stringify(e?.body || '');
  let stopWhy = null;
  if (s === 471) stopWhy = 'Hesapta işlem yasağı/yetki reddi (471)';
  else if (s === 494) stopWhy = 'Transfer pazarı kilitli (494)';
  else if (s === 429) stopWhy = 'Rate limit (429)';
  else if (s === 458 || s === 459 || /captcha/i.test(body)) stopWhy = `Captcha algılandı (${s ?? '?'}) — Web App'te çözün`;
  else if (s === 426 || s === 512 || /softban/i.test(body)) stopWhy = `Softban/servis hatası (${s})`;
  else if (s === 401 || s === 403) stopWhy = 'Oturum geçersiz — Web App sekmesini yenileyin';

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
  while (my === token) {
    const { list } = await load();
    const item = list.find((x) => x.status === 'pending');
    if (!item) break;

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
  const skipped = list.filter((x) => ['notfound', 'budget', 'error'].includes(x.status)).length;
  const msg = `${bought} kart alındı, ${skipped} atlandı. Toplam harcama: ${fmt(run.spent)} coin`;
  notify('Gallery Grab bitti', msg);
  await stop(`Bitti — ${msg}`, 'ok');
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
      case 'search': return { ok: true, players: await searchPlayers(msg.term, 20) };
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
      case 'setBudget': await chrome.storage.local.set({ gallerySettings: { budget: Math.max(0, Math.floor(msg.budget || 0)) } }); return { ok: true };
      case 'refreshCoins': { const coins = parseCoins(await api.credits()); await patchRun({ coins }); return { ok: true, coins }; }
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
