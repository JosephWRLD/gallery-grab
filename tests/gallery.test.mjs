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

// ---------------------------------------------------------------- bonus etiketleri
// fut.gg'nin önerdiği dizilimler (kart özellikleriyle) ve fut.gg'nin hesapladığı taban/bonus puanı
const FUTGG = JSON.parse(readFileSync(new URL('./fixtures/futgg-solutions.json', import.meta.url), 'utf8'));

test('setScore: fut.gg çözümlerinin taban + bonus puanıyla birebir', () => {
  for (const s of FUTGG.sets) {
    const r = G.setScore(s.cards.map(G.solCard), FUTGG.tags);
    assert.equal(r.base, s.base, s.name + ' taban');
    assert.equal(r.bonus, s.bonus, s.name + ' bonus');
  }
});

test('setScore: yalnız en yüksek 10 etiket sayılır', () => {
  const laliga = FUTGG.sets.find((s) => s.name.includes('laliga-ea-sports'));
  const r = G.setScore(laliga.cards.map(G.solCard), FUTGG.tags);
  const active = r.tags.filter((x) => x.bonus > 0);
  assert.ok(active.length > G.MAX_TAGS);
  assert.equal(r.tags.filter((x) => x.on).length, G.MAX_TAGS);
  const minOn = Math.min(...r.tags.filter((x) => x.on).map((x) => x.bonus));
  assert.ok(active.filter((x) => !x.on).every((x) => x.bonus <= minOn));
  // döküm: sayılmayanlar off, Türkçe adlar
  const rows = G.tagRows(r.tags);
  assert.equal(rows.filter((x) => x.off).length, active.length - G.MAX_TAGS);
  assert.ok(rows.some((x) => x.name === 'Orta Saha Kontrolü'));
});

test('summarise: etiketler varsa bonus dahil, dizilim bonusa göre seçilir', () => {
  // 2 kartlık set: en yüksek iki kart (100 + 95) yerine aynı ülkeden 100 + 94 → %10 bonusla daha yüksek
  const tags = [{ id: 3, name: 'Same Nation', rule: { type: 'MAX_COUNT_ALL_SAME', attr: 'NATION', values: ['0'] }, tiers: [[2, 10]] }];
  const set = mkSet({ required: 2, tags });
  const defs = [def(1, 100, true, { nation: 7 }), def(2, 95, true, { nation: 8 }), def(3, 94, true, { nation: 7 })];
  const s = G.summarise(set, defs);
  assert.deepEqual(s.lineup.map((d) => d.def).sort(), [1, 3]);
  assert.equal(s.base, 194);
  assert.equal(s.bonus, 19);
  assert.equal(s.score, 213);
  // etiket yoksa eski davranış: ilk N taban puan
  assert.equal(G.summarise(mkSet({ required: 2 }), defs).score, 195);
});

test('bestLineup: puanı düşük ama etiketi tamamlayan kartlar (aday sınırının dışında olsa da) seçilir', () => {
  // 20 altın kart (70) varken 3 bronz kart (40, %80 Bronz) → 120 + 96 = 216 > 210
  const tags = [{ id: 4, name: 'Bronze', rule: { type: 'COUNT', attr: 'LEVEL', values: ['bronze'] }, tiers: [[3, 80]] }];
  const set = mkSet({ required: 3, tags });
  const defs = [...Array.from({ length: 20 }, (_, i) => def(100 + i, 70, true, { r: 80 })), ...[1, 2, 3].map((i) => def(i, 40, true, { r: 60 }))];
  const s = G.summarise(set, defs);
  assert.deepEqual(s.lineup.map((d) => d.def).sort(), [1, 2, 3]);
  assert.equal(s.score, 216);
  assert.equal(G.setScore(s.lineup, tags).total, s.live);
});

test('withAttrs: EA kartında olmayan holografik/mevki bilgisi katalogdan gelir', () => {
  const set = mkSet({ sol: { cards: [[101, 101, 89, 3, 500, 1000, 1, 7, 13, 'LW/ST', 5, 4, 1]], tiers: [] } });
  const [d] = G.withAttrs(set, [def(101, 500, true, { nation: 9 })]);
  assert.equal(d.holo, true);
  assert.deepEqual(d.pp, ['LW', 'ST']);
  assert.equal(d.nation, 9);   // EA'nın değeri korunur
  assert.equal(d.wf, 5);
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

test('priceCap: canlı ×1,25; canlı yoksa fut.gg ×1,4 / +2.000; kullanıcı sınırı üst sınır', () => {
  assert.equal(G.priceCap({ live: 700, price: 500 }, 0), 850);        // 875 → 850
  assert.equal(G.priceCap({ price: 700 }, 0), 2700);                  // max(980, 2.700)
  assert.equal(G.priceCap({ price: 10000 }, 0), 14000);               // max(14.000, 12.000)
  assert.equal(G.priceCap({ price: 23000 }, 0), 32000);               // Veerman: eskiden 46.000
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
  assert.equal(a.gg, 700);
  assert.equal(b.gg, 20000);
  assert.equal(a.rare, 0);
  assert.equal(b.rare, 3);
  assert.equal(b.ref, 22000);
  assert.equal(b.range.maxb, 27500);
  assert.equal(b.range.minb, 11000);
  assert.ok(b.range.minb < b.range.maxb);
});

test('suspiciousPrice: fut.gg ×1,4 üstü + kesinleşmemiş arama', () => {
  assert.equal(G.suspiciousPrice(46000, 23000, false), true);    // Veerman
  assert.equal(G.suspiciousPrice(46000, 23000, true), false);    // daha ucuzu yok kesin → gerçek fiyat
  assert.equal(G.suspiciousPrice(30000, 23000, false), false);   // ×1,4 içinde
  assert.equal(G.suspiciousPrice(2700, 700, false), false);      // ucuz kart: fut.gg < 1.000
  assert.equal(G.suspiciousPrice(5000, 0, false), false);        // referans yok
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

test('solveGrade: tam N kart, sendekiler bedava, bonusla daha ucuz dizilim, fut.gg kademesinden pahalı değil', () => {
  // 3 kartlık set, C eşiği 300. Havuz: [def, base, ovr, rare, score, price, club, nation, league, ...]
  const tags = [{ id: 3, name: 'Same Nation', rule: { type: 'MAX_COUNT_ALL_SAME', attr: 'NATION', values: ['0'] }, tiers: [[3, 20]] }];
  const cards = [
    [11, 11, 80, 1, 120, 900, 1, 7, 13], [12, 12, 80, 1, 120, 900, 1, 8, 13], [13, 13, 80, 1, 120, 900, 1, 9, 13],
    [21, 21, 78, 1, 90, 300, 1, 7, 13], [22, 22, 78, 1, 90, 300, 1, 7, 13], [23, 23, 78, 1, 90, 300, 1, 7, 13],
  ];
  const set = mkSet({ required: 3, tags, sol: { cards, tiers: [{ g: 'C', tokens: 0, cost: 2700, idx: [0, 1, 2] }] } });
  // sahiplik yok: 3 × 90 = 270 + %20 (aynı ülke) = 324 ≥ 300 → 900 coin (fut.gg 2700)
  const p = G.solveGrade(set, 'C');
  assert.equal(p.cards.length, 3);
  assert.equal(p.need, 900);
  assert.ok(p.sumSc >= 300 && p.sumBonus > 0);
  assert.ok(p.need <= G.planFromTier(set, 'C').cost);
  // sende 21 ve 22 var → yalnız 23 alınır (300)
  const defs = [21, 22].map((d) => def(d, 90, true, { nation: 7, team: 1 }));
  const q = G.solveGrade(set, 'C', defs);
  assert.equal(q.missing, 1);
  assert.equal(q.need, 300);
  assert.equal(q.cards.filter((c) => c.col).length, 2);
  // kümülatif token (fut.gg kademesi gibi)
  assert.equal(G.solveGrade({ ...set, grades: grades(['D', 10, 2], ['C', 300, 3], ['B', 500, 5]) }, 'C').tokens, 5);
});

test('solveGrade: havuz N karttan azsa ya da eşik aşılamıyorsa ulaşılamaz', () => {
  const set = mkSet({ required: 3, sol: { cards: [[1, 1, 80, 1, 100, 500], [2, 2, 80, 1, 100, 500]], tiers: [] } });
  assert.ok(G.solveGrade(set, 'D').unreachable);
  const set2 = mkSet({ required: 2, sol: { cards: [[1, 1, 80, 1, 100, 500], [2, 2, 80, 1, 100, 500]], tiers: [] } });
  assert.equal(G.solveGrade(set2, 'D').need, 1000);
  assert.ok(G.solveGrade(set2, 'C').unreachable);   // 200 < 300
  // ilanı olmayan (canlı fiyat 0) ve fiyatsız kartlar havuza girmez
  assert.ok(G.solveGrade(set2, 'D', null, { 1: 0 }).unreachable);
});

test('overviewLists: en ucuz token, tamamlanmaya en yakın, en yüksek not ve bütçe planı', () => {
  const a = mkSet({ id: 1, name: 'A' });
  const b = mkSet({ id: 2, name: 'B' });
  const u = mkSet({ id: 3, name: 'U', filter: { unsupported: true } });
  const defsB = [def(101, 100, true), def(102, 200, true), def(103, 300, false), def(104, 400, false)];
  const sB = G.summarise(b, defsB);
  const sums = { 2: { collected: sB.collected, required: b.required, score: sB.score, earned: sB.earned } };
  const defsOf = (id) => (id === 2 ? defsB : null);
  const L = G.overviewLists([a, b, u], sums, defsOf, { coins: 2000 });
  // desteklenmeyen set hiçbir listede yok
  assert.ok(![...L.cheap, ...L.top, ...L.close].some((r) => r.set.id === 3));
  // A eşitlenmedi: token başına en ucuz S (7401/28 < 3101/5)
  assert.equal(L.cheap.find((r) => r.set.id === 1).g, 'S');
  // en yüksek not ucuzdan pahalıya: B setinde 102 sende → S yalnız 103+104 (6.500), A'da 7.400
  assert.deepEqual(L.top.map((r) => [r.set.id, r.cost]), [[2, 6500], [1, 7400]]);
  // tamamlanmaya en yakın: yalnız eşitlenmiş B, 1 boş yuva en ucuz kartla (103 → 1.500), B notu → +5 token
  assert.equal(L.close.length, 1);
  assert.equal(L.close[0].left, 1);
  assert.equal(L.close[0].cost, 1500);
  assert.equal(L.close[0].gain, 5);
  // canlı fiyat fut.gg'yi ezer
  assert.equal(G.overviewLists([b], sums, defsOf, { live: { 103: 900 } }).close[0].cost, 900);
  // 2.000 coin: yalnız B setinin B notu (1.500) sığar
  assert.equal(L.plan.tokens, 5);
  assert.deepEqual(L.plan.picks.map((o) => [o.setId, o.g]), [[2, 'B']]);
  assert.equal(G.overviewLists([a], {}, () => null).plan, null);
});
