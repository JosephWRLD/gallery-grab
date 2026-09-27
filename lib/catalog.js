// Galeri set kataloğu: eklentiye gömülü kopya + GitHub'daki güncel kopya.
// GitHub Actions dosyayı her gün 21:00 TR'de (18:00 UTC) fut.gg'den yeniden üretir (tools/build-gallery-sets.mjs);
// eklenti, son kontrol en son 21:40 TR'den önceyse yeniden çeker (Actions gecikmesi için 40 dk pay).
const REMOTE = 'https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/data/gallery-sets.json';

function lastPublish(now = new Date()) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 40));
  if (t > now) t.setUTCDate(t.getUTCDate() - 1);
  return t.getTime();
}

const FAIL_WAIT = 60 * 60 * 1000;   // indirme başarısızsa en erken 1 saat sonra tekrar dene

const valid = (c) => c && Array.isArray(c.sets) && c.sets.length >= 50 && Array.isArray(c.categories);
const newer = (a, b) => String(a?.updated || '') > String(b?.updated || '');

// Gömülü kopya değişmez: bir kez okunup bellekte tutulur (her çağrıda 400 KB JSON ayrıştırılmasın)
let bundledCache = null;
async function bundled() {
  if (!bundledCache) bundledCache = fetch(chrome.runtime.getURL('data/gallery-sets.json')).then((r) => r.json()).catch((e) => { bundledCache = null; throw e; });
  return bundledCache;
}

export async function loadCatalog() {
  const { galleryCatalog } = await chrome.storage.local.get('galleryCatalog');
  const local = await bundled();
  return valid(galleryCatalog) && newer(galleryCatalog, local) ? galleryCatalog : local;
}

// force: süreye bakmadan kontrol et. Dönen: { updated, source: 'remote' | 'bundled', changed }
export async function refreshCatalog(force = false) {
  const { galleryCatalogAt = 0, galleryCatalogFailAt = 0, galleryCatalog } = await chrome.storage.local.get(['galleryCatalogAt', 'galleryCatalogFailAt', 'galleryCatalog']);
  if (!force && (galleryCatalogAt >= lastPublish() || Date.now() - galleryCatalogFailAt < FAIL_WAIT)) return null;
  let remote;
  try {
    const r = await fetch(REMOTE, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Katalog indirilemedi (HTTP ${r.status})`);
    remote = await r.json();
    if (!valid(remote)) throw new Error('İndirilen katalog geçersiz');
  } catch (e) {
    // başarısız deneme "kontrol edildi" sayılmaz: 1 saat sonra yeniden denenir
    await chrome.storage.local.set({ galleryCatalogFailAt: Date.now() });
    throw e;
  }
  await chrome.storage.local.set({ galleryCatalogAt: Date.now(), galleryCatalogFailAt: 0 });
  const local = await bundled();
  const best = newer(galleryCatalog, remote) ? galleryCatalog : remote;
  const changed = newer(best, local) && best.updated !== galleryCatalog?.updated;
  if (newer(best, local)) await chrome.storage.local.set({ galleryCatalog: best });
  return { updated: newer(best, local) ? best.updated : local.updated, changed };
}
