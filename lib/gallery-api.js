// Galeri verisi: Web App'in kendi "konsept oyuncu" araması (services.Item.searchConceptItems).
// EA her kart için isCollected + gradingScore döndürüyor; istek EA'nın kendi istemcisiyle
// (GET /defid?type=player&team|league|rare...) sayfa bağlamında atılır.
import { runInWebApp, ApiError } from './ea-api.js';
import { diagProbe } from './gallery.js';

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
      // Web App'in bu arama için attığı /defid adresi (kayıt tamponu dolu olsa da gözlemci görür)
      let url = null, po = null;
      try {
        po = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/\/defid\?/.test(e.name)) url = e.name; });
        po.observe({ type: 'resource' });
      } catch (_) {}
      const obs = window.services.Item.searchConceptItems(c);
      const ref = {};
      let done = false;
      const finish = (v) => { if (!done) { done = true; try { po?.disconnect(); } catch (_) {} resolve(v); } };
      // Bazı Web App sürümlerinde (Opera'da görüldü) kart nesnesi isCollected/gradingScore taşımıyor ama EA'nın
      // ham yanıtında var: o zaman aynı isteğin ham JSON'undan oku. Dönen: resourceId/id → ham kart
      const rawMap = async (n) => {
        await new Promise((r) => setTimeout(r, 50));
        if (!url && crit.club) {
          let base = null;
          try { base = performance.getEntriesByType('resource').map((x) => x.name.match(/^https:\/\/[^/]+\/ut\/game\/fc\d+\//)?.[0]).filter(Boolean).pop(); } catch (_) {}
          if (base) url = `${base}defid?count=${count}&sort=desc&start=${offset}&type=player&team=${crit.club}`;
        }
        if (!url) return null;
        const sid = window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || '';
        const r = await fetch(url, { headers: { 'X-UT-SID': sid, Accept: 'application/json' }, credentials: 'omit' });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        const arr = !j ? [] : Array.isArray(j) ? j : j.itemData || j.items || [];
        const m = new Map();
        for (const x of arr) for (const k of [x?.resourceId, x?.id]) if (k != null) m.set(Number(k), x);
        return { m, arr: arr.length === n ? arr : null };
      };
      obs.observe(ref, async (o, res) => {
        o.unobserve(ref);
        if (!res?.success) { finish({ ok: false, code: 'http', status: res?.status ?? 0 }); return; }
        const src = res.response?.items || [];
        let raw = null;
        if (src.length && !src.some((i) => typeof i.isCollected === 'boolean')) {
          try { raw = await rawMap(src.length); } catch (_) {}
        }
        const items = src.map((i, idx) => {
          const x = raw ? raw.m.get(Number(i.definitionId)) || raw.arr?.[idx] || null : null;
          return {
            def: Number(i.definitionId),
            name: i._staticData?.name || '',
            r: Number(i.rating) || 0,
            rare: Number(i.rareflag) || 0,
            team: Number(i.teamId) || null,
            league: Number(i.leagueId) || null,
            pos: i.preferredPosition || null,
            col: x ? x.isCollected === true : !!i.isCollected,
            sc: Number(x ? x.gradingScore : i.gradingScore) || 0,
            tradable: !i.untradeable,
          };
        });
        finish({ ok: true, items, raw: !!raw });
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

// Teşhis: setin her takımı/ligi için tek sayfa konsept araması + ham yanıt özeti (bkz. lib/gallery.js diagProbe)
export async function diagnoseConcept(crit, withRaw = true) {
  return (await runInWebApp(diagProbe, [crit, withRaw])) || { error: 'no-result' };
}
