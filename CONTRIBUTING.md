# Katkı rehberi / Contributing

**Türkçe** · [English](#english)

Gallery Grab'e ilgin için teşekkürler. Proje tek kişilik ve ücretsiz; aşağıdakiler işi ikimiz için de kolaylaştırır.

## Hata ve öneri

- **Hata:** [Hata bildir](https://github.com/JosephWRLD/gallery-grab/issues/new?template=hata.yml) formunu doldur. Sürüm numarası, tarayıcı ve (setler 0/N görünüyorsa) **Teşhis** raporu çoğu sorunu tek seferde çözer.
- **Öneri:** [Öneri](https://github.com/JosephWRLD/gallery-grab/issues/new?template=oneri.yml) formunu kullan.
- **Hızlı soru:** Discord `yusuflnx`.
- **Güvenlik açığı:** issue açma; [SECURITY.md](SECURITY.md)'deki yolu izle.

Raporlara EA hesap adı, e-posta, oturum anahtarı (`X-UT-SID`) ya da şifre koyma.

## Kod katkısı

1. Repoyu fork'la, `main`'den bir dal aç.
2. Değişikliği yap; mevcut kodun üslubuna uy (yorumlar Türkçe).
3. Kontrol et:
   - `node --test tests/*.test.mjs`
   - `lib/i18n.js` ya da `lib/gallery.js` değiştiyse `node tools/build-userscript.mjs` (CI bunu denetler)
   - Yeni arayüz metinleri `lib/i18n.js`'e **hem Türkçe hem İngilizce** eklenir.
   - Kullanıcıya görünen değişiklikler `CHANGELOG.md`'ye yazılır.
4. Pull request aç; şablondaki listeyi doldur.

Büyük bir değişiklikten önce bir issue açıp konuşmak boşa emek harcamanı önler.

**Lisans:** Katkın [PolyForm Noncommercial 1.0.0](LICENSE) lisansıyla yayımlanır. Projeyi ticari amaçla kullanmaya ya da satmaya yönelik katkılar kabul edilmez.

---

## English

Thanks for your interest in Gallery Grab. It's a free, one-person project; the notes below make things easier for both of us.

### Bugs and ideas

- **Bug:** fill in the [Bug report](https://github.com/JosephWRLD/gallery-grab/issues/new?template=hata.yml) form. The version, browser and (if sets show 0/N) the **Diagnostics** report solve most issues in one go.
- **Idea:** use the [Feature request](https://github.com/JosephWRLD/gallery-grab/issues/new?template=oneri.yml) form.
- **Quick question:** Discord `yusuflnx`.
- **Security vulnerability:** don't open an issue; follow [SECURITY.md](SECURITY.md).

Never include your EA account name, e-mail, session token (`X-UT-SID`) or password in a report.

### Code

1. Fork the repo and branch off `main`.
2. Make your change and match the existing style (code comments are in Turkish).
3. Check:
   - `node --test tests/*.test.mjs`
   - if `lib/i18n.js` or `lib/gallery.js` changed, `node tools/build-userscript.mjs` (CI checks this)
   - new UI strings go into `lib/i18n.js` in **both Turkish and English**
   - user-facing changes go into `CHANGELOG.md`
4. Open a pull request and fill in the template checklist.

For bigger changes, open an issue first so no effort is wasted.

**License:** contributions are released under [PolyForm Noncommercial 1.0.0](LICENSE). Contributions aimed at commercial use or selling the project are not accepted.
