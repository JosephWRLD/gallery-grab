# Gallery Grab güncelleyici (paketlenmemiş Chrome eklentisi için).
# Chrome, "Paketlenmemiş öğe yükle" ile kurulan eklentiyi kendisi güncellemez; "Yenile" yalnız klasörü yeniden okur.
# Bu betik GitHub'daki en yeni eklenti sürümünü (v1.x etiketi) indirir ve AYNI klasörün üstüne yazar:
# klasör yolu değişmediği için eklenti kimliği ve kayıtlı veriler korunur. Ardından Chrome'da Yenile'ye basılır.
# Kullanım: guncelle.bat (ya da: powershell -ExecutionPolicy Bypass -File tools\update.ps1 [-Force])
param([switch]$Force)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'JosephWRLD/gallery-grab'
$dest = Split-Path -Parent $PSScriptRoot
$headers = @{ 'User-Agent' = 'gallery-grab-updater'; 'Accept' = 'application/vnd.github+json' }

function Done($msg, $code = 0) { Write-Host ''; Write-Host $msg; exit $code }

if (-not (Test-Path (Join-Path $dest 'manifest.json'))) { Done "manifest.json bulunamadı: $dest" 1 }
if (Test-Path (Join-Path $dest '.git')) { Done "Bu klasör bir git deposu; güncellemek için 'git pull' kullan." 1 }

$current = (Get-Content (Join-Path $dest 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "Kurulu sürüm: $current"

try {
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=30" -Headers $headers
} catch { Done "GitHub'a ulaşılamadı: $($_.Exception.Message)" 1 }

$rel = $releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^v1\.\d+\.\d+$' } |
  Sort-Object { [version]$_.tag_name.Substring(1) } -Descending | Select-Object -First 1
if (-not $rel) { Done 'GitHub''da eklenti sürümü bulunamadı.' 1 }
$latest = $rel.tag_name.Substring(1)
Write-Host "En yeni sürüm: $latest"

if (-not $Force -and [version]$latest -le [version]$current) { Done 'Zaten güncel. Bir şey yapmaya gerek yok.' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("gallery-grab-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'src.zip'
  Write-Host "İndiriliyor: $($rel.tag_name)…"
  Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/zipball/$($rel.tag_name)" -Headers $headers -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x')
  $src = Get-ChildItem (Join-Path $tmp 'x') -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'manifest.json'))) { Done 'İndirilen arşiv beklenen yapıda değil.' 1 }
  # Üstüne yazılır; klasördeki diğer dosyalar silinmez
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $dest -Recurse -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$now = (Get-Content (Join-Path $dest 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
Done "Güncellendi: $current → $now`nŞimdi Chrome'da chrome://extensions sayfasında Gallery Grab'in Yenile (↻) düğmesine bas ve Web App sekmesini yenile."
