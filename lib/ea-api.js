// EA UT API istemcisi. İstekler Web App sekmesinin sayfa bağlamında (MAIN world) çalıştırılır.
export class ApiError extends Error {
  constructor(status, body, msg) {
    super(msg || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Yedek; normalde Web App'in kendi isteğinden yakalanan session.baseUrl kullanılır (fc26/fc27 otomatik).
const DEFAULT_BASE = 'https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27';
// Yalnız EA'nın UT sunucusu kabul edilir (sayfadan gelen adres doğrulanmadan kullanılmasın)
export const validBase = (u) => /^https:\/\/[a-z0-9.-]+\.ea\.com(:\d+)?\/ut\/game\/[^/?#]+$/i.test(String(u || ''));

// Birden çok Web App sekmesi/penceresi olabilir (her pencerenin kendi "aktif" sekmesi var): oturumu gerçekten
// açık olanı seç — önce son odaklanılan penceredeki aktif sekme. Seçim 30 sn önbelleklenir.
let tabPick = { id: null, at: 0 };
async function findTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.ea.com/*/ultimate-team/web-app/*', 'https://www.easports.com/*/ultimate-team/web-app/*'],
  });
  if (tabs.length <= 1) return tabs[0] || null;
  const cached = tabs.find((t) => t.id === tabPick.id);
  if (cached && Date.now() - tabPick.at < 30000) return cached;
  let focused = null;
  try { focused = (await chrome.windows.getLastFocused())?.id ?? null; } catch (_) {}
  const rank = (t) => (t.active && t.windowId === focused ? 0 : t.active ? 1 : 2);
  const ordered = [...tabs].sort((a, b) => rank(a) - rank(b) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const t of ordered) {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: sidInPage });
      if (r?.result) { tabPick = { id: t.id, at: Date.now() }; return t; }
    } catch (_) {}
  }
  return ordered[0];
}

export async function runInWebApp(func, args = []) {
  const tab = await findTab();
  if (!tab) throw new ApiError(0, null, 'EA Web App sekmesi bulunamadı');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args, func });
  return res?.result;
}

async function pageFetch(tabId, url, method, headers, body) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [url, method, headers, body],
    func: async (url, method, headers, body) => {
      try {
        // EA oturum anahtarını arada yeniliyor: kayıtlıdan değil, o anki sayfa oturumundan gönder
        const live = (window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || window.services?.Authentication?.sessionUtas?.id || null);
        if (live) headers['X-UT-SID'] = live;
        // UT API çerez değil X-UT-SID ile doğrular; 'include' + ACAO:* CORS'u bozar.
        const r = await fetch(url, { method, headers, body: body || undefined, credentials: 'omit' });
        return { status: r.status, text: await r.text() };
      } catch (e) {
        return { status: 0, text: String(e) };
      }
    },
  });
  return res?.result || { status: 0, text: 'executeScript sonuç döndürmedi' };
}

// Web App'in gerçekten kullandığı UT adresini sayfanın ağ kayıtlarından bulur.
function baseInPage() {
  const rx = /^(https?:\/\/[^/]+\/ut\/game\/[^/?#]+)/;
  try {
    const list = performance.getEntriesByType('resource');
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i].name.match(rx);
      if (m) return m[1];
    }
  } catch (_) {}
  return null;
}

async function resolveBase(tab, session) {
  if (validBase(session.baseUrl)) return session.baseUrl;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: baseInPage });
  const base = res?.result;
  if (validBase(base)) {
    await chrome.storage.local.set({ session: { ...session, baseUrl: base } });
    return base;
  }
  return DEFAULT_BASE;
}

// Web App'in kendi oturum nesnesinden güncel SID'yi okur (sayfa yenilenince/yeniden girişte SID değişir).
function sidInPage() {
  // FC 27'de alan adı utasSession (eski sürümlerde sessionUtas); getUtasSession() yedek
  try { return (window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || window.services?.Authentication?.sessionUtas?.id || null); } catch (_) { return null; }
}

// 401 alınınca Web App'i dürt: kendi istemcisiyle küçük bir konsept araması yaptırır. Web App oturumunun
// düştüğünü bu istekte fark edip kendi yeniden girişini yapar (boşta beklerken bunu tetikleyen olmuyor).
// Dönen: o anki SID (ya da null).
function nudgeInPage() {
  const live = () => (window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || window.services?.Authentication?.sessionUtas?.id || null);
  return new Promise((resolve) => {
    try {
      if (!window.services?.Item?.searchConceptItems || !window.UTSearchCriteriaDTO) { resolve(live()); return; }
      const c = new window.UTSearchCriteriaDTO();
      c.type = window.SearchType.PLAYER;
      c.count = 1;
      c.offset = 0;
      c.club = 1;
      const ref = {};
      let done = false;
      const finish = () => { if (!done) { done = true; setTimeout(() => resolve(live()), 1500); } };
      window.services.Item.searchConceptItems(c).observe(ref, (o) => { o.unobserve(ref); finish(); });
      setTimeout(finish, 8000);
    } catch (_) { resolve(live()); }
  });
}

// 401 alınınca: sayfadaki güncel SID eskisinden farklıysa kaydet → true (isteği tekrar dene)
async function refreshSid(tab, session) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: sidInPage });
    const sid = res?.result;
    if (!sid || sid === session.sid) return false;
    await chrome.storage.local.set({ session: { ...session, sid, capturedAt: Date.now() } });
    return true;
  } catch (_) { return false; }
}

async function call(method, path, opts = {}, retried = false) {
  const { query, body } = opts;
  const { session } = await chrome.storage.local.get('session');
  if (!session?.sid) throw new ApiError(401, null, 'Oturum yok: EA Web App sekmesini açıp giriş yapın');
  const tab = await findTab();
  if (!tab) throw new ApiError(0, null, 'EA Web App sekmesi bulunamadı');

  const base = await resolveBase(tab, session);
  let url = base + path;
  if (query) url += '?' + new URLSearchParams(query).toString();
  const headers = {
    ...(session.headers || {}),
    'X-UT-SID': session.sid,
    Accept: 'application/json',
  };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  // Web App ile aynı: gerçek HTTP metodu, GET'te gövde yok.
  const payload = method === 'GET' ? null : JSON.stringify(body || {});
  const { status, text } = await pageFetch(tab.id, url, method, headers, payload);
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (status === 0) {
    const hint = base === DEFAULT_BASE ? ' — API adresi yakalanamadı; Web App\'te Transfer Pazarı\'nı açıp tekrar deneyin' : '';
    throw new ApiError(0, text, `Bağlantı hatası (${base}): ${String(text).slice(0, 120)}${hint}`);
  }
  // EA anahtarı yenilerken araya giren istek 401 alabilir: kısa bekleyip (pageFetch o anki anahtarı okur) bir kez daha dene
  if ((status === 401 || status === 403) && !retried) {
    tabPick = { id: null, at: 0 };
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: nudgeInPage });
      if (r?.result && r.result !== session.sid) await chrome.storage.local.set({ session: { ...session, sid: r.result, capturedAt: Date.now() } });
    } catch (_) {
      await new Promise((res) => setTimeout(res, 2500));
    }
    return call(method, path, opts, true);
  }
  if (status === 401) throw new ApiError(401, json, 'Oturum geçersiz (401): EA Web App sekmesini yenileyip giriş yapın, sonra Transfer Pazarı\'nda bir arama yapın');
  if (status < 200 || status >= 300) throw new ApiError(status, json);
  return json;
}

export const api = {
  // rare: EA nadirlik kimliği (rareflag) → rarityIds; Web App'in nadirlik filtresiyle aynı alan
  search: ({ maskedDefId, maxb, minb, rare, num = 21, start = 0 }) => {
    const q = { num, start, type: 'player', maskedDefId };
    if (maxb) q.maxb = maxb;
    if (minb) q.minb = minb;
    if (rare) q.rarityIds = rare;
    return call('GET', '/transfermarket', { query: q });
  },
  buyNow: (tradeId, price) => call('PUT', `/trade/${tradeId}/bid`, { body: { bid: price } }),
  // Kulüpteki oyuncular (sahip olunanlar). Parametreler Web App'in kullandığı kalıp.
  club: ({ start = 0, count = 91, sort = 'desc', sortBy = 'value' } = {}) =>
    call('GET', '/club', { query: { start, count, sort, sortBy, type: 'player' } }),
  credits: () => call('GET', '/user/credits'),
  tradepile: () => call('GET', '/tradepile'),
  // Kangal Snip ile aynı kalıplar: kartı transfer listesine taşı, satışa koy.
  toTradepile: (itemId) => call('PUT', '/item', { body: { itemData: [{ id: itemId, pile: 'trade' }] } }),
  list: (itemId, startingBid, buyNowPrice, duration = 3600) =>
    call('POST', '/auctionhouse', { body: { itemData: { id: itemId }, startingBid, duration, buyNowPrice } }),
};

export function parseCoins(r) {
  if (!r) return null;
  if (typeof r.credits === 'number') return r.credits;
  if (Array.isArray(r.credits)) {
    const x = r.credits.find((v) => /coin/i.test(v.type || v.name || '')) || r.credits[0];
    return x?.count ?? x?.amount ?? null;
  }
  if (Array.isArray(r.currencies)) {
    const x = r.currencies.find((v) => /coin/i.test(v.name || ''));
    return x?.finalFunds ?? x?.funds ?? null;
  }
  return null;
}
