// EA Web App görsel adresleri. Kök, players.json URL'sinden türetilir (lib/players.js).
// Doğrulanan kalıplar: portraits/<baseId>.png, clubs/<light|dark>/<teamId>.png,
// leagues/<light|dark>/<leagueId>.png, flags/dark/<nationId>.png
export function imgUrls(base) {
  if (!base) return { portrait: () => null, crest: () => null, league: () => null, flag: () => null };
  const u = (p, id) => (id ? `${base}/${p}/${id}.png` : null);
  return {
    portrait: (id) => u('portraits', id),
    crest: (id) => u('clubs/dark', id),
    crestAlt: (id) => u('clubs/light', id),
    league: (id) => u('leagues/dark', id),
    leagueAlt: (id) => u('leagues/light', id),
    flag: (id) => u('flags/dark', id),
  };
}
