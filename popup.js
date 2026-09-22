const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('tr-TR'));
const send = (msg) => chrome.runtime.sendMessage(msg);
const LABEL = { pending: 'bekliyor', done: 'alındı', notfound: 'bulunamadı', budget: 'bütçe yetmedi', error: 'hata' };

// Web App sol menüsündeki GALERİ sekmesinden iframe içinde açıldıysa
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
  for (const c of [].concat(children)) el.append(c);
  return el;
}

async function render() {
  const { galleryList = [], gallerySettings = {}, galleryRun = {} } =
    await chrome.storage.local.get(['galleryList', 'gallerySettings', 'galleryRun']);
  const budget = gallerySettings.budget || 0;
  const spent = galleryRun.spent || 0;

  $('coins').textContent = fmt(galleryRun.coins);
  $('spent').textContent = fmt(spent);
  $('left').textContent = budget > 0 ? fmt(Math.max(0, budget - spent)) : '∞';
  if (document.activeElement !== $('budget')) $('budget').value = budget || '';

  const running = !!galleryRun.running;
  $('toggle').textContent = running ? 'Durdur' : 'Başlat';
  $('toggle').className = running ? 'dan' : 'pri';
  $('status').textContent = galleryRun.text || 'Hazır';
  $('status').className = galleryRun.level || 'mut';

  const done = galleryList.filter((x) => x.status === 'done').length;
  $('count').textContent = galleryList.length ? `${done}/${galleryList.length}` : '';

  $('list').replaceChildren(...(galleryList.length ? galleryList.map((x) => {
    const tag = x.status === 'done' ? `alındı · ${fmt(x.price)}` : LABEL[x.status] || x.status;
    return h('div', { class: 'it' }, [
      h('div', { class: 'n' }, [
        h('span', { text: `${x.name}${x.rating ? ` (${x.rating})` : ''}` }),
        ...(x.note ? [h('small', { text: x.note })] : []),
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
      text: `${p.name}${p.rating ? ` (${p.rating})` : ''}`,
      onclick: async () => { await send({ type: 'add', player: p }); $('q').value = ''; $('results').replaceChildren(); },
    })) : [h('div', { class: 'mut', text: 'Sonuç yok' })]));
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
$('toggle').addEventListener('click', async () => {
  const { galleryRun = {} } = await chrome.storage.local.get('galleryRun');
  if (galleryRun.running) return send({ type: 'stop' });
  await send({ type: 'setBudget', budget: Number($('budget').value) || 0 });
  send({ type: 'start' });
});
$('retry').addEventListener('click', () => send({ type: 'retry' }));
$('resetSpent').addEventListener('click', () => send({ type: 'resetSpent' }));
$('clear').addEventListener('click', () => send({ type: 'clear' }));

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && (c.galleryList || c.gallerySettings || c.galleryRun)) render();
});
render();
send({ type: 'refreshCoins' }).catch(() => {});
