# Gallery Grab

FC 27 Ultimate Team Web App için **Tampermonkey kullanıcı scripti** (eski MV3 Chrome eklentisi sürümü de repoda duruyor). Galeri (koleksiyon) doldurmak için listedeki her oyuncudan, **hangi versiyon olursa olsun en ucuz BIN ilanından 1 kart** alır.

> **Uyarı:** Web App'te otomatik alım yapmak EA kullanım şartlarına aykırıdır ve hesabın kısıtlanmasına ya da kalıcı yasaklanmasına yol açabilir. Proje ücretsizdir, satılmaz, EA ile hiçbir bağlantısı yoktur ve garanti verilmez. Kullanım riski tamamen kullanıcıya aittir — ayrıntılar: [Sorumluluk reddi](#sorumluluk-reddi-ve-yasal-notlar).

## Sorumluluk reddi ve yasal notlar

- Bu proje **ücretsizdir, satılmaz** ve hiçbir şekilde ticari olarak sunulmaz. Kodu alıp **satmak, ücretli hizmete/aboneliğe katmak ya da başka türlü ticari amaçla kullanmak lisansla yasaklanmıştır**; kişisel kullanım, değiştirme ve paylaşma serbesttir. Kaynak kodu açıktır, lisansı [PolyForm Noncommercial 1.0.0](LICENSE)'dır — **ticari kullanım ve satış yasaktır** ve **hiçbir garanti verilmez** ("as is").
- Bu proje **Electronic Arts Inc. ile hiçbir bağlantısı yoktur**, EA tarafından onaylanmamış, desteklenmemiş ya da sponsor edilmemiştir. "EA", "EA SPORTS", "FC", "FIFA" ve "Ultimate Team" sahiplerinin ticari markalarıdır; burada yalnızca tanımlama amacıyla anılır. Depoda EA'ya ait hiçbir görsel, ses, kod ya da veri bulunmaz — script çalışırken yalnızca kullanıcının tarayıcısının zaten indirdiği verileri okur.
- **EA Web App'te otomatik işlem yapmak EA kullanım şartlarına aykırıdır.** Kullanmak hesabının kısıtlanmasına, oyun içi varlıklarının silinmesine ya da kalıcı yasaklanmasına yol açabilir. Bu riski kabul etmiyorsan kullanma.
- Yazılım **eğitim ve kişisel deneme amacıyla** paylaşılmıştır. Kullanımdan doğan tüm sonuçlar (hesap yaptırımları, coin kaybı, veri kaybı dâhil) **tamamen kullanıcının sorumluluğundadır**; geliştirici hiçbir sorumluluk kabul etmez.
- Herhangi bir güvenlik önlemi, ödeme sistemi ya da koruma mekanizması atlatılmaz; script kullanıcının kendi oturumunu, kendi tarayıcısında kullanır. Hesap satışı, coin ticareti ya da üçüncü kişiler adına işlem için kullanılamaz.
- Hak sahibi bir kurum kaldırılmasını isterse depo kaldırılır — bunun için [İletişim](#i̇leti̇şi̇m) bölümündeki adrese yazılması yeterlidir.

## İletişim

Sorun, hata ya da öneri olursa yaz: **Discord `yusuflnx`**
Panelin altında da aynı bilgi ve kopyalama düğmesi var; çalışmayı durduran hatalarda bildirimde de görünür.

## Özellikler

- **Oyuncu arama:** Web App'in kendi `players.json` veritabanından; hem yaygın ad (Iniesta) hem tam ad (Andrés Iniesta Luján) eşleşir. Toplu ekleme için her satıra bir isim yazılır, bulunamayanlar kutuda kalır.
- **Görsel ayırt etme:** Arama sonuçlarında ve listede oyuncunun **yüz fotoğrafı**; fiyat taraması veya alım sonrasında **kulüp arması, ülke bayrağı, mevki · kulüp · lig · ülke**. Aynı isimli oyuncuları ayırmak için.
- **Farklı kulüp uyarısı:** Beklenen kulüp (varsayılan: listede en çok geçen kulüp, istenirse açılır listeden sabitlenir) dışında kalan oyuncuların satırı kırmızı görünür ve "farklı kulüp" rozeti alır; üstte kaç oyuncunun uyuşmadığı yazar. Uyarı yalnız görseldir, alımı engellemez.
- **Fiyat taraması:** "Fiyatları tara" alım yapmadan her oyuncunun en ucuz BIN'ini ve kulüp/lig/ülke bilgisini doldurur, toplam tahmini maliyeti gösterir (30 dakikadan eski fiyatlar tazelenir).
- **Kulüp taraması:** "Kulübü tara" kulüpteki oyuncuları okur; listede "sende var" rozeti çıkar. "Kulübümde olanları atla" açıksa alım sırasında atlanır.
- **En ucuz ilanı bulma:** Kademeli `maxb` taramasıyla, en fazla 5 arama yapılır.
- **Alım:** Başkası önce alırsa en fazla 3 kez tekrar denenir. Alınan kart **unassigned** havuzunda kalır.
- **Bütçe:** Toplam bütçe sınırı konabilir. Coin yetmezse o oyuncu atlanır.
- **Hata protokolü:** Captcha, 429, 471, 494, softban ya da 401 alınırsa tüm çalışma durur ve bildirim gösterilir.
- **Liste durumları:** bekliyor · alındı · bulunamadı · bütçe yetmedi · hata. "Atlananları tekrar dene" düğmesi var.
- **Arayüz:** Web App sol menüsünün en altında **GALLERY** sekmesi ve tam ekran panel.

## Kurulum — Tampermonkey (önerilen)

1. Chrome'a [Tampermonkey](https://www.tampermonkey.net/) kur.
2. **[Scripti kur](https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js)** bağlantısına tıkla — Tampermonkey kurulum ekranını açar. (Alternatif: dosyanın içeriğini kopyalayıp Tampermonkey → **Yeni script** içine yapıştır ve kaydet.)
3. EA FC Web App'i aç, giriş yap, **Transfer Pazarı → Oyuncu Ara** ekranını bir kez aç (oturum, oyuncu veritabanı ve isim sözlükleri bu sırada hazırlanır).
4. Sol menünün en altındaki **GALLERY** sekmesinden paneli aç.

Güncellemeler Tampermonkey tarafından kendiliğinden kontrol edilir.

## Kurulum — Chrome eklentisi (v1.3.0, artık geliştirilmiyor)

1. `chrome://extensions` sayfasını aç, **Geliştirici modu**'nu etkinleştir.
2. **Paketlenmemiş öğe yükle** ile bu klasörü seç.
3. EA FC Web App'i aç ve giriş yap. Transfer Pazarı → Oyuncu Ara ekranını bir kez aç; oturum ve oyuncu veritabanı bu sırada hazırlanır.
4. Sol menüdeki **GALLERY** sekmesinden oyuncuları ekle, bütçeyi gir ve **Başlat**'a bas.

## Dosya yapısı

| Dosya | Görev |
|---|---|
| `userscript/gallery-grab.user.js` | **Tampermonkey sürümü (v2.0.0) — tek dosyada tüm işlevler** |
| `manifest.json` | MV3 tanımı (eklenti sürümü, v1.3.0) |
| `inject.js` | Sayfa bağlamı. XHR'dan `X-UT-SID`, başlıklar ve API adresini yakalar |
| `content.js` / `content.css` | Oturumu depoya yazar, keepalive sağlar, sol menü sekmesi ve paneli ekler |
| `background.js` | Liste yönetimi, en ucuzu bulma, alım döngüsü, hata protokolü |
| `lib/ea-api.js` | UT API istemcisi (`search`, `buyNow`, `credits`, `club`) |
| `lib/players.js` | `players.json` üzerinden oyuncu arama + yerelleştirme (loc) dosyalarından kulüp/lig/ülke id→isim sözlükleri |
| `lib/img.js` | EA görsel adresleri (yüz, arma, lig, bayrak) |
| `lib/pricing.js` | EA fiyat kademeleri |
| `popup.html` / `popup.js` | Kontrol paneli |

Ayrıntılı kod analizi: [ANALIZ.md](ANALIZ.md)
