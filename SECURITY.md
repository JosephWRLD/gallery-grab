# Güvenlik politikası / Security policy

## Desteklenen sürümler / Supported versions

Yalnız en son sürüm desteklenir: Chrome eklentisinde son `v1.x`, Tampermonkey'de son `v2.x`.
Only the latest release is supported: the latest `v1.x` for the Chrome extension and the latest `v2.x` for Tampermonkey.

## Açık bildirme / Reporting a vulnerability

**Herkese açık issue açma.** [Gizli bildirim formunu](https://github.com/JosephWRLD/gallery-grab/security/advisories/new) kullan
(Security → Report a vulnerability). Ulaşamazsan Discord'dan `yusuflnx`'e yaz, ayrıntıyı orada paylaşma; gizli kanalı birlikte belirleriz.

**Don't open a public issue.** Use the [private reporting form](https://github.com/JosephWRLD/gallery-grab/security/advisories/new)
(Security → Report a vulnerability). If that doesn't work, message `yusuflnx` on Discord without the details, and we'll pick a private channel.

Örnekler / Examples: oturum anahtarının (`X-UT-SID`) sızması, eklentinin başka sitelerde kod çalıştırması, katalog güncellemesinin
değiştirilebilmesi / session token (`X-UT-SID`) leaks, the extension running code on other sites, tampering with catalog updates.

Kapsam dışı / Out of scope: EA'nın hesap yaptırımları (README'deki uyarıya bak) ve EA Web App'in kendi açıkları
/ EA account sanctions (see the README warning) and vulnerabilities in the EA Web App itself.

Bildirimlere birkaç gün içinde dönülür; düzeltme yayımlanınca bildiren kişi (istersen) CHANGELOG'da anılır.
Reports get a reply within a few days; once fixed, the reporter is credited in the CHANGELOG if they wish.
