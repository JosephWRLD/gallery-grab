# Gallery Grab — Kod Analizi (v1.1.1)

Tarih: 2026-09-22. Kapsam: tüm kaynak dosyalar.

## 1. Mimari

Altyapı Kangal Snip ile aynı:
- `inject.js` oturumu yakalar.
- `content.js` oturumu depoya yazar, keepalive sağlar ve menü sekmesini ekler.
- `lib/ea-api.js` istekleri Web App sekmesinin içinde `fetch` ile çalıştırır.

Kangal'dan farkı: tek amaçlı, durumu az, satış ve listeleme yok.

```
popup  ── add / bulkAdd / start / stop ──►  background.js
                                             runLoop: sıradaki "pending" oyuncu
                                               └─ buyOne
                                                    ├─ findCheapest: maxb kademeli ≤5 arama
                                                    ├─ bütçe / coin kontrolü
                                                    └─ PUT /trade/{id}/bid  (460/461 → ≤3 tekrar)
                                             handleError: ciddi hatada tüm döngü durur
```

**Depolama anahtarları:**
- `galleryList`: `{id, baseId, name, rating, status, price, note}`
- `gallerySettings`: `{budget}`
- `galleryRun`: `{running, spent, coins, text, level}`
- `session`

**Service worker yeniden başlarsa:** Çalışma "durdu" olarak işaretlenir ve kendiliğinden devam etmez. Bu bilinçli, güvenli tarafta kalmak için.

## 2. İstek maliyeti

- Oyuncu başına: 1–5 arama + 1 alım (+ en fazla 3 tekrar).
- Aramalar arası bekleme 0,4–0,9 sn, oyuncular arası 1–2,5 sn.
- 50 oyuncuda ≈150–300 istek, birkaç dakikada. Dakikada 60+ isteğe çıkabilir.

## 3. Güçlü yanlar

- Kapsam dar ve anlaşılır. Kart unassigned'da kalır, satış mantığı yok, karmaşa yok.
- Ciddi hatada (captcha, 429, 471, 494, softban, 401) tüm döngü duruyor, devam etmiyor.
- Bütçe ve coin kontrolü her alımdan önce yapılıyor.
- `token` ile durdurma anında etkili. Yarım kalan alım sonrası döngü bitiyor.
- Arayüzde `textContent` kullanılıyor, `innerHTML` yok (XSS yok).

## 4. Bulgular

| # | Önem | Yer | Bulgu | Öneri |
|---|---|---|---|---|
| G1 | **Yüksek** | `background.js:84,168` | Hız sınırı ve insan benzeri bekleme yok. Aramalar arası 0,4–0,9 sn çok agresif. Uzun listede captcha ya da softban riski yüksek. Kangal'daki saatlik limit, mola ve log-normal bekleme burada yok. | Oyuncular arası 4–10 sn, aramalar arası 1,5–3 sn bekleme; saatlik istek limiti (ör. 300); her ~30 oyuncuda mola. |
| G2 | Orta | `lib/ea-api.js` `search`, `findCheapest` | `minb` rastgeleleştirilmiyor. EA aynı URL'ye önbellekli sonuç dönebiliyor, bu da satılmış ilanların gelmesine ve 460/461 tekrarlarına yol açıyor. | Kangal'daki `jitterMinBin` mantığını ekle. |
| G3 | Orta (doğrulanmadı) | `background.js` `buyOne` | Alınan kartlar unassigned'da birikiyor. EA'nın unassigned sınırı dolarsa sonraki her alım hata verir ve her oyuncu için boşuna istek harcanır. Tüm döngü durmuyor. | Sınır hatasını (kod gerçek testte belirlenecek) ciddi hata listesine ekle ya da art arda N alım hatasında dur. |
| G4 | Orta | `background.js:57` `bulkAdd` | Toplu eklemede isim başına ilk eşleşme alınıyor. Ortak isimlerde (ör. "Silva", "Rodrygo") yanlış oyuncu eklenebilir. | Tam eşleşme yoksa "belirsiz" diye işaretle ve kullanıcıya seçtir. |
| G5 | Düşük | `background.js` | İşlem günlüğü ve istek sayacı yok. Hata olunca yalnız son durum metni ve oyuncu notu kalıyor. | Kangal'daki `log()` ve `recordRequest()` taşınabilir. |
| G6 | Düşük | `background.js:98` | Bütçe kontrolü `run.spent` ile yapılıyor ama "Harcananı sıfırla" çalışma sırasında basılırsa bütçe fiilen yeniden açılıyor. | Çalışırken bu düğmeyi devre dışı bırak. |
| G7 | Bilgi | `background.js:231` | SW yeniden başlayınca çalışma otomatik devam etmiyor. Uzun listede Chrome SW'yi kapatırsa kullanıcı yeniden başlatmalı. | Bilinçli tercih, belgelendi. |

## 5. Doğrulanmamış varsayımlar

- `players.json` alan adları ve `maskedDefId` = base id. Arama ve alımın çalıştığı kullanıcı tarafından doğrulandı, ama alan eşlemesi her oyuncu için test edilmedi.
- Alım yanıtında coin alanı (`parseCoins(r)`).
- EA'nın unassigned havuzu sınırı ve dolunca döndüğü hata kodu.

## 6. Kangal Snip ile ilişki

- Kod tabanı ortak: `inject.js`, `content.js`, `lib/ea-api.js` ve oyuncu araması neredeyse aynı.
- Menü sekmesi: Gallery Grab kendi sekmesini her zaman en alta taşır, Kangal sırayı zorlamaz. Bu sayede ikisi aynı anda yüklüyken DOM döngüsü oluşmaz.
- Panel kapanma: Kangal sekmesine ya da `#fc27-dock`'a tıklanınca Galeri paneli kapanır.
