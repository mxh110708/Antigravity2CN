param(
    [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture,
    [string]$OutputDirectory = '',
    [string]$SourceCommit = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'portable_runtime.ps1')
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$packageName = "antigravity2-cn-windows-$Architecture"
$stage = Join-Path $output $packageName
$archive = Join-Path $output "$packageName.zip"
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $archive)) {
    throw 'Build output already exists. Choose a fresh OutputDirectory.'
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
# Explicit allowlist prevents tests, credentials, caches or local configuration entering releases.
foreach ($name in @('localization_engine.js', 'README.md', 'src', 'dicts')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage -Recurse
}
Get-ChildItem -LiteralPath $projectRoot -Filter '*.bat' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $stage
}
$scripts = Join-Path $stage 'scripts'
New-Item -ItemType Directory -Path $scripts | Out-Null
foreach ($name in @('node-runtime.json', 'portable_runtime.ps1', 'run_windows.ps1', 'ensure_localized.js')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scripts
}
# Reuse an already verified local cache where available; otherwise download from nodejs.org.
$spec = Get-NodeRuntimeSpec -ProjectRoot $projectRoot -Architecture $Architecture
$cached = Join-Path (Join-Path $projectRoot '.runtime') $spec.Directory
if (Test-Path -LiteralPath $cached) {
    $node = Get-PortableNode -ProjectRoot $projectRoot -Architecture $Architecture -Offline
    $destination = Join-Path (Join-Path $stage '.runtime') $spec.Directory
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($name in @('node.exe', 'LICENSE')) {
        Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $node) $name) -Destination $destination
    }
}
$null = Get-PortableNode -ProjectRoot $stage -Architecture $Architecture
$metadata = [ordered]@{ sourceCommit = $SourceCommit; architecture = $Architecture; nodeVersion = (Get-Content -LiteralPath (Join-Path $scripts 'node-runtime.json') -Raw | ConvertFrom-Json).version }
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'build-info.json') -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
$hash = Get-RuntimeFileSha256 $archive
"$hash  $packageName.zip" | Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII
Write-Host "Created $archive"
