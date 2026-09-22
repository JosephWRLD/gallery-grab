// Oyuncu arama: EA Web App'in kendi oyuncu veritabanı (players.json), sekmenin sayfa bağlamında okunur.
import { runInWebApp } from './ea-api.js';

function dbSearchInPage(term, limit) {
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  const findUrl = () => {
    const rx = /players?\.json(\?|$)/i;
    try { for (const e of performance.getEntriesByType('resource')) if (rx.test(e.name)) return e.name; } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = String(localStorage.getItem(localStorage.key(i)) || '').match(/https?:\/\/[^"'\s\\]+?players\.json/i);
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
        window.__galeriDb = flatten(await r.json()).map((p) => ({
          id: Number(p.id ?? p.assetId ?? p.baseId ?? p.definitionId ?? 0),
          n: String(p.c || p.commonName || [p.f ?? p.firstName, p.l ?? p.lastName].filter(Boolean).join(' ') || '').trim(),
          r: Number(p.r ?? p.rating ?? 0) || null,
        })).filter((p) => p.id > 0 && p.n);
      }
      const q = norm(term);
      if (!q) return { ok: true, players: [] };
      const out = [];
      for (const p of window.__galeriDb) {
        const n = norm(p.n);
        const i = n.indexOf(q);
        if (i < 0) continue;
        // tam eşleşme > baştan eşleşme > içinde geçen; eşitlikte yüksek rating önce
        const s = (n === q ? 0 : i === 0 ? 1000 : 2000) - (p.r || 0);
        out.push({ baseId: p.id, name: p.n, rating: p.r, s });
        if (out.length >= 600) break;
      }
      out.sort((a, b) => a.s - b.s);
      return { ok: true, players: out.slice(0, limit).map(({ s, ...p }) => p) };
    } catch (e) {
      return { ok: false, code: 'err', message: String(e) };
    }
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
