# Gallery Grab

FC 27 Ultimate Team Web App için Chrome eklentisi (Manifest V3). Galeri (koleksiyon) doldurmak için listedeki her oyuncudan, **hangi versiyon olursa olsun en ucuz BIN ilanından 1 kart** alır.

> **Uyarı:** Web App'te otomatik alım yapmak EA kullanım şartlarına aykırıdır ve hesabın kısıtlanmasına ya da yasaklanmasına yol açabilir. Kullanım riski tamamen kullanıcıya aittir.

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
- **Arayüz:** Web App sol menüsünün en altında **GALLERY** sekmesi ve gömülü panel. Popup olarak da açılır.

## Kurulum

1. `chrome://extensions` sayfasını aç, **Geliştirici modu**'nu etkinleştir.
2. **Paketlenmemiş öğe yükle** ile bu klasörü seç.
3. EA FC Web App'i aç ve giriş yap. Transfer Pazarı → Oyuncu Ara ekranını bir kez aç; oturum ve oyuncu veritabanı bu sırada hazırlanır.
4. Sol menüdeki **GALLERY** sekmesinden oyuncuları ekle, bütçeyi gir ve **Başlat**'a bas.

## Dosya yapısı

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3 tanımı |
| `inject.js` | Sayfa bağlamı. XHR'dan `X-UT-SID`, başlıklar ve API adresini yakalar |
| `content.js` / `content.css` | Oturumu depoya yazar, keepalive sağlar, sol menü sekmesi ve paneli ekler |
| `background.js` | Liste yönetimi, en ucuzu bulma, alım döngüsü, hata protokolü |
| `lib/ea-api.js` | UT API istemcisi (`search`, `buyNow`, `credits`, `club`) |
| `lib/players.js` | `players.json` üzerinden oyuncu arama + yerelleştirme (loc) dosyalarından kulüp/lig/ülke id→isim sözlükleri |
| `lib/img.js` | EA görsel adresleri (yüz, arma, lig, bayrak) |
| `lib/pricing.js` | EA fiyat kademeleri |
| `popup.html` / `popup.js` | Kontrol paneli |

Ayrıntılı kod analizi: [ANALIZ.md](ANALIZ.md)
