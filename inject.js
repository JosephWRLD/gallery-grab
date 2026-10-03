// Sayfa (MAIN) dünyasında çalışır: EA Web App'in kendi UT isteklerinden oturum başlıklarını yakalar.
(() => {
  const SRC = 'fc-galeri';
  const IGNORED = new Set(['content-type', 'accept', 'x-http-method-override']);
  const state = { sid: null, headers: {}, baseUrl: null, acct: null };
  let lastSent = '';

  const baseFrom = (u) => {
    const m = String(u).match(/^(https?:\/\/[^/]+\/ut\/game\/[^/?#]+)/);
    return m ? m[1] : null;
  };

  const emit = () => {
    if (!state.sid) return;
    const key = JSON.stringify([state.sid, state.headers, state.baseUrl, state.acct]);
    if (key === lastSent) return;
    lastSent = key;
    window.postMessage({ source: SRC, type: 'session', payload: { sid: state.sid, headers: state.headers, baseUrl: state.baseUrl, acct: state.acct } }, '*');
  };

  // Hangi EA hesabı (galeri verisi hesaba özel saklanır): Web App açılışta usermassinfo ister → userInfo.personaId.
  // Yedek: Web App'in kullanıcı nesnesi (alan adları sürüme göre değişebilir).
  const setAcct = (id, name) => {
    if (id == null || id === '' || id === 0) return;
    const a = { id: String(id), name: name ? String(name) : null };
    if (state.acct?.id === a.id && state.acct?.name === a.name) return;
    state.acct = a;
    emit();
  };
  function readMassInfo() {
    try { const u = JSON.parse(this.responseText)?.userInfo; if (u) setAcct(u.personaId, u.personaName); } catch (_) {}
  }
  function acctFromApp() {
    try {
      const u = window.services?.User?.getUser?.();
      const p = u?.getSelectedPersona?.() || u?.selectedPersona || null;
      setAcct(p?.id ?? p?.personaId ?? u?.personaId ?? u?.selectedPersonaId ?? null, p?.name ?? p?.personaName ?? u?.personaName ?? null);
    } catch (_) {}
  }

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
    if (this.__fcg) {
      ingest(this.__fcg.url, this.__fcg.headers);
      if (/\/ut\/game\/[^?]*\/(transfermarket|tradepile|watchlist)\b/.test(String(this.__fcg.url))) this.addEventListener('load', readCollected);
      if (/\/ut\/game\/[^?]*\/usermassinfo\b/.test(String(this.__fcg.url))) this.addEventListener('load', readMassInfo);
    }
    return xSend.apply(this, a);
  };

  // fetch bilinçli olarak sarılmıyor: Web App UT isteklerini XHR ile yapar. fetch sarılınca sayfanın
  // kendi düşen istekleri (reklam engelleyici vb.) "Failed to fetch" olarak eklentinin hatalarına yazılıyordu.

  // Transfer pazarı rozeti: EA her ilan kartında isCollected taşıyor (galeride zaten toplanmış kart).
  // UTPlayerItemView.renderItem sarılır; görünümler yeniden kullanıldığı için rozet her çizimde güncellenir.
  // Bazı Web App sürümlerinde (Opera'da görüldü) kart nesnesi isCollected taşımıyor: o zaman EA'nın ham
  // pazar yanıtından okunur (kart id → isCollected). Görünüm yanıttan önce çizilirse kısa süre sonra yeniden bakılır.
  const collected = new Map();
  function readCollected() {
    try {
      const j = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || 'null');
      for (const a of j?.auctionInfo || []) {
        const it = a?.itemData;
        if (it?.id != null && typeof it.isCollected === 'boolean') collected.set(Number(it.id), it.isCollected);
      }
      if (collected.size > 5000) collected.clear();
    } catch (_) {}
  }
  const isCol = (item) => (typeof item?.isCollected === 'boolean' ? item.isCollected : collected.get(Number(item?.id)));

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
          const col = isCol(item);
          if (col === undefined && item?._auction?.tradeId) {
            // yanıt henüz okunmadıysa: aynı kart hâlâ bu görünümdeyse yeniden dene
            const view = this;
            setTimeout(() => { if (view.__fcgItem === item && isCol(item) === true) paint(root, item, true); }, 400);
          }
          this.__fcgItem = item;
          paint(root, item, col === true);
        }
      } catch (_) {}
      return r;
    };
    V.prototype.__fcgBadge = true;
    return true;
  };
  function paint(root, item, collectedNow) {
    const show = collectedNow && !!item?._auction?.tradeId;
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
  const badgeTimer = setInterval(() => { if (patchBadge()) clearInterval(badgeTimer); }, 1000);

  // Yedek: Web App'in kendi servis nesnesinden SID oku
  setInterval(() => {
    try {
      const id = (window.services?.Authentication?.utasSession?.id || window.services?.Authentication?.getUtasSession?.()?.id || window.services?.Authentication?.sessionUtas?.id || null);   // FC 27: utasSession
      if (!state.baseUrl) {
        for (const e of performance.getEntriesByType('resource')) { const b = baseFrom(e.name); if (b) { state.baseUrl = b; lastSent = ''; } }
      }
      if (id && id !== state.sid) state.sid = id;
      if (!state.acct) acctFromApp();
      emit();
    } catch (_) {}
  }, 5000);
})();
