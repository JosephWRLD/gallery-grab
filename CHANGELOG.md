# Değişiklik geçmişi

Bu dosya Gallery Grab'in sürümleri arasındaki değişiklikleri tutar. En yeni sürüm en üstte.
Sürüm numarası `manifest.json` ile aynıdır.

> Not: 1.1.1 ve öncesi tek bir commit içinde repoya alınmıştı. 1.2.0'dan itibaren her sürüm ayrı commit + `v*` etiketi olarak işaretlenir.

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
