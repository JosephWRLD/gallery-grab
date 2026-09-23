const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('tr-TR'));
const send = (msg) => chrome.runtime.sendMessage(msg);
const LABEL = {
  pending: 'bekliyor', done: 'alındı', notfound: 'bulunamadı',
  budget: 'bütçe yetmedi', owned: 'kulübünde var', error: 'hata',
};

// Web App sol menüsündeki GALLERY sekmesinden iframe içinde açıldıysa
if (new URLSearchParams(location.search).has('embedded')) {
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
  for (const c of [].concat(children)) if (c) el.append(c);
  return el;
}

// Görsel yoksa/404 ise satırı bozma: varsa yedek adrese geç, yoksa gizle.
function icon(src, cls, alt) {
  if (!src) return null;
  const el = h('img', { class: cls, src, loading: 'lazy', alt: '' });
  el.onerror = () => {
    if (alt && el.src !== alt) { el.src = alt; return; }
    el.style.display = 'none';
  };
  return el;
}

// Kulüp / lig / ülke satırı — bu bilgi ancak fiyat taraması veya alım sonrası dolar.
function metaRow(x) {
  const bits = [x.position, x.club, x.league, x.nation].filter(Boolean).join(' · ');
  if (!bits && !x.crest && !x.flag) return null;
  return h('div', { class: 'meta' }, [
    icon(x.crest, 'ic', x.crestAlt),
    icon(x.flag, 'ic'),
    bits ? h('span', { text: bits }) : null,
  ]);
}

async function render() {
  const { galleryList = [], gallerySettings = {}, galleryRun = {}, clubBaseIds = [], clubScanAt = 0, clubFetched = 0, galleryMeta = null } =
    await chrome.storage.local.get(['galleryList', 'gallerySettings', 'galleryRun', 'clubBaseIds', 'clubScanAt', 'clubFetched', 'galleryMeta']);
  const budget = gallerySettings.budget || 0;
  const spent = galleryRun.spent || 0;
  const owned = new Set(clubBaseIds);

  $('coins').textContent = fmt(galleryRun.coins);
  $('spent').textContent = fmt(spent);
  $('left').textContent = budget > 0 ? fmt(Math.max(0, budget - spent)) : '∞';
  if (document.activeElement !== $('budget')) $('budget').value = budget || '';
  $('skipOwned').checked = !!gallerySettings.skipOwned;
  $('clubInfo').textContent = clubScanAt
    ? `${owned.size} oyuncu · ${clubFetched} kart · ${new Date(clubScanAt).toLocaleDateString('tr-TR')}`
    : 'taranmadı';

  // Sözlük yüklüyse sessiz kal; yalnız sorun varsa sebebini göster.
  const c = galleryMeta?.counts;
  $('metaInfo').textContent = !galleryMeta || c?.teams ? ''
    : 'İsim sözlüğü yüklenemedi — ' + (galleryMeta.warn || '') + ' ' + (galleryMeta.sample || '');
  $('metaInfo').style.wordBreak = 'break-all';

  const running = !!galleryRun.running;
  $('toggle').textContent = running ? 'Durdur' : 'Başlat';
  $('toggle').className = running ? 'dan' : 'pri';
  $('status').textContent = galleryRun.text || 'Hazır';
  $('status').className = galleryRun.level || 'mut';
  for (const id of ['scanPrices', 'scanClub']) $(id).disabled = running;

  const done = galleryList.filter((x) => x.status === 'done').length;
  $('count').textContent = galleryList.length ? `${done}/${galleryList.length}` : '';

  const total = galleryList.reduce((a, x) => a + (x.status === 'done' ? 0 : x.market || 0), 0);
  $('estimate').textContent = total ? `Tahmini kalan maliyet: ${fmt(total)} coin` : '';

  $('list').replaceChildren(...(galleryList.length ? galleryList.map((x) => {
    const tag = x.status === 'done' ? `alındı · ${fmt(x.price)}` : LABEL[x.status] || x.status;
    const price = x.status !== 'done' && x.marketAt
      ? (x.market ? `~${fmt(x.market)}` : 'ilan yok')
      : null;
    return h('div', { class: 'it' }, [
      icon(x.portrait, 'face'),
      h('div', { class: 'n' }, [
        h('span', { text: `${x.name}${x.rating ? ` (${x.rating})` : ''}` }),
        price ? h('span', { class: 'price', text: price }) : null,
        owned.has(x.baseId) && x.status !== 'owned' ? h('span', { class: 'tag owned', text: 'sende var' }) : null,
        metaRow(x),
        x.note ? h('small', { text: x.note }) : null,
      ]),
      h('span', { class: `tag ${x.status}`, text: tag }),
      h('button', { class: 'x', text: '✕', title: 'Sil', onclick: () => send({ type: 'remove', id: x.id }) }),
    ]);
  }) : [h('div', { class: 'mut', text: 'Liste boş — yukarıdan oyuncu ekleyin.' })]));
}

// ---------------------------------------------------------------- arama
let timer = null;
let seq = 0;
$('q').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const term = $('q').value.trim();
    const my = ++seq;
    if (term.length < 2) { $('results').replaceChildren(); return; }
    const r = await send({ type: 'search', term });
    if (my !== seq) return;
    if (!r?.ok) { $('results').replaceChildren(h('div', { class: 'mut', text: r?.error || 'Arama başarısız' })); return; }
    $('results').replaceChildren(...(r.players.length ? r.players.map((p) => h('div', {
      class: 'res',
      onclick: async () => { await send({ type: 'add', player: p }); $('q').value = ''; $('results').replaceChildren(); },
    }, [
      icon(p.portrait, 'face'),
      h('div', {}, [
        h('span', { text: `${p.name}${p.rating ? ` (${p.rating})` : ''}` }),
        p.fullName && p.fullName !== p.name ? h('small', { text: p.fullName }) : null,
      ]),
    ])) : [h('div', { class: 'mut', text: 'Sonuç yok' })]));
  }, 300);
});

$('bulkBtn').addEventListener('click', async () => {
  const names = $('bulk').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return;
  $('bulkBtn').disabled = true;
  $('missing').textContent = 'Aranıyor…';
  const r = await send({ type: 'bulkAdd', names });
  $('bulkBtn').disabled = false;
  if (!r?.ok) { $('missing').textContent = r?.error || 'Hata'; return; }
  $('bulk').value = r.missing.join('\n');
  $('missing').textContent = r.missing.length ? `${r.added} eklendi. Bulunamayanlar kutuda bırakıldı.` : `${r.added} eklendi.`;
});

// ---------------------------------------------------------------- kontroller
$('budget').addEventListener('change', () => send({ type: 'setBudget', budget: Number($('budget').value) || 0 }));
$('skipOwned').addEventListener('change', () => send({ type: 'setSkipOwned', value: $('skipOwned').checked }));
$('toggle').addEventListener('click', async () => {
  const { galleryRun = {} } = await chrome.storage.local.get('galleryRun');
  if (galleryRun.running) return send({ type: 'stop' });
  await send({ type: 'setBudget', budget: Number($('budget').value) || 0 });
  send({ type: 'start' });
});
$('scanPrices').addEventListener('click', () => send({ type: 'scanPrices' }));
$('scanClub').addEventListener('click', () => send({ type: 'scanClub' }));
$('retry').addEventListener('click', () => send({ type: 'retry' }));
$('resetSpent').addEventListener('click', () => send({ type: 'resetSpent' }));
$('clear').addEventListener('click', () => send({ type: 'clear' }));

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && (c.galleryList || c.gallerySettings || c.galleryRun || c.clubBaseIds || c.galleryMeta)) render();
});
render();
send({ type: 'refreshCoins' }).catch(() => {});
