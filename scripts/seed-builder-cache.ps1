$ErrorActionPreference = 'Stop'
$cache = $env:ELECTRON_BUILDER_CACHE
if (!$cache -and $env:RUNNER_TEMP) {
    $cache = Join-Path $env:RUNNER_TEMP 'edup-builder-cache'
}
if ([string]::IsNullOrWhiteSpace($cache) -or ![IO.Path]::IsPathFullyQualified($cache)) {
    throw 'Builder cache must be an absolute directory.'
}
$assets = @(
    @{Release='winCodeSign-2.6.0'; Id=18435274; Sha='cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'},
    @{Release='nsis-3.0.4.1'; Id=16428442; Sha='9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'},
    @{Release='nsis-resources-3.4.1'; Id=13752602; Sha='593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'}
)
foreach ($asset in $assets) {
    $directory = Join-Path $cache $asset.Release
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $target = Join-Path $directory ($asset.Release + '.7z')
    $partial = $target + '.download'
    $url = 'https://api.github.com/repos/electron-userland/electron-builder-binaries/releases/assets/' + $asset.Id + '?download=1'
    Invoke-WebRequest -Uri $url -Headers @{Accept='application/octet-stream'} -UserAgent 'EDUPLINK-build' -OutFile $partial -TimeoutSec 60
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.Sha) {
        throw ('Unexpected builder tool digest for ' + $asset.Release)
    }
    Move-Item -LiteralPath $partial -Destination $target
    Write-Host ('Verified ' + $asset.Release)
}
if ($env:GITHUB_ENV) {
    Add-Content -LiteralPath $env:GITHUB_ENV -Encoding utf8 -Value ('ELECTRON_BUILDER_CACHE=' + $cache)
}
