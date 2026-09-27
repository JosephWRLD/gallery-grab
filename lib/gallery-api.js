// Galeri verisi: Web App'in kendi "konsept oyuncu" araması (services.Item.searchConceptItems).
// EA her kart için isCollected + gradingScore döndürüyor; istek EA'nın kendi istemcisiyle
// (GET /defid?type=player&team|league|rare...) sayfa bağlamında atılır.
import { runInWebApp, ApiError } from './ea-api.js';

const PAGE = 100;

function conceptPageInPage(crit, offset, count) {
  return new Promise((resolve) => {
    try {
      if (!window.services?.Item?.searchConceptItems || !window.UTSearchCriteriaDTO) {
        resolve({ ok: false, code: 'not-ready' });
        return;
      }
      const c = new window.UTSearchCriteriaDTO();
      c.type = window.SearchType.PLAYER;
      c.count = count;
      c.offset = offset;
      if (crit.club) c.club = crit.club;
      if (crit.league) c.league = crit.league;
      if (crit.rarities) c.rarities = crit.rarities;
      const obs = window.services.Item.searchConceptItems(c);
      const ref = {};
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      obs.observe(ref, (o, res) => {
        o.unobserve(ref);
        if (!res?.success) { finish({ ok: false, code: 'http', status: res?.status ?? 0 }); return; }
        const items = (res.response?.items || []).map((i) => ({
          def: Number(i.definitionId),
          name: i._staticData?.name || '',
          r: Number(i.rating) || 0,
          rare: Number(i.rareflag) || 0,
          team: Number(i.teamId) || null,
          league: Number(i.leagueId) || null,
          pos: i.preferredPosition || null,
          col: !!i.isCollected,
          sc: Number(i.gradingScore) || 0,
          tradable: !i.untradeable,
        }));
        finish({ ok: true, items });
      });
      setTimeout(() => finish({ ok: false, code: 'timeout' }), 20000);
    } catch (e) {
      resolve({ ok: false, code: 'err', message: String(e) });
    }
  });
}

async function conceptPage(crit, offset) {
  const r = await runInWebApp(conceptPageInPage, [crit, offset, PAGE]);
  if (!r) throw new ApiError(0, null, 'Web App sekmesinden yanıt alınamadı');
  if (!r.ok) {
    if (r.code === 'not-ready') throw new ApiError(0, null, "Web App henüz hazır değil — giriş yapıp ana ekranın açılmasını bekleyin");
    if (r.code === 'http') throw new ApiError(r.status, null, `Galeri araması başarısız (HTTP ${r.status})`);
    throw new ApiError(0, null, `Galeri araması başarısız (${r.code}${r.message ? ': ' + r.message : ''})`);
  }
  return r.items;
}

// Setin filtresindeki tüm kartlar (takımlar/ligler tek tek, sayfalı).
// pause: sayfalar arası bekleme; onReq(ms): her isteğin süresi (eşitleme süre tahmini için).
export async function fetchSetDefs(filter, pause, onReq = null) {
  const crits = filter.teams ? filter.teams.map((club) => ({ club }))
    : filter.leagues ? filter.leagues.map((league) => ({ league }))
    : filter.rarities ? [{ rarities: filter.rarities }]
    : [];
  const byDef = new Map();
  for (const crit of crits) {
    for (let offset = 0, guard = 0; guard < 60; guard++) {
      const t0 = Date.now();
      const items = await conceptPage(crit, offset);
      onReq?.(Date.now() - t0);
      for (const it of items) if (it.def) byDef.set(it.def, it);
      if (items.length < PAGE) break;
      offset += items.length;
      await pause();
    }
    if (crits.length > 1) await pause();
  }
  return [...byDef.values()];
}
