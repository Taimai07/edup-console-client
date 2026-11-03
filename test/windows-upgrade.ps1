$ErrorActionPreference = 'Stop'
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$stage = Join-Path $env:RUNNER_TEMP 'edup-upgrade-fixture'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$old = Join-Path $stage 'previous-0.2.0.exe'
Invoke-WebRequest 'https://github.com/Taimai07/edup-console-client/releases/download/v0.2.0/EDUPLINK-Setup-0.2.0.exe' -OutFile $old
if ((Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash.ToLower() -ne '4055d053a61eccb5dca08ea7c51538accbb5d2e32b5f1641615e9a6f15042a92') { throw 'Previous installer hash mismatch' }
$installDir = Join-Path $stage 'installed'
$p = Start-Process -FilePath $old -ArgumentList @('/S',"/D=$installDir") -WindowStyle Hidden -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'Previous installer failed' }
# Synthetic data only, on an isolated GitHub runner. Never run this against a user's profile.
$dataDir = Join-Path $env:APPDATA $pkg.productName
if (Test-Path -LiteralPath $dataDir) { throw 'Expected a fresh isolated runner profile' }
New-Item -ItemType Directory -Path $dataDir | Out-Null
$names = @('connection.json','device-identity.bin','snapshot.bin')
$before = @{}
foreach ($name in $names) {
  $file = Join-Path $dataDir $name
  [IO.File]::WriteAllBytes($file,[Text.Encoding]::UTF8.GetBytes("isolated-upgrade-fixture-$name"))
  $before[$name] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
}
$new = (Resolve-Path "dist/EDUPLINK-Setup-$($pkg.version).exe").Path
$p = Start-Process -FilePath $new -ArgumentList @('/S',"/D=$installDir") -WindowStyle Hidden -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'New installer failed' }
foreach ($name in $names) {
  if ((Get-FileHash -LiteralPath (Join-Path $dataDir $name) -Algorithm SHA256).Hash -ne $before[$name]) { throw "User state changed: $name" }
}
$exe = Join-Path $installDir "$($pkg.productName).exe"
$receipt = Join-Path $stage 'self-check.json'
$p = Start-Process -FilePath $exe -ArgumentList @('--self-check',"`"$receipt`"") -WindowStyle Hidden -Wait -PassThru
if ($p.ExitCode -ne 0 -or !(Test-Path -LiteralPath $receipt)) { throw 'Installed application self-check failed' }
$check = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
if (!$check.ok -or !$check.packaged -or $check.version -ne $pkg.version -or $check.userDataBasename -ne $pkg.productName) { throw 'Installed version or data location mismatch' }
if (!$check.patchBootstrap -or $check.bootstrapVersion -ne $pkg.version) { throw 'Patch bootstrap missing' }
@{ previous='0.2.0'; current=$pkg.version; preservedFiles=$names.Count; selfCheck=$check } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath dist/windows-upgrade-receipt.json -Encoding utf8
Write-Host "Upgrade from 0.2.0 to $($pkg.version): state preserved; packaged headless self-check passed."
