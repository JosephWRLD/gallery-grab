// Sayfa (MAIN) dünyasında çalışır: EA Web App'in kendi UT isteklerinden oturum başlıklarını yakalar.
(() => {
  const SRC = 'fc-galeri';
  const IGNORED = new Set(['content-type', 'accept', 'x-http-method-override']);
  const state = { sid: null, headers: {}, baseUrl: null };
  let lastSent = '';

  const baseFrom = (u) => {
    const m = String(u).match(/^(https?:\/\/[^/]+\/ut\/game\/[^/?#]+)/);
    return m ? m[1] : null;
  };

  const emit = () => {
    if (!state.sid) return;
    const key = JSON.stringify([state.sid, state.headers, state.baseUrl]);
    if (key === lastSent) return;
    lastSent = key;
    window.postMessage({ source: SRC, type: 'session', payload: { sid: state.sid, headers: state.headers, baseUrl: state.baseUrl } }, '*');
  };

  const ingest = (url, headers) => {
    if (!/\/ut\/game\//.test(String(url))) return;
    const base = baseFrom(url);
    if (base) state.baseUrl = base;
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (lk === 'x-ut-sid') state.sid = v;
      else if (!IGNORED.has(lk)) state.headers[k] = v;
    }
    emit();
  };

  // XHR
  const xOpen = XMLHttpRequest.prototype.open;
  const xSet = XMLHttpRequest.prototype.setRequestHeader;
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__fcg = { url, headers: {} };
    return xOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__fcg) this.__fcg.headers[k] = v;
    return xSet.call(this, k, v);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    if (this.__fcg) ingest(this.__fcg.url, this.__fcg.headers);
    return xSend.apply(this, a);
  };

  // fetch bilinçli olarak sarılmıyor: Web App UT isteklerini XHR ile yapar. fetch sarılınca sayfanın
  // kendi düşen istekleri (reklam engelleyici vb.) "Failed to fetch" olarak eklentinin hatalarına yazılıyordu.

  // Yedek: Web App'in kendi servis nesnesinden SID oku
  setInterval(() => {
    try {
      const id = window.services && window.services.Authentication && window.services.Authentication.sessionUtas && window.services.Authentication.sessionUtas.id;
      if (!state.baseUrl) {
        for (const e of performance.getEntriesByType('resource')) { const b = baseFrom(e.name); if (b) { state.baseUrl = b; lastSent = ''; } }
      }
      if (id && id !== state.sid) state.sid = id;
      emit();
    } catch (_) {}
  }, 5000);
})();
