# Shared by the Windows launchers and release packager. Compatible with PowerShell 5.1.
function Get-WindowsNodeArchitecture {
    param([string]$ProcessorArchitecture = $(if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }))
    switch ($ProcessorArchitecture.ToLowerInvariant()) {
        { $_ -in 'amd64', 'x64' } { return 'x64' }
        'arm64' { return 'arm64' }
        default { throw 'Only 64-bit Windows (x64 or ARM64) is supported.' }
    }
}

function Get-NodeRuntimeSpec {
    param([string]$ProjectRoot, [ValidateSet('x64', 'arm64')][string]$Architecture)
    $manifest = Get-Content -LiteralPath (Join-Path $ProjectRoot 'scripts/node-runtime.json') -Raw | ConvertFrom-Json
    if ($manifest.version -notmatch '^v\d+\.\d+\.\d+$') { throw 'Invalid portable Node.js version.' }
    $platform = $manifest.windows.$Architecture
    foreach ($digest in @($platform.archiveSha256, $platform.nodeSha256, $manifest.licenseSha256)) {
        if ($digest -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid portable Node.js SHA-256 manifest.' }
    }
    $directory = "node-$($manifest.version)-win-$Architecture"
    return [pscustomobject]@{
        Directory = $directory
        Url = "https://nodejs.org/dist/$($manifest.version)/$directory.zip"
        ArchiveSha256 = $platform.archiveSha256
        NodeSha256 = $platform.nodeSha256
        LicenseSha256 = $manifest.licenseSha256
    }
}

function Get-RuntimeFileSha256 {
    param([string]$LiteralPath)
    $stream = [IO.File]::OpenRead($LiteralPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Assert-RuntimeFile {
    param([string]$LiteralPath, [string]$Sha256)
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) { throw "Portable runtime file is missing: $LiteralPath" }
    $file = Get-Item -LiteralPath $LiteralPath -Force
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Portable runtime cannot use a linked file: $LiteralPath" }
    if ((Get-RuntimeFileSha256 $LiteralPath) -ne $Sha256) {
        throw "Portable runtime SHA-256 mismatch: $LiteralPath. Extract a fresh release package or remove .runtime and retry."
    }
}

function Assert-RuntimeDirectory {
    param([string]$LiteralPath)
    if (Test-Path -LiteralPath $LiteralPath) {
        $directory = Get-Item -LiteralPath $LiteralPath -Force
        if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Portable runtime requires a regular directory: $LiteralPath"
        }
    }
}

function Save-NodeRuntimeArchive {
    param([string]$Uri, [string]$Destination)
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        $proxy = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { '' }
        $params = @{
            UseBasicParsing = $true
            Uri = $Uri
            OutFile = $Destination
            MaximumRedirection = 0
            TimeoutSec = 180
        }
        if ($proxy -and $proxy -match '^https?://') {
            $params.Proxy = $proxy
        }
        Invoke-WebRequest @params
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol
    }
}

function Get-PortableNode {
    param(
        [string]$ProjectRoot,
        [ValidateSet('x64', 'arm64')][string]$Architecture = (Get-WindowsNodeArchitecture),
        [switch]$Offline
    )
    $spec = Get-NodeRuntimeSpec -ProjectRoot $ProjectRoot -Architecture $Architecture
    $runtimeRoot = Join-Path $ProjectRoot '.runtime'
    $directory = Join-Path $runtimeRoot $spec.Directory
    $node = Join-Path $directory 'node.exe'
    $license = Join-Path $directory 'LICENSE'
    Assert-RuntimeDirectory $runtimeRoot
    Assert-RuntimeDirectory $directory
    if ((Test-Path -LiteralPath $node) -or (Test-Path -LiteralPath $license)) {
        Assert-RuntimeFile $node $spec.NodeSha256
        Assert-RuntimeFile $license $spec.LicenseSha256
        return $node
    }
    if ($Offline) { throw 'Portable runtime is missing. Extract the complete Windows release ZIP.' }

    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $lock = $null
    $zip = $null
    $temporary = @()
    try {
        # Serialize preparation, and recheck after locking in case another launcher completed it.
        $lockPath = Join-Path $runtimeRoot 'download.lock'
        if (Test-Path -LiteralPath $lockPath) {
            if ((Get-Item -LiteralPath $lockPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Portable runtime download lock cannot be a linked file.'
            }
        }
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        if ((Test-Path -LiteralPath $node) -or (Test-Path -LiteralPath $license)) {
            Assert-RuntimeFile $node $spec.NodeSha256
            Assert-RuntimeFile $license $spec.LicenseSha256
            return $node
        }
        $prefix = Join-Path $runtimeRoot ([Guid]::NewGuid().ToString('N'))
        $archive = "$prefix.zip.part"
        $nodeTemporary = "$prefix.node.part"
        $licenseTemporary = "$prefix.license.part"
        $temporary = @($archive, $nodeTemporary, $licenseTemporary)
        Write-Host "[Runtime] Preparing portable Node.js from $($spec.Url)"
        Write-Host '[Runtime] This stays inside the project; no installation or PATH change is needed.'
        Save-NodeRuntimeArchive -Uri $spec.Url -Destination $archive
        Assert-RuntimeFile $archive $spec.ArchiveSha256

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        # Extract only these exact entries; never expand paths supplied by the archive.
        foreach ($entrySpec in @(
            @{ Name = 'node.exe'; Destination = $nodeTemporary },
            @{ Name = 'LICENSE'; Destination = $licenseTemporary }
        )) {
            $entry = $zip.GetEntry("$($spec.Directory)/$($entrySpec.Name)")
            if ($null -eq $entry) { throw "Node.js archive is missing $($entrySpec.Name)." }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $entrySpec.Destination)
        }
        $zip.Dispose()
        $zip = $null
        Assert-RuntimeFile $nodeTemporary $spec.NodeSha256
        Assert-RuntimeFile $licenseTemporary $spec.LicenseSha256
        Assert-RuntimeDirectory $directory
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Move-Item -LiteralPath $licenseTemporary -Destination $license
        Move-Item -LiteralPath $nodeTemporary -Destination $node
        return $node
    } finally {
        if ($null -ne $zip) { $zip.Dispose() }
        foreach ($file in $temporary) {
            if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
        }
        if ($null -ne $lock) { $lock.Dispose() }
    }
}
