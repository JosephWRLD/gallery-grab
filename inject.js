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

  // Transfer pazarı rozeti: EA her ilan kartında isCollected taşıyor (galeride zaten toplanmış kart).
  // UTPlayerItemView.renderItem sarılır; görünümler yeniden kullanıldığı için rozet her çizimde güncellenir.
  const BADGE = 'fcg-collected';
  const patchBadge = () => {
    const V = window.UTPlayerItemView;
    if (!V?.prototype?.renderItem || V.prototype.__fcgBadge) return !!V?.prototype?.__fcgBadge;
    const orig = V.prototype.renderItem;
    V.prototype.renderItem = function (item, ...rest) {
      const r = orig.call(this, item, ...rest);
      try {
        const root = this.getRootElement?.();
        if (root) {
          const show = item?.isCollected === true && !!item?._auction?.tradeId;
          let b = root.querySelector(':scope > .' + BADGE);
          if (show && !b) {
            b = document.createElement('div');
            b.className = BADGE;
            const sp = document.createElement('span');   // küçük kartta CSS yalnız ✓ gösterir
            sp.textContent = '✓ Galeride';
            b.appendChild(sp);
            b.title = 'Gallery Grab: bu kart galeride zaten toplandı';
            root.appendChild(b);
          } else if (!show && b) b.remove();
        }
      } catch (_) {}
      return r;
    };
    V.prototype.__fcgBadge = true;
    return true;
  };
  const badgeTimer = setInterval(() => { if (patchBadge()) clearInterval(badgeTimer); }, 1000);

  // Yedek: Web App'in kendi servis nesnesinden SID oku
  setInterval(() => {
    try {
      const id = (window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || window.services?.Authentication?.sessionUtas?.id || null);   // FC 27: utasSession
      if (!state.baseUrl) {
        for (const e of performance.getEntriesByType('resource')) { const b = baseFrom(e.name); if (b) { state.baseUrl = b; lastSent = ''; } }
      }
      if (id && id !== state.sid) state.sid = id;
      emit();
    } catch (_) {}
  }, 5000);
})();
