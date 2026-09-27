# Değişiklik geçmişi

Bu dosya Gallery Grab'in sürümleri arasındaki değişiklikleri tutar. En yeni sürüm en üstte.
Sürüm numarası `manifest.json` ile aynıdır.

> Not: 1.1.1 ve öncesi tek bir commit içinde repoya alınmıştı. 1.2.0'dan itibaren her sürüm ayrı commit + `v*` etiketi olarak işaretlenir.

## [2.1.1] / [1.4.1] — 2026-09-27

### Değişti
- GALLERY sekmesi yalnız **oyun açıkken**, sol menüde görünüyor. Giriş ve yükleme ekranında sol kenarda çıkan yüzen buton kaldırıldı. Oturum kapanıp menü kaybolursa açık panel de kapanıyor.

## [2.1.0] — 2026-09-27 (userscript)

- Chrome eklentisi 1.4.0'daki **Galeri ekranının tamamı** userscript'e taşındı (aşağıdaki 1.4.0 maddelerinin hepsi); panelde "GALERİ | OYUNCU LİSTESİ" sekmeleri.
- Hesaplar ve dil sözlüğü `lib/gallery.js` + `lib/i18n.js`'ten `tools/build-userscript.mjs` ile gömülüyor; iki sürüm aynı kodu kullanıyor, CI güncelliğini denetliyor.
- Katalog GitHub'dan indiriliyor (yeni izinler: `@grant GM_xmlhttpRequest`, `@connect raw.githubusercontent.com`).
- Chrome eklentisiyle çakışmasın diye DOM kimlikleri ayrıldı (`#fcgu-tab`, `#fcgu-panel`); eklenti de yüklüyse panelde uyarı çıkıyor.
- EA sayfasını yormamak için panel kapalıyken çizim yapılmıyor, çizimler kareye bir kez birleştiriliyor; bir kutuya yazarken yeniden çizim bekliyor.

## [1.4.0] — 2026-09-27 (Chrome eklentisi)

### Eklendi — Galeri ekranı
- GALLERY sekmesi artık **FUT Galeri**'yi gösteriyor: lig sekmeleri, 126 set kartı (toplanan/gereken, set puanı, D·C·B·A·S notu; alt alta sonraki token, kazanılan, şu an alınabilen token ve puan, en fazla token).
- **Toplanma durumu EA'dan:** Web App'in konsept araması her kart için `isCollected` ve `gradingScore` veriyor; set puanı = toplananların en yüksek `gereken` tanesinin puan toplamı (FUTGenie ile birebir: Arsenal 18/20 · 64.851, Birmingham 15/15 · 820 · A).
- **Tümünü eşitle:** "N set, ~X dk" onay penceresi (ölçülen istek süresinden tahmin), kalan süreli ilerleme, "son 6 saatte eşitlenenleri atla". Tek bir set hata verirse bir kez daha denenir, olmazsa atlanır; art arda 3 set düşerse durur.
- **Set detayı:** fut.gg'nin her not için önerdiği en ucuz çözüm (gereken coin, toplam fiyat, vergi kaybı, puan (çözüm / hedef), token, kartlar); sende olan kartlar ✓ ile düşülür; kartlarda galeri puanı ("+410 puan"). Tümü/Eksik/Toplanan filtresi; setteki tüm kartların listesi.
- **Eşitle + güncel fiyat:** eksik kartların pazardaki güncel fiyatı (sarı), fut.gg fiyatı (soluk), ilanı olmayan (kırmızı); durum satırında arama izi ("800 bulundu · 750 ve altında ilan yok").
- **Bu çözümü al / Planı al:** eksik kartları güncel pazar fiyatından alır; alınan kart varsayılan olarak satışa konur (satış fiyatı: ödenen ya da fut.gg, ±%20, ilan süresi 1 sa–1 gün, tahmini kâr/zarar), istenirse transfer listesinde ya da unassigned'da bırakılır. Alımdan sonra set yeniden eşitlenir.
- **Token planlayıcı:** hedef token (Hall of FUT: 300 / 400 / 500 / 750) ya da coin bütçesi → her setten en fazla bir not seçen en ucuz plan (çoklu seçim sırt çantası; açgözlü seçimden 750 tokenda ~%50 ucuz).
- **Üst şerit:** galeri seviyesi (oyundan elle; sonraki ödül seviyesi), toplam galeri puanı, kazanılabilen puan, kazanılan / şu an alınabilen / en fazla token, tamamlanan set, oyunda notlandırılacak setler.
- **Sıralama ve filtre:** en çok / en az alınabilen token, en fazla token, mevcut kartlarla en çok token, en çok kalan, token başına en ucuz, sonraki token en ucuz, sonraki tokena en yakın, en çok tamamlanan; göster: tümü / şu an token alınabilenler / oyunda notlandırılacaklar / tamamlananlar / eşitlenmemişler.
- **Pazar rozeti:** transfer pazarı / transfer listesi / takip listesinde galeride zaten toplanmış kartlara "✓ Galeride".
- **Dil:** Türkçe / English (bayraklı seçici); ekran, durum mesajları ve bildirimler. Oyuncu listesi ekranı Türkçe kalıyor.
- Alt çubukta **Coin ↻**, **Galeri harcaması** (↺), **Galeri bütçesi**, **Kart başına en fazla**; sağ üstte "Destek & fikir: Discord yusuflnx".
- **Set kataloğu** `data/gallery-sets.json` (fut.gg'den `tools/build-gallery-sets.mjs`; çözümler, fiyatlar ve fiyat tarihleriyle). GitHub Actions her gün 21:00 (TR) yeniliyor; eklenti 21:40'tan sonra ilk açılışta çekiyor, başarısızsa 1 saat sonra yeniden deniyor. Fiyatlar 2 günden eskiyse detayda uyarı.

### Güvenlik
- **Kart başına fiyat sınırı:** canlı fiyat bakıldıysa canlı × 1,25; bakılmadıysa fut.gg × 2 (en az +2.000); üstüne "Kart başına en fazla" (varsayılan 50.000). Sınırı aşan kart alınmaz, raporda gerçek fiyatıyla yazılır ve o fiyat bir sonraki denemenin esası olur.
- **Holografik ve Başlangıç** setlerinde sahiplik Web App'ten doğrulanamadığı için eşitleme, alım ve planlama kapalı (önceki ara sürümde boş kart listesiyle "eşitlenmiş" görünüp 1,6 M coin'lik alım açılabiliyordu; eski kayıtlar açılışta siliniyor).
- **Transfer listesi 100 kartta dolunca** alım duruyor (önceden kartlar sessizce unassigned'da birikiyordu).
- **Galeri'ye ayrı bütçe** (oyuncu listesinin bütçesinden bağımsız).
- Durdur'dan hemen sonra başlatılan görevi eski görevin bitişi artık durduramıyor, durum mesajını da ezemiyor; beklenmedik görev hatası "çalışıyor" durumunda takılı bırakmıyor. Durdurulan alımda alınan kartların seti de "oyunda notlandır" olarak işaretleniyor.
- İlanı sürekli başkası kapan kart raporda yazıyor ("ilanlar hep başkası tarafından alındı").
- Sayfadan gelen UT adresi yalnız `*.ea.com/ut/game/` biçimindeyse kabul ediliyor; `host_permissions` `www.ea.com` ve `www.easports.com` ile sınırlandı.

### Düzeltildi
- **Alım sırasında ara ara "Oturum geçersiz":** FC 27'de güncel oturum `services.Authentication.utasSession` alanında (eski `sessionUtas` hep boştu); her istek gönderim anındaki anahtarla gidiyor. 401/403'te Web App kendi istemcisiyle dürtülüp (boşta süresi dolan oturumu yenilesin) istek bir kez tekrarlanıyor. Birden çok Web App sekmesi varsa oturumu açık olan seçiliyor.
- Eşitleme sırasında Galeri sayfası sekmelere zıplamıyor; detaydaki kart listesi güncellemede kapanmıyor.
- Armalar/portreler Oyuncu Ara ekranı açılmadan da geliyor (görsel kökü herhangi bir kart görselinden).
- Gömülü panelde Discord adı kopyalanabiliyor (iframe `clipboard-write`).

### Bilinen sınır
- Buradaki not/puan oyundaki **bonus etiketleri** (aynı kulüp, ilk sahip +%500 …) içermez; oyundaki not daha yüksek olabilir. Çözüm kartlarının hepsi sende olan notlar "oyunda notlandır" olarak işaretlenir. Token için setin **oyunda notlandırılması** gerekir (Web App notlandıramaz): kart alınan setler işaretlenir, "✓ Notlandırdım" ile temizlenir.

### Geliştirme
- `tests/` (node:test): puan/not, fut.gg planı, fiyat sınırı, planlayıcının kaba kuvvetle doğrulanması, dil sözlüğü paritesi, userscript güncelliği. `.github/workflows/ci.yml` her push'ta sözdizimi + testler + userscript denetimi.

## [2.0.3] — 2026-09-25

### Düzeltildi
- Bazı kulüplerin adı yanlış çıkıyordu. Örneğin erkek Arsenal (id 1) "Chemistry Points on Each Player: Max. %1" görünüyordu: yerelleştirme dosyasında sonu `1` ile biten ve içinde "team" geçen bir metin anahtarı kulüp adı sanılmıştı. Artık yalnız binlerce id'yi aynı önekle taşıyan asıl isim anahtarları kabul ediliyor, `%`/`{}` yer tutucusu içeren metinler eleniyor. Önbellek sürümü (`META_V` 3) artırıldı, eski sözlük kendiliğinden yenileniyor.
- Farklı kulüp uyarısı artık kulüp **adına** göre karşılaştırıyor. Erkek ve kadın takımları (ör. Arsenal / Arsenal WSL) farklı `teamId` taşıdığı için yanlışlıkla "farklı kulüp" işaretleniyordu.
- Kulüp/lig/ülke adı ekranda o anki sözlükten çözülüyor, listedeki eski yanlış adlar yeniden tarama gerektirmeden düzeliyor.

## [1.3.1] — 2026-09-25 (Chrome eklentisi)

- 2.0.3'teki üç düzeltme (kulüp adı sözlüğü, ada göre kulüp karşılaştırması, adların güncel sözlükten çözülmesi) MV3 eklentisine de uygulandı: `lib/players.js`, `popup.js`, `background.js` (`META_V` 3).

## [2.0.2] — 2026-09-23

### Eklendi
- **Lisans: [PolyForm Noncommercial 1.0.0](LICENSE)** — kaynak tamamen açık, kişisel kullanım/değiştirme/paylaşma serbest, **ticari kullanım ve satış yasak**.
- README'ye **Sorumluluk reddi ve yasal notlar** bölümü: garanti yok, EA ile bağlantı yok (marka notu), EA kullanım şartları uyarısı, hesap yaptırımlarının kullanıcı sorumluluğunda olduğu, depoda EA'ya ait veri bulunmadığı, hak sahibi talebinde deponun kaldırılacağı.
- Script başlığına `@license`, `@homepageURL`, `@supportURL`.

### Değişti
- `@updateURL` / `@downloadURL` artık gerçek adres: `raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js` → Tampermonkey güncellemeleri kendiliğinden yakalıyor.
- Depo **public** yapıldı (kaynak herkese açık).

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
