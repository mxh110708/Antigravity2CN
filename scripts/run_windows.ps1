# No param block: preserve engine flags such as --install-dir as positional strings.
$ErrorActionPreference = 'Stop'
try {
    if ($args.Count -lt 1 -or $args[0] -notin @('install', 'restore', 'launch', 'check', 'runtime')) {
        throw 'Usage: run_windows.ps1 install|restore|launch|check|runtime [engine arguments]'
    }
    $mode = $args[0]
    $forwarded = @()
    if ($args.Count -gt 1) { $forwarded = @($args[1..($args.Count - 1)]) }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    . (Join-Path $PSScriptRoot 'portable_runtime.ps1')
    $node = Get-PortableNode -ProjectRoot $projectRoot
    # Keep external Node preload/module settings out of this dedicated runtime process.
    Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH -ErrorAction SilentlyContinue
    switch ($mode) {
        'runtime' { & $node --version }
        'install' { & $node (Join-Path $projectRoot 'localization_engine.js') @forwarded }
        'restore' { & $node (Join-Path $projectRoot 'localization_engine.js') --huifu @forwarded }
        'launch' { & $node (Join-Path $PSScriptRoot 'ensure_localized.js') --fix --launch @forwarded }
        'check' { & $node (Join-Path $PSScriptRoot 'ensure_localized.js') @forwarded }
    }
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("[ERROR] $($_.Exception.Message)")
    [Console]::Error.WriteLine('Use the complete Windows release ZIP for offline use. Source ZIPs need nodejs.org on first run.')
    exit 1
}
