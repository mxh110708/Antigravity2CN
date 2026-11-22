# Project-local development SDK. Ordinary installs keep using the smaller .runtime.
function Assert-ProjectDevToolchain {
    param([string]$Directory, $Spec)
    Assert-RuntimeDirectory $Directory
    $node = Join-Path $Directory 'node.exe'
    $npm = Join-Path $Directory 'node_modules/npm/bin/npm-cli.js'
    Assert-RuntimeFile $node $Spec.NodeSha256
    Assert-RuntimeFile (Join-Path $Directory 'LICENSE') $Spec.LicenseSha256
    if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { throw 'Project development SDK is incomplete: npm-cli.js is missing.' }
    return [pscustomobject]@{ Node = $node; NpmCli = $npm; Directory = $Directory }
}

function Get-ProjectDevToolchain {
    param([string]$ProjectRoot, [ValidateSet('x64', 'arm64')][string]$Architecture = (Get-WindowsNodeArchitecture))
    $spec = Get-NodeRuntimeSpec -ProjectRoot $ProjectRoot -Architecture $Architecture
    $toolRoot = Join-Path $ProjectRoot '.dev-tools'
    $directory = Join-Path $toolRoot $spec.Directory
    Assert-RuntimeDirectory $toolRoot
    if (Test-Path -LiteralPath $directory) { return Assert-ProjectDevToolchain $directory $spec }
    New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
    $lock = $null
    $stage = $null
    $archive = $null
    try {
        $lockPath = Join-Path $toolRoot 'setup.lock'
        if ((Test-Path -LiteralPath $lockPath) -and ((Get-Item -LiteralPath $lockPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Development SDK lock cannot be a linked file.'
        }
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        if (Test-Path -LiteralPath $directory) { return Assert-ProjectDevToolchain $directory $spec }
        $prefix = Join-Path $toolRoot ([Guid]::NewGuid().ToString('N'))
        $archive = "$prefix.zip.part"
        $stage = "$prefix.stage"
        Write-Host "[Dev] Preparing project-local Node.js and npm from $($spec.Url)"
        Save-NodeRuntimeArchive -Uri $spec.Url -Destination $archive
        Assert-RuntimeFile $archive $spec.ArchiveSha256
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            $stagePrefix = [IO.Path]::GetFullPath($stage) + [IO.Path]::DirectorySeparatorChar
            foreach ($entry in $zip.Entries) {
                if (-not $entry.FullName.StartsWith("$($spec.Directory)/", [StringComparison]::Ordinal)) {
                    throw 'Unexpected root in development SDK archive.'
                }
                $target = [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
                if (-not $target.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw 'Development SDK archive entry escapes its staging directory.'
                }
            }
        } finally { $zip.Dispose() }
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
        $staged = Join-Path $stage $spec.Directory
        $null = Assert-ProjectDevToolchain $staged $spec
        $toolPrefix = [IO.Path]::GetFullPath($toolRoot) + [IO.Path]::DirectorySeparatorChar
        if (-not ([IO.Path]::GetFullPath($staged)).StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFullPath($directory)).StartsWith($toolPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Unsafe SDK promotion path.'
        }
        Move-Item -LiteralPath $staged -Destination $directory
        return Assert-ProjectDevToolchain $directory $spec
    } finally {
        if ($archive -and (Test-Path -LiteralPath $archive -PathType Leaf)) { Remove-Item -LiteralPath $archive -Force }
        if ($stage -and (Test-Path -LiteralPath $stage)) {
            $resolvedStage = [IO.Path]::GetFullPath($stage)
            $rootPrefix = [IO.Path]::GetFullPath($toolRoot) + [IO.Path]::DirectorySeparatorChar
            if (-not $resolvedStage.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe SDK cleanup path.' }
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
        if ($null -ne $lock) { $lock.Dispose() }
    }
}
