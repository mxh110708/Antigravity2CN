# Dedicated development commands; no system installation or sibling project is needed.
$ErrorActionPreference = 'Stop'
$exitCode = 1
$originalPath = $env:PATH
$originalNodeOptions = $env:NODE_OPTIONS
$originalNodePath = $env:NODE_PATH
$originalNpmCache = $env:npm_config_cache
try {
    $mode = 'check'
    if ($args.Count -gt 0) { $mode = $args[0] }
    if ($args.Count -gt 1 -or $mode -notin @('setup', 'ci', 'check', 'test')) {
        throw 'Usage: dev.ps1 setup|ci|check|test'
    }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    . (Join-Path $PSScriptRoot 'portable_runtime.ps1')
    . (Join-Path $PSScriptRoot 'dev_toolchain.ps1')
    $tools = Get-ProjectDevToolchain -ProjectRoot $projectRoot
    $env:PATH = "$($tools.Directory);$originalPath"
    $env:npm_config_cache = Join-Path $projectRoot '.dev-tools/npm-cache'
    Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH -ErrorAction SilentlyContinue
    Push-Location -LiteralPath $projectRoot
    try {
        switch ($mode) {
            'setup' {
                Write-Host "[Dev] SDK: $($tools.Directory)"
                & $tools.Node --version
                if ($LASTEXITCODE -ne 0) { throw 'Project-local Node.js failed.' }
                & $tools.Node $tools.NpmCli --version
            }
            'ci' { & $tools.Node $tools.NpmCli ci --ignore-scripts --no-audit --no-fund }
            'check' { & $tools.Node $tools.NpmCli run check }
            'test' { & $tools.Node $tools.NpmCli test }
        }
        $exitCode = $LASTEXITCODE
    } finally { Pop-Location }
} catch {
    [Console]::Error.WriteLine("[Dev ERROR] $($_.Exception.Message)")
} finally {
    # The PATH change applies only to this process and its child commands.
    $env:PATH = $originalPath
    $env:NODE_OPTIONS = $originalNodeOptions
    $env:NODE_PATH = $originalNodePath
    $env:npm_config_cache = $originalNpmCache
}
exit $exitCode
