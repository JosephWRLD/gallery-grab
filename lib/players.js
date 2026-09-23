// Oyuncu arama ve sabit veri (kulüp/lig/ülke adları, görsel kökü):
// EA Web App'in kendi dosyaları, sekmenin sayfa bağlamında okunur.
// players.json yalnızca isim + rating içerir; kulüp/lig/ülke oyuncunun item verisinden gelir.
import { runInWebApp } from './ea-api.js';

function dbSearchInPage(term, limit) {
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  const findUrl = () => {
    const rx = /items\/web\/players\.json/i;
    try { for (const e of performance.getEntriesByType('resource')) if (rx.test(e.name)) return e.name; } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = String(localStorage.getItem(localStorage.key(i)) || '').match(/https?:\/\/[^"' ]+?players\.json/i);
        if (m) return m[0];
      }
    } catch (_) {}
    return null;
  };

  const flatten = (j) => {
    if (Array.isArray(j)) return j;
    const out = [];
    for (const v of Object.values(j || {})) if (Array.isArray(v)) out.push(...v);
    return out;
  };

  return (async () => {
    try {
      if (!window.__galeriDb) {
        const url = findUrl();
        if (!url) return { ok: false, code: 'no-db' };
        const r = await fetch(url, { credentials: 'omit' });
        if (!r.ok) return { ok: false, code: 'http', status: r.status };
        window.__galeriDb = flatten(await r.json()).map((p) => {
          const first = String(p.f ?? p.firstName ?? '').trim();
          const last = String(p.l ?? p.lastName ?? '').trim();
          const common = String(p.c ?? p.commonName ?? '').trim();
          const full = [first, last].filter(Boolean).join(' ');
          return {
            id: Number(p.id ?? p.assetId ?? p.baseId ?? p.definitionId ?? 0),
            n: common || full,          // ekranda gösterilen ad
            full: full !== (common || full) ? full : '',  // farklıysa ikinci ad biçimi
            r: Number(p.r ?? p.rating ?? 0) || null,
          };
        }).filter((p) => p.id > 0 && p.n);
      }
      const q = norm(term);
      if (!q) return { ok: true, players: [] };
      const out = [];
      for (const p of window.__galeriDb) {
        // hem "Iniesta" hem "Andrés Iniesta Luján" aransın
        const forms = p.full ? [norm(p.n), norm(p.full)] : [norm(p.n)];
        let best = -1;
        for (const f of forms) {
          const i = f.indexOf(q);
          if (i < 0) continue;
          const s = (f === q ? 0 : i === 0 ? 1000 : 2000);
          if (best < 0 || s < best) best = s;
        }
        if (best < 0) continue;
        out.push({ baseId: p.id, name: p.n, fullName: p.full || p.n, rating: p.r, s: best - (p.r || 0) });
        if (out.length >= 600) break;
      }
      out.sort((a, b) => a.s - b.s);
      return { ok: true, players: out.slice(0, limit).map(({ s, ...p }) => p) };
    } catch (e) {
      return { ok: false, code: 'err', message: String(e) };
    }
  })();
}

// Görsel kökü + kulüp/lig/ülke id→isim sözlükleri.
// teamconfig.json yalnızca takım→lig eşlemesi tutuyor (isim yok); isimler Web App'in
// yerelleştirme dosyalarında, "...team...<id>" biçimli anahtarlarda duruyor.
function metaInPage() {
  const res = (() => { try { return performance.getEntriesByType('resource').map((e) => e.name); } catch (_) { return []; } })();
  const url = res.find((n) => n.includes('items/web/players.json'));
  if (!url) return { ok: false, code: 'no-db' };

  const root = url.split('/items/web/players.json')[0];      // .../<yıl>/fut
  const imgBase = root + '/items/images/mobile';

  // Sayfanın indirdiği yerelleştirme dosyaları; cdn > preload > web-app/loc sırasıyla denenir.
  const locUrls = res.filter((n) => n.includes('/loc/') && n.includes('.json'));
  locUrls.sort((a, b) => (b.includes('/cdn/') ? 1 : 0) - (a.includes('/cdn/') ? 1 : 0));

  // İç içe olabilir: tüm metin alanlarını "nokta.ile.birleşik.anahtar" -> değer olarak düzleştir.
  const flatten = (o, pre, out, depth) => {
    if (!o || depth > 5 || out.length > 80000) return out;
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? pre + '.' + k : k;
      if (typeof v === 'string') { if (v.trim() && v.length <= 60) out.push([key, v.trim()]); }
      else if (v && typeof v === 'object') flatten(v, key, out, depth + 1);
    }
    return out;
  };

  // Aynı id için birden çok anahtar olabilir (tam ad / kısaltma); kısaltma olmayanı ve uzun olanı seç.
  const put = (map, id, key, val) => {
    const abbr = /abbr|short|initial|3letter|code/i.test(key);
    const prev = map[id];
    if (!prev || (prev.abbr && !abbr) || (prev.abbr === abbr && val.length > prev.v.length)) map[id] = { v: val, abbr };
  };
  const plain = (map) => { const o = {}; for (const [k, x] of Object.entries(map)) o[k] = x.v; return o; };

  return (async () => {
    const meta = { ok: true, imgBase, teams: {}, leagues: {}, nations: {}, tried: locUrls.length };
    const teams = {}, leagues = {}, nations = {};
    try {
      for (const lu of locUrls.slice(0, 4)) {
        let j;
        try { j = await (await fetch(lu, { credentials: 'omit' })).json(); } catch (_) { continue; }
        for (const [key, val] of flatten(j, '', [], 0)) {
          const m = key.match(/([0-9]+)$/);
          if (!m) continue;
          const id = m[1];
          if (/team|club/i.test(key)) put(teams, id, key, val);
          else if (/league/i.test(key)) put(leagues, id, key, val);
          else if (/nation|country/i.test(key)) put(nations, id, key, val);
        }
        if (Object.keys(teams).length) { meta.locUrl = lu; break; }
      }
      meta.teams = plain(teams);
      meta.leagues = plain(leagues);
      meta.nations = plain(nations);
      meta.counts = {
        teams: Object.keys(meta.teams).length,
        leagues: Object.keys(meta.leagues).length,
        nations: Object.keys(meta.nations).length,
      };
      if (!meta.counts.teams) {
        // Tutturulamadıysa: hangi dosyalara bakıldığı ve örnek anahtarlar geri dönsün.
        const sampleKeys = [];
        for (const lu of locUrls.slice(0, 1)) {
          try {
            const j = await (await fetch(lu, { credentials: 'omit' })).json();
            for (const [k] of flatten(j, '', [], 0)) { if (/team|club|league|nation/i.test(k)) sampleKeys.push(k); if (sampleKeys.length > 8) break; }
          } catch (_) {}
        }
        meta.sample = JSON.stringify({ locUrls: locUrls.slice(0, 3), sampleKeys }).slice(0, 500);
      }
    } catch (e) {
      meta.warn = String(e);
    }
    return meta;
  })();
}

export async function searchPlayers(term, limit = 20) {
  const q = String(term || '').trim();
  if (q.length < 2) return [];
  const r = await runInWebApp(dbSearchInPage, [q, limit]);
  if (!r) throw new Error('Web App sekmesinden yanıt alınamadı');
  if (!r.ok) {
    if (r.code === 'no-db') throw new Error('Oyuncu veritabanı yüklenmemiş: Web App\'te Transfer Pazarı → Oyuncu Ara ekranını bir kez açın.');
    throw new Error(r.code === 'http' ? `Oyuncu veritabanı indirilemedi (HTTP ${r.status})` : `Oyuncu veritabanı okunamadı: ${r.message || ''}`);
  }
  return r.players;
}

export async function fetchMeta() {
  const r = await runInWebApp(metaInPage);
  if (!r?.ok) throw new Error('Görsel/isim verisi okunamadı: Web App\'te Transfer Pazarı → Oyuncu Ara ekranını bir kez açın.');
  return r;
}
