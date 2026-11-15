$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function u([string]$s) { [regex]::Unescape($s) }

& {
    if ([Environment]::Is64BitOperatingSystem -eq $false) {
        Write-Error (u 'ClauseDown \u306F 64 \u30D3\u30C3\u30C8\u7248\u306E Windows \u306B\u306E\u307F\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059\u3002')
    }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        Write-Host (u 'ARM \u7248\u306E Windows \u3067\u306F\u3001x64 \u7248\u3092\u5165\u308C\u307E\u3059\uFF08\u30A8\u30DF\u30E5\u30EC\u30FC\u30B7\u30E7\u30F3\u3067\u52D5\u4F5C\u3057\u307E\u3059\uFF09\u3002')
    }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/SHIOZAKI-Shota/ClauseDown/releases/latest' -Headers @{ 'User-Agent' = 'ClauseDown-installer' }
    $asset = $release.assets | Where-Object { $_.name -match '^ClauseDown-Setup-[\d.]+\.exe$' } | Select-Object -First 1
    if (-not $asset) {
        Write-Error (u '\u6700\u65B0\u7248\u306E Windows \u7248\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002')
    }
    $path = Join-Path $env:TEMP $asset.name
    Write-Host ((u '\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u3066\u3044\u307E\u3059\uFF1A{0}\uFF08{1} MB\uFF09') -f $asset.name, [math]::Round($asset.size / 1MB))
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $path -UseBasicParsing
    try {
        Write-Host (u '\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3057\u3066\u3044\u307E\u3059\u2026')
        Start-Process -FilePath $path -ArgumentList '/S' -Wait
    } finally {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
    Write-Host ((u 'ClauseDown {0} \u3092\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3057\u307E\u3057\u305F\u3002\u30B9\u30BF\u30FC\u30C8\u30E1\u30CB\u30E5\u30FC\u304B\u3089\u8D77\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002') -f $release.tag_name)
}
