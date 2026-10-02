# Değişiklik geçmişi

Bu dosya Gallery Grab'in sürümleri arasındaki değişiklikleri tutar. En yeni sürüm en üstte.
Sürüm numarası `manifest.json` ile aynıdır.

> Not: 1.1.1 ve öncesi tek bir commit içinde repoya alınmıştı. 1.2.0'dan itibaren her sürüm ayrı commit + `v*` etiketi olarak işaretlenir.

## [2.2.3] / [1.5.4] — 2026-10-02

### Düzeltildi
- **Özel kartların fazla fiyattan alınması** (ör. ~24.000'lik özel Veerman 46.000'e alındı): EA pazar araması oyuncunun
  tüm sürümlerini bitiş süresine göre getirir; sayfa başka sürümlerle doluysa aranan sürümün ucuz ilanı görünmüyordu ve
  arama "daha ucuzu yok" diye erken bitiyordu. Artık aynı fiyat aralığında 3 sayfaya kadar bakılır; sayfalar bitmeden
  sonuç kesinleşmezse bu durum işaretlenir.
- Fiyat fut.gg'nin 1,4 katından fazlaysa ve daha ucuzunun olmadığı kesinleşmediyse kart **alınmaz** (not düşülür) ve
  canlı fiyat olarak saklanmaz. Fiyat gerçekten yükselmişse (arama kesinleştiyse) alım yine yapılır.
- Canlı fiyat bakılmamış kartlarda sınır fut.gg × 2 yerine **fut.gg × 1,4** (en az fut.gg + 2.000).

## [1.5.3] — 2026-10-01

### Eklendi
- **`guncelle.bat`** (+ `tools/update.ps1`): GitHub'daki en yeni eklenti sürümünü indirip eklenti klasörünün üstüne
  yazar; klasör yolu aynı kaldığı için eklenti kimliği ve kayıtlı veriler korunur. Ardından Chrome'da Yenile yeterli.
  (Chrome paketlenmemiş eklentiyi kendisi güncellemez; Yenile yalnız klasörü yeniden okur.)
- **Yeni sürüm uyarısı:** GitHub'daki sürüm 6 saatte bir kontrol edilir; daha yeniyse galeri ekranında ve oyuncu
  listesi panelinde *Yeni sürüm var* bağlantısı görünür.

## [2.2.2] / [1.5.2] — 2026-10-01

### Değişti
- **Sırayla al** artık her setten önce seti EA'dan yeniden eşitler: o arada oyunda alınan/satılan kartlar hesaba katılır.
- **Oto derece canlı fiyatla seçilir:** seçilen derecenin eksik kartlarına pazardan güncel fiyat bakılır ve karar
  yeniden verilir; fiyat yüzünden derece düşerse yeni derecenin kartları da fiyatlanır (en çok 3 derece). Son 10 dakikada
  fiyatına bakılan kart yeniden aranmaz. Elle seçilen derecede yalnız eşitleme yapılır. Kartlar yine alımdan hemen önce
  pazardaki güncel en ucuz ilandan alınır.

## [2.2.1] / [1.5.1] — 2026-10-01

### Eklendi
- **Derin teşhis** (Teşhis penceresi): oyundaki galeri derecesinin Web App'te bir yerde olup olmadığını aramak için
  global sınıfları, servis/depo metotlarını, sabitleri, bu oturumda atılan UT adreslerini, yüklü uygulama kodundaki
  galeri/derece geçen adları, adresleri ve çevrelerini, dil dosyasındaki galeri metinlerini ve sayfa depolamasının
  anahtar adlarını raporlar. EA sunucusuna istek atmaz; SID, persona ve depolama değerleri rapora girmez.

### Düzeltildi
- **Oyunda notlandırılan derece geri düşüyordu** (ör. Frosinone oyunda S, galeride A): alınan kartlar satılınca EA
  onları artık toplanmış saymıyor ve derece kulüpteki kartlardan yeniden hesaplanıyordu. Artık eşitlemelerde görülen
  en yüksek puan hatırlanır ve derece bunun altına inmez; detayda **Oyundaki derece** seçicisiyle (Otomatik / D–S)
  oyundaki derece elle sabitlenebilir; **Sıfırla** düğmesi set için hatırlanan puanı ve seçimi siler. Planlayıcı ve otomatik derece seçimi de bu dereceyi kazanılmış sayar.

## [2.2.0] / [1.5.0] — 2026-09-30

### Eklendi
- **Çoklu seçim:** galeride "Çoklu seçim" açılınca kartlara tıklamak seti seçer (sıra numarası = alım sırası).
  Üstteki çubukta genel **hedef derece** (En yüksek / S / A / B / C / D), her set için ayrı derece (Oto = genel hedef),
  set başına alınacak derece + kart sayısı + maliyet, **Sekmedekileri seç**, **Temizle** ve **Sırayla al**.
  Seçim ve hedef tarayıcıda hatırlanır.
- **Sıralı işleme:** seçilen setler kuyrukta tek tek alınır (mevcut toplu alım akışı; Durdur her an çalışır).
- **Otomatik en yüksek derece:** derece, hedeften aşağı doğru *ulaşılabilir* ilk derecedir — fut.gg çözümü var,
  henüz kazanılmamış, eksik kartlardan ilanı olmadığı bilinen yok ve maliyet kullanılabilir coin'e sığıyor
  (güncel coin; galeri bütçesi girildiyse bütçeden kalanla sınırlı). Coin setlere sırayla paylaştırılır; yetmeyen
  set alt dereceye düşer (S → A → B …). Alım sırasında her setten önce güncel coin ve fiyatla yeniden seçilir.
- **Set detayı** artık varsayılan olarak ulaşılabilir en yüksek dereceyle açılır (hiçbiri ulaşılamıyorsa eski kural).

## [2.1.6] / [1.4.7] — 2026-09-30

### Düzeltildi
- **Bazı tarayıcılarda (Opera'da görüldü) her set 0/N görünüyordu.** Teşhis raporu: EA'nın ham yanıtında
  `isCollected`/`gradingScore` doğru geliyor, ama o Web App sürümünün kart nesnelerinde bu alanlar yok. Artık nesnede
  alan yoksa aynı `/defid` isteğinin ham yanıtından okunur (adres `PerformanceObserver` ile yakalanır). Alanı taşıyan
  Web App'te (Chrome) davranış ve istek sayısı değişmez.
- **Teşhis → Genel tarama** aynı durumda sayımı ham yanıttan yapar (raporda `hamYanittan` = bu yolla sayılan istek).
- **Pazar rozeti ("✓ Galeride")** aynı durumda EA'nın ham pazar yanıtından (transfermarket / tradepile / watchlist,
  kart id → `isCollected`) beslenir; görünüm yanıttan önce çizilirse 400 ms sonra yeniden bakılır.

## [2.1.5] / [1.4.6] — 2026-09-30

### Değişti
- **Kart başına en fazla** varsayılanı 50.000 → **0 (yok)**. Artık yalnız otomatik sınır (canlı ×1,25 / fut.gg ×2) ve
  galeri bütçesi geçerli; 50.000 üstü kartlar (ör. 57.000'lik Undav) gereksiz yere atlanmıyor. Ayarı hiç değiştirmemiş
  (50.000'de kalan) kullanıcılarda değer bir kez 0'a çekilir; elle başka bir değer girenlerinki korunur.

## [2.1.4] / [1.4.5] — 2026-09-30

### Değişti
- **Teşhis** genişledi: setin bütün takımları (ör. Arsenal erkek + kadın) ayrı ayrı sorgulanıyor; rapora kayıtlı eşitleme
  verisinin genel özeti (eşitlenen / toplanan set sayısı, tarih aralığı, alım sonrası ayarı), EA yanıtındaki tüm alan adları
  ve toplanmış / toplanmamış kartları ayıran alanlar eklendi. Bütün setlerin kayıtlı toplanan/gereken listesi de
  rapora giriyor (EA'ya ek istek atmaz). Web App yanıtı önbellekten verdiğinde ham yanıt için adres yeniden kuruluyor.

### Eklendi
- Teşhis penceresinde **Genel tarama (tümü)**: bütün setlerin bütün takımları/ligleri EA'dan tek tek sorgulanır, her set için
  toplanan/gereken, kart sayısı, kayıtlı özetten fark ve hatalar tek raporda toplanır. Başlamadan önce süre tahmini gösterilir,
  Durdur ile ya da pencere kapatılınca durur. Alım yapmaz.

## [2.1.3] / [1.4.4] — 2026-09-29

### Eklendi
- **Teşhis** düğmesi (galeri ekranı, "Kataloğu yenile" yanında): setler eşitlendiği hâlde hepsi 0/N görünüyorsa, seçilen set için
  EA'nın döndürdüğü toplanma bilgisini (Web App nesnesi + aynı isteğin ham yanıtı) raporlar. Alım yapmaz; rapor kişisel bilgi
  (persona, e-posta, oturum anahtarı) içermez, "Kopyala" ile destek için gönderilebilir.

## [1.4.3] — 2026-09-29 (Chrome eklentisi)

### Düzeltildi
- Set detayında başlığın altında görünen "null" yazısı kaldırıldı.
- Görsel adresi henüz öğrenilmeden (ilk kurulumda) galeri açılınca ekranın çökmesi düzeltildi.

## [2.1.2] / [1.4.2] — 2026-09-28

### Değişti
- Proje yeni GitHub hesabına taşındı: `github.com/JosephWRLD/gallery-grab`. Userscript güncelleme adresleri (`@updateURL` / `@downloadURL`) ve galeri kataloğu adresi buna göre güncellendi. Eski adres bir süre yönlendirmeye devam eder, yine de bu sürüme güncellemen önerilir.

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
