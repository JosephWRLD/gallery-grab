# Değişiklik geçmişi

Bu dosya Gallery Grab'in sürümleri arasındaki değişiklikleri tutar. En yeni sürüm en üstte.
Sürüm numarası `manifest.json` ile aynıdır.

> Not: 1.1.1 ve öncesi tek bir commit içinde repoya alınmıştı. 1.2.0'dan itibaren her sürüm ayrı commit + `v*` etiketi olarak işaretlenir.

## [2.0.1] — 2026-09-23

### Eklendi
- **İletişim**: panelin altında "Sorun, hata ya da öneri olursa yaz — Discord: **yusuflnx**" satırı ve kullanıcı adını kopyalayan düğme.
- Çalışmayı durduran ciddi hataların bildiriminde de iletişim bilgisi geçiyor ("Sorun sürerse yaz: Discord yusuflnx").
- Script başlığında `@author` alanına Discord adı eklendi; açıklamaya iletişim notu girdi.

## [2.0.0] — 2026-09-23

**Dağıtım biçimi değişti: Chrome eklentisi → Tampermonkey kullanıcı scripti.**
Tek dosya: `userscript/gallery-grab.user.js`. Kurulum için Chrome Web Store, paketleme ya da geliştirici modu gerekmiyor; güncelleme `@updateURL` ile kendiliğinden geliyor. MV3 eklenti sürümü (1.3.0) referans olarak repoda kalıyor ama artık geliştirilmiyor.

### Eklendi
- `userscript/gallery-grab.user.js`: eklentinin tüm işlevleri tek self-contained script içinde — oyuncu arama/toplu ekleme, en ucuz BIN bulma (kademeli `maxb`), alım döngüsü, bütçe, fiyat taraması, kulüp taraması, "sende var" rozeti, farklı kulüp uyarısı, hata protokolü, sol menüdeki GALLERY sekmesi ve panel.
- Çalışma sürerken sekme kapatılmak istenirse tarayıcı uyarısı (`beforeunload`).

### Değişti
- Oturum: `chrome.storage` + content script köprüsü yerine XHR başlık yakalama doğrudan sayfa bağlamında; SID yedeği `window.services.Authentication.sessionUtas.id`.
- EA istekleri: `chrome.scripting.executeScript` köprüsü kalktı, doğrudan sayfa `fetch`'i kullanılıyor (`credentials: 'omit'`).
- Depolama: `chrome.storage.local` → `GM_setValue/GM_getValue` (senkron; yoksa `localStorage`). Durum değişince `chrome.storage.onChanged` yerine doğrudan `render()`.
- Panel: `web_accessible_resources` + iframe yerine sayfaya doğrudan basılan DOM; stiller `#fcg-panel` altında kapsüllendi (EA'nın CSS'i sızmasın).
- Bildirim: `chrome.notifications` → `GM_notification`.
- Görseller (yüz, arma, bayrak) artık kayıtta tutulmuyor, çizim anında `imgBase`'den üretiliyor; sözlük sonradan yüklenince satırlar kendiliğinden düzeliyor.

### Notlar
- **Alım döngüsü yalnız Web App sekmesi açıkken sürer** (service worker yok). Sekme kapanırsa çalışma durur.
- Popup penceresi yok; panel sol menüdeki GALLERY sekmesinden açılır.
- Tampermonkey kurulu olmalı. Yayınlamak için `@updateURL` / `@downloadURL` satırlarındaki `example.com` gerçek adresle değiştirilmeli.

## [1.3.0] — 2026-09-23

### Eklendi
- **Farklı kulüp uyarısı**: listedeki oyuncuların kulübü beklenen kulüpten farklıysa o satır **kırmızı** görünür (kırmızı şerit + kırmızı isim + `farklı kulüp` rozeti), listenin üstünde özet çıkar: "N oyuncu farklı kulüpte — yanlış oyuncu eklenmiş olabilir". Aynı isimli oyuncu yüzünden yanlış kartın listeye girdiği tek bakışta görülür.
- **Beklenen kulüp seçici**: varsayılan **otomatik** (listede en çok geçen kulüp), istenirse açılır listeden bir kulüp sabitlenir (`gallerySettings.expectClub`, `setExpectClub` mesajı).

### Notlar
- Kulüp bilgisi ancak **"Fiyatları tara"** ya da alım sonrası dolduğu için uyarı o zaman görünür; kulübü henüz bilinmeyen satır nötr kalır (yanlış alarm yok).
- Tek kulüp varsa ya da en çok geçen iki kulüp eşit sayıdaysa uyarı verilmez; ikinci durumda panel "çoğunluk yok — kulüp seçin" der.
- Uyarı yalnız görseldir: alımı engellemez, satırı atlamaz.

## [1.2.0] — 2026-09-23

### Eklendi
- **Görsel oyuncu ayrımı** (aynı isimli oyuncuları ayırt etmek için):
  - Arama sonuçlarında ve listede oyuncunun **yüz fotoğrafı**.
  - Fiyat taraması ya da alım sonrasında **kulüp arması, ülke bayrağı** ve `mevki · kulüp · lig · ülke` satırı.
- **"Fiyatları tara"**: alım yapmadan her oyuncunun en ucuz BIN'ini ve kulüp/lig/ülke bilgisini doldurur, listenin altında tahmini kalan maliyeti gösterir. 30 dakikadan eski fiyatlar tazelenir.
- **"Kulübü tara"**: kulüpteki oyuncular sayfalanarak okunur, base id kümesi saklanır; listede **"sende var"** rozeti çıkar.
- **"Kulübümde olanları atla"** seçeneği: açıkken alım sırasında kulüpte zaten olan oyuncu atlanır (`owned` durumu).
- `lib/img.js`: EA görsel adresleri (yüz, kulüp arması, lig, bayrak).
- İsim sözlüğü yüklenemezse panelde sebep ve örnek anahtarlar gösterilir.

### Değişti
- Kulüp/lig/ülke id→isim sözlükleri artık `teamconfig.json` yerine Web App'in **yerelleştirme (`/loc/`) dosyalarından** çıkarılıyor; `teamconfig.json` isim içermiyor (ölçüm: 2584 kulüp, 151 lig, 218 ülke).
- `lib/ea-api.js`: `club` uç noktası eklendi (`GET /club?start&count&sort&sortBy&type=player`).
- Sabit veri için `galleryMeta` önbelleği: `META_V = 2`, 7 gün TTL; sözlük boş kaldıysa önbelleğe güvenilmeyip yeniden denenir.
- `gallerySettings` artık `skipOwned` alanını da tutuyor.
- Tarama görevleri için ortak `startTask()` ve hata sınıflandırması için ortak `stopReason()`.

### Notlar
- Kulüp sayfalamasında sunucu `start` parametresini yok sayarsa aynı sayfanın dönüp durmasına karşı koruma var; toplam alan adı (`totalResults`/`total`/`count`) üçü de denenir.
- Taramalar sürerken Başlat ve tarama düğmeleri kilitlenir.

## [1.1.1] — 2026-09-22

### Eklendi
- İlk sürüm: oyuncu arama ve toplu ekleme, kademeli `maxb` taramasıyla en ucuz BIN'i bulma, alım döngüsü (460/461'de yeniden deneme), toplam bütçe sınırı, ciddi hatalarda (captcha, 429, 471, 494, softban, 401) tüm çalışmayı durduran hata protokolü.
- EA Web App sol menüsünün en altında **GALLERY** sekmesi ve gömülü panel; popup olarak da açılır.
- `README.md` ve kod analizi `ANALIZ.md`.
