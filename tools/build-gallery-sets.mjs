// FC 27 Galeri set kataloğunu herkese açık fut.gg sayfalarından üretir → data/gallery-sets.json
// Çalıştırma: node tools/build-gallery-sets.mjs   (GitHub Actions her gün 21:00 TR'de çalıştırır)
//
// Sayfalar SSR ile gömülü bir veri bloğu taşıyor ("$R[n]={...}" nesne yazımı). Kod çalıştırmadan,
// yalnız düzenli ifadelerle okunur. Bir set sayfası okunamazsa o setin önceki değeri korunur;
// set sayısı belirgin şekilde düşerse dosya yazılmaz (bozuk katalog yayınlanmasın).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setScore, solCard } from '../lib/gallery.js';

const OUT = fileURLToPath(new URL('../data/gallery-sets.json', import.meta.url));
const BASE = 'https://www.fut.gg/fut-gallery/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const MIN_SETS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lig setleri: EA lig id'leri (Web App'teki lig sözlüğüyle doğrulandı).
const LEAGUE_IDS = {
  'premier-league': [13], 'laliga-ea-sports': [53], bundesliga: [19], 'serie-a-enilive': [31],
  'ligue-1-mcdonald-s': [16], 'barclays-wsl': [2216], 'liga-f-moeve': [2222],
  'frauen-bundesliga': [2215], 'arkema-pl': [2218],
};
// Nadirlik setleri: EA rareflag değerleri. Holografik ve Başlangıç seti Web App aramasıyla
// ayrıştırılamıyor (holografik bir kart özelliği; başlangıç seti binlerce sıradan kart) → yalnız bilgi.
const RARITY_FILTERS = {
  heroes: { rarities: [72] }, totw: { rarities: [3] }, 'squad-foundations': { rarities: [87] },
  holographics: { unsupported: 'holographic' }, 'starter-set': { unsupported: 'starter' },
};
// Kulüp filtresi yalnız bu lig kategorilerinde üretilir. Sezon içinde eklenecek bilinmeyen bir kategori (kampanya,
// promo…) kulüp seti sanılıp çözüm kartlarının takımlarıyla yanlış izlenmesin.
const CLUB_CATEGORIES = new Set(['premier-league', 'laliga', 'bundesliga', 'ligue-1', 'serie-a']);

// Sayfadaki kartların çoğu (≥%80) tek bir özel nadirlikteyse o nadirliğin filtresi
function rarityFromPage(page) {
  if (!page?.rarities?.size) return null;
  const total = [...page.rarities.values()].reduce((a, n) => a + n, 0);
  const [r, n] = [...page.rarities].sort((a, b) => b[1] - a[1])[0];
  return r > 1 && n / total >= 0.8 ? { rarities: [r] } : null;
}

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch (_) {}
    await sleep(2000 * i);
  }
  return null;
}

const num = (s) => (s == null || s === 'null' ? null : Number(s));
const str = (s) => s.replace(/\\"/g, '"').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function gender(desc) {
  if (/Mens or Womens/i.test(desc)) return 'mw';
  if (/Women'?s/i.test(desc)) return 'w';
  if (/Men'?s/i.test(desc)) return 'm';
  return null;
}

// Ana sayfa: kategoriler + her setin özet alanları.
function parseIndex(html) {
  const cats = [...html.matchAll(/\{id:(\d+),name:"((?:[^"\\]|\\.)*)",slug:"([^"]+)",priority:(\d+),sets:/g)]
    .map((m) => ({ id: +m[1], name: str(m[2]), slug: m[3], priority: +m[4] }));
  const setRe = /\{id:(\d+),categoryId:(\d+),name:"((?:[^"\\]|\\.)*)",slug:"([^"]+)",description:"((?:[^"\\]|\\.)*)",requiredCards:(\d+),priority:(\d+),startTime:(\d+),grades:\$R\[\d+\]=\[(.*?)\],clubEaId:(\d+|null),totalTokens:(\d+)\}/g;
  const sets = new Map();
  for (const m of html.matchAll(setRe)) {
    if (sets.has(+m[1])) continue;
    sets.set(+m[1], {
      id: +m[1], cat: +m[2], name: str(m[3]), slug: m[4], desc: str(m[5]), required: +m[6],
      priority: +m[7], start: +m[8],
      grades: [...m[9].matchAll(/name:"([DCBAS])",threshold:(\d+)/g)].map((g) => ({ g: g[1], score: +g[2] })),
      club: num(m[10]), maxTokens: +m[11],
    });
  }
  return { cats, sets: [...sets.values()] };
}

// Bonus etiketleri (her set sayfasında aynı liste): { id, name, rule: { type, attr, values }, tiers: [[enAz, yüzde]] }
function parseTags(html) {
  const i = html.indexOf('tags:$R', html.indexOf('category:$R'));
  if (i < 0) return null;
  const seg = html.slice(i, html.indexOf('capturedAt', i)).replace(/\$R\[\d+\]=/g, '');
  const tags = seg.split('{id:').slice(1).map((p) => {
    const r = p.match(/target:"(\w+)",type:"(\w+)",attribute:"(\w+)",values:\[([^\]]*)\]/);
    return {
      id: +p.split(',')[0], name: str(p.match(/name:"((?:[^"\\]|\\.)*)"/)?.[1] || ''),
      rule: r ? { type: r[2], attr: r[3], values: [...r[4].matchAll(/"([^"]*)"/g)].map((x) => x[1]) } : null,
      tiers: [...p.matchAll(/minItems:(\d+),bonus:(\d+)/g)].map((m) => [+m[1], +m[2]]),
    };
  }).filter((t) => t.rule && t.tiers.length);
  return tags.length ? tags : null;
}

// fut.gg'nin kendi önerdiği dizilimin puanı (öz denetim için): { base, bonus, defs }
function parseSolution(html) {
  const i = html.indexOf('solution:$R');
  if (i < 0) return null;
  const seg = html.slice(i, html.indexOf('costTiers', i));
  const base = seg.match(/baseGrade:(\d+)/);
  const bonus = seg.match(/bonusGrade:(\d+)/);
  if (!base || !bonus) return null;
  return { base: +base[1], bonus: +bonus[1], defs: [...seg.matchAll(/\{eaId:(\d+),playerEaId/g)].map((m) => +m[1]) };
}

// Sayfadaki fiyatlı kartlar (çözümler + önerilen dizilim): [eaId, baseId, overall, rarity, score, price, club, nation]
const CARD_RE = /\{eaId:(\d+),playerEaId:(\d+),score:(\d+),overall:(\d+),gender:\d,clubEaId:(\d+),nationEaId:(\d+),rarityEaId:(\d+),price:(\d+|null)/g;

// Set sayfası: not başına ödüller + sette sayılan kartların takım/nadirlik dağılımı.
function parseSetPage(html) {
  const i = html.indexOf('l:$R[14]={set:');
  if (i < 0) return null;
  const end = html.indexOf('category:$R', i);
  const head = html.slice(i, end > i ? end : i + 20000);
  const grades = {};
  const gRe = /\{name:"([DCBAS])",threshold:(\d+),level:\d+,rewards:\$R\[\d+\]=\[(.*?)\]\}(?=,\$R\[\d+\]=\{name:"|\],clubEaId)/g;
  for (const m of head.matchAll(gRe)) {
    let tokens = 0;
    const items = [];
    for (const r of m[3].matchAll(/type:"([^"]+)",value:(\d+),count:\d+,label:"((?:[^"\\]|\\.)*)"/g)) {
      if (r[1] === 'event_token_1') tokens += +r[2];
      else items.push(str(r[3]));
    }
    grades[m[1]] = { tokens, items };
  }
  const clubs = new Map();
  const rarities = new Map();
  for (const m of html.matchAll(/\{eaId:(\d+),playerEaId:\d+,score:\d+,overall:\d+,gender:\d,clubEaId:(\d+),nationEaId:\d+,rarityEaId:(\d+)/g)) {
    clubs.set(+m[2], (clubs.get(+m[2]) || 0) + 1);
    rarities.set(+m[3], (rarities.get(+m[3]) || 0) + 1);
  }
  return { grades, clubs, rarities, sol: parseTiers(html), solution: parseSolution(html) };
}

// fut.gg'nin her not için önerdiği en ucuz çözüm ("costTiers"). Yalnız ulaşılabilir notlar listeleniyor.
// Kartlar sette bir kez tutulur: [eaId (definitionId), baseId, overall, rarity, score, price, club, nation]
// (+ ekleAttrs: league, mevkiler, za, beceri, holo); kademe → idx. Kademede olmayan fiyatlı kartlar da
// tutulur (kendi çözücümüzün aday havuzu).
function parseTiers(html) {
  const cards = [];
  const at = new Map();
  const add = (c) => {
    const def = +c[1];
    if (!at.has(def)) { at.set(def, cards.length); cards.push([def, +c[2], +c[4], +c[7], +c[3], num(c[8]), +c[5], +c[6]]); }
    else if (c[8] !== 'null') cards[at.get(def)][5] = +c[8];
    return at.get(def);
  };
  const tiers = [];
  const tRe = /\{grade:"([DCBAS])",threshold:\d+,tokens:(\d+),cost:(\d+),peakPrice:\d+,status:"(\w+)",items:\$R\[\d+\]=\[(.*?)\]\}/g;
  for (const m of html.matchAll(tRe)) {
    if (tiers.some((t) => t.g === m[1])) continue;
    const idx = [...m[5].matchAll(CARD_RE)].map(add);
    if (idx.length) tiers.push({ g: m[1], cost: +m[3], tokens: +m[2], status: m[4], idx });
  }
  for (const c of html.matchAll(CARD_RE)) add(c);
  return tiers.length || cards.length ? { cards, tiers } : null;
}

// ---------------------------------------------------------------- kart özellikleri (bonus etiketleri için)
// Sayfada olmayanlar (lig, mevkiler, zayıf ayak, beceri, holografik) fut.gg kart API'sinden; önceki katalogda
// olan kartlar yeniden çekilmez (özellikler sezon içinde değişmez).
const POS = { 0: 'GK', 2: 'RWB', 3: 'RB', 5: 'CB', 7: 'LB', 8: 'LWB', 10: 'CDM', 12: 'RM', 14: 'CM', 16: 'LM', 18: 'CAM', 21: 'CF', 23: 'RW', 25: 'ST', 27: 'LW' };
const ATTR_API = 'https://www.fut.gg/api/fut/player-item-definitions/27/';
const ATTR_MAX = Number(process.env.ATTR_MAX || 6000);   // tek çalıştırmada en çok kart isteği

async function fetchAttrs(def) {
  for (let i = 1; i <= 2; i++) {
    try {
      const r = await fetch(`${ATTR_API}${def}/`, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (r.ok) {
        const d = (await r.json())?.data;
        if (!d) return null;
        const pos = [d.position, ...(d.alternativePositionIds || [])].map((p) => POS[p]).filter(Boolean);
        return [d.leagueEaId ?? null, pos.join('/') || null, d.weakFoot ?? null, d.skillMoves ?? null, d.holographicType ? 1 : 0];
      }
      if (r.status === 404) return null;
    } catch (_) {}
    await sleep(1500 * i);
  }
  return null;
}

function filterFor(set, catSlug, page) {
  if (catSlug === 'leagues') return LEAGUE_IDS[set.slug] ? { leagues: LEAGUE_IDS[set.slug] } : { unsupported: 'league' };
  if (catSlug === 'rarities') return RARITY_FILTERS[set.slug] || rarityFromPage(page) || { unsupported: 'rarity' };
  if (!CLUB_CATEGORIES.has(catSlug)) {
    const f = rarityFromPage(page) || { unsupported: 'category' };
    console.warn(`UYARI: bilinmeyen kategori "${catSlug}" → ${set.slug}: ${JSON.stringify(f)} (kontrol et)`);
    return f;
  }
  // Kulüp seti: sette görünen kartların takımları (≥3 kart). Ödüllerdeki takım id'si güvenilmez:
  // kadın setlerinde (ör. Birmingham City) ödül erkek takımını, kartlar kadın takımını gösteriyor.
  const teams = page ? [...page.clubs].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([id]) => id) : [];
  if (!teams.length && set.club) teams.push(set.club);
  return teams.length ? { teams } : { unsupported: 'club' };
}

// Kartlara lig/mevki/ZA/beceri/holo ekler: önceki katalogdan, yoksa fut.gg kart API'sinden (ATTR_MAX'a kadar).
async function addAttrs(sets, prev) {
  const known = new Map();
  for (const s of prev?.sets || []) for (const c of s.sol?.cards || []) if (c.length >= 13) known.set(c[0], c.slice(8, 13));
  const need = new Set();
  for (const s of sets) for (const c of s.sol?.cards || []) if (c.length < 13 && !known.has(c[0])) need.add(c[0]);
  let n = 0;
  let miss = 0;
  for (const def of need) {
    if (n++ >= ATTR_MAX) break;
    const a = await fetchAttrs(def);
    if (a) known.set(def, a); else miss++;
    await sleep(150 + Math.random() * 150);
  }
  for (const s of sets) {
    if (!s.sol?.cards) continue;
    s.sol = { ...s.sol, cards: s.sol.cards.map((c) => (c.length >= 13 ? c : known.has(c[0]) ? [...c.slice(0, 8), ...known.get(c[0])] : c)) };
  }
  console.log(`Kart özellikleri: ${need.size} yeni kart, ${Math.min(n, need.size) - miss} çekildi, ${miss} alınamadı`);
}

// Öz denetim: fut.gg'nin önerdiği dizilimi kendi motorumuzla puanla; fut.gg'nin taban/bonus değeriyle aynı olmalı.
function selfCheck(sets, tags, oracle) {
  let ok = 0;
  const bad = [];
  for (const s of sets) {
    const o = oracle.get(s.id);
    if (!o) continue;
    const by = new Map((s.sol?.cards || []).map((c) => [c[0], c]));
    if (!o.defs.every((d) => by.get(d)?.length >= 13)) continue;   // özellikleri eksik: denetlenemez
    const r = setScore(o.defs.map((d) => solCard(by.get(d))), tags);
    if (r.base === o.base && r.bonus === o.bonus) ok++;
    else bad.push(`${s.name}: taban ${r.base}/${o.base}, bonus ${r.bonus}/${o.bonus}`);
  }
  console.log(`Puan motoru öz denetimi: ${ok} set tuttu, ${bad.length} farklı`);
  for (const b of bad.slice(0, 10)) console.warn('UYARI: puan farkı — ' + b);
}

async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch (_) {}
  const prevById = new Map((prev?.sets || []).map((s) => [s.id, s]));

  const index = await get(BASE);
  if (!index) throw new Error('Ana sayfa alınamadı');
  const { cats, sets } = parseIndex(index);
  console.log(`${cats.length} kategori, ${sets.length} set`);
  if (sets.length < MIN_SETS) throw new Error(`Set sayısı çok düşük (${sets.length}) — sayfa yapısı değişmiş olabilir`);

  const catSlug = new Map(cats.map((c) => [c.id, c.slug]));
  // Yeni set / kategori uyarısı (sezon içinde EA set ekler; filtresi elle kontrol edilmeli)
  const prevCats = new Set((prev?.categories || []).map((c) => c.id));
  for (const c of cats) if (prev && !prevCats.has(c.slug)) console.warn(`UYARI: yeni kategori "${c.slug}" (${c.name})`);
  for (const s of sets) if (prev && !prevById.has(s.id)) console.warn(`UYARI: yeni set "${catSlug.get(s.cat)}/${s.slug}"`);
  const now = new Date().toISOString().slice(0, 16) + 'Z';
  const out = [];
  let failed = 0;
  let solMissing = 0;   // sayfası okundu ama çözümü ayrıştırılamadı (yapı değişmiş olabilir)
  let tags = null;
  const oracle = new Map();   // setId → fut.gg'nin önerdiği dizilimin puanı (öz denetim)
  for (const s of sets) {
    const slug = catSlug.get(s.cat);
    const html = await get(`${BASE}${slug}/${s.slug}/`);
    const page = html ? parseSetPage(html) : null;
    const old = prevById.get(s.id);
    if (!page || !Object.keys(page.grades).length) {
      failed++;
      if (old) { out.push(old); continue; }
    }
    if (page && !page.sol?.tiers.length) solMissing++;
    if (html && !tags) tags = parseTags(html);
    if (page?.solution) oracle.set(s.id, page.solution);
    out.push({
      id: s.id, slug: s.slug, cat: slug, name: s.name, required: s.required, gender: gender(s.desc),
      club: s.club, filter: filterFor(s, slug, page),
      grades: s.grades.map((g) => ({ ...g, tokens: page?.grades[g.g]?.tokens || 0, items: page?.grades[g.g]?.items || [] })),
      maxTokens: s.maxTokens, priority: s.priority,
      // sol.at: fiyatların çekildiği an; çözüm okunamazsa önceki (bayat) çözüm tarihiyle birlikte korunur
      sol: page?.sol?.tiers.length ? { at: now, ...page.sol } : old?.sol || null,
    });
    await sleep(700 + Math.random() * 800);
  }
  if (failed > sets.length / 4) throw new Error(`${failed} set sayfası okunamadı — dosya yazılmadı`);
  if (solMissing > sets.length / 2) throw new Error(`${solMissing} setin çözümü ayrıştırılamadı — fut.gg sayfa yapısı değişmiş olabilir, dosya yazılmadı`);

  await addAttrs(out, prev);
  tags = tags || prev?.tags || null;
  if (tags) selfCheck(out, tags, oracle);
  else console.warn('UYARI: bonus etiketleri ayrıştırılamadı — eklenti yalnız taban puan gösterir');

  const categories = cats.sort((a, b) => a.priority - b.priority).map(({ slug, name }) => ({ id: slug, name }));
  const body = { categories, tags, sets: out.sort((a, b) => a.cat.localeCompare(b.cat) || a.priority - b.priority) };
  // İçerik değişmediyse dosyaya dokunma (tarih yüzünden boş commit oluşmasın).
  if (prev && JSON.stringify({ categories: prev.categories, tags: prev.tags || null, sets: prev.sets }) === JSON.stringify(body)) {
    console.log('Değişiklik yok');
    return;
  }
  const json = { v: 1, season: 'fc27', updated: now, source: 'fut.gg', ...body };
  await writeFile(OUT, JSON.stringify(json, null, 1) + '\n');
  console.log(`Yazıldı: ${out.length} set (${failed} sayfa önceki değerden, ${solMissing} sette çözüm yok)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
