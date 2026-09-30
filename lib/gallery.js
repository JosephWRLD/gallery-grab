// Galeri seti hesapları — saf fonksiyonlar (Chrome API'si yok; node ile de denenebilir).
import { makeT } from './i18n.js';
const TR_T = makeT('tr');   // metin üreten fonksiyonlarda t verilmezse Türkçe
// Kart (def) biçimi: { def, base, name, r, rare, team, league, pos, col (isCollected), sc (gradingScore) }
// Kural (Web App verisiyle doğrulandı): toplanan kartlar puana göre sıralanır, ilk `required` tanesinin
// puanı toplanır; bu toplam not merdiveniyle karşılaştırılır.

export const GRADES = ['D', 'C', 'B', 'A', 'S'];
export const TAX = 0.05;

export function counted(set, defs) {
  return defs.filter((d) => d.col).sort((a, b) => b.sc - a.sc).slice(0, set.required);
}

export function gradeFor(set, score) {
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

export function summarise(set, defs) {
  const top = counted(set, defs);
  const score = top.reduce((a, d) => a + (d.sc || 0), 0);
  return { collected: top.length, required: set.required, total: defs.length, score, ...gradeFor(set, score) };
}

// Boş slotları en ucuz toplanmamış kartlarla doldurma planı.
// prices: { [def]: coin } — fiyatı bilinmeyen ya da ilanı olmayan kartlar plana girmez.
export function cheapestFill(set, defs, prices, slots = null) {
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
export function priceCandidates(set, defs, extra = 3) {
  const free = Math.max(0, set.required - counted(set, defs).length);
  return defs.filter((d) => !d.col).sort((a, b) => a.r - b.r || a.sc - b.sc).slice(0, free + extra);
}

// EA definitionId = baseId + 2^24 * sürüm
export const baseOf = (def) => def % 16777216;

// ---------------------------------------------------------------- eşitleme süresi tahmini
// Setin istek sayısı: son eşitlemede ölçülen (summary.reqs); yoksa takım/lig sayısından tahmin.
export const SYNC_DEFAULT_SEC = 0.9;   // istek başına (ölçüm yoksa)
const PAGE_GAP = 0.45;                 // background.js pause() ortalaması
const SET_GAP = 0.5;                   // background.js setGap() ortalaması
export function setRequests(set, sum) {
  if (sum?.reqs) return sum.reqs;
  const f = set.filter || {};
  if (f.teams) return f.teams.length;
  if (f.leagues) return f.leagues.length * 6;
  if (f.rarities) return 2;
  return 0;
}
export function syncEstimate(sets, summary = {}, secPerReq = null) {
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
export function fmtDur(sec, t = TR_T) {
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
export function planFromTier(set, grade, defs = null, live = null) {
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
export function defaultTier(set, score = 0) {
  const tiers = set.sol?.tiers || [];
  const ladder = set.grades || [];
  const ok = (t) => { const g = ladder.find((x) => x.g === t.g); return g && g.score > score && (g.tokens || 0) > 0; };
  return (tiers.find(ok) || tiers[tiers.length - 1])?.g || null;
}

// ---------------------------------------------------------------- token planlayıcı
// Setin henüz ulaşılmamış notları için seçenekler: kazanç = kademe tokenı − şu an kazanılan,
// maliyet = çözümde sende olmayan kartların fut.gg fiyatı (set eşitlenmediyse tamamı → tahmini).
export function tierOptions(set, defs = null) {
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
export function bestNext(set, defs = null) {
  const opts = tierOptions(set, defs);
  if (!opts.length) return null;
  return opts.reduce((a, o) => ((o.cost + 1) / o.gain < (a.cost + 1) / a.gain ? o : a));
}

// Çoklu seçim sırt çantası: her setten en fazla bir not. groups = [[opt,…], …]
// target verilirse: target tokena en ucuz ulaşan plan. budget verilirse: bu bütçeyle en çok token.
export function planTokens(groups, { target = null, budget = null } = {}) {
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
export const HALL_OF_FUT = [
  { tokens: 300, names: 'McGeady, Layún' },
  { tokens: 400, names: 'Guarín, Florenzi, Gervinho, Błaszczykowski, Ibarbo' },
  { tokens: 500, names: 'David Luiz, Doumbia, Richards, Walcott, Valencia, Balotelli' },
  { tokens: 750, names: 'Pato, Hulk' },
];

// ---------------------------------------------------------------- fiyat basamakları
// EA BIN basamakları: <1.000 → 50, <10.000 → 100, <50.000 → 250, <100.000 → 500, üstü 1.000; en düşük BIN 200
export const binStep = (p) => (p < 1000 ? 50 : p < 10000 ? 100 : p < 50000 ? 250 : p < 100000 ? 500 : 1000);
export const roundBin = (p) => Math.max(200, Math.floor(p / binStep(p)) * binStep(p));

// ---------------------------------------------------------------- yeniden listeleme fiyatı
// cfg = { base: 'paid' | 'market', pct: -20…20 }; ref = fut.gg fiyatı (varsa)
export function relistPrice(paid, ref, cfg = {}) {
  const base = cfg.base === 'market' && ref > 0 ? ref : paid;
  return roundBin(base * (1 + (Number(cfg.pct) || 0) / 100));
}

// ---------------------------------------------------------------- alım fiyat sınırı
// Kart başına en yüksek ödeme: canlı fiyat bakıldıysa canlı × 1,25; bakılmadıysa fut.gg fiyatının 2 katı ya da
// fut.gg + 2.000 (hangisi büyükse). maxCard (kullanıcı ayarı, 0 = yok) her durumda üst sınırdır.
// Dönen: geçerli BIN basamağına yuvarlanmış sınır; 0 = sınır yok (hiçbir referans ve ayar yoksa).
export const MAX_CARD_DEFAULT = 0;
export function priceCap(card, maxCard = MAX_CARD_DEFAULT) {
  const live = card?.live > 0 ? card.live : 0;
  const ref = card?.price > 0 ? card.price : 0;
  let cap = live ? Math.ceil(live * 1.25) : ref ? Math.max(ref * 2, ref + 2000) : 0;
  if (maxCard > 0) cap = cap ? Math.min(cap, maxCard) : maxCard;
  return cap ? roundBin(cap) : 0;
}

// Alım hedefleri: { def, name, ref, cap, range: { minb?, maxb? } }. maxb = fiyat sınırı; özel sürümlerde (rare > 1)
// baz kart ilanları arasında kaybolmasın diye beklenen fiyatın yarısı alt sınır. ref: "piyasa" satış fiyatı dayanağı.
export function buyTargets(cards, maxCard = MAX_CARD_DEFAULT) {
  return cards.map((c) => {
    const ref = c.live > 0 ? c.live : c.price || 0;
    const cap = priceCap(c, maxCard);
    const minb = c.rare > 1 && ref >= 1000 ? roundBin(ref * 0.5) : 0;
    const range = {};
    if (minb && (!cap || minb < cap)) range.minb = minb;
    if (cap) range.maxb = cap;
    return { def: c.def, name: c.name || '#' + c.def, ref, cap, range: Object.keys(range).length ? range : null };
  });
}

// ---------------------------------------------------------------- şu an alınabilen token
// fut.gg'nin ulaşılabilir notları (sol.tiers, kümülatif token) içinden en yükseği − kazanılan.
// Çözümü olmayan (pazarda ulaşılamayan) notların tokenı sayılmaz. sol yoksa null (bilinmiyor).
export function reachableTokens(set, sum = null) {
  if (!set.sol?.tiers?.length || set.filter?.unsupported) return null;
  const top = Math.max(0, ...set.sol.tiers.map((t) => t.tokens || 0));
  const earned = sum?.earned ?? 0;
  return Math.max(0, top - earned);
}
export function tokenLabel(set, sum = null, t = TR_T) {
  const r = reachableTokens(set, sum);
  const earned = sum?.earned ?? 0;
  const got = earned ? t('lbl.earned', { n: earned }) : '';
  return got + (r == null ? t('lbl.max', { max: set.maxTokens }) : t('lbl.reach', { r, max: set.maxTokens }));
}

// Şu an kazanılabilen galeri puanı: pazarda ulaşılabilen en yüksek notun fut.gg çözümü alınırsa set puanı
// ne kadar artar. defs varsa (eşitlenmiş) EA puanları + sende olanlar; yoksa fut.gg puanlarıyla sıfırdan.
export function reachableScore(set, defs = null) {
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
export function tokenRows(set, sum = null, next = null, t = TR_T, rs = null) {
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
export const nextMilestone = (lv) => (lv >= 25 ? null : Math.min(25, (Math.floor((lv || 0) / 5) + 1) * 5));

// ---------------------------------------------------------------- genel özet (setlere tıklamadan)
// sums: gallerySummary, defsOf(setId) → defs | null
export function overview(sets, sums = {}, defsOf = () => null) {
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
export const SORT_KEYS = ['', 'tokens', 'tokensAsc', 'max', 'earned', 'left', 'value', 'cheap', 'near', 'progress'];
export const SHOW_KEYS = ['all', 'open', 'grade', 'done', 'unsynced'];
export const sortOptions = (t = TR_T) => SORT_KEYS.map((k) => [k, t('sort.' + k)]);
export const showOptions = (t = TR_T) => SHOW_KEYS.map((k) => [k, t('show.' + k)]);
// toGrade: { setId: at } — kart alınıp oyunda notlandırılması gereken setler
export function sortFilterSets(sets, sums = {}, next = new Map(), sortBy = '', show = 'all', toGrade = {}) {
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
export function diagProbe(crits, withRaw = true) {
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

// Kayıtlı eşitleme verisinin genel özeti (yeni istek atmaz): summary = gallerySummary, sets = katalog setleri
export function diagOverview(summary = {}, sets = [], extra = {}) {
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
export function diagSetList(summary = {}, sets = []) {
  return sets.map((s) => ({ s, c: summary[s.id] ? summary[s.id].collected : null }))
    .sort((a, b) => (b.c ?? -1) - (a.c ?? -1) || a.s.name.localeCompare(b.s.name))
    .map(({ s, c }) => `${s.name} ${c ?? '?'}/${s.required}`);
}

// Genel tarama raporu: rows = [{ set, parts } | { set, error }], her setin her takımı/ligi canlı sorgulanmış (ham yanıt yok).
// Satır: "Arsenal 9+9=18/20 (kart 28+28)"; kayıtlı özetten farklıysa "≠kayıtlı N", ilk sayfa dolduysa (100 kart) "+".
export function diagScan(rows, summary = {}) {
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
export function diagReport(r, meta = {}) {
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
export function diagCrit(set) {
  const f = set?.filter || {};
  if (f.teams?.length) return f.teams.map((club) => ({ club }));
  if (f.leagues?.length) return f.leagues.map((league) => ({ league }));
  return f.rarities ? [{ rarities: f.rarities }] : null;
}
