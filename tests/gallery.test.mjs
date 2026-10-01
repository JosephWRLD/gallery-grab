// lib/gallery.js birim testleri — çalıştırma: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../lib/gallery.js';
import { makeT } from '../lib/i18n.js';

// ---------------------------------------------------------------- yardımcılar
const grades = (...pairs) => pairs.map(([g, score, tokens = 0]) => ({ g, score, tokens, items: [] }));
function mkSet(over = {}) {
  return {
    id: 1, slug: 'test', cat: 'premier-league', name: 'Test', required: 3,
    filter: { teams: [1] }, maxTokens: 28,
    grades: grades(['D', 10], ['C', 300], ['B', 500, 5], ['A', 700, 8], ['S', 1000, 15]),
    // kartlar: [def, base, overall, rarity, score, price]
    sol: {
      at: new Date().toISOString(),
      cards: [[101, 101, 70, 0, 100, 700], [102, 102, 72, 0, 200, 900], [103, 103, 75, 0, 300, 1500], [104, 104, 80, 3, 400, 5000]],
      tiers: [{ g: 'D', cost: 700, tokens: 0, idx: [0] }, { g: 'B', cost: 3100, tokens: 5, idx: [0, 1, 2] }, { g: 'S', cost: 7400, tokens: 28, idx: [1, 2, 3] }],
    },
    ...over,
  };
}
const def = (d, sc, col, extra = {}) => ({ def: d, name: 'P' + d, r: 70, rare: 0, sc, col, tradable: true, ...extra });

// ---------------------------------------------------------------- puan / not
test('summarise: oyundaki derece tabanı (satılan kartlar) puanı düşürmez', () => {
  const set = mkSet();
  const defs = [def(1, 100, true), def(2, 200, false), def(3, 300, false)];
  assert.equal(G.summarise(set, defs).score, 100);
  G.applyFloors([set], { 1: { best: 1000 } });
  const s = G.summarise(set, defs);
  assert.equal(s.score, 1000); assert.equal(s.live, 100); assert.equal(s.grade, 'S');
  assert.equal(G.pickGrade(set, defs).why, 'done');   // S kazanılmış: yeniden alım önerilmez
  G.applyFloors([set], { 1: { best: 1000, manual: 'A' } });   // elle seçilen derece best'in yerine geçer
  assert.equal(G.summarise(set, defs).grade, 'A');
  G.applyFloors([set], {});
  assert.equal(G.summarise(set, defs).score, 100);
});

test('summarise: toplananların en yüksek required tanesi sayılır', () => {
  const set = mkSet();
  const defs = [def(1, 50, true), def(2, 400, true), def(3, 300, true), def(4, 250, true), def(5, 999, false)];
  const s = G.summarise(set, defs);
  assert.equal(s.collected, 3);
  assert.equal(s.score, 950);         // 400 + 300 + 250 (50 dışarıda, toplanmamış 999 sayılmaz)
  assert.equal(s.grade, 'A');
  assert.equal(s.earned, 13);         // B (5) + A (8)
  assert.equal(s.next.g, 'S');
  assert.equal(s.need, 50);
});

test('gradeFor: eşik altında not yok, en üstte next yok', () => {
  const set = mkSet();
  assert.equal(G.gradeFor(set, 0).grade, null);
  const top = G.gradeFor(set, 5000);
  assert.equal(top.grade, 'S');
  assert.equal(top.next, null);
  assert.equal(top.earned, 28);
});

// ---------------------------------------------------------------- fut.gg çözümü
test('planFromTier: sende olanlar düşülür, canlı fiyat fut.gg fiyatının yerine geçer', () => {
  const set = mkSet();
  const defs = [def(101, 110, true), def(102, 210, false), def(103, 300, false)];
  const p = G.planFromTier(set, 'B', defs, { 102: 1200, 103: 0 });
  assert.equal(p.missing, 2);
  assert.equal(p.need, 1200 + 1500);  // 102 canlı 1.200; 103 canlıda ilan yok (0) → fut.gg fiyatı
  assert.equal(p.priced, 2);
  assert.equal(p.noListing, 1);
  assert.equal(p.cards.find((c) => c.def === 101).sc, 110);   // eşitlenmiş kartta EA puanı
  assert.equal(p.cards.find((c) => c.def === 101).scSrc, 'EA');
  assert.equal(G.planFromTier(set, 'A', defs), null);         // çözümü olmayan not
});

test('pickGrade: hedeften aşağı ulaşılabilir ilk derece (coin, ilan, kazanılmış)', () => {
  const set = mkSet();
  const defs = [def(101, 100, true), def(102, 200, false), def(103, 300, false), def(104, 400, false)];
  // S eksikleri 900+1500+5000 = 7400; B eksikleri 900+1500 = 2400
  assert.equal(G.pickGrade(set, defs).g, 'S');                          // hedef yok → en yüksek
  let r = G.pickGrade(set, defs, null, 'S', 5000);
  assert.equal(r.g, 'B'); assert.equal(r.fell, true);                   // S'ye coin yetmiyor → B
  assert.equal(G.pickGrade(set, defs, null, 'A', null).g, 'B');         // A'nın çözümü yok → B
  assert.equal(G.pickGrade(set, defs, { 104: 0 }, 'S').g, 'B');         // S'de ilanı olmayan kart → B
  r = G.pickGrade(set, defs, null, 'S', 100);
  assert.equal(r.g, null); assert.equal(r.why, 'coins');                // D bile 0 (sende) ama D zaten kazanılmış
  const done = [def(102, 200, true), def(103, 300, true), def(104, 600, true)];
  assert.deepEqual(G.pickGrade(set, done, null, 'S'), { g: null, why: 'done' });   // 1100 ≥ S eşiği
  assert.equal(G.pickGrade({ ...set, filter: { unsupported: true } }, defs).why, 'none');
  assert.equal(G.pickGrade(set, null, null, null, 7400).g, 'S');        // eşitlenmemiş: tamamı sayılır
});

test('pickBatch: coin sırayla paylaşılır, yetmeyen set alt dereceye düşer', () => {
  const set = mkSet();
  const defs = [def(101, 100, true), def(102, 200, false), def(103, 300, false), def(104, 400, false)];
  const b = G.pickBatch([{ set, defs }, { set: { ...set, id: 2 }, defs }, { set: { ...set, id: 3 }, defs, grade: 'B' }], null, 'S', 10000);
  assert.deepEqual(b.rows.map((r) => r.g), ['S', 'B', null]);           // 7400 → kalan 2600 → B 2400 → kalan 200
  assert.equal(b.rows[2].why, 'coins');
  assert.equal(b.need, 7400 + 2400);
  assert.equal(b.cards, 3 + 2);
});

// ---------------------------------------------------------------- fiyat sınırı
test('roundBin: EA fiyat basamakları ve en düşük BIN', () => {
  assert.equal(G.roundBin(875), 850);
  assert.equal(G.roundBin(1250), 1200);
  assert.equal(G.roundBin(10149), 10000);
  assert.equal(G.roundBin(99999), 99500);
  assert.equal(G.roundBin(150), 200);
});

test('priceCap: canlı ×1,25; canlı yoksa fut.gg ×2 / +2.000; kullanıcı sınırı üst sınır', () => {
  assert.equal(G.priceCap({ live: 700, price: 500 }, 0), 850);        // 875 → 850
  assert.equal(G.priceCap({ price: 700 }, 0), 2700);                  // max(1.400, 2.700)
  assert.equal(G.priceCap({ price: 10000 }, 0), 20000);               // max(20.000, 12.000)
  assert.equal(G.priceCap({ price: 100000 }, 50000), 50000);          // kullanıcı sınırı
  assert.equal(G.priceCap({}, 0), 0);                                  // referans yok, ayar yok → sınır yok
  assert.equal(G.priceCap({}, 30000), 30000);
  // varsayılan 0: yalnız otomatik sınır (57.000 canlı → 71.250 → 71.000)
  assert.equal(G.MAX_CARD_DEFAULT, 0);
  assert.equal(G.priceCap({ live: 57000 }), 71000);
  // sınır her zaman canlı fiyatın altına inmez
  for (const live of [200, 350, 999, 1000, 4321, 49999, 50000, 123456]) assert.ok(G.priceCap({ live }, 0) >= live, String(live));
});

test('buyTargets: maxb = sınır, özel sürümde minb (sınırın altında)', () => {
  const [a, b] = G.buyTargets([
    { def: 1, name: 'A', rare: 0, price: 700 },
    { def: 2, name: 'B', rare: 3, price: 20000, live: 22000 },
  ], 0);
  assert.deepEqual(a.range, { maxb: 2700 });
  assert.equal(a.ref, 700);
  assert.equal(b.ref, 22000);
  assert.equal(b.range.maxb, 27500);
  assert.equal(b.range.minb, 11000);
  assert.ok(b.range.minb < b.range.maxb);
});

test('relistPrice: ödenen / piyasa ± yüzde, geçerli basamak', () => {
  assert.equal(G.relistPrice(700, null, {}), 700);
  assert.equal(G.relistPrice(700, 1000, { base: 'market', pct: -10 }), 900);
  assert.equal(G.relistPrice(200, null, { pct: -20 }), 200);
  assert.equal(G.relistPrice(150000, 200000, { base: 'market', pct: 5 }), 210000);
});

// ---------------------------------------------------------------- planlayıcı
test('tierOptions: desteklenmeyen set hiç seçenek üretmez; hepsi sendeyse "hazır"', () => {
  assert.deepEqual(G.tierOptions(mkSet({ filter: { unsupported: 'holographic' } }), []), []);
  const set = mkSet();
  const owned = [def(101, 100, true), def(102, 200, true), def(103, 300, true)];   // skor 600 → B
  const opts = G.tierOptions(set, owned);
  const s = opts.find((o) => o.g === 'S');
  assert.ok(s && !s.ready);            // 104 eksik
  assert.equal(s.gain, 28 - 5);        // kazanılan B (5) düşülür
  const est = G.tierOptions(set, null);
  assert.ok(est.every((o) => o.est && !o.ready));
});

test('planTokens: küçük örneklerde kaba kuvvetle aynı (en ucuz) sonucu verir, setten en fazla bir seçim', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 40; round++) {
    const groups = Array.from({ length: 4 }, (_, k) => Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({ setId: k, g: 'DCBAS'[i], gain: 1 + Math.floor(rand() * 20), cost: Math.floor(rand() * 1000) })));
    const target = 10 + Math.floor(rand() * 40);
    // kaba kuvvet
    let best = Infinity;
    const walk = (k, tok, cost) => {
      if (k === groups.length) { if (tok >= target) best = Math.min(best, cost); return; }
      walk(k + 1, tok, cost);
      for (const o of groups[k]) walk(k + 1, tok + o.gain, cost + o.cost);
    };
    walk(0, 0, 0);
    const r = G.planTokens(groups, { target });
    if (best === Infinity) { assert.equal(r.reached, false); continue; }
    assert.equal(r.reached, true);
    assert.equal(r.cost, best, 'round ' + round);
    assert.equal(new Set(r.picks.map((o) => o.setId)).size, r.picks.length);
  }
});

test('planTokens: bütçe modu bütçeyi aşmaz', () => {
  const groups = [[{ setId: 1, gain: 5, cost: 100 }, { setId: 1, gain: 20, cost: 900 }], [{ setId: 2, gain: 8, cost: 300 }]];
  const r = G.planTokens(groups, { budget: 450 });
  assert.ok(r.cost <= 450);
  assert.equal(r.tokens, 13);
  assert.deepEqual(G.planTokens([], { target: 5 }), { picks: [], tokens: 0, cost: 0, tax: 0, reached: false });
});

// ---------------------------------------------------------------- alınabilen token / puan
test('reachableTokens / reachableScore: desteklenmeyen sette bilinmiyor (null)', () => {
  const holo = mkSet({ filter: { unsupported: 'holographic' } });
  assert.equal(G.reachableTokens(holo), null);
  assert.equal(G.reachableScore(holo), null);
  const set = mkSet();
  assert.equal(G.reachableTokens(set, { earned: 5 }), 23);
  assert.equal(G.reachableScore(set, null), 200 + 300 + 400);
});

test('tokenRows: hazır seçenek "oyunda notlandır" satırı', () => {
  const t = makeT('tr');
  const rows = G.tokenRows(mkSet(), { earned: 0 }, { gain: 5, tax: 0, ready: true }, t, 100);
  assert.match(rows[0][1], /oyunda notlandır/);
  assert.equal(rows[0][2], 'ok');
});

// ---------------------------------------------------------------- ızgara
test('sortFilterSets: notlandırılacaklar filtresi ve sıralama', () => {
  const a = mkSet({ id: 1, maxTokens: 28 });
  const b = mkSet({ id: 2, maxTokens: 220 });
  const c = mkSet({ id: 3, maxTokens: 38, filter: { unsupported: 'x' } });
  const next = new Map([[2, { gain: 5, tax: 10, missing: 0, ready: true }]]);
  assert.deepEqual(G.sortFilterSets([a, b, c], {}, next, '', 'grade', { 1: Date.now() }).map((x) => x.id), [1, 2]);
  assert.deepEqual(G.sortFilterSets([a, b, c], {}, new Map(), 'max').map((x) => x.id), [2, 3, 1]);
  assert.deepEqual(G.sortFilterSets([a, b, c], {}, new Map(), '', 'unsynced').map((x) => x.id), [1, 2]);
});

test('nextMilestone ve fmtDur', () => {
  assert.deepEqual([0, 4, 5, 24, 25].map(G.nextMilestone), [5, 5, 10, 25, null]);
  const t = makeT('tr');
  assert.equal(G.fmtDur(59, t), '59 sn');
  assert.equal(G.fmtDur(125, t), '2 dk 5 sn');
  assert.equal(G.fmtDur(3725, t), '1 sa 2 dk');
});

// ---------------------------------------------------------------- katalog
test('katalog: yapı ve tutarlılık', () => {
  const cat = JSON.parse(readFileSync(new URL('../data/gallery-sets.json', import.meta.url), 'utf8'));
  assert.ok(cat.sets.length >= 100);
  assert.ok(Array.isArray(cat.categories) && cat.categories.length >= 5);
  const club = new Set(['premier-league', 'laliga', 'bundesliga', 'ligue-1', 'serie-a']);
  for (const s of cat.sets) {
    const f = s.filter;
    assert.ok(f && (f.teams || f.leagues || f.rarities || f.unsupported), s.slug + ': filtre');
    if (f.teams) assert.ok(club.has(s.cat), s.slug + ': kulüp filtresi yalnız lig kategorilerinde');
    for (let i = 1; i < s.grades.length; i++) assert.ok(s.grades[i].score > s.grades[i - 1].score, s.slug + ': eşik sırası');
    for (const t of s.sol?.tiers || []) {
      const cum = s.grades.slice(0, s.grades.findIndex((g) => g.g === t.g) + 1).reduce((a, g) => a + g.tokens, 0);
      assert.equal(t.tokens, cum, s.slug + ':' + t.g + ' kümülatif token');
      assert.ok(t.idx.length <= s.required && t.idx.every((i) => i < s.sol.cards.length), s.slug + ':' + t.g + ' kart');
    }
  }
});
