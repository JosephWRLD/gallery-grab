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

async function findTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.ea.com/*/ultimate-team/web-app/*', 'https://www.easports.com/*/ultimate-team/web-app/*'],
  });
  return tabs.find((t) => t.active) || tabs[0] || null;
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
  if (session.baseUrl) return session.baseUrl;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: baseInPage });
  const base = res?.result;
  if (base) {
    await chrome.storage.local.set({ session: { ...session, baseUrl: base } });
    return base;
  }
  return DEFAULT_BASE;
}

// Web App'in kendi oturum nesnesinden güncel SID'yi okur (sayfa yenilenince/yeniden girişte SID değişir).
function sidInPage() {
  try { return window.services?.Authentication?.sessionUtas?.id || null; } catch (_) { return null; }
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
  if (status === 401 && !retried && await refreshSid(tab, session)) return call(method, path, opts, true);
  if (status === 401) throw new ApiError(401, json, 'Oturum geçersiz (401): EA Web App sekmesini yenileyip giriş yapın, sonra Transfer Pazarı\'nda bir arama yapın');
  if (status < 200 || status >= 300) throw new ApiError(status, json);
  return json;
}

export const api = {
  search: ({ maskedDefId, maxb, num = 21, start = 0 }) => {
    const q = { num, start, type: 'player', maskedDefId };
    if (maxb) q.maxb = maxb;
    return call('GET', '/transfermarket', { query: q });
  },
  buyNow: (tradeId, price) => call('PUT', `/trade/${tradeId}/bid`, { body: { bid: price } }),
  // Kulüpteki oyuncular (sahip olunanlar). Parametreler Web App'in kullandığı kalıp.
  club: ({ start = 0, count = 91, sort = 'desc', sortBy = 'value' } = {}) =>
    call('GET', '/club', { query: { start, count, sort, sortBy, type: 'player' } }),
  credits: () => call('GET', '/user/credits'),
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
