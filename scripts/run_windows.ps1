# No param block: preserve engine flags such as --install-dir as positional strings.
$ErrorActionPreference = 'Stop'
try {
    if ($args.Count -lt 1 -or $args[0] -notin @('install', 'restore', 'launch', 'check', 'runtime', 'update', 'config')) {
        throw 'Usage: run_windows.ps1 install|restore|launch|check|runtime|update|config [arguments]'
    }
    $mode = $args[0]
    $forwarded = @()
    if ($args.Count -gt 1) { $forwarded = @($args[1..($args.Count - 1)]) }
    $skipUpdateCheck = $false
    if ($mode -in @('install', 'launch')) {
        $filtered = @()
        foreach ($item in $forwarded) {
            if ($item -eq '--no-update-check') { $skipUpdateCheck = $true }
            else { $filtered += $item }
        }
        $forwarded = $filtered
    }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    . (Join-Path $PSScriptRoot 'portable_runtime.ps1')
    $node = Get-PortableNode -ProjectRoot $projectRoot
    # Keep external Node preload/module settings out of this dedicated runtime process.
    Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH -ErrorAction SilentlyContinue
    $updaterScript = Join-Path $PSScriptRoot 'self_update.js'
    if ($mode -in @('install', 'launch') -and (-not $skipUpdateCheck) -and (Test-Path -LiteralPath $updaterScript -PathType Leaf)) {
        try { & $node $updaterScript auto --quiet-when-off } catch { }
    }
    switch ($mode) {
        'runtime' { & $node --version }
        'install' { & $node (Join-Path $projectRoot 'localization_engine.js') @forwarded }
        'restore' { & $node (Join-Path $projectRoot 'localization_engine.js') --huifu @forwarded }
        'launch' { & $node (Join-Path $PSScriptRoot 'ensure_localized.js') --fix --launch @forwarded }
        'check' { & $node (Join-Path $PSScriptRoot 'ensure_localized.js') @forwarded }
        'update' { & $node $updaterScript apply --reinstall @forwarded }
        'config' { & $node $updaterScript config @forwarded }
    }
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("[ERROR] $($_.Exception.Message)")
    [Console]::Error.WriteLine('Use the complete Windows release ZIP for offline use. Source ZIPs need nodejs.org on first run.')
    exit 1
}
