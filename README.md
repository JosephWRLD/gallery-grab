# Gallery Grab

FC 27 Ultimate Team Web App için **FUT Galeri** aracı: Web App'te olmayan Galeri'yi sol menüye ekler, setlerin durumunu EA'dan okur, fut.gg'nin en ucuz çözümlerini gösterir ve eksik kartları güncel pazar fiyatından alır. İki sürümü var: **Chrome eklentisi** (v1.4.1) ve **Tampermonkey kullanıcı scripti** (v2.1.1). İkisi aynı hesap kodunu kullanır; **ikisini birlikte kurma**.

> **Uyarı:** Web App'te otomatik alım yapmak EA kullanım şartlarına aykırıdır ve hesabın kısıtlanmasına ya da kalıcı yasaklanmasına yol açabilir. Proje ücretsizdir, satılmaz, EA ile hiçbir bağlantısı yoktur ve garanti verilmez. Kullanım riski tamamen kullanıcıya aittir — ayrıntılar: [Sorumluluk reddi](#sorumluluk-reddi-ve-yasal-notlar).

## Sorumluluk reddi ve yasal notlar

- Bu proje **ücretsizdir, satılmaz** ve hiçbir şekilde ticari olarak sunulmaz. Kodu alıp **satmak, ücretli hizmete/aboneliğe katmak ya da başka türlü ticari amaçla kullanmak lisansla yasaklanmıştır**; kişisel kullanım, değiştirme ve paylaşma serbesttir. Kaynak kodu açıktır, lisansı [PolyForm Noncommercial 1.0.0](LICENSE)'dır — **ticari kullanım ve satış yasaktır** ve **hiçbir garanti verilmez** ("as is").
- Bu proje **Electronic Arts Inc. ile hiçbir bağlantısı yoktur**, EA tarafından onaylanmamış, desteklenmemiş ya da sponsor edilmemiştir. "EA", "EA SPORTS", "FC", "FIFA" ve "Ultimate Team" sahiplerinin ticari markalarıdır; burada yalnızca tanımlama amacıyla anılır. Depoda EA'ya ait hiçbir görsel, ses, kod ya da veri bulunmaz — script çalışırken yalnızca kullanıcının tarayıcısının zaten indirdiği verileri okur.
- **EA Web App'te otomatik işlem yapmak EA kullanım şartlarına aykırıdır.** Kullanmak hesabının kısıtlanmasına, oyun içi varlıklarının silinmesine ya da kalıcı yasaklanmasına yol açabilir. Bu riski kabul etmiyorsan kullanma.
- Yazılım **eğitim ve kişisel deneme amacıyla** paylaşılmıştır. Kullanımdan doğan tüm sonuçlar (hesap yaptırımları, coin kaybı, veri kaybı dâhil) **tamamen kullanıcının sorumluluğundadır**; geliştirici hiçbir sorumluluk kabul etmez.
- Herhangi bir güvenlik önlemi, ödeme sistemi ya da koruma mekanizması atlatılmaz; script kullanıcının kendi oturumunu, kendi tarayıcısında kullanır. Hesap satışı, coin ticareti ya da üçüncü kişiler adına işlem için kullanılamaz.
- Set kataloğu (eşikler, ödüller, önerilen çözümler) herkese açık [fut.gg](https://www.fut.gg/fut-gallery/) sayfalarından günlük olarak derlenir; fut.gg ile de bir bağlantı yoktur.
- Hak sahibi bir kurum kaldırılmasını isterse depo kaldırılır — bunun için [İletişim](#i̇leti̇şi̇m) bölümündeki adrese yazılması yeterlidir.

## İletişim

Sorun, hata ya da öneri olursa yaz: **Discord `yusuflnx`** (Galeri ekranının sağ üstünde; tıklayınca kopyalanır).

## Galeri ekranı

- **Setler lig sekmeleriyle:** Premier League / Barclays WSL, LALIGA / Liga F, Bundesliga, Ligue 1, Serie A, Ligler, Nadirlikler (126 set). Her kartta `toplanan / gereken`, set puanı, ulaşılan not (D·C·B·A·S) ve alt alta: sonraki token, kazanılan, şu an alınabilen token ve puan, en fazla token.
- **Üst şerit:** galeri seviyesi (oyundan elle girilir — Web App bu bilgiyi vermiyor), toplam galeri puanı, kazanılabilen puan, kazanılan / şu an alınabilen / en fazla token, tamamlanan set, **oyunda notlandırılacak** setler.
- **Tümünü eşitle:** tüm setlerin toplanma durumunu EA'dan okur (Web App'in "konsept oyuncu" araması her kart için `isCollected` ve `gradingScore` döndürüyor); önce kaç set eşitleneceğini ve tahmini süreyi sorar, son 6 saatte eşitlenenleri atlayabilir. Tek bir set hata verirse bir kez daha dener, olmazsa atlayıp devam eder.
- **Set detayı — fut.gg çözümleri:** her not için fut.gg'nin önerdiği en ucuz kart çözümü; sende olan kartlar ✓ ile işaretlenip maliyetten düşülür. **Eşitle + güncel fiyat** eksik kartların pazardaki güncel fiyatına bakar; **Bu çözümü al** onaydan sonra eksikleri alır.
- **Alım güvenliği:**
  - Her kart için **fiyat sınırı** var: canlı fiyat bakıldıysa canlı fiyatın %25 fazlası, bakılmadıysa fut.gg fiyatının 2 katı (en az +2.000). Üstüne "Kart başına en fazla" ayarı (varsayılan 50.000) gelir.
  - Sınırı aşan kart alınmaz; raporda gerçek fiyatıyla yazılır ve bir sonraki denemede o fiyat esas alınır.
  - Ayrıca **Galeri bütçesi** (galeri harcaması bu tutara ulaşınca durur) ve coin bakiyesi kontrolü var.
  - Transfer listesi dolunca (100) alım durur.
  - Holografik ve Başlangıç setlerinde sahiplik Web App'ten doğrulanamadığı için eşitleme ve alım kapalıdır; bu setler yalnız bilgi olarak gösterilir.
- **Alımdan sonra:** kart varsayılan olarak **satışa konur**. Satış fiyatı ödenen ya da fut.gg fiyatı olabilir, ±%20 ayarlanabilir ve ilan süresi seçilebilir. Kart yine toplanmış sayılır, gerçek maliyet ≈ %5 vergidir. İstenirse kart transfer listesinde ya da unassigned'da bırakılır.
- **Oyunda notlandırma:** Web App setleri notlandıramaz. Token'ı almak için seti oyunda (konsol / PC) Galeri'den notlandırman gerekir. Kart aldığın setler ve çözüm kartlarının hepsi sende olan setler "oyunda notlandır" rozetiyle işaretlenir. Notlandırınca detaydaki **✓ Notlandırdım** düğmesiyle işareti kaldırırsın.
- **Token planlayıcı:** hedef token (Hall of FUT: 300 / 400 / 500 David Luiz / 750 Pato–Hulk) ya da coin bütçesi girersin. Her setten en fazla bir not seçen en ucuz plan hesaplanır; **Planı al** setleri sırayla alır.
- **Sıralama / filtre, Coin ↻, pazar rozeti:** pazarda zaten toplanmış kartlara "✓ Galeride" rozeti gelir. Dil Türkçe / English (bayraklı seçici).
- **Katalog:** `data/gallery-sets.json`, `tools/build-gallery-sets.mjs` ile fut.gg'den üretilir. GitHub Actions bunu **her gün 21:00'de (TR)** yeniler. Eklenti 21:40'tan sonra ilk açılışta yeni sürümü çeker; indirme başarısız olursa 1 saat sonra yeniden dener, ağ yoksa gömülü kopyayı kullanır. Setin fiyatları 2 günden eskiyse detayda uyarı çıkar.

**Bilinen sınır:** Buradaki not ve puan, oyundaki **bonus etiketleri** (aynı kulüp, ilk sahip +%500 vb.) içermez. Oyundaki not daha yüksek olabilir. fut.gg çözümleri bonuslarla hesaplanmıştır; o yüzden "Puan (çözüm / hedef)" hedefin altında görünse de oyunda notu verir.

## Oyuncu listesi ekranı (eski özellik)

Listeye eklenen her oyuncudan, hangi versiyon olursa olsun **en ucuz BIN ilanından 1 kart** alır. Özellikler:

- `players.json` üzerinden oyuncu arama ve toplu ekleme
- Yüz / arma / bayrak ile ayırt etme ve "farklı kulüp" uyarısı
- Fiyat ve kulüp taraması
- Bütçe
- Hata protokolü: captcha, 429, 471, 494, softban ya da oturum hatasında durur

Galeri ekranının sağ üstündeki "Oyuncu listesi" bağlantısıyla açılır. Bu ekran yalnız Türkçe.

## Kurulum — Chrome eklentisi (önerilen)

1. `chrome://extensions` sayfasını aç, **Geliştirici modu**'nu etkinleştir.
2. **Paketlenmemiş öğe yükle** ile bu klasörü seç.
3. EA FC Web App'i aç ve giriş yap.
4. Oyun açılınca (giriş yapıp ana ekran yüklendikten sonra) sol menünün en altında **GALLERY** sekmesi görünür; onunla Galeri'yi aç. Sıra: **Tümünü eşitle** → bir sete tıkla → not sekmesini seç → **Eşitle + güncel fiyat** → **Bu çözümü al**.

## Kurulum — Tampermonkey

1. Chrome'a [Tampermonkey](https://www.tampermonkey.net/) kur.
2. **[Scripti kur](https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js)** bağlantısına tıkla; Tampermonkey kurulum ekranını açar.
3. EA FC Web App'i aç, giriş yap ve sol menünün en altındaki **GALLERY** sekmesinden paneli aç ("GALERİ | OYUNCU LİSTESİ").

Güncellemeler Tampermonkey tarafından kendiliğinden kontrol edilir. Katalog GitHub'dan indirilir (`@connect raw.githubusercontent.com`).

## Geliştirme

- `node --test tests/*.test.mjs` — hesap fonksiyonları, dil sözlüğü ve userscript'in güncelliği testleri.
- `node tools/build-userscript.mjs` — `lib/i18n.js` + `lib/gallery.js` değişince userscript'teki gömülü bloğu yeniler. CI bunu denetler.
- `node tools/build-gallery-sets.mjs` — kataloğu fut.gg'den üretir. Bilinmeyen kategori ya da yeni set için log'a uyarı basar; çözümlerin çoğu okunamazsa dosyayı yazmaz.

## Dosya yapısı

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3 tanımı (eklenti v1.4.1) |
| `inject.js` | Sayfa bağlamı: UT isteklerinden oturumu yakalar, pazar rozetini ekler |
| `content.js` / `content.css` | Oturumu depoya yazar (adres doğrulamalı), keepalive, sol menü sekmesi ve gömülü panel |
| `background.js` | Görevler: eşitleme, canlı fiyat, alım (fiyat sınırı, bütçe, transfer listesi), satışa koyma, oyuncu listesi |
| `gallery.html` / `gallery.js` | Galeri ekranı |
| `popup.html` / `popup.js` | Oyuncu listesi ekranı |
| `lib/gallery.js` | Saf hesaplar: puan/not, fut.gg planı, fiyat sınırı, token planlayıcı, sıralama |
| `lib/i18n.js` | Türkçe / English sözlük |
| `lib/gallery-api.js` | Web App'in konsept aramasıyla setin kartlarını okuma |
| `lib/ea-api.js` | UT API istemcisi (sekme seçimi, oturum yenileme) |
| `lib/catalog.js` | Katalog yükleme ve günlük GitHub güncellemesi |
| `lib/players.js`, `lib/img.js`, `lib/pricing.js` | Oyuncu arama + isim sözlükleri, görsel adresleri, fiyat basamakları |
| `data/gallery-sets.json` | Set kataloğu (126 set, fut.gg çözümleri ve fiyat tarihleriyle) |
| `userscript/gallery-grab.user.js` | Tampermonkey sürümü (v2.1.1) |
| `tools/`, `tests/`, `.github/workflows/` | Katalog/userscript üretimi, testler, günlük katalog işi ve CI |

Kod analizi ve bilinen sınırlar: [ANALIZ.md](ANALIZ.md)
