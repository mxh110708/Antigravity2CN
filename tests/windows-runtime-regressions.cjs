const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const onWindows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quotePS = text => `'${text.replaceAll("'", "''")}'`;

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag portable runtime '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['portable_runtime.ps1', 'run_windows.ps1']) {
        fs.copyFileSync(path.join(repo, 'scripts', file), path.join(root, 'scripts', file));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/node-runtime.json')));
    return { root, manifest };
}

function saveManifest(root, manifest) {
    fs.writeFileSync(path.join(root, 'scripts/node-runtime.json'), JSON.stringify(manifest));
}

function runPS(source, options = {}) {
    // EncodedCommand prevents test paths and JSON from being reinterpreted by a shell.
    return spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
        encoding: 'utf8', timeout: 30000, windowsHide: true, ...options,
    });
}

test('portable Node manifest pins official Windows archive, binary and license digests', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/node-runtime.json')));
    assert.match(manifest.version, /^v24\.\d+\.\d+$/);
    assert.equal(manifest.source, `https://nodejs.org/dist/${manifest.version}/SHASUMS256.txt`);
    assert.match(manifest.licenseSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(manifest.windows).sort(), ['arm64', 'x64']);
    for (const platform of Object.values(manifest.windows)) {
        assert.match(platform.archiveSha256, /^[a-f0-9]{64}$/);
        assert.match(platform.nodeSha256, /^[a-f0-9]{64}$/);
    }
});

test('portable runtime verifies downloads, extracts only approved files and refuses tampering', { skip: !onWindows }, t => {
    const { root, manifest } = fixture(t);
    const extracted = path.join(root, 'zip input', `node-${manifest.version}-win-x64`);
    fs.mkdirSync(extracted, { recursive: true });
    const fakeNode = Buffer.from('synthetic node - never executed');
    const license = Buffer.from('synthetic license');
    fs.writeFileSync(path.join(extracted, 'node.exe'), fakeNode);
    fs.writeFileSync(path.join(extracted, 'LICENSE'), license);
    fs.writeFileSync(path.join(extracted, 'must-not-extract.cmd'), 'not allowed');
    const archive = path.join(root, 'official fixture.zip');
    let result = runPS(`$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; Add-Type -AssemblyName System.IO.Compression;
        $zip = [IO.Compression.ZipFile]::Open(${quotePS(archive)}, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in @('node.exe', 'LICENSE', 'must-not-extract.cmd')) {
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path ${quotePS(extracted)} $name), (${quotePS(path.basename(extracted))} + '/' + $name))
            }
        } finally { $zip.Dispose() }
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    manifest.windows.x64.archiveSha256 = digest(fs.readFileSync(archive));
    manifest.windows.x64.nodeSha256 = digest(fakeNode);
    manifest.licenseSha256 = digest(license);
    saveManifest(root, manifest);
    const runtime = path.join(root, '.runtime', path.basename(extracted));
    const preamble = `$ErrorActionPreference = 'Stop'; . ${quotePS(path.join(root, 'scripts/portable_runtime.ps1'))}; `;
    result = runPS(`${preamble}
        if ((Get-WindowsNodeArchitecture 'AMD64') -ne 'x64') { throw 'x64 detection failed' }
        if ((Get-WindowsNodeArchitecture 'ARM64') -ne 'arm64') { throw 'ARM64 detection failed' }
        try { Get-WindowsNodeArchitecture 'x86'; throw '32-bit unexpectedly accepted' } catch { if ($_.Exception.Message -notlike '*64-bit Windows*') { throw } }
        function Save-NodeRuntimeArchive { param($Uri, $Destination)
            if ($Uri -ne 'https://nodejs.org/dist/${manifest.version}/node-${manifest.version}-win-x64.zip') { throw 'Unexpected download source' }
            Copy-Item -LiteralPath ${quotePS(archive)} -Destination $Destination
        }
        $null = Get-PortableNode -ProjectRoot ${quotePS(root)} -Architecture x64
        function Save-NodeRuntimeArchive { throw 'Verified runtime must not download again' }
        $null = Get-PortableNode -ProjectRoot ${quotePS(root)} -Architecture x64 -Offline
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(fs.readdirSync(runtime).sort(), ['LICENSE', 'node.exe']);
    assert.deepEqual(fs.readFileSync(path.join(runtime, 'node.exe')), fakeNode);
    for (const file of ['node.exe', 'LICENSE']) {
        const original = fs.readFileSync(path.join(runtime, file));
        fs.appendFileSync(path.join(runtime, file), 'tampered');
        result = runPS(`${preamble} function Save-NodeRuntimeArchive { throw 'No repair download is allowed' }; $null = Get-PortableNode -ProjectRoot ${quotePS(root)} -Architecture x64;`);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /SHA-256 mismatch/);
        fs.writeFileSync(path.join(runtime, file), original);
    }

    // A different synthetic project starts without a cache. An invalid download must not be published.
    const rejected = path.join(root, 'rejected download');
    fs.mkdirSync(path.join(rejected, 'scripts'), { recursive: true });
    manifest.windows.x64.archiveSha256 = '0'.repeat(64);
    saveManifest(rejected, manifest);
    result = runPS(`${preamble} function Save-NodeRuntimeArchive { param($Uri, $Destination) Copy-Item -LiteralPath ${quotePS(archive)} -Destination $Destination }; $null = Get-PortableNode -ProjectRoot ${quotePS(rejected)} -Architecture x64;`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(fs.existsSync(path.join(rejected, '.runtime', path.basename(extracted), 'node.exe')), false);
    assert.deepEqual(fs.readdirSync(path.join(rejected, '.runtime')), ['download.lock']);

    const missing = path.join(root, 'offline missing');
    fs.mkdirSync(path.join(missing, 'scripts'), { recursive: true });
    saveManifest(missing, manifest);
    result = runPS(`${preamble} function Save-NodeRuntimeArchive { throw 'Network forbidden' }; $null = Get-PortableNode -ProjectRoot ${quotePS(missing)} -Architecture x64 -Offline;`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /complete Windows release ZIP/);
    assert.equal(fs.existsSync(path.join(missing, '.runtime')), false);
});

test('all Windows double-click entries work with no system Node and preserve arguments and exit codes', { skip: !onWindows }, t => {
    const { root, manifest } = fixture(t);
    const architecture = process.arch;
    assert.ok(['x64', 'arm64'].includes(architecture));
    const runtime = path.join(root, '.runtime', `node-${manifest.version}-win-${architecture}`);
    fs.mkdirSync(runtime, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
    const license = Buffer.from('synthetic license for launcher test');
    fs.writeFileSync(path.join(runtime, 'LICENSE'), license);
    manifest.windows[architecture].nodeSha256 = digest(fs.readFileSync(process.execPath));
    manifest.licenseSha256 = digest(license);
    saveManifest(root, manifest);
    // These two scripts only report arguments. They cannot query, install or launch a real client.
    const reporter = `console.log(JSON.stringify({args:process.argv.slice(2),exe:process.execPath,options:process.env.NODE_OPTIONS||null,modulePath:process.env.NODE_PATH||null})); if(process.argv.includes('--probe-exit'))process.exitCode=23;`;
    fs.writeFileSync(path.join(root, 'localization_engine.js'), reporter);
    fs.writeFileSync(path.join(root, 'scripts/ensure_localized.js'), reporter);
    const poison = path.join(root, 'must not preload.cjs');
    fs.writeFileSync(poison, 'throw new Error("External Node preload was executed");');
    const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32'), NODE_OPTIONS: `--require "${poison}"`, NODE_PATH: path.join(root, 'untrusted modules') };
    const client = path.join(root, 'synthetic client & spaces');
    for (const [file, flags] of [
        ['双击安装中文汉化.bat', []],
        ['双击卸载还原官方英文.bat', ['--huifu']],
        ['启动Antigravity(自动检查汉化).bat', ['--fix', '--launch']],
    ]) {
        fs.copyFileSync(path.join(repo, file), path.join(root, file));
        const result = spawnSync(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/s', '/c', `""${path.join(root, file)}" --install-dir "${client}" --no-kill"`], {
            env, encoding: 'utf8', input: '\r\n', timeout: 30000, windowsHide: true, windowsVerbatimArguments: true,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const line = result.stdout.split(/\r?\n/).find(text => text.startsWith('{'));
        assert.ok(line, result.stdout);
        const report = JSON.parse(line);
        assert.deepEqual(report.args, [...flags, '--install-dir', client, '--no-kill']);
        assert.equal(report.exe.toLowerCase(), path.join(runtime, 'node.exe').toLowerCase());
        assert.equal(report.options, null);
        assert.equal(report.modulePath, null);
    }
    const checked = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/run_windows.ps1'), 'check', '--install-dir', client], {
        env, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout.trim()).args, ['--install-dir', client]);
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/run_windows.ps1'), 'install', '--probe-exit'], {
        env, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(result.status, 23, result.stderr || result.stdout);
});
