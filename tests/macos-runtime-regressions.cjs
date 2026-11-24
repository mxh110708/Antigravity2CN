const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const skipUnixTests = process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quoteSh = text => `'${String(text).replaceAll("'", "'\\''")}'`;

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag mac runtime '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['portable_runtime.sh', 'run_macos.sh', 'build_macos_package.sh']) {
        const dst = path.join(root, 'scripts', file);
        fs.copyFileSync(path.join(repo, 'scripts', file), dst);
        fs.chmodSync(dst, 0o755);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/node-runtime.json'), 'utf8'));
    return { root, manifest };
}

function saveManifest(root, manifest) {
    fs.writeFileSync(path.join(root, 'scripts/node-runtime.json'), JSON.stringify(manifest));
}

function runBash(source, options = {}) {
    return spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', source], {
        encoding: 'utf8',
        timeout: 30000,
        ...options,
    });
}

function listFilesRecursive(dir, base = dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(base, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(full, base));
        } else {
            results.push(rel);
        }
    }
    return results;
}

test('portable Node manifest pins official macOS archive, binary and license digests', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/node-runtime.json'), 'utf8'));
    assert.match(manifest.version, /^v24\.\d+\.\d+$/);
    assert.equal(manifest.source, `https://nodejs.org/dist/${manifest.version}/SHASUMS256.txt`);
    assert.ok(manifest.macos && typeof manifest.macos === 'object');
    assert.match(manifest.macos.licenseSha256, /^[a-f0-9]{64}$/);
    const archKeys = Object.keys(manifest.macos).filter(k => k !== 'licenseSha256').sort();
    assert.deepEqual(archKeys, ['arm64', 'x64']);
    for (const arch of archKeys) {
        assert.match(manifest.macos[arch].archiveSha256, /^[a-f0-9]{64}$/);
        assert.match(manifest.macos[arch].nodeSha256, /^[a-f0-9]{64}$/);
    }
});

test('portable_runtime.sh verifies downloads, extracts only approved files, rejects symlinks and refuses tampering', { skip: skipUnixTests }, t => {
    const { root, manifest } = fixture(t);
    const dirName = `node-${manifest.version}-darwin-x64`;
    const inputRoot = path.join(root, 'tar input');
    const extracted = path.join(inputRoot, dirName);
    fs.mkdirSync(path.join(extracted, 'bin'), { recursive: true });
    const fakeNode = Buffer.from('#!/bin/sh\necho synthetic-node\n');
    const license = Buffer.from('synthetic macos license');
    fs.writeFileSync(path.join(extracted, 'bin/node'), fakeNode, { mode: 0o755 });
    fs.writeFileSync(path.join(extracted, 'LICENSE'), license, { mode: 0o644 });
    fs.writeFileSync(path.join(extracted, 'must-not-extract.sh'), 'not allowed\n');

    const archive = path.join(root, 'official fixture.tar.gz');
    const tarRes = spawnSync('tar', ['-czf', archive, '-C', inputRoot, dirName], { encoding: 'utf8' });
    assert.equal(tarRes.status, 0, tarRes.stderr || tarRes.stdout);

    manifest.macos.x64.archiveSha256 = digest(fs.readFileSync(archive));
    manifest.macos.x64.nodeSha256 = digest(fakeNode);
    manifest.macos.licenseSha256 = digest(license);
    saveManifest(root, manifest);

    const runtimeDir = path.join(root, '.runtime', dirName);
    const preamble = `source ${quoteSh(path.join(root, 'scripts/portable_runtime.sh'))}`;

    let result = runBash(`${preamble}
        [ "$(get_macos_node_arch arm64)" = "arm64" ]
        [ "$(get_macos_node_arch aarch64)" = "arm64" ]
        [ "$(get_macos_node_arch x86_64)" = "x64" ]
        if get_macos_node_arch x86 2>/dev/null; then exit 99; fi
        save_node_runtime_archive() {
            if [ "$1" != ${quoteSh(`https://nodejs.org/dist/${manifest.version}/${dirName}.tar.gz`)} ]; then
                echo "Unexpected download source: $1" >&2
                return 1
            fi
            cp ${quoteSh(archive)} "$2"
        }
        NODE_OUT="$(get_portable_node ${quoteSh(root)} x64)"
        [ "$NODE_OUT" = ${quoteSh(path.join(runtimeDir, 'node'))} ]
        save_node_runtime_archive() {
            echo "Verified runtime must not download again" >&2
            return 1
        }
        OFFLINE_OUT="$(get_portable_node ${quoteSh(root)} x64 --offline)"
        [ "$OFFLINE_OUT" = "$NODE_OUT" ]
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(fs.readdirSync(runtimeDir).sort(), ['LICENSE', 'node']);
    assert.deepEqual(fs.readFileSync(path.join(runtimeDir, 'node')), fakeNode);
    assert.notEqual(fs.statSync(path.join(runtimeDir, 'node')).mode & 0o111, 0);

    for (const file of ['node', 'LICENSE']) {
        const target = path.join(runtimeDir, file);
        const original = fs.readFileSync(target);
        fs.appendFileSync(target, 'tampered');
        result = runBash(`${preamble}
            save_node_runtime_archive() { echo "No repair download is allowed" >&2; return 1; }
            get_portable_node ${quoteSh(root)} x64
        `);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /SHA-256 mismatch/);
        fs.writeFileSync(target, original);
        if (file === 'node') fs.chmodSync(target, 0o755);
    }

    // Reject symlinks in .runtime cache.
    const nodeTarget = path.join(runtimeDir, 'node');
    const savedNode = fs.readFileSync(nodeTarget);
    const linkDest = path.join(root, 'external-node');
    fs.writeFileSync(linkDest, savedNode);
    fs.unlinkSync(nodeTarget);
    fs.symlinkSync(linkDest, nodeTarget);
    result = runBash(`${preamble}; get_portable_node ${quoteSh(root)} x64`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /linked file/);
    fs.unlinkSync(nodeTarget);
    fs.writeFileSync(nodeTarget, savedNode, { mode: 0o755 });

    // Reject archive SHA-256 mismatch without publishing cache.
    const rejected = path.join(root, 'rejected download');
    fs.mkdirSync(path.join(rejected, 'scripts'), { recursive: true });
    const rejectedManifest = structuredClone(manifest);
    rejectedManifest.macos.x64.archiveSha256 = '0'.repeat(64);
    saveManifest(rejected, rejectedManifest);
    result = runBash(`${preamble}
        save_node_runtime_archive() { cp ${quoteSh(archive)} "$2"; }
        get_portable_node ${quoteSh(rejected)} x64
    `);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(fs.existsSync(path.join(rejected, '.runtime', dirName, 'node')), false);
    assert.equal(fs.existsSync(path.join(rejected, '.runtime', 'download.lock.d')), false);

    // Offline mode rejects missing cache without invoking download.
    const missing = path.join(root, 'offline missing');
    fs.mkdirSync(path.join(missing, 'scripts'), { recursive: true });
    saveManifest(missing, manifest);
    result = runBash(`${preamble}
        save_node_runtime_archive() { echo "Network forbidden" >&2; return 1; }
        get_portable_node ${quoteSh(missing)} x64 --offline
    `);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /complete macOS release ZIP/);
    assert.equal(fs.existsSync(path.join(missing, '.runtime')), false);
});

test('build_macos_package.sh builds standalone macOS archive without Windows files and preserves executable bits', { skip: skipUnixTests }, t => {
    const { root, manifest } = fixture(t);
    const dirName = `node-${manifest.version}-darwin-arm64`;

    // Minimal valid project files + decoy Windows/test files that must NOT be packaged.
    fs.writeFileSync(path.join(root, 'localization_engine.js'), '// synthetic engine\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# synthetic readme\n');
    fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT License\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'antigravity2cn', version: '1.1.0' }) + '\n');
    for (const cmd of ['install-cn.command', 'restore-en.command', 'update-cn.command']) {
        fs.copyFileSync(path.join(repo, cmd), path.join(root, cmd));
        fs.chmodSync(path.join(root, cmd), 0o755);
    }
    for (const helper of ['self_update.js', 'validate_dicts.js']) {
        fs.writeFileSync(path.join(root, 'scripts', helper), '// stub helper\n');
    }
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/asar_patcher.js'), '// stub\n');
    fs.mkdirSync(path.join(root, 'dicts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dicts/common.json'), '{"Settings":"设置"}\n');

    // Decoys that must never appear in macOS release ZIP.
    fs.writeFileSync(path.join(root, 'install-cn.bat'), '@echo off\r\n');
    fs.writeFileSync(path.join(root, 'restore-en.bat'), '@echo off\r\n');
    fs.writeFileSync(path.join(root, 'launch-antigravity.bat'), '@echo off\r\n');
    fs.writeFileSync(path.join(root, 'scripts/run_windows.ps1'), '# decoy\n');
    fs.writeFileSync(path.join(root, 'scripts/ensure_localized.js'), '// decoy\n');
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests/decoy.cjs'), '// decoy\n');

    const runtimeDir = path.join(root, '.runtime', dirName);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const fakeNode = Buffer.from('#!/bin/sh\necho synthetic-arm64-node\n');
    const license = Buffer.from('synthetic arm64 license');
    fs.writeFileSync(path.join(runtimeDir, 'node'), fakeNode, { mode: 0o755 });
    fs.writeFileSync(path.join(runtimeDir, 'LICENSE'), license, { mode: 0o644 });
    manifest.macos.arm64.nodeSha256 = digest(fakeNode);
    manifest.macos.licenseSha256 = digest(license);
    saveManifest(root, manifest);

    const outDir = path.join(root, 'out dist');
    const buildRes = spawnSync('/bin/bash', [
        path.join(root, 'scripts/build_macos_package.sh'),
        '--architecture', 'arm64',
        '--output-dir', outDir,
        '--source-commit', 'deadbeef1234',
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(buildRes.status, 0, buildRes.stderr || buildRes.stdout);

    const zipPath = path.join(outDir, 'antigravity2cn-macos-arm64.zip');
    const shaPath = `${zipPath}.sha256`;
    assert.equal(fs.existsSync(zipPath), true);
    assert.equal(fs.existsSync(shaPath), true);
    const recordedSha = fs.readFileSync(shaPath, 'utf8').trim();
    assert.equal(recordedSha, `${digest(fs.readFileSync(zipPath))}  antigravity2cn-macos-arm64.zip`);

    const unpacked = path.join(root, 'unpacked');
    fs.mkdirSync(unpacked, { recursive: true });
    const unzipRes = spawnSync('unzip', ['-q', zipPath, '-d', unpacked], { encoding: 'utf8' });
    assert.equal(unzipRes.status, 0, unzipRes.stderr || unzipRes.stdout);

    const pkgDir = path.join(unpacked, 'antigravity2cn-macos-arm64');
    const files = listFilesRecursive(pkgDir);
    for (const required of [
        'localization_engine.js',
        'README.md',
        'LICENSE',
        'install-cn.command',
        'restore-en.command',
        'update-cn.command',
        'build-info.json',
        'src/asar_patcher.js',
        'dicts/common.json',
        'scripts/node-runtime.json',
        'scripts/portable_runtime.sh',
        'scripts/run_macos.sh',
        'scripts/self_update.js',
        'scripts/validate_dicts.js',
        `.runtime/${dirName}/node`,
        `.runtime/${dirName}/LICENSE`,
    ]) {
        assert.ok(files.includes(required), `Missing ${required} in macOS package`);
    }
    for (const rel of files) {
        assert.equal(/\.(?:bat|ps1)$/i.test(rel), false, `Windows script leaked into macOS package: ${rel}`);
        assert.equal(rel.includes('ensure_localized.js'), false, `ensure_localized.js leaked: ${rel}`);
        assert.equal(rel.startsWith('tests/'), false, `tests leaked: ${rel}`);
        assert.equal(rel.startsWith('docs/'), false, `docs leaked: ${rel}`);
    }
    for (const execRel of [
        'install-cn.command',
        'restore-en.command',
        'update-cn.command',
        'scripts/run_macos.sh',
        'scripts/portable_runtime.sh',
        `.runtime/${dirName}/node`,
    ]) {
        assert.notEqual(fs.statSync(path.join(pkgDir, execRel)).mode & 0o111, 0, `${execRel} must be executable`);
    }
    const buildInfo = JSON.parse(fs.readFileSync(path.join(pkgDir, 'build-info.json'), 'utf8'));
    assert.deepEqual(buildInfo, {
        platform: 'macos',
        architecture: 'arm64',
        version: '1.1.0',
        launcherVersion: 1,
        sourceCommit: 'deadbeef1234',
        nodeVersion: manifest.version,
    });
});

test('run_macos.sh runtime reports portable Node version and preserves engine exit codes', { skip: skipUnixTests }, t => {
    const { root, manifest } = fixture(t);
    const arch = process.arch;
    assert.ok(['arm64', 'x64'].includes(arch));
    const runtimeDir = path.join(root, '.runtime', `node-${manifest.version}-darwin-${arch}`);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const fakeNode = path.join(runtimeDir, 'node');
    fs.copyFileSync(process.execPath, fakeNode);
    fs.chmodSync(fakeNode, 0o755);
    const license = Buffer.from('synthetic license for run_macos test');
    fs.writeFileSync(path.join(runtimeDir, 'LICENSE'), license);
    manifest.macos[arch].nodeSha256 = digest(fs.readFileSync(fakeNode));
    manifest.macos.licenseSha256 = digest(license);
    saveManifest(root, manifest);

    fs.writeFileSync(
        path.join(root, 'localization_engine.js'),
        'if (process.argv.includes("--probe-exit")) process.exitCode = 23;'
    );

    const env = { PATH: '/usr/bin:/bin', HOME: root };
    const rtRes = spawnSync('/bin/bash', [path.join(root, 'scripts/run_macos.sh'), 'runtime'], { env, encoding: 'utf8' });
    assert.equal(rtRes.status, 0, rtRes.stderr || rtRes.stdout);
    assert.match(rtRes.stdout.trim(), /^v\d+\.\d+\.\d+$/);

    const exitRes = spawnSync('/bin/bash', [path.join(root, 'scripts/run_macos.sh'), 'install', '--probe-exit'], { env, encoding: 'utf8' });
    assert.equal(exitRes.status, 23, exitRes.stderr || exitRes.stdout);

    const badMode = spawnSync('/bin/bash', [path.join(root, 'scripts/run_macos.sh'), 'bogus'], { env, encoding: 'utf8' });
    assert.notEqual(badMode.status, 0);
});
