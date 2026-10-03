# Gallery Grab — Kod Analizi (eklenti v1.4.0 · userscript v2.1.0)

Tarih: 2026-09-27. Kapsam: tüm kaynak dosyalar, katalog verisi, katalog üretimi ve GitHub Actions.

## 1. Mimari

```
EA Web App sekmesi (www.ea.com/.../web-app)
 ├─ inject.js (MAIN)      UT isteklerinden X-UT-SID / adres yakalar → postMessage; pazar rozeti (UTPlayerItemView yaması)
 ├─ content.js (izole)    oturumu storage'a yazar (adres doğrulamalı), keepalive, sol menü sekmesi + gömülü panel (iframe)
 └─ sayfa bağlamında çalıştırılanlar (chrome.scripting, world MAIN)
      ├─ lib/gallery-api.js  services.Item.searchConceptItems → set kartları (isCollected, gradingScore)
      └─ lib/ea-api.js       UT API: transfermarket, bid, item, auctionhouse, tradepile, credits (gönderim anındaki SID ile)

background.js (service worker)  görevler: eşitleme, canlı fiyat, alım (sınır / bütçe / transfer listesi), satışa koyma,
                                oyuncu listesi; tek görev belirteci (token) + stop(my)
gallery.html / gallery.js       Galeri ekranı (iframe ya da ayrı sekme); chrome.storage üzerinden durum
lib/gallery.js                  saf hesaplar (puan/not, fut.gg planı, fiyat sınırı, planlayıcı, sıralama)
lib/i18n.js                     TR / EN sözlük
lib/catalog.js                  gömülü katalog + GitHub'dan günlük güncelleme
data/gallery-sets.json          126 set: filtre (takım / lig / nadirlik), eşikler, ödüller, fut.gg çözümleri + tarih

userscript/gallery-grab.user.js aynı işlevler tek dosyada; lib/i18n.js + lib/gallery.js tools/build-userscript.mjs ile gömülü
tools/build-gallery-sets.mjs    fut.gg SSR verisinden katalog (düzenli ifade; kod çalıştırmadan)
.github/workflows               gallery-sets.yml (her gün 18:00 UTC = 21:00 TR), ci.yml (sözdizimi + testler + userscript)
```

**Veri kaynakları:** toplanma durumu ve kart puanı EA'dan (konsept araması), set tanımları ve önerilen çözümler fut.gg'den, pazar fiyatı EA transfer pazarından.

## 2. Doğrulanan davranışlar
- Set puanı = toplanan kartların en yüksek `gereken` tanesinin `gradingScore` toplamı. FUTGenie ile birebir aynı: Arsenal 18/20 · 64.851, Birmingham 15/15 · 820 · A, Chelsea 12/20 · 10.553, Coventry 1/15 · 35.
- Transfer pazarı sonuçları da `isCollected` taşıyor; rozet bunu kullanıyor.
- Fiyat araması: bulunan en ucuzdan bir basamak aşağısıyla (`maxb`) yeniden aranır, en fazla 5 arama. Özel sürümler `minb` ile bulunur (Undav TOTW 88.500 → 86.000 bulundu).
- FC 27'de güncel UT oturumu `services.Authentication.utasSession.id`.
- Katalog: eşikler artan, tier tokenları kümülatif, çözüm kart sayıları ≤ gereken, bir takım yalnız bir sette.

## 3. 2026-09-27 analizinde bulunup düzeltilenler
| Önem | Sorun | Düzeltme |
|---|---|---|
| Yüksek | Alımda fiyat üst sınırı yoktu (planlayıcı canlı fiyata bakmadan alabiliyordu) | Kart başına sınır: canlı × 1,25 / fut.gg × 2 (+2.000) + "Kart başına en fazla" |
| Yüksek | Holografik / Başlangıç setleri boş listeyle "eşitlenip" 1,6 M coin'lik alıma açılabiliyordu | Bu setlerde eşitleme / alım / planlama kapalı, eski kayıtlar siliniyor |
| Yüksek | Durdur → yeni görev: eski görevin bitişi yeni görevi durdurabiliyordu | `stop(text, level, my)` |
| Yüksek | Transfer listesi dolunca plan sessizce devam ediyordu | Doluluk izleniyor, 100'de duruyor |
| Orta | Görev hatası "çalışıyor"da takılı bırakıyordu | Görevler hata yakalayıcıyla başlatılıyor |
| Orta | Tek zaman aşımı tüm eşitlemeyi kesiyordu | Bir kez tekrar, sonra atla; art arda 3 hatada dur |
| Orta | Eşitlemede sayfa sekmelere zıplıyordu; kart listesi kapanıyordu | Yalnız sekme değişince yatay kaydırma; açık durum hatırlanıyor |
| Orta | Katalog indirme hatasında bir gün bekleniyordu | 1 saat sonra yeniden deneme; gömülü kopya bellekte |
| Orta | Bilinmeyen kategorideki set kulüp seti sanılabiliyordu | Kulüp filtresi yalnız 5 lig kategorisinde; bilinmeyende nadirlik tespiti ya da "desteklenmiyor"; yeni set uyarısı |
| Orta | Bayat fiyat sessiz kalıyordu | Set başına `sol.at`, 2 günden eskiyse uyarı; çözümlerin çoğu okunamazsa build başarısız |
| Orta | Galeri ve oyuncu listesi aynı bütçe sayısını farklı sayaçla ölçüyordu | Ayrı galeri bütçesi |
| Orta | Görseller Oyuncu Ara açılmadan gelmiyordu | Herhangi bir kart görselinden görsel kökü |
| Orta | Userscript panel kapalıyken de her durumda tüm DOM'u çiziyordu; eklentiyle aynı DOM kimlikleri | Çizim birleştirme, kapalıyken çizmeme, odak koruması; `fcgu-` kimlikleri + uyarı |
| Orta | Token için oyunda notlandırma gerektiği söylenmiyordu | "Oyunda notlandır" rozeti, üst şerit kutusu, filtre, "✓ Notlandırdım" |
| Düşük | Sayfadan gelen UT adresi doğrulanmıyordu; izinler genişti | `*.ea.com/ut/game/` doğrulaması; `host_permissions` daraltıldı |
| Düşük | Gömülü panelde panoya kopyalama; EN modda Türkçe kalan metinler; `fmtDur` saat; fiyat kayıtları büyüyordu | Düzeltildi |

## 4. Bilinen sınırlar
- **Bonus etiketleri (1.6.0'dan beri hesaplanıyor):** puan = taban + en yüksek 10 etiket bonusu; motor fut.gg dizilimleriyle birebir. Yalnız **İlk Sahip** (+%150–500) EA verisinde olmadığı için sayılamaz; bu kartları olan setlerde oyundaki puan daha yüksek olabilir.
- **Notlandırma oyunda:** Web App notlandıramaz; "Notlandırdım" işareti kullanıcıya bırakılır.
- **Galeri seviyesi** Web App verisinde yok, elle giriliyor.
- **fut.gg çözümleri kişiselleştirilmemiş:** sıfırdan hesaplanıyor. Sende güçlü kartlar varsa daha az kartla aynı nota ulaşılabilir.
- **Doğrulanmamış:**
  - alınan kartın anında `isCollected` olması (alım sonrası eşitleme kontrol ediyor);
  - 401'de Web App'i dürtmenin yeniden girişi tetiklemesi;
  - konsept aramasının tüm sürümleri döndürmesi;
  - EA'nın unassigned sınırı.
- **Katalog kaynağı:** fut.gg sayfa yapısı ya da erişim politikası değişirse günlük iş başarısız olur (dosya yazılmaz, son katalog kullanılmaya devam eder).

## 5. Sonraki adımlar (önerilen, bu sürümde yok)
- ~~**Bonus etiket motoru**~~ — 1.6.0'da yapıldı (`setScore`, `bestLineup`, katalog `tags` + kart özellikleri, günlük öz denetim).
- **Kişiselleştirilmiş en ucuz yol:** bonus motoruna bağlı.
- **Kod tekrarı:** eklenti ve userscript'te görev ve arayüz kodu tekrar ediyor. Ortak modül + bundler (esbuild) ile tek kaynaktan iki çıktı.
- **Katalog geçmişi:** günlük katalog commit'leri main'i büyütür; ileride ayrı bir `catalog` dalı ya da Release varlığı.
