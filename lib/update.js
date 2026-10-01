// Yeni sürüm uyarısı: paketlenmemiş eklentiyi Chrome kendisi güncellemez, bu yüzden GitHub'daki manifest.json
// sürümü 6 saatte bir okunur; kurulu sürümden yeniyse galeri/panel ekranında "guncelle.bat" notu gösterilir.
const REMOTE = 'https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/manifest.json';
const EVERY = 6 * 60 * 60 * 1000;

export const RELEASES = 'https://github.com/JosephWRLD/gallery-grab/releases';

// '1.10.0' > '1.9.3'
export function isNewer(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Dönen: { current, latest } (latest yalnız kurulu sürümden yeniyse dolu)
export async function checkUpdate(force = false) {
  const current = chrome.runtime.getManifest().version;
  let { galleryUpdate: u = {} } = await chrome.storage.local.get('galleryUpdate');
  if (force || !(Date.now() - (u.at || 0) < EVERY)) {
    try {
      const r = await fetch(REMOTE, { cache: 'no-store' });
      if (r.ok) u = { latest: (await r.json()).version, at: Date.now() };
      else u = { ...u, at: Date.now() };
    } catch { u = { ...u, at: Date.now() }; }
    await chrome.storage.local.set({ galleryUpdate: u });
  }
  return { current, latest: isNewer(u.latest, current) ? u.latest : null };
}
