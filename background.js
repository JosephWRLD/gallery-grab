import { api, ApiError, parseCoins } from './lib/ea-api.js';
import { searchPlayers, fetchMeta } from './lib/players.js';
import { imgUrls } from './lib/img.js';
import { prevPrice } from './lib/pricing.js';
import { fetchSetDefs, diagnoseConcept, deepDiagnose } from './lib/gallery-api.js';
import { loadCatalog, refreshCatalog } from './lib/catalog.js';
import { checkUpdate } from './lib/update.js';
import { summarise, applyFloors, setRequests, floorScore, priceCandidates, cheapestFill, baseOf, syncEstimate, planFromTier, solveGrade, pickGrade, fmtDur, relistPrice, buyTargets, suspiciousPrice, MAX_CARD_DEFAULT, diagCrit, diagReport, diagOverview, diagSetList, diagScan, deepReport } from './lib/gallery.js';
import { makeT, detectLang, localeOf } from './lib/i18n.js';

// Galeri durum mesajlarının dili (Galeri ekranındaki TR/EN seçimi; yoksa tarayıcı dili)
let LANG = detectLang();
let T = makeT(LANG);
const setLangBg = (l) => { LANG = l === 'en' ? 'en' : 'tr'; T = makeT(LANG); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString(localeOf(LANG));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const PROBE_MAX = 5;   // en ucuzu bulmak için en fazla arama sayısı
const PAGE_MAX = 3;    // tam sürüm aranırken aynı fiyat aralığında bakılan en fazla sayfa
const PAGE_FULL = 20;  // num=21 istenir; 20+ ilan = sayfa dolu (EA en çok 20 döndürse de güvenli taraf)
const RETRY_MAX = 3;   // ilan başkası tarafından alınırsa yeniden deneme
const RETRY_ROUNDS = 2;   // tüm kartlar bitince başkası aldığı / ilan bulunamadığı / hata verdiği için atlananlara dönüş turu
const DEFAULT_RUN = { running: false, spent: 0, coins: null, text: '', level: 'idle', ts: 0 };
const TP_MAX = 100;    // transfer listesi kapasitesi

let token = 0;
let diagToken = 0;   // genel teşhis taraması (diagStop ile artar)

// ---------------------------------------------------------------- sabit veri (görsel + isim sözlükleri)
const META_TTL = 7 * 24 * 60 * 60 * 1000;

const META_V = 3;

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
  // 1.4.6: eski varsayılan 50.000 (değiştirilmemiş) → 0 (yok); bir kez çalışır
  if (r.gallerySettings && !r.gallerySettings.maxCardV2) {
    if (r.gallerySettings.maxCard === 50000) r.gallerySettings.maxCard = 0;
    r.gallerySettings.maxCardV2 = true;
    await chrome.storage.local.set({ gallerySettings: r.gallerySettings });
  }
  return {
    list: r.galleryList || [],
    settings: {
      budget: 0, skipOwned: false, expectClub: null,
      // galeri: ayrı bütçe (galleryBuySpent ile ölçülür), kart başına en fazla, alım sonrası, satış ayarları
      galleryBudget: 0, maxCard: MAX_CARD_DEFAULT, afterBuy: 'relist', relist: { base: 'paid', pct: 0, dur: 3600 },
      ...(r.gallerySettings || {}),
    },
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
// my verilirse: görev durdurulmuş / yenisi başlamışsa eski görevin mesajı yeni durumu ezmesin
const status = async (text, level = 'ok', my = null) => { if (my == null || my === token) await patchRun({ text, level }); };

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
// exactDef verilirse yalnız o sürüm (definitionId) sayılır — galeride her sürüm ayrı karttır.
const defOf = (a) => Number(a.itemData?.resourceId ?? a.itemData?.definitionId ?? 0);
// range {minb, maxb}: özel sürümler baz kart ilanları arasında kaybolmasın diye beklenen fiyat çevresinde ara.
// Bulunan en ucuzdan bir basamak aşağısı (maxb) ile tekrar aranır; sonuç gelmezse o fiyat en ucuzdur.
// trail verilirse: trail.lo = ilan çıkmayan son üst sınır (ör. 800 bulundu → 750'de yok);
// trail.sure = "daha ucuzu yok" kesinleşti (false: sayfalar başka sürümlerle doluydu ya da arama hakkı bitti).
// EA sonucu fiyata değil bitiş süresine göre sıralar ve maskedDefId oyuncunun tüm sürümlerini getirir. Bu yüzden özel
// sürümde (rare > 1) arama nadirliğe daraltılır (rarityIds); EA filtreyi uygulamıyorsa (başka nadirlik gelirse ya da
// 400) rarityOk=false olur ve sayfalı yönteme dönülür: sayfa başka sürümlerle doluysa aranan sürüm sonraki sayfalarda
// olabilir — boş süzülmüş sayfa "ilan yok" demek değildir. 20'den az ilanlı sayfa = aralıktaki tüm ilanlar görüldü.
let rarityOk = null;   // null: denenmedi, true: EA rarityIds'i uyguluyor, false: uygulamıyor
const rareOf = (a) => (a.itemData?.rareflag != null ? Number(a.itemData.rareflag) : null);
async function findCheapest(baseId, exactDef = null, range = null, trail = null, rare = 0) {
  const byRare = rare > 1 && exactDef && rarityOk !== false;
  let best = null;
  let hi = range?.maxb || 0;
  const lo = byRare ? 0 : range?.minb || 0;   // nadirliğe daralınca alt sınır gereksiz (fiyatı çöken kart da bulunur)
  let sure = false;
  probe: for (let i = 0; i < PROBE_MAX; i++) {
    let list = [];
    let raw = [];
    for (let pg = 0; pg < (byRare ? 1 : PAGE_MAX); pg++) {
      if (pg) await sleep(rnd(400, 900));
      let res;
      try {
        res = await api.search({ maskedDefId: baseId, num: 21, start: pg * 20, ...(hi > 0 ? { maxb: hi } : {}), ...(lo ? { minb: lo } : {}), ...(byRare ? { rare } : {}) });
      } catch (e) {
        if (byRare && e instanceof ApiError && e.status === 400) { rarityOk = false; return findCheapest(baseId, exactDef, range, trail, 0); }
        throw e;
      }
      raw = res?.auctionInfo || [];
      if (byRare && raw.some((a) => rareOf(a) != null && rareOf(a) !== rare)) { rarityOk = false; return findCheapest(baseId, exactDef, range, trail, 0); }
      if (byRare && raw.length) rarityOk = true;
      list = activeBins(res).filter((a) => !exactDef || defOf(a) === exactDef);
      if (list.length) break;
      if (raw.length < PAGE_FULL) { if (best && trail) trail.lo = hi; sure = true; break probe; }   // sayfalar bitti: yok
    }
    if (!list.length) break;   // sayfalar başka sürümlerle dolu: emin değiliz
    const cand = list.reduce((m, a) => (a.buyNowPrice < m.buyNowPrice ? a : m));
    if (!best || cand.buyNowPrice < best.buyNowPrice) best = cand;
    // Eksik sayfa: bu üst sınırın altındaki tüm ilanlar görüldü → en ucuz kesin, aşağıya tekrar arama gereksiz
    if (raw.length < PAGE_FULL) { if (trail) trail.lo = prevPrice(best.buyNowPrice); sure = true; break; }
    if (best.buyNowPrice <= 200 || (lo && best.buyNowPrice <= lo)) { sure = true; break; }
    hi = prevPrice(best.buyNowPrice);
    await sleep(rnd(400, 900));
  }
  if (trail) trail.sure = sure;
  return best;
}

// true dönerse döngü devam eder, false dönerse durdurulmuştur.
async function buyOne(item, my) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    if (my !== token) return false;
    await status(`Aranıyor: ${item.name}${attempt > 1 ? ` (deneme ${attempt})` : ''}`, 'ok', my);
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
  if (s === 471) stopWhy = T('sr.471');
  else if (s === 494) stopWhy = T('sr.494');
  else if (s === 429) stopWhy = T('sr.429');
  else if (s === 458 || s === 459 || /captcha/i.test(body)) stopWhy = T('sr.captcha', { s: s ?? '?' });
  else if (s === 426 || s === 512 || /softban/i.test(body)) stopWhy = T('sr.softban', { s });
  else if (s === 401 || s === 403) stopWhy = T('sr.session', { s });
  return stopWhy;
}

async function handleError(e, item, my) {
  const s = e?.status;
  const stopWhy = stopReason(e);
  if (stopWhy) {
    notify('Gallery Grab durdu', stopWhy);
    await stop(stopWhy, 'error', my);
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
        return stop('Art arda bağlantı hatası (Web App sekmesi açık mı?)', 'error', my);
      }
      if (!(await handleError(e, item, my))) return;
    }
    await sleep(rnd(1000, 2500));
  }
  if (my !== token) return;

  const { run, list } = await load();
  const skipped = list.filter((x) => ['notfound', 'budget', 'error', 'owned'].includes(x.status)).length;
  const msg = `${bought} kart alındı, ${skipped} atlandı. Toplam harcama: ${fmt(run.spent)} coin`;
  notify('Gallery Grab bitti', msg);
  await stop(`Bitti — ${msg}`, 'ok', my);
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
    await status('Fiyat taranıyor: ' + item.name, 'ok', my);
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
      if (why) { notify('Gallery Grab durdu', why); return stop(why, 'error', my); }
      seen.add(item.id);
      await patchItem(item.id, { marketAt: Date.now(), note: 'Fiyat alınamadı: ' + (err?.message || 'hata') });
    }
    await sleep(rnd(900, 2000));
  }
  if (my === token) await stop('Fiyat taraması bitti (' + n + ' oyuncu)', 'ok', my);
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
      await status('Kulüp taranıyor: ' + owned.size + ' oyuncu' + (total ? ' / ' + total + ' kart' : ''), 'ok', my);

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
    return stop((why || 'Kulüp taraması başarısız') + ' (' + (err?.status ?? '') + ' ' + (err?.message || '') + ')', 'error', my);
  }
  if (my !== token) return;
  await chrome.storage.local.set({ clubBaseIds: [...owned], clubScanAt: Date.now(), clubTotal: total, clubFetched: fetched });
  await stop('Kulüpte ' + owned.size + ' farklı oyuncu (' + fetched + ' kart okundu' + (total ? ' / ' + total : '') + ')', 'ok', my);
}

// ---------------------------------------------------------------- galeri setleri
// gdefs:<setId> = { at, defs }   — setin tüm kartları (isCollected + gradingScore)
// gallerySummary = { [setId]: { collected, required, score, grade, earned, reqs, at } }
// galleryPrices = { [def]: { p, at } }   — 0 = pazarda ilan yok
// gallerySyncStats = { secPerReq }        — eşitleme süre tahmini için ölçülen istek süresi
// galleryBuySpent = sayı                  — yalnız galeri alımları (liste ekranının sayacından ayrı)
const PRICE_TTL = 30 * 60 * 1000;
const defsKey = (id) => 'gdefs:' + id;
const pause = () => sleep(rnd(300, 600));          // aynı setin sayfaları arası
const setGap = () => sleep(rnd(300, 700));         // setler arası

// galleryGraded = { [setId]: { best, manual } } — oyundaki derece geri gitmez (bkz. lib/gallery.js summarise)
async function loadCat() {
  const cat = await loadCatalog();
  const { galleryGraded = {} } = await chrome.storage.local.get('galleryGraded');
  applyFloors(cat.sets, galleryGraded);
  return cat;
}

async function setById(id) {
  const cat = await loadCat();
  const set = cat.sets.find((s) => s.id === id);
  if (!set) throw new Error('Set katalogda yok: ' + id);
  return set;
}

async function saveSetDefs(set, defs, reqs = null) {
  const { gallerySummary = {}, galleryGraded = {} } = await chrome.storage.local.get(['gallerySummary', 'galleryGraded']);
  const g = galleryGraded[set.id] || {};
  const live = summarise({ ...set, floor: 0 }, defs).live;
  if (live > (g.best || 0)) { galleryGraded[set.id] = { ...g, best: live }; await chrome.storage.local.set({ galleryGraded }); }
  set.floor = floorScore(set, galleryGraded[set.id]);
  const sum = summarise(set, defs);
  gallerySummary[set.id] = {
    collected: sum.collected, required: sum.required, total: sum.total,
    score: sum.score, grade: sum.grade, earned: sum.earned, base: sum.base, bonus: sum.bonus,
    reqs: reqs ?? gallerySummary[set.id]?.reqs ?? null, at: Date.now(),
  };
  await chrome.storage.local.set({ [defsKey(set.id)]: { at: Date.now(), defs }, gallerySummary });
}

// Alınan kart satışa çıkıp satılınca EA isCollected'ı false yapar, ama oyunda notlandırılan derece düşmez.
// Alımdan sonra beklenen puan (alınanlar toplanmış sayılarak, bonus dahil) setin en iyi puanı olarak saklanır.
// defs yoksa kayıtlı eşitleme kullanılır.
async function raiseFloor(set, defs, got) {
  if (!got?.length) return;
  if (!defs) defs = (await chrome.storage.local.get(defsKey(set.id)))[defsKey(set.id)]?.defs;
  if (!defs) return;
  const ids = new Set(got);
  const live = summarise({ ...set, floor: 0 }, defs.map((d) => (ids.has(d.def) ? { ...d, col: true } : d))).live;
  const { galleryGraded = {}, gallerySummary = {} } = await chrome.storage.local.get(['galleryGraded', 'gallerySummary']);
  const g = galleryGraded[set.id] || {};
  if (live <= (g.best || 0)) return;
  galleryGraded[set.id] = { ...g, best: live };
  set.floor = floorScore(set, galleryGraded[set.id]);
  const sum = summarise(set, defs);
  if (gallerySummary[set.id]) gallerySummary[set.id] = { ...gallerySummary[set.id], score: sum.score, grade: sum.grade, earned: sum.earned };
  await chrome.storage.local.set({ galleryGraded, gallerySummary });
}

// Puan hesabı değişince (SUMMARY_V) ya da yeni katalog gelince özetler kayıtlı eşitlemelerden yeniden hesaplanır
// (EA'ya istek yok). 2: bonus etiketleri.
const SUMMARY_V = 2;
async function recomputeSummaries(force = false) {
  const { gallerySummaryV = 1 } = await chrome.storage.local.get('gallerySummaryV');
  if (!force && gallerySummaryV >= SUMMARY_V) return;
  const cat = await loadCat();
  const { gallerySummary = {} } = await chrome.storage.local.get('gallerySummary');
  const saved = await chrome.storage.local.get(cat.sets.map((x) => defsKey(x.id)));
  for (const set of cat.sets) {
    const defs = saved[defsKey(set.id)]?.defs;
    if (!defs || !gallerySummary[set.id]) continue;
    const sum = summarise(set, defs);
    gallerySummary[set.id] = { ...gallerySummary[set.id], collected: sum.collected, score: sum.score, grade: sum.grade, earned: sum.earned, base: sum.base, bonus: sum.bonus };
  }
  await chrome.storage.local.set({ gallerySummary, gallerySummaryV: SUMMARY_V });
}

// ---------------------------------------------------------------- hesaba özel galeri verisi
// galleryAcct = { id, name } — verisi şu an yüklü olan EA hesabı (inject.js → session.acct).
// Hesap değişince eskisinin galeri verisi `acct:<id>` altına kaldırılır, yeninin kaydı geri yüklenir (yoksa boş başlar).
// Fiyatlar, ayarlar, katalog ortak kalır.
const ACCT_KEYS = ['galleryGraded', 'galleryToGrade', 'gallerySummary', 'galleryBuySpent', 'galleryBuys', 'galleryLevel'];
const acctKey = (id) => 'acct:' + id;
let acctQueue = Promise.resolve();
const checkAccount = (acct) => (acctQueue = acctQueue.then(() => switchAccount(acct)).catch(() => {}));
async function switchAccount(acct) {
  const id = acct?.id ? String(acct.id) : null;
  if (!id) return;
  const all = await chrome.storage.local.get(null);
  const cur = all.galleryAcct || null;
  if (cur?.id === id) {
    if (acct.name && acct.name !== cur.name) await chrome.storage.local.set({ galleryAcct: { id, name: acct.name } });
    return;
  }
  if (!cur) return chrome.storage.local.set({ galleryAcct: { id, name: acct.name || null } });   // ilk tanıma: mevcut veri bu hesabın
  if (all.galleryRun?.running) await stop(T('bg.stopped'), 'idle');
  const mine = (k) => ACCT_KEYS.includes(k) || k.startsWith('gdefs:');
  const snap = {};
  for (const [k, v] of Object.entries(all)) if (mine(k)) snap[k] = v;
  const next = all[acctKey(id)] || {};
  await chrome.storage.local.set({ [acctKey(cur.id)]: { name: cur.name, at: Date.now(), data: snap } });
  await chrome.storage.local.remove([...Object.keys(snap), acctKey(id)]);
  await chrome.storage.local.set({ ...(next.data || {}), galleryAcct: { id, name: acct.name || next.name || null } });
  const name = acct.name || next.name || id;
  await status(next.data ? T('bg.acctBack', { name }) : T('bg.acctNew', { name }), next.data ? 'ok' : 'warn');
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.session?.newValue?.acct) checkAccount(c.session.newValue.acct); });
chrome.storage.local.get('session').then(({ session }) => session?.acct && checkAccount(session.acct)).catch(() => {});

// Bu hesaptaki tüm "oyundaki derece" kayıtları (elle seçilen + eşitlemelerde görülen en yüksek) silinir,
// özetler kayıtlı eşitlemelerden yeniden hesaplanır (EA'ya istek yok)
async function resetGraded() {
  await chrome.storage.local.remove('galleryGraded');
  await recomputeSummaries(true);
}

async function syncSets(my, ids) {
  const cat = await loadCat();
  const sets = ids.map((id) => cat.sets.find((s) => s.id === id)).filter((s) => s && !s.filter.unsupported);
  const got = await chrome.storage.local.get(['gallerySyncStats', 'gallerySummary']);
  let secPerReq = got.gallerySyncStats?.secPerReq || null;
  const summary = got.gallerySummary || {};
  const started = Date.now();
  let n = 0;
  let failed = 0;
  let streak = 0;   // art arda başarısız set (sekme kapandıysa her set düşer → dur)
  // galeri ekranındaki eşitleme animasyonu için: sıra, o anki set ve istek ilerlemesi (galleryRun.sync)
  const sync = { ids: sets.map((s) => s.id), done: [], fail: [], cur: null, req: 0, reqN: 0, t0: started, end: 0 };
  const syncPatch = (p = {}) => (my === token ? patchRun({ sync: Object.assign(sync, p) }) : null);
  await syncPatch();
  const pageGap = async () => { await pause(); await syncPatch(); };   // sayfa arası: istek sayacını yansıt
  for (const [i, set] of sets.entries()) {
    if (my !== token) return;
    const left = syncEstimate(sets.slice(i), summary, secPerReq).sec;
    await syncPatch({ cur: set.id, req: 0, reqN: setRequests(set, summary[set.id]), left: Math.round(left) });
    await status(T('bg.syncing', { name: set.name, i: i + 1, n: sets.length, left: fmtDur(left, T) }), 'ok', my);
    let reqs = 0;
    let defs = null;
    let lastErr = null;
    // Web App anlık meşgulse / zaman aşımı: 2 sn sonra bir kez daha dene, olmazsa seti atla
    for (let attempt = 0; attempt < 2 && !defs && my === token; attempt++) {
      try {
        defs = await fetchSetDefs(set.filter, pageGap, (ms) => {
          reqs++;
          sync.req = reqs;
          secPerReq = secPerReq ? secPerReq * 0.8 + (ms / 1000) * 0.2 : ms / 1000;   // hareketli ortalama
        });
      } catch (err) {
        lastErr = err;
        const why = stopReason(err);
        if (why) { notify(T('bg.haltTitle'), why); return stop(why, 'error', my); }
        if (attempt === 0) await sleep(2000);
      }
    }
    if (my !== token) return;
    if (defs) {
      await saveSetDefs(set, defs, reqs);
      summary[set.id] = { ...(summary[set.id] || {}), reqs };
      await chrome.storage.local.set({ gallerySyncStats: { secPerReq } });
      n++;
      streak = 0;
      await syncPatch({ done: [...sync.done, set.id], cur: null });
    } else {
      failed++;
      await syncPatch({ fail: [...sync.fail, set.id], cur: null });
      const e = lastErr?.message || T('error');
      if (++streak >= 3) { notify(T('bg.haltTitle'), e); return stop(T('bg.syncFail', { name: set.name, e }) + T('bg.syncFailN', { n: failed }), 'error', my); }
      await status(T('bg.syncFail', { name: set.name, e }), 'warn', my);
    }
    await setGap();
  }
  await syncPatch({ end: Date.now() });
  if (my === token) await stop(T('bg.syncDone', { n, m: sets.length, d: fmtDur((Date.now() - started) / 1000, T) }) + (failed ? T('bg.syncFailN', { n: failed }) : ''), failed ? 'warn' : 'ok', my);
}

async function loadPrices() {
  const { galleryPrices = {} } = await chrome.storage.local.get('galleryPrices');
  return galleryPrices;
}
const freshPrices = (all) => {
  const out = {};
  for (const [d, x] of Object.entries(all)) if (Date.now() - x.at < PRICE_TTL) out[d] = x.p;
  return out;
};

// Boş slot sayısı + birkaç yedek kadar toplanmamış, satılabilir baz kartın en ucuz ilanına bakar.
async function priceSet(my, setId) {
  const set = await setById(setId);
  if (set.filter?.unsupported) return stop(T('bg.unsupported', { name: set.name }), 'warn', my);
  const { [defsKey(setId)]: saved } = await chrome.storage.local.get(defsKey(setId));
  if (!saved) return stop(T('bg.needSync'), 'warn', my);
  const pool = saved.defs.filter((d) => d.tradable && d.rare <= 1);
  const cands = priceCandidates(set, pool);
  if (!cands.length) return stop(T('bg.noCands', { name: set.name }), 'ok', my);
  let n = 0;
  for (const d of cands) {
    if (my !== token) return;
    const all = await loadPrices();
    if (all[d.def] && Date.now() - all[d.def].at < PRICE_TTL) continue;
    await status(T('bg.priceOne', { name: d.name, i: ++n, n: cands.length }), 'ok', my);
    try {
      const a = await findCheapest(baseOf(d.def), d.def);
      await savePrice(d.def, a ? a.buyNowPrice : 0);
    } catch (err) {
      const why = stopReason(err);
      if (why) { notify(T('bg.haltTitle'), why); return stop(why, 'error', my); }
    }
    await sleep(rnd(900, 2000));
  }
  if (my !== token) return;
  const plan = cheapestFill(set, saved.defs, freshPrices(await loadPrices()));
  await stop(T('bg.priceDone', { name: set.name, n: plan.pick.length, c: fmt(plan.coins), t: fmt(plan.tax) }), 'ok', my);
}

// Alınan kartı ayara göre transfer listesine taşır / satışa koyar.
// Satış fiyatı: ödenen ya da fut.gg fiyatı (ref), ±% ayarıyla; EA basamağına yuvarlanır.
// Dönen: { note, tp } — tp: 'ok' (transfer listesine girdi) | 'fail' (liste dolu / taşınamadı) | null (unassigned'da kaldı)
async function afterBuy(itemId, price, settings, ref = null) {
  const mode = settings.afterBuy || 'relist';
  if (!itemId || mode === 'keep') return { note: '', tp: null };
  await sleep(rnd(500, 1200));
  const mv = await api.toTradepile(itemId);
  if (mv?.itemData?.[0]?.success === false) return { note: T('bg.tpFail', { r: mv.itemData[0].reason || '?' }), tp: 'fail' };
  if (mode !== 'relist') return { note: T('bg.tp'), tp: 'ok' };
  const cfg = settings.relist || {};
  const sell = relistPrice(price, ref, cfg);
  await sleep(rnd(500, 1200));
  try {
    await api.list(itemId, Math.max(150, prevPrice(sell)), sell, cfg.dur || 3600);
  } catch (e) {
    if (stopReason(e)) throw e;
    return { note: T('bg.listFail', { e: e?.status || e?.message }), tp: 'ok' };
  }
  const net = Math.floor(sell * 0.95) - price;
  return { note: T('bg.relisted', { p: fmt(sell), net: (net >= 0 ? '+' : '') + fmt(net) }), tp: 'ok' };
}

// Transfer listesindeki ilan sayısı (satılan / süresi dolan dahil; hepsi yer kaplar). null = okunamadı.
async function tradepileCount() {
  try { return (await api.tradepile())?.auctionInfo?.length ?? null; } catch (e) { if (stopReason(e)) throw e; return null; }
}
// Alım bağlamı: "Unassigned'da bırak" dışında transfer listesi doluluğu izlenir
async function buyContext() {
  const { settings } = await load();
  if ((settings.afterBuy || 'relist') === 'keep') return { tp: null, full: false };
  const tp = await tradepileCount();
  return { tp, full: tp != null && tp >= TP_MAX };
}

async function buyMissing(my, setId) {
  const set = await setById(setId);
  if (set.filter?.unsupported) return stop(T('bg.unsupported', { name: set.name }), 'warn', my);
  const { [defsKey(setId)]: saved } = await chrome.storage.local.get(defsKey(setId));
  if (!saved) return stop(T('bg.needSync'), 'warn', my);
  const prices = freshPrices(await loadPrices());
  const plan = cheapestFill(set, saved.defs, prices);
  if (!plan.pick.length) return stop(T('bg.noBuy'), 'warn', my);
  const { settings } = await load();
  // fiyatlar "Fiyatla"dan geliyor → canlı fiyat sayılır (sınır = canlı × 1,25)
  const cards = plan.pick.map((d) => ({ def: d.def, name: d.name, rare: d.rare, price: prices[d.def], live: prices[d.def] }));
  return buyAndFinish(my, set, buyTargets(cards, settings.maxCard), plan.pick);
}

// fut.gg'nin seçilen not için önerdiği çözümdeki (hangi kartlar), henüz toplanmamış kartları
// pazardaki GÜNCEL en ucuz fiyattan alır. fut.gg fiyatı yalnız özel sürümleri bulmak için alt sınır ipucu.
// src: 'futgg' | 'gg' (Gallery Grab çözücü); want: ekranda onaylanan eksik kartlar (değiştiyse almaz — plan kilidi)
async function buyPlan(my, setId, grade, src = 'futgg', want = null) {
  const set = await setById(setId);
  if (set.filter?.unsupported) return stop(T('bg.unsupported', { name: set.name }), 'warn', my);
  const { [defsKey(setId)]: saved } = await chrome.storage.local.get(defsKey(setId));
  if (!saved) return stop(T('bg.needSync'), 'warn', my);
  const live = freshPrices(await loadPrices());
  let plan = src === 'gg' ? solveGrade(set, grade, saved.defs, live) : planFromTier(set, grade, saved.defs, live);
  if (plan?.unreachable) plan = null;
  if (!plan) return stop(T('bg.noSol', { name: set.name, g: grade }), 'warn', my);
  const todo = plan.cards.filter((c) => !c.col);
  if (want && (want.length !== todo.length || todo.some((c) => !want.includes(c.def)))) return stop(T('bg.planChanged', { name: set.name, g: grade }), 'warn', my);
  if (!todo.length) return stop(T('bg.allOwned', { name: set.name }), 'ok', my);
  const { settings } = await load();
  return buyAndFinish(my, set, buyTargets(todo, settings.maxCard), todo);
}

// Galeri ekranındaki alım animasyonu için (galleryRun.buy): set sırası, o anki set ve kartlarının durumu
// kart st: 'q' sırada | 'find' aranıyor | 'ok' alındı (p fiyat) | 'skip' atlandı | 'fail' hata
function buyFx(my, ids) {
  const buy = { ids, done: [], fail: [], cur: null, cset: null, cards: [], spent: 0, bought: 0, t0: Date.now(), end: 0 };
  const patch = (p = {}) => (my === token ? patchRun({ buy: Object.assign(buy, p) }) : null);
  const card = (def, p, extra = {}) => { Object.assign(buy.cards.find((c) => c.def === def) || {}, p); return patch(extra); };
  const close = (id, ok) => patch({ [ok ? 'done' : 'fail']: [...buy[ok ? 'done' : 'fail'], id], cur: null });
  return { buy, patch, card, close };
}
const fxCards = (targets, plan = []) => targets.map((t) => ({ def: t.def, name: t.name, base: baseOf(t.def), r: plan.find((c) => c.def === t.def)?.r || 0, rare: t.rare, st: 'q', p: 0 }));

// Kartları sırayla alır; bütçe galeriye özel sayaçla (galleryBuySpent) kontrol edilir.
// Dönen: { bought, notes, halt } — halt: 'budget' | 'coins' | 'stopped' | 'error' (döngü devam etmemeli)
// ctx = { tp }: transfer listesindeki ilan sayısı (null = izlenmiyor). halt 'tpfull' = liste doldu.
// Başkası aldığı, ilan olmadığı ya da hata verdiği için atlanan kartlara, hepsi bitince RETRY_ROUNDS tur daha dönülür
// (fiyat sınırı / şüpheli fiyat yüzünden atlananlara dönülmez). Notları yalnız son turda kalanlar için yazılır.
async function buyCards(my, set, targets, label = '', ctx = {}) {
  let bought = 0;
  const notes = [];
  const fx = ctx.fx || null;
  let list = targets;
  for (let round = 0; round <= RETRY_ROUNDS && list.length; round++) {
  const last = round === RETRY_ROUNDS;
  const again = [];
  if (round) {
    await status(label + T('bg.retryRound', { n: list.length, r: round, m: RETRY_ROUNDS }), 'ok', my);
    await sleep(rnd(4000, 8000));   // ilanlar yenilensin
    if (my !== token) return { bought, notes, halt: 'stopped' };
  }
  for (const [i, t] of list.entries()) {
    if (my !== token) return { bought, notes, halt: 'stopped' };
    if (ctx.tp != null && ctx.tp >= TP_MAX) return { bought, notes: [...notes, T('bg.tpFull', { n: ctx.tp })], halt: 'tpfull' };
    const { settings } = await load();
    try {
      await status(label + T('bg.search', { name: t.name, i: i + 1, n: list.length }), 'ok', my);
      await fx?.card(t.def, { st: 'find' });
      let done = false;
      let retry = false;   // bu turda atlandı ama sonra yeniden denenebilir
      const noted = notes.length;
      for (let attempt = 1; attempt <= RETRY_MAX && !done; attempt++) {
        const tr = {};
        const a = await findCheapest(baseOf(t.def), t.def, t.range, tr, t.rare);
        if (!a) {
          // Sınırın altında ilan yok: gerçek en ucuz fiyatı bul — rapora yazılır ve canlı fiyat olarak saklanır
          // (bir sonraki denemede sınır bu fiyatın %25 fazlası olur)
          const real = t.range?.maxb ? await findCheapest(baseOf(t.def), t.def, t.range.minb ? { minb: t.range.minb } : null, null, t.rare) : null;
          await savePrice(t.def, real ? real.buyNowPrice : 0);
          if (real) notes.push(T('bg.overCap', { name: t.name, p: fmt(real.buyNowPrice), c: fmt(t.range.maxb) }));
          else if (last) notes.push(T('bg.noListing', { name: t.name }));
          else retry = true;
          break;
        }
        const price = a.buyNowPrice;
        // fut.gg'nin çok üstünde ve daha ucuzunun olmadığı kesinleşmedi: alma, canlı fiyat diye de saklama
        if (suspiciousPrice(price, t.gg, tr.sure)) { notes.push(T('bg.overRef', { name: t.name, p: fmt(price), f: fmt(t.gg) })); break; }
        await savePrice(t.def, price);
        if (t.cap && price > t.cap) { notes.push(T('bg.overCap', { name: t.name, p: fmt(price), c: fmt(t.cap) })); break; }
        const { galleryBuySpent = 0 } = await chrome.storage.local.get('galleryBuySpent');
        const { run } = await load();
        if (settings.galleryBudget > 0 && galleryBuySpent + price > settings.galleryBudget) return { bought, notes: [...notes, T('bg.budget')], halt: 'budget' };
        if (run.coins != null && price > run.coins) return { bought, notes: [...notes, T('bg.coinsLow')], halt: 'coins' };
        await sleep(rnd(300, 800));
        if (my !== token) return { bought, notes, halt: 'stopped' };
        try {
          const r = await api.buyNow(a.tradeId, price);
          const it = r?.auctionInfo?.[0]?.itemData || a.itemData || {};
          const cur = await load();
          const { galleryBuySpent: sp = 0 } = await chrome.storage.local.get('galleryBuySpent');
          const { galleryBuys = [] } = await chrome.storage.local.get('galleryBuys');
          galleryBuys.push({ n: t.name, d: t.def, p: price, g: t.gg || 0, s: set.name, at: Date.now() });
          await chrome.storage.local.set({ galleryBuySpent: sp + price, galleryBuys: galleryBuys.slice(-200) });
          await patchRun({ coins: parseCoins(r) ?? (cur.run.coins != null ? cur.run.coins - price : null) });
          await fx?.card(t.def, { st: 'ok', p: price }, { spent: fx.buy.spent + price, bought: fx.buy.bought + 1 });
          bought++;
          (ctx.got ||= []).push(t.def);
          done = true;
          const ab = await afterBuy(it.id, price, settings, t.ref);
          await status(label + T('bg.bought', { name: t.name, p: fmt(price), x: ab.note }), 'ok', my);
          if (ab.tp === 'ok' && ctx.tp != null) ctx.tp++;
          if (ab.tp === 'fail') return { bought, notes: [...notes, T('bg.tpFull', { n: ctx.tp ?? TP_MAX })], halt: 'tpfull' };
        } catch (e) {
          if (e instanceof ApiError && (e.status === 460 || e.status === 461)) { await sleep(rnd(600, 1200)); continue; }
          throw e;
        }
      }
      if (!done && !retry && notes.length === noted) { if (last) notes.push(T('bg.sniped', { name: t.name })); else retry = true; }
      if (retry) { again.push(t); await fx?.card(t.def, { st: 'again' }); }
      else if (!done) await fx?.card(t.def, { st: 'skip' });
    } catch (err) {
      const why = stopReason(err);
      if (why) { notify(T('bg.haltTitle'), why); await stop(why, 'error', my); return { bought, notes, halt: 'error' }; }
      if (last) { notes.push(`${t.name}: ${err?.message || T('error')}`); await fx?.card(t.def, { st: 'fail' }); }
      else { again.push(t); await fx?.card(t.def, { st: 'again' }); }
    }
    await sleep(rnd(1000, 2500));
  }
  list = again;
  }
  return { bought, notes, halt: null };
}

async function refreshCoinsRun() {
  try { await patchRun({ coins: parseCoins(await api.credits()) }); } catch (_) {}
}

// Tek set: al + bitir
async function buyAndFinish(my, set, targets, plan = []) {
  await refreshCoinsRun();
  const ctx = await buyContext();
  if (ctx.full) return stop(T('bg.tpFull', { n: ctx.tp }), 'warn', my);
  ctx.got = [];
  ctx.fx = buyFx(my, [set.id]);
  await ctx.fx.patch({ cur: set.id, cset: set.id, cards: fxCards(targets, plan) });
  const r = await buyCards(my, set, targets, '', ctx);
  if (r.halt === 'stopped' || r.halt === 'error') {
    await ctx.fx.close(set.id, false);
    if (r.bought) { await markToGrade([set.id]); await raiseFloor(set, null, ctx.got); }
    return;
  }
  return finishBuy(my, set, r.bought, r.notes, r.halt, ctx.got, ctx.fx);
}

// Kart alınan setler oyunda notlandırılmalı (Web App notlandıramıyor): { setId: zaman }
async function markToGrade(ids) {
  const { galleryToGrade = {} } = await chrome.storage.local.get('galleryToGrade');
  for (const id of ids) galleryToGrade[id] = Date.now();
  await chrome.storage.local.set({ galleryToGrade });
}

// Çoklu alımda derece kararından önce: derecenin eksik kartlarına pazardan güncel fiyat.
// Son 10 dk'da bakılan kart atlanır (alt dereceye düşülünce ortak kartlar yeniden aranmaz). false = durduruldu.
const RECHECK_MS = 10 * 60 * 1000;
async function priceFresh(my, set, grade, defs, label) {
  const all = await loadPrices();
  const plan = planFromTier(set, grade, defs);
  const todo = (plan ? plan.cards.filter((c) => !c.col) : []).filter((c) => !(all[c.def] && Date.now() - all[c.def].at < RECHECK_MS));
  for (const [i, c] of todo.entries()) {
    if (my !== token) return false;
    await status(label + T('bg.live', { name: c.name || '#' + c.def, i: i + 1, n: todo.length }), 'ok', my);
    try {
      const tr = {};
      const a = await findCheapest(baseOf(c.def), c.def, c.rare > 1 && c.price >= 1000 ? { minb: Math.floor(c.price * 0.5) } : null, tr, c.rare);
      if (!a || !suspiciousPrice(a.buyNowPrice, c.price, tr.sure)) await savePrice(c.def, a ? a.buyNowPrice : 0);
    } catch (err) {
      const why = stopReason(err);
      if (why) { notify(T('bg.haltTitle'), why); await stop(why, 'error', my); return false; }
    }
    await sleep(rnd(700, 1500));
  }
  return my === token;
}

// Token planlayıcının seçtiği setler: [{ setId, grade }] sırayla. Her setten önce set eşitlenir
// (oyunda alınan/satılan kartlar), oto derecede seçilen derecenin kartlarına canlı fiyat bakılır; sonra yine eşitlenir.
async function buyBatch(my, items) {
  await refreshCoinsRun();
  const cat = await loadCat();
  const ctx = await buyContext();
  if (ctx.full) return stop(T('bg.tpFull', { n: ctx.tp }), 'warn', my);
  let total = 0;
  let halt = null;
  const done = [];
  items = items.filter((it) => cat.sets.some((x) => x.id === it.setId));
  const fx = buyFx(my, items.map((it) => it.setId));
  await fx.patch();
  for (const [i, it] of items.entries()) {
    if (my !== token) return;
    const set = cat.sets.find((x) => x.id === it.setId);
    await fx.patch({ cur: set.id, cards: [] });
    if (set.filter?.unsupported) { done.push(T('bg.unsupported', { name: set.name })); await fx.close(set.id, false); continue; }
    const label = `[${i + 1}/${items.length}] ${set.name} · `;
    const { [defsKey(set.id)]: saved } = await chrome.storage.local.get(defsKey(set.id));
    let defs = saved?.defs || null;
    await status(label + T('bg.syncing1', { name: set.name }), 'ok', my);
    try { defs = await fetchSetDefs(set.filter, pause); await saveSetDefs(set, defs); } catch (err) {
      const why = stopReason(err);
      if (why) { notify(T('bg.haltTitle'), why); return stop(why, 'error', my); }
    }
    if (my !== token) return;
    if (!defs) { done.push(T('bg.unsyncedSkip', { name: set.name })); await fx.close(set.id, false); continue; }
    let grade = it.grade;
    // Çoklu seçim (auto): o anki coin/bütçe ve CANLI fiyatlarla hedeften aşağı ulaşılabilir en yüksek derece.
    // Seçilen derecenin kartları fiyatlanır, karar yeniden verilir; derece değişirse yenisi de fiyatlanır (en çok 3 derece).
    if (it.auto) {
      const { settings: st, run } = await load();
      const { galleryBuySpent = 0 } = await chrome.storage.local.get('galleryBuySpent');
      let avail = run.coins ?? null;
      if (st.galleryBudget > 0) avail = Math.min(avail ?? Infinity, Math.max(0, st.galleryBudget - galleryBuySpent));
      const seen = new Set();
      let p;
      for (;;) {
        p = pickGrade(set, defs, freshPrices(await loadPrices()), it.grade || null, avail);
        if (!p.g || seen.has(p.g) || seen.size >= 3) break;
        seen.add(p.g);
        if (!(await priceFresh(my, set, p.g, defs, label))) return;
      }
      if (!p.g) { done.push(T('bg.autoNone.' + p.why, { name: set.name })); await fx.close(set.id, true); continue; }
      if (p.fell) done.push(T('bg.autoFell', { name: set.name, from: it.grade, to: p.g }));
      grade = p.g;
    }
    const plan = planFromTier(set, grade, defs, freshPrices(await loadPrices()));
    const todo = plan ? plan.cards.filter((c) => !c.col) : [];
    if (!todo.length) { if (plan) done.push(T('bg.autoReady', { name: set.name, g: grade })); await fx.close(set.id, true); continue; }
    const { settings } = await load();
    ctx.got = [];
    ctx.fx = fx;
    const targets = buyTargets(todo, settings.maxCard);
    await fx.patch({ cset: set.id, cards: fxCards(targets, todo) });
    const r = await buyCards(my, set, targets, label, ctx);
    total += r.bought;
    if (r.halt === 'stopped' || r.halt === 'error') {
      await fx.close(set.id, false);
      if (r.bought) { await markToGrade([set.id]); await raiseFloor(set, defs, ctx.got); }
      return;
    }
    let after = null;
    try { after = await fetchSetDefs(set.filter, pause); await saveSetDefs(set, after); } catch (_) {}   // alınanlar toplandı mı
    if (r.bought) { await markToGrade([set.id]); await raiseFloor(set, after || defs, ctx.got); }
    done.push(...r.notes.filter((x) => !done.includes(x)));
    await fx.close(set.id, true);
    if (r.halt) { halt = r.halt; break; }
  }
  if (my !== token) return;
  await fx.patch({ end: Date.now() });
  const msg = T('bg.planDone', { n: total }) + (done.length ? ' · ' + done.slice(0, 3).join(' · ') + (done.length > 3 ? ` (+${done.length - 3})` : '') : '') + (total ? T('bg.gradeHint') : '');
  notify('Gallery Grab', msg);
  await stop(msg, halt ? 'warn' : 'ok', my);
}

// Canlı fiyatı sakla; 24 saatten eski kayıtları at (depo şişmesin)
async function savePrice(def, p) {
  const all = await loadPrices();
  const now = Date.now();
  for (const [k, x] of Object.entries(all)) if (now - x.at > 24 * 60 * 60 * 1000) delete all[k];
  all[def] = { p, at: now };
  await chrome.storage.local.set({ galleryPrices: all });
}

// Seçili notun çözümündeki eksik kartların pazardaki güncel en ucuz fiyatı
async function priceTier(my, set, grade, defs) {
  const plan = planFromTier(set, grade, defs);
  const todo = plan ? plan.cards.filter((c) => !c.col) : [];
  const changes = [];
  const trails = [];
  for (const [i, c] of todo.entries()) {
    if (my !== token) return null;
    const name = c.name || '#' + c.def;
    await status(T('bg.live', { name, i: i + 1, n: todo.length }), 'ok', my);
    try {
      const tr = {};
      const a = await findCheapest(baseOf(c.def), c.def, c.rare > 1 && c.price >= 1000 ? { minb: Math.floor(c.price * 0.5) } : null, tr, c.rare);
      const p = a ? a.buyNowPrice : 0;
      if (a && suspiciousPrice(p, c.price, tr.sure)) { changes.push(T('bg.overRef', { name, p: fmt(p), f: fmt(c.price) })); await sleep(rnd(700, 1500)); continue; }
      if (a && tr.lo) trails.push(T('bg.trail', { name, p: fmt(p), lo: fmt(tr.lo) }));
      await savePrice(c.def, p);
      if (p !== c.price) changes.push(p ? T('bg.liveChange', { name, p: fmt(p), f: fmt(c.price) }) : T('bg.liveNone', { name }));
    } catch (err) {
      const why = stopReason(err);
      if (why) { notify(T('bg.haltTitle'), why); await stop(why, 'error', my); return null; }
    }
    await sleep(rnd(700, 1500));
  }
  return { n: todo.length, changes, trails };
}

// Detaydaki "Eşitle": seti EA'dan eşitle + seçili notun eksik kartlarına canlı fiyat
async function syncPrice(my, setId, grade) {
  const set = await setById(setId);
  if (set.filter?.unsupported) return stop(T('bg.unsupported', { name: set.name }), 'warn', my);
  await status(T('bg.syncing1', { name: set.name }), 'ok', my);
  let defs;
  try { defs = await fetchSetDefs(set.filter, pause); await saveSetDefs(set, defs); } catch (err) {
    const why = stopReason(err) || err?.message || T('error');
    return stop(T('bg.syncFail', { name: set.name, e: why }), 'error', my);
  }
  if (!grade || my !== token) return my === token ? stop(T('bg.synced1', { name: set.name }), 'ok', my) : undefined;
  const r = await priceTier(my, set, grade, defs);
  if (!r || my !== token) return;
  const plan = planFromTier(set, grade, defs, freshPrices(await loadPrices()));
  const head = T('bg.liveDone', { name: set.name, g: grade, m: plan.missing, c: fmt(plan.need) });
  const trail = r.trails.length ? ' · ' + r.trails.slice(0, 2).join(' · ') : '';
  await stop((r.changes.length ? `${head} · ${r.changes.slice(0, 4).join(' · ')}` : head + T('bg.liveSame')) + trail, 'ok', my);
}

async function finishBuy(my, set, bought, notes, halt = null, got = [], fx = null) {
  if (my !== token) return;
  // Alınanların toplandığını EA'dan doğrula
  let after = null;
  try { after = await fetchSetDefs(set.filter, pause); await saveSetDefs(set, after); } catch (_) {}   // alınanlar toplandı mı
  if (bought) { await markToGrade([set.id]); await raiseFloor(set, after, got); }
  const { gallerySummary = {} } = await chrome.storage.local.get('gallerySummary');
  const s = gallerySummary[set.id];
  const note = notes.length ? ' · ' + notes.slice(0, 3).join(' · ') + (notes.length > 3 ? ` (+${notes.length - 3})` : '') : '';
  const msg = T('bg.done1', { name: set.name, n: bought }) + note + (s ? T('bg.done1b', { c: s.collected, r: s.required, g: s.grade || '-' }) : '') + (bought ? T('bg.gradeHint') : '');
  notify('Gallery Grab', msg);
  if (fx) { await fx.close(set.id, true); await fx.patch({ end: Date.now() }); }
  await stop(msg, halt || notes.length ? 'warn' : 'ok', my);
}

async function startTask(fn, label) {
  const { session } = await chrome.storage.local.get('session');
  if (!session?.sid) { await status(T('bg.noSession'), 'error'); return { ok: false }; }
  const my = ++token;
  await patchRun({ running: true, text: label, level: 'ok', sync: null, buy: null });   // sync/buy: yalnız eşitleme/alım görevi doldurur
  // Görev beklenmedik hata fırlatırsa "çalışıyor" durumunda takılı kalmasın
  Promise.resolve().then(() => fn(my)).catch((e) => stop(T('bg.taskFail', { e: e?.message || String(e) }), 'error', my));
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
  runLoop(my).catch((e) => stop(T('bg.taskFail', { e: e?.message || String(e) }), 'error', my));
  return { ok: true };
}

// my verilirse: yalnız o görev hâlâ güncelse durdurur (Durdur'dan sonra başlatılan yeni görevi eski görevin bitişi öldürmesin)
async function stop(text = T('bg.stopped'), level = 'idle', my = null) {
  if (my != null && my !== token) return;
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
      case 'setExpectClub': {   // null = otomatik çoğunluk, metin = sabitlenmiş kulüp (ad anahtarı)
        const { settings } = await load();
        const v = msg.value ? String(msg.value) : null;
        await chrome.storage.local.set({ gallerySettings: { ...settings, expectClub: v } });
        return { ok: true };
      }
      case 'syncSets': return startTask((my) => syncSets(my, msg.ids || []), T('bg.syncStart'));
      case 'priceSet': return startTask((my) => priceSet(my, msg.id), T('bg.priceStart'));
      case 'buyMissing': return startTask((my) => buyMissing(my, msg.id), T('bg.missingStart'));
      case 'buyPlan': return startTask((my) => buyPlan(my, msg.id, msg.grade, msg.src, msg.defs || null), T('bg.buyStart'));
      case 'syncPrice': return startTask((my) => syncPrice(my, msg.id, msg.grade), T('bg.syncStart'));
      case 'setLang': setLangBg(msg.value); await chrome.storage.local.set({ galleryLang: LANG }); return { ok: true };
      case 'buyBatch': return startTask((my) => buyBatch(my, msg.items || []), T('bg.planStart'));
      case 'setRelist': {
        const { settings } = await load();
        const v = msg.value || {};
        const relist = {
          base: v.base === 'market' ? 'market' : 'paid',
          pct: Math.max(-20, Math.min(20, Math.round(Number(v.pct) || 0))),
          dur: [3600, 10800, 21600, 43200, 86400].includes(Number(v.dur)) ? Number(v.dur) : 3600,
        };
        await chrome.storage.local.set({ gallerySettings: { ...settings, relist } });
        return { ok: true };
      }
      case 'resetGallerySpent': await chrome.storage.local.set({ galleryBuySpent: 0 }); return { ok: true };
      case 'setMaxCard':
      case 'setGalleryBudget': {
        const { settings } = await load();
        const key = msg.type === 'setMaxCard' ? 'maxCard' : 'galleryBudget';
        await chrome.storage.local.set({ gallerySettings: { ...settings, [key]: Math.max(0, Math.floor(Number(msg.value) || 0)) } });
        return { ok: true };
      }
      case 'setToGrade': {   // value true = işaretle, false = "notlandırdım" (kaldır)
        const { galleryToGrade = {} } = await chrome.storage.local.get('galleryToGrade');
        if (msg.value) galleryToGrade[msg.id] = Date.now(); else delete galleryToGrade[msg.id];
        await chrome.storage.local.set({ galleryToGrade });
        return { ok: true };
      }
      case 'resetGraded': await resetGraded(); return { ok: true };
      case 'setGraded': {   // value: 'D'…'S' = oyundaki derece, null = otomatik (eşitlemelerde görülen en yüksek); reset: kayıt silinir
        const { galleryGraded = {} } = await chrome.storage.local.get('galleryGraded');
        if (msg.reset) delete galleryGraded[msg.id];
        else galleryGraded[msg.id] = { ...(galleryGraded[msg.id] || {}), manual: msg.value || null };
        await chrome.storage.local.set({ galleryGraded });
        const set = await setById(msg.id);
        const saved = (await chrome.storage.local.get(defsKey(msg.id)))[defsKey(msg.id)];
        if (saved?.defs) {   // özet (ızgara) yeni tabanla yeniden hesaplanır
          const { gallerySummary = {} } = await chrome.storage.local.get('gallerySummary');
          const sum = summarise(set, saved.defs);
          if (gallerySummary[set.id]) Object.assign(gallerySummary[set.id], { score: sum.score, grade: sum.grade, earned: sum.earned });
          await chrome.storage.local.set({ gallerySummary });
        }
        return { ok: true };
      }
      case 'setAfterBuy': {
        const { settings } = await load();
        const v = ['relist', 'tradepile', 'keep'].includes(msg.value) ? msg.value : 'relist';
        await chrome.storage.local.set({ gallerySettings: { ...settings, afterBuy: v } });
        return { ok: true };
      }
      case 'diagnose': {   // "Teşhis": toplanma bilgisi gelmiyorsa EA'nın ne döndürdüğünü raporlar (alım yok)
        const set = await setById(msg.id);
        const crit = diagCrit(set);
        if (!crit) return { ok: false, error: T('bg.unsupported', { name: set.name }) };
        const { gallerySummary = {}, galleryToGrade = {} } = await chrome.storage.local.get(['gallerySummary', 'galleryToGrade']);
        const { settings } = await load();
        const cat = await loadCat();
        const s = gallerySummary[set.id];
        let r;
        try { r = await diagnoseConcept(crit); } catch (e) { r = { error: e?.message || String(e) }; }
        const app = 'eklenti v' + chrome.runtime.getManifest().version;
        const okSets = cat.sets.filter((x) => !x.filter?.unsupported);
        const overview = diagOverview(gallerySummary, okSets, {
          katalog: cat.updated || null, alimSonrasi: settings.afterBuy || 'relist', notlandirilacak: Object.keys(galleryToGrade).length,
        });
        // Genel tarama: bütün setlerin bütün takımları/ligleri, yalnız sayılar (ilerleme galleryDiagRun'da)
        let scan = null;
        if (msg.all) {
          const my = ++diagToken;
          const rows = [];
          for (const [i, x] of okSets.entries()) {
            if (my !== diagToken) break;
            await chrome.storage.local.set({ galleryDiagRun: { i, n: okSets.length, at: Date.now() } });
            try { rows.push({ set: x, parts: (await diagnoseConcept(diagCrit(x), false)).parts || [] }); }
            catch (e) { rows.push({ set: x, error: String(e?.message || e).slice(0, 80) }); }
            await setGap();
          }
          await chrome.storage.local.remove('galleryDiagRun');
          scan = diagScan(rows, gallerySummary) + (rows.length < okSets.length ? `\n  (durduruldu: ${rows.length}/${okSets.length})` : '');
        }
        return { ok: true, text: diagReport(r, { app, set: set.name, overview, scan, sets: diagSetList(gallerySummary, okSets), saved: s ? { c: s.collected, n: s.total, sc: s.score } : null }) };
      }
      case 'deepDiag': {   // Derin teşhis: oyundaki galeri derecesi Web App'te bir yerde var mı (EA'ya istek yok)
        let r;
        try { r = await deepDiagnose(); } catch (e) { r = { error: e?.message || String(e) }; }
        return { ok: true, text: deepReport(r, { app: 'eklenti v' + chrome.runtime.getManifest().version }) };
      }
      case 'diagStop': diagToken++; return { ok: true };
      case 'diagEstimate': {   // genel tarama onayı için: set ve istek sayısı
        const okSets = (await loadCat()).sets.filter((x) => !x.filter?.unsupported);
        return { ok: true, sets: okSets.length, reqs: okSets.reduce((a, x) => a + (diagCrit(x)?.length || 0), 0) };
      }
      case 'catalog': {
        // Galeri ekranı açılınca: günlük güncelleme kontrolü + görsel kökü için sözlük
        let info = null;
        try { info = await refreshCatalog(!!msg.force); } catch (e) { if (msg.force) return { ok: false, error: e.message }; }
        await recomputeSummaries(!!info?.changed).catch(() => {});
        metaOrNull();
        return { ok: true, info };
      }
      case 'checkUpdate': return { ok: true, ...(await checkUpdate(!!msg.force)) };   // yeni sürüm uyarısı (6 saatte bir GitHub)
      case 'openGalleryTab': await chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') }); return { ok: true };
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

// Açılış: dil; service worker yeniden başladıysa yarım kalan görevi "durdu" say; desteklenmeyen setlerin
// (Holografik, Başlangıç) eski sürümde oluşmuş boş kayıtlarını sil — sahiplik doğrulanamıyor, alım kapalı.
(async () => {
  const { galleryLang } = await chrome.storage.local.get('galleryLang');
  if (galleryLang) setLangBg(galleryLang);
  const { run } = await load();
  if (run.running) await patchRun({ running: false, text: T('bg.restarted'), level: 'warn' });
  try {
    const bad = (await loadCat()).sets.filter((x) => x.filter?.unsupported).map((x) => x.id);
    const { gallerySummary = {} } = await chrome.storage.local.get('gallerySummary');
    if (bad.some((id) => gallerySummary[id])) { bad.forEach((id) => delete gallerySummary[id]); await chrome.storage.local.set({ gallerySummary }); }
    await chrome.storage.local.remove(bad.map(defsKey));
  } catch (_) {}
})();
