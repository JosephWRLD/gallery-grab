import { loadCatalog } from './lib/catalog.js';
import {
  summarise, cheapestFill, counted as countedOf, GRADES, baseOf,
  syncEstimate, fmtDur, planFromTier, defaultTier, bestNext, tierOptions, planTokens, HALL_OF_FUT,
  sortOptions, showOptions, sortFilterSets, tokenLabel, tokenRows, overview, reachableScore, nextMilestone,
} from './lib/gallery.js';
import { makeT, detectLang, localeOf, LANGS, FLAGS } from './lib/i18n.js';
import { imgUrls } from './lib/img.js';

const $ = (id) => document.getElementById(id);
let lang = detectLang();
let t = makeT(lang);
let loc = localeOf(lang);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString(loc));
const kfmt = (n) => {
  const d = lang === 'en' ? '.' : ',';
  return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', d) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace('.', d) + 'K' : String(n);
};
const dt = (ms) => new Date(ms).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
const send = (msg) => chrome.runtime.sendMessage(msg);
const PRICE_TTL = 30 * 60 * 1000;

const embedded = new URLSearchParams(location.search).has('embedded');
if (embedded) {
  document.body.classList.add('embedded');
  parent.postMessage({ source: 'fcg-panel', type: 'ready' }, '*');
}

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el[k] = v;
  }
  for (const c of [].concat(children)) if (c != null && c !== false) el.append(c);
  return el;
}
function icon(src, cls, alt) {
  if (!src) return null;
  const el = h('img', { class: cls, src, loading: 'lazy', alt: '' });
  el.onerror = () => { if (alt && el.src !== alt) { el.src = alt; return; } el.style.visibility = 'hidden'; };
  return el;
}
// Çalışan görev varken devre dışı kalacak düğme
function taskBtn(props) {
  const b = h('button', props);
  b.dataset.task = '1';
  b.disabled = b.disabled || !!state.galleryRun?.running;
  return b;
}

// Sabit metinler (gallery.html data-i18n*) + seçim kutuları
function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  $('sort').replaceChildren(...sortOptions(t).map(([v, x]) => h('option', { value: v, text: x })));
  $('show').replaceChildren(...showOptions(t).map(([v, x]) => h('option', { value: v, text: x })));
  $('lang').replaceChildren(...LANGS.map(([v, x]) => {
    const b = h('button', { class: v === lang ? 'on' : '', title: x, onclick: () => { if (v !== lang) { setLang(v); send({ type: 'setLang', value: v }); } } });
    b.append(document.importNode(new DOMParser().parseFromString(FLAGS[v], 'image/svg+xml').documentElement, true));
    return b;
  }));
}
function setLang(l) {
  lang = l === 'en' ? 'en' : 'tr';
  t = makeT(lang);
  loc = localeOf(lang);
  applyStatic();
  render();
  if (!$('md').hidden) closeModal();
}

let CAT = null;
let tab = null;
let openId = null;
let openGrade = null;     // detayda seçili not sekmesi
let confirmBuy = false;
let cardFilter = 'all';   // detay: all | missing | collected
let listOpen = false;     // detay: "Setteki tüm kartlar" açık mı (yeniden çizimde kapanmasın)
let scrolledTab = null;   // sekme çubuğu yalnız sekme değişince kaydırılır
let state = {};
let sortBy = '';
let show = 'all';
const DEFS = new Map();   // setId → defs (gdefs:<id> önbelleği)
const RECENT = 6 * 60 * 60 * 1000;

try {
  tab = localStorage.getItem('fcg-tab');
  sortBy = localStorage.getItem('fcg-sort') || '';
  show = localStorage.getItem('fcg-show') || 'all';
} catch (_) {}

async function loadAllDefs() {
  const keys = CAT.sets.map((x) => 'gdefs:' + x.id);
  const got = await chrome.storage.local.get(keys);
  DEFS.clear();
  for (const x of CAT.sets) if (!x.filter?.unsupported && got['gdefs:' + x.id]) DEFS.set(x.id, got['gdefs:' + x.id].defs);
}

// Arma / lig görseli / nadirlik harfi
function setArt(set, img, cls = 'crest') {
  const f = set.filter || {};
  if (f.teams) { const tm = set.club || f.teams[0]; return icon(img.crest(tm), cls, img.crestAlt(tm)); }
  if (f.leagues) return icon(img.league(f.leagues[0]), cls, img.leagueAlt(f.leagues[0]));
  return h('div', { class: 'ph', text: set.name.slice(0, 1) });
}

function diamonds(set, grade) {
  const got = new Set();
  for (const g of set.grades) { got.add(g.g); if (g.g === grade) break; }
  return h('div', { class: 'grades' }, GRADES.filter((g) => set.grades.some((x) => x.g === g)).map((g) =>
    h('div', { class: `gd ${g}${grade && got.has(g) ? (g === grade ? ' cur' : ' got') : ''}`, title: gradeTitle(set, g) }, [h('span', { text: g })])));
}
function gradeTitle(set, g) {
  const x = set.grades.find((y) => y.g === g);
  if (!x) return g;
  const rw = [x.tokens ? t('tokens', { n: x.tokens }) : null, ...(x.items || [])].filter(Boolean).join(', ');
  return t('grade.title', { g, score: fmt(x.score) }) + (rw ? ' — ' + rw : '');
}

function renderTabs() {
  $('tabs').replaceChildren(...CAT.categories.map((c) => h('button', {
    class: c.id === tab ? 'on' : '', text: c.name,
    onclick: () => { tab = c.id; try { localStorage.setItem('fcg-tab', tab); } catch (_) {} render(); },
  })));
  // Yalnız sekme değişince ve yalnız yatay kaydır (scrollIntoView her çizimde sayfayı sekmelere zıplatıyordu)
  if (scrolledTab !== tab) {
    scrolledTab = tab;
    const on = $('tabs').querySelector('.on');
    const bar = $('tabs');
    if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
      bar.scrollLeft = Math.max(0, on.offsetLeft - 8);
    }
  }
}

function card(set, sum, img) {
  const unsupported = set.filter?.unsupported;
  const full = sum && sum.collected >= sum.required;
  const toGrade = !!state.galleryToGrade?.[set.id] || !!NEXT.get(set.id)?.ready;
  return h('div', { class: 'set' + (full ? ' full' : ''), onclick: () => openDetail(set.id) }, [
    full ? h('span', { class: 'chk', text: '✓' }) : null,
    toGrade ? h('span', { class: 'gbadge', text: t('grade.badge'), title: t('ov.toGrade.title') }) : null,
    h('div', { class: 'hd' }, [
      setArt(set, img),
      h('div', {}, [
        h('div', { class: 'nm', text: set.name }),
        h('div', { class: 'cnt', text: sum ? t('card.collected', { n: sum.collected, req: set.required }) : `— / ${set.required}` }),
        sum ? h('div', { class: 'sc', title: t('card.score') }, [h('i', { class: 'dia' }), fmt(sum.score)])
          : h('div', { class: 'note', text: unsupported ? t('card.untrackable') : t('card.unsynced') }),
      ]),
    ]),
    diamonds(set, sum?.grade),
    h('div', { class: 'tk', title: NEXT.get(set.id)?.est ? t('card.est') : '' }, tokenRows(set, sum, NEXT.get(set.id), t, reachableScore(set, DEFS.get(set.id) || null)).flatMap(([l, v, c]) => [h('span', { text: l }), h('b', { class: c, text: v })])),
  ]);
}
const NEXT = new Map();
function computeNext() {
  NEXT.clear();
  for (const x of CAT.sets) { const n = bestNext(x, DEFS.get(x.id) || null); if (n) NEXT.set(x.id, n); }
}

const summaryEarned = (set, s) => s.earned ?? set.grades.filter((g) => s.score >= g.score).reduce((a, g) => a + (g.tokens || 0), 0);

async function render() {
  if (!CAT) return;
  state = await chrome.storage.local.get(['gallerySummary', 'galleryRun', 'gallerySettings', 'galleryMeta', 'galleryBuySpent', 'gallerySyncStats', 'galleryLevel', 'galleryToGrade']);
  if (!CAT.categories.some((c) => c.id === tab)) tab = CAT.categories[0].id;
  renderTabs();
  const img = imgUrls(state.galleryMeta?.imgBase);
  const sums = state.gallerySummary || {};
  const sets = CAT.sets.filter((s) => s.cat === tab);
  computeNext();
  const shown = sortFilterSets(sets, sums, NEXT, sortBy, show, state.galleryToGrade || {});
  $('grid').replaceChildren(...(shown.length ? shown.map((s) => card(s, sums[s.id], img)) : [h('div', { class: 'empty', text: sets.length ? t('grid.emptyFilter') : t('grid.empty') })]));
  $('sort').value = sortBy;
  $('show').value = show;

  const synced = sets.filter((s) => sums[s.id]);
  const earned = synced.reduce((a, s) => a + (summaryEarned(s, sums[s.id]) || 0), 0);
  const last = Math.max(0, ...synced.map((s) => sums[s.id].at || 0));
  $('tabInfo').replaceChildren(
    t('tab.info', { synced: synced.length, all: sets.length }), h('b', { text: `${earned}` }), t('tab.max', { max: sets.reduce((a, s) => a + s.maxTokens, 0) }),
    last ? t('tab.last', { d: dt(last) }) : '',
  );
  $('catInfo').textContent = t('cat', { d: catDate() });
  renderOverview(sums, sets);

  renderBar();
  if (openId) renderDetail();
}
// Üst özet: tüm galeri (büyük) + seçili sekme (küçük)
function renderOverview(sums, tabSets) {
  if (document.activeElement?.classList?.contains('lvin')) return;   // seviye yazılırken yeniden çizme
  const all = overview(CAT.sets, sums, (id) => DEFS.get(id) || null);
  const tb = overview(tabSets, sums, (id) => DEFS.get(id) || null);
  const box = (label, value, sub, cls = '', title = '') => h('div', { title }, [
    h('div', { class: 'l', text: label }), h('div', { class: 'v ' + cls, text: value }), sub ? h('div', { class: 's', text: sub }) : null,
  ]);
  const lv = state.galleryLevel || 0;
  const nm = nextMilestone(lv);
  const lvIn = h('input', { type: 'number', min: 0, max: 25, value: lv || '', placeholder: t('ov.level.ph'), class: 'lvin',
    onchange: (e) => chrome.storage.local.set({ galleryLevel: Math.max(0, Math.min(25, Math.floor(Number(e.target.value) || 0))) }) });
  $('ovw').replaceChildren(
    h('div', { title: t('ov.level.title') }, [h('div', { class: 'l', text: t('ov.level') }), h('div', { class: 'v a' }, [lvIn, h('span', { class: 'of', text: ' / 25' })]),
      h('div', { class: 's', text: lv ? (nm ? t('ov.level.next', { n: nm }) : t('ov.level.max')) : '' })]),
    box(t('ov.score'), fmt(all.score), t('ov.synced', { n: all.synced, m: all.total }), 'g', t('ov.score.title')),
    box(t('ov.earned'), fmt(all.earned), t('ov.tab', { v: fmt(tb.earned) }), 'g'),
    box(t('ov.reachPts'), '+' + fmt(all.reachPts), t('ov.tab', { v: '+' + fmt(tb.reachPts) }), 'g', t('ov.reachPts.title')),
    box(t('ov.reach'), fmt(all.reach), t('ov.reachCost', { c: kfmt(all.reachCost), t: kfmt(all.reachTax) }) + ' · ' + t('ov.tab', { v: fmt(tb.reach) }), 'a', t('ov.reach.title')),
    box(t('ov.max'), fmt(all.max), t('ov.tab', { v: fmt(tb.max) })),
    box(t('ov.sets'), `${all.done}/${all.total}`, t('ov.tab', { v: `${tb.done}/${tb.total}` })),
    gradeBox(),
  );
}
// "Oyunda notlandırılacak": kart alınan setler + çözüm kartlarının hepsi sende olanlar (tıklayınca listelenir)
function gradeBox() {
  const marked = state.galleryToGrade || {};
  const n = CAT.sets.filter((x) => marked[x.id] || NEXT.get(x.id)?.ready).length;
  const b = h('div', { class: 'click', title: t('ov.toGrade.title'), onclick: () => { show = 'grade'; try { localStorage.setItem('fcg-show', show); } catch (_) {} render(); } }, [
    h('div', { class: 'l', text: t('ov.toGrade') }), h('div', { class: 'v ' + (n ? 'a' : ''), text: String(n) }), h('div', { class: 's', text: t('ov.toGrade.sub') }),
  ]);
  return b;
}
const solDate = (set) => (set.sol?.at ? new Date(set.sol.at).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' }) : catDate());
function solAge(set) {
  const at = set.sol?.at ? Date.parse(set.sol.at) : null;
  const days = at ? Math.floor((Date.now() - at) / 86400000) : 0;
  return days >= 2 ? t('sol.old', { n: days }) : '';
}
const catDate = () => (CAT.updated ? new Date(CAT.updated.length > 10 ? CAT.updated : CAT.updated + 'T00:00Z').toLocaleString(loc, { dateStyle: 'short', timeStyle: CAT.updated.length > 10 ? 'short' : undefined }) : '?');

function renderBar() {
  const run = state.galleryRun || {};
  const st = state.gallerySettings || {};
  $('coins').textContent = fmt(run.coins);
  $('spent').textContent = fmt(state.galleryBuySpent || 0);
  if (document.activeElement !== $('budget')) $('budget').value = st.galleryBudget || '';
  if (document.activeElement !== $('maxCard')) $('maxCard').value = st.maxCard ?? 50000;
  $('afterBuy').value = st.afterBuy || 'relist';
  const rl = st.relist || {};
  $('relistBox').hidden = (st.afterBuy || 'relist') !== 'relist';
  $('relBase').value = rl.base || 'paid';
  $('relPct').value = String(rl.pct || 0);
  $('relDur').value = String(rl.dur || 3600);
  $('status').textContent = run.text || t('ready');
  $('status').className = 'st ' + (run.level || '');
  $('status').title = run.text || '';
  const running = !!run.running;
  $('stop').hidden = !running;
  $('syncAll').disabled = running;
  document.querySelectorAll('[data-task]').forEach((b) => { b.disabled = running; });
}

// ---------------------------------------------------------------- "Tümünü eşitle" onayı
let skipRecent = true;
function openSyncConfirm() {
  const sums = state.gallerySummary || {};
  const all = CAT.sets.filter((s) => !s.filter?.unsupported);
  const sets = skipRecent ? all.filter((s) => !(sums[s.id]?.at > Date.now() - RECENT)) : all;
  const skipped = all.length - sets.length;
  const est = syncEstimate(sets, sums, state.gallerySyncStats?.secPerReq);
  const k = est.kinds;
  const measured = !!state.gallerySyncStats?.secPerReq;
  const avg = (est.sec / Math.max(1, est.sets)).toFixed(1).replace('.', lang === 'en' ? '.' : ',');
  $('mdBox').replaceChildren(
    h('h3', { text: t('sync.title') }),
    h('div', {}, [h('b', { text: t('sync.sets', { n: est.sets }) }), t('sync.body', { c: k.club, l: k.league, r: k.rarity, q: est.reqs })]),
    h('div', { class: 'big', text: `~${fmtDur(est.sec, t)}` }),
    h('div', { class: 'note', text: t('sync.avg', { s: avg }) + (measured ? t('sync.measured') : t('sync.first')) + t('sync.keep') }),
    h('label', { class: 'kv', style: 'display:block;margin-top:10px' }, [
      h('input', { type: 'checkbox', checked: skipRecent, style: 'width:auto', onchange: (e) => { skipRecent = e.target.checked; openSyncConfirm(); } }),
      t('sync.skip') + (skipped ? t('sync.skipped', { n: skipped }) : ''),
    ]),
    h('div', { class: 'row' }, [
      h('button', { class: 'g', text: t('cancel'), onclick: closeModal }),
      h('button', { class: 'b', text: sets.length ? t('sync.start') : t('sync.none'), disabled: !sets.length, onclick: () => { closeModal(); send({ type: 'syncSets', ids: sets.map((s) => s.id) }); } }),
    ]),
  );
  $('mdBox').className = 'box';
  $('md').hidden = false;
}
// ---------------------------------------------------------------- teşhis
// Kullanıcı oyunda notlandırdığı bir seti seçer; EA'nın döndürdüğü toplanma bilgisi rapor olarak kopyalanır.
let diagId = null;
function openDiag() {
  const sets = CAT.sets.filter((s) => !s.filter?.unsupported).slice().sort((a, b) => a.name.localeCompare(b.name, loc));
  const sums = state.gallerySummary || {};
  if (diagId == null) diagId = (sets.find((s) => s.filter?.teams) || sets[0])?.id ?? null;
  const out = h('textarea', { class: 'diag', readOnly: true, placeholder: t('diag.ph') });
  const run = h('button', { class: 'b', text: t('diag.run') });
  const all = h('button', { class: 'g', text: t('diag.all'), title: t('diag.all.title') });
  const copy = h('button', { class: 'g', text: t('diag.copy'), disabled: true });
  let armed = false, poll = null;
  const go = async (full) => {
    run.disabled = true;
    out.value = t('diag.running');
    if (full) {
      all.textContent = t('diag.stop');
      all.onclick = () => send({ type: 'diagStop' });
      poll = setInterval(async () => {
        const { galleryDiagRun: p } = await chrome.storage.local.get('galleryDiagRun');
        if (p) out.value = t('diag.progress', { i: p.i + 1, n: p.n });
      }, 1000);
    }
    const r = await send({ type: 'diagnose', id: diagId, all: full }).catch((e) => ({ ok: false, error: e.message }));
    clearInterval(poll);
    out.value = r?.ok ? r.text : t('diag.fail', { e: r?.error || t('error') });
    run.disabled = false;
    copy.disabled = !r?.ok;
    armed = false;
    all.textContent = t('diag.all');
    all.onclick = arm;
  };
  run.onclick = () => go(false);
  // Genel tarama iki adımlı: önce süre tahmini, ikinci tıkta başlar
  const arm = async () => {
    if (armed) return go(true);
    const e = await send({ type: 'diagEstimate' }).catch(() => null);
    if (!e?.ok) return;
    armed = true;
    all.textContent = t('diag.all.confirm', { d: fmtDur(e.reqs * 1.3 + e.sets * 0.5, t) });
    out.value = t('diag.all.note', { sets: e.sets, reqs: e.reqs });
  };
  all.onclick = arm;
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(out.value); copy.textContent = t('diag.copied'); }
    catch (_) { out.select(); }
    setTimeout(() => { copy.textContent = t('diag.copy'); }, 1500);
  };
  $('mdBox').replaceChildren(
    h('h3', { text: t('diag.title') }),
    h('div', { class: 'note', text: t('diag.body') }),
    h('label', { class: 'kv', style: 'display:block;margin-top:10px' }, [
      t('diag.set') + ' ',
      h('select', { onchange: (e) => { diagId = Number(e.target.value); } },
        sets.map((s) => h('option', { value: String(s.id), selected: s.id === diagId, text: s.name + (sums[s.id] ? ` (${sums[s.id].collected}/${sums[s.id].total})` : '') }))),
    ]),
    out,
    h('div', { class: 'row' }, [h('button', { class: 'g', text: t('close'), onclick: closeModal }), all, copy, run]),
  );
  $('mdBox').className = 'box wide';
  $('md').hidden = false;
}
function closeModal() { $('md').hidden = true; send({ type: 'diagStop' }).catch(() => {}); }   // açık genel tarama varsa durur
$('md').addEventListener('click', (e) => { if (e.target === $('md')) closeModal(); });

// ---------------------------------------------------------------- detay
function openDetail(id) { openId = id; openGrade = null; confirmBuy = false; cardFilter = 'all'; listOpen = false; $('ov').hidden = false; renderDetail(); }
function closeDetail() { openId = null; $('ov').hidden = true; }
$('ov').addEventListener('click', (e) => { if (e.target === $('ov')) closeDetail(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('md').hidden) closeModal(); else if (openId) closeDetail();
});

// fut.gg çözüm sekmeleri: her not için coin + token; çözümü olmayan not "ulaşılamaz"
function gradeTabs(set, sum, defs, prices) {
  return h('div', { class: 'gtabs' }, set.grades.map((g) => {
    const p = planFromTier(set, g.g, defs, prices);
    const got = sum && sum.score >= g.score;
    return h('div', {
      class: `gt ${g.g}${g.g === openGrade ? ' on' : ''}${p ? '' : ' na'}${got ? ' got' : ''}`,
      title: gradeTitle(set, g.g),
      onclick: () => { if (!p) return; openGrade = g.g; confirmBuy = false; renderDetail(); },
    }, [
      h('b', { text: g.g }),
      h('div', { class: 'c', text: p ? t('coins', { n: fmt(defs ? p.need : p.cost) }) : t('unreachable') }),
      h('div', { class: 't', text: t('tokens', { n: p ? p.tokens : g.tokens || 0 }) }),
    ]);
  }));
}

function solutionBox(set, plan, img, sum) {
  const stats = h('div', { class: 'stats6' }, [
    h('div', { title: plan.priced ? t('st.need.title.live') : t('st.need.title.futgg') }, [
      plan.priced ? t('st.need.live', { p: plan.priced, m: plan.missing }) : t('st.need.futgg'),
      h('b', { text: plan.synced ? fmt(plan.need) : '—' })]),
    h('div', {}, [t('st.total'), h('b', { text: fmt(plan.cost) })]),
    h('div', {}, [t('st.tax'), h('b', { text: plan.synced ? fmt(plan.tax) : fmt(Math.ceil(plan.cost * 0.05)) })]),
    h('div', { title: t('st.sumPts.title') }, [t('st.sumPts'), h('b', { text: `${fmt(plan.sumSc)} / ${fmt(plan.threshold)}` })]),
    h('div', {}, [t('st.tokens'), h('b', { text: String(plan.tokens) })]),
    h('div', {}, [t('st.cards'), h('b', { text: plan.synced ? t('st.have', { h: plan.cards.length - plan.missing, n: plan.cards.length }) : String(plan.cards.length) })]),
  ]);
  const chips = plan.synced ? h('div', { class: 'chips' }, [['all', plan.cards.length], ['missing', plan.missing], ['collected', plan.cards.length - plan.missing]].map(([k, n]) =>
    h('button', { class: cardFilter === k ? 'on' : '', text: `${t('chip.' + k)} (${n})`, onclick: () => { cardFilter = k; renderDetail(); } }))) : null;
  const cards = h('div', { class: 'solg' }, plan.cards
    .filter((c) => cardFilter === 'all' || (cardFilter === 'missing' ? !c.col : c.col))
    .slice().sort((a, b) => (a.col - b.col) || b.price - a.price)
    .map((c) => h('div', { class: 'sc2' + (c.col ? ' col' : '') + (c.rare > 1 ? ' sp' : ''), title: t('card.tip', { name: c.name || '#' + c.def, r: c.r, sc: fmt(c.sc), p: fmt(c.cost) }) + (c.col ? t('card.tip.col') : '') }, [
      h('span', { class: 'rt', text: c.r }),
      c.col ? h('span', { class: 'ok', text: '✓' }) : null,
      icon(img.portrait(c.base), 'face'),
      h('div', { class: 'nm', text: c.name || '—' }),
      h('div', { class: 'ft' }, [h('span', { class: 'v', text: t('pts', { n: fmt(c.sc) }), title: t('pts.tip', { n: fmt(c.sc), src: c.scSrc }) }),
        c.col ? h('span', { class: 'p', text: kfmt(c.price) })
          : c.live === 0 ? h('span', { class: 'p none', text: t('noListing') })
          : c.live > 0 ? h('span', { class: 'p live', text: kfmt(c.live), title: t('live.tip', { p: fmt(c.price) }) })
          : h('span', { class: 'p', text: kfmt(c.price), title: t('futgg.tip') })]),
    ])));

  let actions;
  if (set.filter?.unsupported) {
    actions = h('div', { class: 'unsup', text: t('unsupported.note') });
  } else if (!plan.synced) {
    actions = h('div', { class: 'row' }, [
      h('span', { class: 'note', text: t('sync.hint') }),
      taskBtn({ class: 'b', text: t('btn.syncPrice'), onclick: () => send({ type: 'syncPrice', id: set.id, grade: plan.grade }) }),
    ]);
  } else if (!plan.missing) {
    actions = h('div', { class: 'row' }, [h('span', { class: 'note', text: t('allOwned', { n: Math.max(0, plan.tokens - (sum?.earned || 0)) }), title: t('ready.tip') })]);
  } else {
    actions = h('div', { class: 'row' }, [
      taskBtn({ class: plan.priced < plan.missing ? 'b' : 'g', text: t('btn.syncPrice'), title: t('btn.syncPrice.title'), onclick: () => send({ type: 'syncPrice', id: set.id, grade: plan.grade }) }),
      taskBtn({
        class: confirmBuy ? 'dan' : 'b',
        text: confirmBuy ? t('buy.confirm', { n: plan.missing, c: fmt(plan.need) }) : t('buy.plan', { n: plan.missing, c: fmt(plan.need) }),
        onclick: () => {
          if (!confirmBuy) { confirmBuy = true; renderDetail(); return; }
          confirmBuy = false;
          send({ type: 'buyPlan', id: set.id, grade: plan.grade });
        },
      }),
      confirmBuy ? h('button', { class: 'g', text: t('cancel'), onclick: () => { confirmBuy = false; renderDetail(); } }) : null,
    ]);
  }
  return h('div', { class: 'plan' }, [
    stats, actions,
    h('div', { class: 'note', style: 'margin-top:6px', text: t('sol.note', { g: plan.grade, d: solDate(set) }) + solAge(set) + (plan.noListing ? t('sol.noListing', { n: plan.noListing }) : '') + t('sol.bonus') }),
    chips, cards,
  ]);
}

// fut.gg çözümü olmayan setler için eski akış: en ucuz eksik kartlar
function cheapestBox(set, defs, saved, prices) {
  const plan = cheapestFill(set, defs, prices);
  const free = plan.free;
  const unknown = defs.filter((d) => !d.col && d.tradable && d.rare <= 1 && prices[d.def] == null).length;
  const lines = [h('div', { class: 'note', text: t('cb.none') })];
  if (!free) lines.push(h('div', { text: t('cb.full') }));
  else if (plan.pick.length) {
    lines.push(h('div', {}, [t('cb.plan', { free, n: plan.pick.length }), h('b', { text: fmt(plan.coins) }), t('cb.tax'), h('b', { text: fmt(plan.tax) })]));
    lines.push(h('div', { class: 'note', text: t('cb.after', { s: fmt(plan.after.score), g: plan.after.grade || '—', e: plan.after.earned, m: plan.after.maxTokens }) }));
  } else lines.push(h('div', { text: t('cb.slots', { free, x: unknown ? t('cb.price') : t('cb.noprice') }) }));
  return h('div', { class: 'plan' }, [...lines, h('div', { class: 'row' }, [
    taskBtn({ class: 'g', text: t('btn.sync'), onclick: () => send({ type: 'syncSets', ids: [set.id] }) }),
    taskBtn({ class: 'b', text: t('btn.price'), onclick: () => send({ type: 'priceSet', id: set.id }) }),
    taskBtn({
      class: confirmBuy ? 'dan' : 'b', disabled: !plan.pick.length,
      text: confirmBuy ? t('buy.missing.confirm', { n: plan.pick.length }) : t('buy.missing', { n: plan.pick.length }),
      onclick: () => { if (!confirmBuy) { confirmBuy = true; renderDetail(); return; } confirmBuy = false; send({ type: 'buyMissing', id: set.id }); },
    }),
  ])]);
}

async function renderDetail() {
  const set = CAT.sets.find((s) => s.id === openId);
  if (!set) return closeDetail();
  const key = 'gdefs:' + set.id;
  const got = await chrome.storage.local.get([key, 'galleryPrices']);
  if (openId !== set.id) return;
  const saved = got[key];
  const prices = {};
  for (const [d, x] of Object.entries(got.galleryPrices || {})) if (Date.now() - x.at < PRICE_TTL) prices[d] = x.p;
  const img = imgUrls(state.galleryMeta?.imgBase);
  const defs = saved?.defs || null;
  const sum = defs ? summarise(set, defs) : null;
  if (!openGrade || !set.sol?.tiers?.some((x) => x.g === openGrade)) openGrade = defaultTier(set, sum?.score || 0);

  let head = null;
  if (sum) {
    const top = set.grades[set.grades.length - 1]?.score || 1;
    head = h('div', {}, [
      h('div', {}, [t('hd.line', { c: sum.collected, r: set.required }), h('b', { text: fmt(sum.score) }), t('hd.line2', { g: sum.grade || '—', e: sum.earned, m: sum.maxTokens })]),
      h('div', { class: 'note', text: sum.next ? t('hd.next', { g: sum.next.g, n: fmt(sum.need) }) + (sum.nextPaying && sum.nextPaying !== sum.next ? t('hd.nextPay', { g: sum.nextPaying.g, n: fmt(sum.needPaying) }) : '') : t('hd.top') }),
      h('div', { class: 'prog' }, [h('i', { style: `width:${Math.min(100, (sum.score / top) * 100).toFixed(1)}%` })]),
    ]);
  }

  let body;
  if (set.filter?.unsupported && !set.sol) {
    body = h('div', { class: 'plan note', text: t('untrackable.long') });
  } else if (set.sol && openGrade) {
    body = solutionBox(set, planFromTier(set, openGrade, defs, prices), img, sum);
  } else if (defs) {
    body = cheapestBox(set, defs, saved, prices);
  } else {
    body = h('div', { class: 'plan' }, [t('notSynced'), h('div', { class: 'row' }, [
      taskBtn({ class: 'b', text: t('btn.sync'), onclick: () => send({ type: 'syncSets', ids: [set.id] }) }),
    ])]);
  }

  // EA'dan gelen tüm kartlar (eşitlendiyse)
  let list = null;
  if (defs) {
    const topIds = new Set(countedOf(set, defs).map((d) => d.def));
    const row = (d) => h('div', { class: 'pl' + (d.col ? ' col' : '') }, [
      icon(img.portrait(baseOf(d.def)), 'face'),
      h('span', { class: 'r', text: d.r || '' }),
      h('div', { class: 'n' }, [
        h('span', { text: (d.col ? '✓ ' : '') + (d.name || '#' + d.def) }),
        h('small', { text: [d.pos, d.rare > 1 ? t('special') : null, !d.tradable ? t('untradeable') : null].filter(Boolean).join(' · ') }),
      ]),
      h('span', { class: 'v', text: t('pts', { n: fmt(d.sc) }), title: t('pts.tip', { n: fmt(d.sc), src: 'EA' }) }),
      h('span', { class: 'p', text: d.col ? '' : prices[d.def] === 0 ? t('noListing') : prices[d.def] ? fmt(prices[d.def]) : '' }),
    ]);
    const counted = defs.filter((d) => topIds.has(d.def)).sort((a, b) => b.sc - a.sc);
    const extra = defs.filter((d) => d.col && !topIds.has(d.def)).sort((a, b) => b.sc - a.sc);
    const missing = defs.filter((d) => !d.col).sort((a, b) => b.sc - a.sc);
    list = h('details', { class: 'cards', open: listOpen, ontoggle: (e) => { listOpen = e.currentTarget.open; } }, [
      h('summary', { class: 'note', style: 'cursor:pointer;margin-top:14px', text: t('list.sum', { n: defs.length, c: counted.length, m: missing.length }) }),
      h('h3', { text: t('list.counted', { c: counted.length, r: set.required }) }), ...counted.map(row),
      extra.length ? h('h3', { text: t('list.extra', { n: extra.length }) }) : null, ...extra.map(row),
      h('h3', { text: t('list.missing', { n: missing.length }) }), ...missing.map(row),
    ]);
  }

  // replaceChildren null'ı "null" metni olarak basar; boş parçaları at
  $('dr').replaceChildren(...[
    h('div', { class: 'hd' }, [setArt(set, img), h('div', { style: 'flex:1' }, [h('h2', { text: set.name }), h('div', { class: 'note', text: t('dt.sub', { r: set.required }) + tokenLabel(set, sum, t) + (saved ? t('dt.synced', { d: dt(saved.at) }) : '') })]),
      h('button', { class: 'g', text: '✕', onclick: closeDetail })]),
    state.galleryToGrade?.[set.id] ? h('div', { class: 'gbanner' }, [
      h('span', { text: t('grade.banner') }),
      h('button', { class: 'b', text: t('grade.done'), onclick: () => send({ type: 'setToGrade', id: set.id, value: false }) }),
    ]) : null,
    head,
    set.sol ? gradeTabs(set, sum, defs, prices) : null,
    body,
    list,
  ].filter(Boolean));
}

// ---------------------------------------------------------------- token planlayıcı
const PL = { mode: 'target', target: 500, budget: 100000, syncedOnly: false, confirm: false, result: null };
function runPlanner() {
  const groups = CAT.sets.filter((x) => !PL.syncedOnly || DEFS.has(x.id)).map((x) => tierOptions(x, DEFS.get(x.id) || null));
  PL.result = PL.mode === 'target' ? planTokens(groups, { target: Math.max(1, PL.target | 0) }) : planTokens(groups, { budget: Math.max(0, PL.budget | 0) });
}
function openPlanner() {
  PL.confirm = false;
  runPlanner();
  renderPlanner();
  $('md').hidden = false;
}
function renderPlanner() {
  const r = PL.result;
  const img = imgUrls(state.galleryMeta?.imgBase);
  const byId = new Map(CAT.sets.map((x) => [x.id, x]));
  const unsynced = r.picks.filter((o) => o.est).length;
  const running = !!state.galleryRun?.running;
  const redo = () => { PL.confirm = false; runPlanner(); renderPlanner(); };
  const input = PL.mode === 'target'
    ? h('input', { type: 'number', min: 1, step: 10, value: PL.target, onchange: (e) => { PL.target = Number(e.target.value) || 0; redo(); } })
    : h('input', { type: 'number', min: 0, step: 10000, value: PL.budget, onchange: (e) => { PL.budget = Number(e.target.value) || 0; redo(); } });
  const buyable = r.picks.filter((o) => !o.est && !o.ready);   // "hazır" satırlarda alınacak kart yok
  $('mdBox').className = 'box wide';
  $('mdBox').replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [h('h3', { text: t('pl.title') }), h('button', { class: 'g', text: '✕', onclick: closeModal })]),
    h('div', { class: 'note', text: t('pl.note') }),
    h('div', { class: 'pl-in' }, [
      h('select', { onchange: (e) => { PL.mode = e.target.value; redo(); } }, [
        h('option', { value: 'target', text: t('pl.target'), selected: PL.mode === 'target' }),
        h('option', { value: 'budget', text: t('pl.budget'), selected: PL.mode === 'budget' }),
      ]),
      input,
      h('label', { class: 'kv' }, [h('input', { type: 'checkbox', checked: PL.syncedOnly, style: 'width:auto', onchange: (e) => { PL.syncedOnly = e.target.checked; redo(); } }), t('pl.synced')]),
    ]),
    PL.mode === 'target' ? h('div', { class: 'presets' }, HALL_OF_FUT.map((x) => h('button', { onclick: () => { PL.target = x.tokens; redo(); } }, [h('b', { text: t('tokens', { n: x.tokens }) }), h('small', { text: x.names })]))) : null,
    h('div', { class: 'ptot' }, [
      h('div', {}, [t('pl.tokens'), h('b', { text: `+${r.tokens}${PL.mode === 'target' && !r.reached ? t('pl.unreach') : ''}` })]),
      h('div', {}, [t('pl.cost'), h('b', { text: fmt(r.cost) })]),
      h('div', {}, [t('pl.tax'), h('b', { text: fmt(r.tax) })]),
      h('div', {}, [t('pl.sets'), h('b', { text: `${r.picks.length} / ${r.picks.reduce((a, o) => a + o.missing, 0)}` })]),
    ]),
    unsynced ? h('div', { class: 'note', style: 'margin-top:6px', text: t('pl.unsynced', { n: unsynced }) }) : null,
    h('div', { class: 'pres' }, r.picks.map((o) => {
      const x = byId.get(o.setId);
      return h('div', { class: 'prow', onclick: () => { closeModal(); openDetail(o.setId); openGrade = o.g; renderDetail(); }, style: 'cursor:pointer' }, [
        setArt(x, img), h('div', {}, [x.name, o.est ? h('span', { class: 'est', text: t('pl.est') }) : null, o.ready ? h('span', { class: 'est', text: t('pl.ready'), title: t('ready.tip') }) : null]),
        h('span', { class: 'g', text: o.g }), h('span', { text: t('pl.gain', { n: o.gain }) }), h('span', { class: 'note', text: t('pl.row', { n: o.missing, c: kfmt(o.cost) }) }),
      ]);
    })),
    h('div', { class: 'row' }, [
      h('button', { class: 'g', text: t('close'), onclick: closeModal }),
      h('button', {
        class: PL.confirm ? 'dan' : 'b', disabled: running || !buyable.length,
        text: PL.confirm ? t('pl.confirm', { n: buyable.length, c: fmt(buyable.reduce((a, o) => a + o.cost, 0)) }) : t('pl.buy'),
        onclick: () => {
          if (!PL.confirm) { PL.confirm = true; renderPlanner(); return; }
          PL.confirm = false;
          send({ type: 'buyBatch', items: buyable.map((o) => ({ setId: o.setId, grade: o.g })) });
          closeModal();
        },
      }),
    ]),
  );
}

// ---------------------------------------------------------------- kontroller
$('planner').addEventListener('click', openPlanner);
$('contact').addEventListener('click', async () => {
  const b = $('contact');
  try { await navigator.clipboard.writeText('yusuflnx'); b.replaceChildren(t('contact.copied'), h('b', { text: 'yusuflnx' })); }
  catch (_) { b.replaceChildren('Discord: ', h('b', { text: 'yusuflnx' })); }
  setTimeout(() => b.replaceChildren(h('span', { text: t('contact') }), h('b', { text: 'Discord yusuflnx' })), 2000);
});
$('sort').addEventListener('change', () => { sortBy = $('sort').value; try { localStorage.setItem('fcg-sort', sortBy); } catch (_) {} render(); });
$('show').addEventListener('change', () => { show = $('show').value; try { localStorage.setItem('fcg-show', show); } catch (_) {} render(); });
$('relPct').replaceChildren(...Array.from({ length: 41 }, (_, i) => i - 20).map((p) => h('option', { value: String(p), text: `${p > 0 ? '+' : ''}${p}%` })));
const sendRelist = () => send({ type: 'setRelist', value: { base: $('relBase').value, pct: Number($('relPct').value), dur: Number($('relDur').value) } });
for (const id of ['relBase', 'relPct', 'relDur']) $(id).addEventListener('change', sendRelist);
$('syncAll').addEventListener('click', openSyncConfirm);
$('diag').addEventListener('click', openDiag);
$('stop').addEventListener('click', () => send({ type: 'stop' }));
$('resetSpent').addEventListener('click', () => send({ type: 'resetGallerySpent' }));
$('refreshCoins').addEventListener('click', async () => {
  const b = $('refreshCoins');
  b.disabled = true;
  b.textContent = '…';
  const r = await send({ type: 'refreshCoins' }).catch((e) => ({ ok: false, error: e.message }));
  b.disabled = false;
  b.textContent = r?.ok ? '✓' : '!';
  b.title = r?.ok ? t('bar.refreshCoins.title') : t('bar.refreshCoins.fail', { e: r?.error || t('error') });
  setTimeout(() => { b.textContent = '↻'; }, 1500);
});
$('budget').addEventListener('change', () => send({ type: 'setGalleryBudget', value: Number($('budget').value) || 0 }));
$('maxCard').addEventListener('change', () => send({ type: 'setMaxCard', value: Number($('maxCard').value) || 0 }));
$('afterBuy').addEventListener('change', () => send({ type: 'setAfterBuy', value: $('afterBuy').value }));
$('toList').addEventListener('click', (e) => { e.preventDefault(); location.href = 'popup.html' + (embedded ? '?embedded=1' : ''); });
$('catRefresh').addEventListener('click', async () => {
  $('catInfo').textContent = t('cat.checking');
  const r = await send({ type: 'catalog', force: true });
  CAT = await loadCatalog();
  await render();
  if (!r?.ok) $('catInfo').textContent = t('cat.fail', { d: catDate(), e: r?.error || t('error') });
  else if (r.info?.changed) $('catInfo').textContent = t('cat.updated', { d: catDate() });
});

let tm = null;
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.galleryLang && c.galleryLang.newValue && c.galleryLang.newValue !== lang) setLang(c.galleryLang.newValue);
  if (c.galleryCatalog) loadCatalog().then((x) => { CAT = x; render(); });
  for (const [k, v] of Object.entries(c)) {
    if (!k.startsWith('gdefs:')) continue;
    const id = Number(k.slice(6));
    if (v.newValue) DEFS.set(id, v.newValue.defs); else DEFS.delete(id);
  }
  if (Object.keys(c).some((k) => k.startsWith('gallery') || k.startsWith('gdefs:'))) { clearTimeout(tm); tm = setTimeout(render, 150); }
});

(async () => {
  const { galleryLang } = await chrome.storage.local.get('galleryLang');
  if (galleryLang) { lang = galleryLang; t = makeT(lang); loc = localeOf(lang); }
  applyStatic();
  CAT = await loadCatalog();
  await loadAllDefs();
  await render();
  const r = await send({ type: 'catalog' }).catch(() => null);
  if (r?.info?.changed) { CAT = await loadCatalog(); render(); }
  send({ type: 'refreshCoins' }).catch(() => {});
})();
