'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createZipBuffer, parseZipBuffer } = require('../src/zip_utils');
const { buildPayload, PAYLOAD_ARCHIVE_NAME } = require('../scripts/build_payload');
const updater = require('../scripts/self_update');
const ensure = require('../scripts/ensure_localized');

const repo = path.resolve(__dirname, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function tempDir(t, prefix = 'ag-update-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function createSyntheticProject(dir, version = '1.0.0', extraDict = { Settings: '设置' }) {
    fs.mkdirSync(path.join(dir, 'dicts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'antigravity2cn', version }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({
        platform: 'windows',
        architecture: 'x64',
        version,
        launcherVersion: 1,
        sourceCommit: 'aaaa1111',
        nodeVersion: 'v24.22.3',
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'localization_engine.js'), `// synthetic engine ${version}\nmodule.exports = { version: ${JSON.stringify(version)} };\n`);
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License\n');
    fs.writeFileSync(path.join(dir, 'README.md'), `# v${version}\n`);
    fs.writeFileSync(path.join(dir, 'dicts/common.json'), JSON.stringify(extraDict, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'src/preload_runtime.js'), `// runtime ${version}\n`);
    fs.writeFileSync(path.join(dir, 'src/zip_utils.js'), '// zip utils stub\n');
    fs.writeFileSync(path.join(dir, 'scripts/ensure_localized.js'), `// ensure ${version}\n`);
    fs.writeFileSync(path.join(dir, 'scripts/self_update.js'), `// self_update ${version}\n`);
    fs.writeFileSync(path.join(dir, 'scripts/validate_dicts.js'), '// validate_dicts stub\n');
    fs.writeFileSync(path.join(dir, 'scripts/node-runtime.json'), JSON.stringify({ version: 'v24.22.3' }) + '\n');
}

test('zip_utils roundtrips stored and deflated entries and rejects corruption, traversal and symlinks', () => {
    const small = Buffer.from('hi');
    const big = Buffer.from('Antigravity Simplified Chinese Localization! '.repeat(200), 'utf8');
    const zip = createZipBuffer([
        { name: 'b/big.txt', data: big },
        { name: 'a/small.txt', data: small },
    ]);
    const parsed = parseZipBuffer(zip);
    assert.deepEqual([...parsed.keys()], ['a/small.txt', 'b/big.txt']);
    assert.deepEqual(parsed.get('a/small.txt'), small);
    assert.deepEqual(parsed.get('b/big.txt'), big);

    // Corrupt a byte inside payload -> CRC32 or inflate error.
    const corrupted = Buffer.from(zip);
    corrupted[30 + 'a/small.txt'.length] ^= 0xff;
    assert.throws(() => parseZipBuffer(corrupted));

    // Reject path traversal at build and parse time.
    assert.throws(() => createZipBuffer([{ name: '../evil.js', data: Buffer.from('x') }]), /Unsafe ZIP entry/);

    // Craft a ZIP entry with Unix symlink mode (0120000 << 16) in central directory.
    const symlinkZip = Buffer.from(zip);
    const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const cdIdx = symlinkZip.indexOf(cdSig);
    assert.ok(cdIdx > 0);
    symlinkZip.writeUInt32LE((0o120777 << 16) >>> 0, cdIdx + 38);
    assert.throws(() => parseZipBuffer(symlinkZip), /symlink/i);
});

test('build_payload builds deterministic payload ZIP and SHA-256 from real repository', t => {
    const outDir = tempDir(t, 'ag-payload-');
    const result = buildPayload({ projectRoot: repo, outputDir: outDir, sourceCommit: 'deadbeef1234' });
    assert.equal(fs.existsSync(result.archivePath), true);
    assert.equal(fs.existsSync(result.shaPath), true);

    const rawSha = fs.readFileSync(result.shaPath, 'utf8').trim();
    assert.equal(rawSha, `${result.sha256}  ${PAYLOAD_ARCHIVE_NAME}`);
    const entries = parseZipBuffer(fs.readFileSync(result.archivePath));
    assert.ok(entries.has('payload-manifest.json'));
    assert.ok(entries.has('localization_engine.js'));
    assert.ok(entries.has('LICENSE'));
    assert.ok(entries.has('scripts/self_update.js'));
    assert.ok(entries.has('src/zip_utils.js'));
    assert.ok(entries.has('dicts/page_main.json'));
    for (const rel of entries.keys()) {
        assert.equal(updater.isAllowedPayloadPath(rel), true, `Unexpected entry in payload: ${rel}`);
        assert.equal(rel.startsWith('.runtime/'), false);
        assert.equal(rel.startsWith('tests/'), false);
        assert.equal(/\.(?:bat|command|ps1|sh)$/i.test(rel), false);
    }
    const manifest = JSON.parse(entries.get('payload-manifest.json').toString('utf8'));
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.launcherVersion, 1);
    assert.equal(manifest.sourceCommit, 'deadbeef1234');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('self_update config persists autoUpdate, proxy and interval and enforces proxy precedence', async t => {
    const cfgDir = tempDir(t, 'ag-cfg-');
    const configPath = path.join(cfgDir, 'updater.json');
    const logs = [];
    const logger = { log: (m) => logs.push(m), error: (m) => logs.push(m) };

    assert.deepEqual(updater.loadConfig(configPath), {
        autoUpdate: 'off',
        proxy: '',
        checkIntervalHours: 24,
        lastCheckedAt: null,
    });

    let code = await updater.main(['config', '--auto-update', 'auto', '--set-proxy', 'http://127.0.0.1:2080', '--interval', '12'], {
        configPath,
        logger,
    });
    assert.equal(code, 0);
    const saved = updater.loadConfig(configPath);
    assert.equal(saved.autoUpdate, 'auto');
    assert.equal(saved.proxy, 'http://127.0.0.1:2080');
    assert.equal(saved.checkIntervalHours, 12);

    // Reject invalid proxy schemes.
    code = await updater.main(['config', '--set-proxy', 'socks5://127.0.0.1:1080'], { configPath, logger });
    assert.equal(code, 1);

    // Proxy precedence: --no-proxy > --proxy > config.proxy > env HTTPS_PROXY (with NO_PROXY).
    assert.equal(updater.resolveProxy({ noProxy: true, cliProxy: 'http://127.0.0.1:9999', config: saved }), null);
    assert.equal(updater.resolveProxy({ cliProxy: 'http://127.0.0.1:9999', config: saved }), 'http://127.0.0.1:9999');
    assert.equal(updater.resolveProxy({ config: saved }), 'http://127.0.0.1:2080');

    code = await updater.main(['config', '--clear-proxy'], { configPath, logger });
    assert.equal(code, 0);
    const cleared = updater.loadConfig(configPath);
    assert.equal(cleared.proxy, '');
    assert.equal(updater.resolveProxy({
        config: cleared,
        env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
        targetUrl: 'https://api.github.com/repos/x/y',
    }), 'http://127.0.0.1:7890');
    assert.equal(updater.resolveProxy({
        config: cleared,
        env: { HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: 'api.github.com' },
        targetUrl: 'https://api.github.com/repos/x/y',
    }), null);
});

test('self_update auto mode stays completely offline by default, honors cooldown and never blocks on errors', async t => {
    const cfgDir = tempDir(t, 'ag-auto-cfg-');
    const configPath = path.join(cfgDir, 'updater.json');
    const projectDir = tempDir(t, 'ag-auto-proj-');
    createSyntheticProject(projectDir, '1.0.0');

    let hitCount = 0;
    const mockTransport = async () => {
        hitCount++;
        return { statusCode: 500, headers: {}, body: Buffer.from('server error') };
    };
    const logger = { log() {}, error() {} };

    // Default autoUpdate=off -> zero network calls.
    let code = await updater.main(['auto'], {
        projectRoot: projectDir,
        configPath,
        _httpGetSingle: mockTransport,
        logger,
    });
    assert.equal(code, 0);
    assert.equal(hitCount, 0);

    // Enable autoUpdate=auto with fresh lastCheckedAt -> skipped by cooldown.
    const now = Date.parse('2026-11-24T12:00:00Z');
    updater.saveConfig({ autoUpdate: 'auto', proxy: '', checkIntervalHours: 24, lastCheckedAt: '2026-11-24T10:00:00Z' }, configPath);
    code = await updater.main(['auto'], {
        projectRoot: projectDir,
        configPath,
        nowMs: now,
        _httpGetSingle: mockTransport,
        logger,
    });
    assert.equal(code, 0);
    assert.equal(hitCount, 0);

    // Cooldown expired + server 500 -> returns 0 without blocking launch.
    updater.saveConfig({ autoUpdate: 'auto', proxy: '', checkIntervalHours: 24, lastCheckedAt: '2026-11-20T10:00:00Z' }, configPath);
    code = await updater.main(['auto'], {
        projectRoot: projectDir,
        configPath,
        nowMs: now,
        _httpGetSingle: mockTransport,
        logger,
    });
    assert.equal(code, 0);
    assert.equal(hitCount, 1);
});

test('self_update upgrades 1.0.0 -> 1.1.0 with configured proxy, enforces host allowlist and strips Authorization on cross-origin redirects', async t => {
    const work = tempDir(t, 'ag-e2e-');
    const localProject = path.join(work, 'portable-1.0.0');
    const remoteSource = path.join(work, 'release-1.1.0');
    const payloadOut = path.join(work, 'payload-dist');
    const configPath = path.join(work, 'cfg', 'updater.json');

    createSyntheticProject(localProject, '1.0.0', { Settings: '设置' });
    createSyntheticProject(remoteSource, '1.1.0', { Settings: '设置', 'New Feature': '新功能' });
    const built = buildPayload({ projectRoot: remoteSource, outputDir: payloadOut, sourceCommit: 'bbbb2222' });
    const zipBytes = fs.readFileSync(built.archivePath);
    const shaBytes = fs.readFileSync(built.shaPath);

    const requests = [];
    const mockTransport = async (urlObj, options) => {
        requests.push({
            url: urlObj.toString(),
            proxy: options.proxy,
            auth: options.headers.Authorization || options.headers.authorization || null,
        });
        if (urlObj.hostname === 'api.github.com' && urlObj.pathname === '/repos/mxh110708/Antigravity2CN/releases/latest') {
            return {
                statusCode: 200,
                headers: {},
                body: Buffer.from(JSON.stringify({
                    tag_name: 'v1.1.0',
                    name: 'v1.1.0',
                    html_url: 'https://github.com/mxh110708/Antigravity2CN/releases/tag/v1.1.0',
                    assets: [
                        {
                            name: PAYLOAD_ARCHIVE_NAME,
                            url: 'https://api.github.com/repos/mxh110708/Antigravity2CN/releases/assets/101',
                            browser_download_url: 'https://github.com/mxh110708/Antigravity2CN/releases/download/v1.1.0/antigravity2cn-payload.zip',
                        },
                        {
                            name: `${PAYLOAD_ARCHIVE_NAME}.sha256`,
                            url: 'https://api.github.com/repos/mxh110708/Antigravity2CN/releases/assets/102',
                            browser_download_url: 'https://github.com/mxh110708/Antigravity2CN/releases/download/v1.1.0/antigravity2cn-payload.zip.sha256',
                        },
                    ],
                })),
            };
        }
        if (urlObj.hostname === 'api.github.com' && urlObj.pathname.endsWith('/101')) {
            return { statusCode: 302, headers: { location: 'https://objects.githubusercontent.com/cdn/payload.zip' }, body: Buffer.alloc(0) };
        }
        if (urlObj.hostname === 'api.github.com' && urlObj.pathname.endsWith('/102')) {
            return { statusCode: 302, headers: { location: 'https://objects.githubusercontent.com/cdn/payload.zip.sha256' }, body: Buffer.alloc(0) };
        }
        if (urlObj.hostname === 'objects.githubusercontent.com' && urlObj.pathname === '/cdn/payload.zip') {
            return { statusCode: 200, headers: {}, body: zipBytes };
        }
        if (urlObj.hostname === 'objects.githubusercontent.com' && urlObj.pathname === '/cdn/payload.zip.sha256') {
            return { statusCode: 200, headers: {}, body: shaBytes };
        }
        return { statusCode: 404, headers: {}, body: Buffer.from('not found') };
    };

    let reinstalled = false;
    const logs = [];
    const code = await updater.main(['apply', '--proxy', 'http://127.0.0.1:2080', '--reinstall'], {
        projectRoot: localProject,
        configPath,
        token: 'synthetic-test-token',
        _httpGetSingle: mockTransport,
        logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
        runReinstall: () => { reinstalled = true; return true; },
    });

    assert.equal(code, 0, logs.join('\n'));
    assert.equal(reinstalled, true);
    assert.equal(requests.length, 5);
    for (const r of requests) {
        assert.equal(r.proxy, 'http://127.0.0.1:2080');
    }
    const apiReqs = requests.filter(r => r.url.startsWith('https://api.github.com/'));
    const cdnReqs = requests.filter(r => r.url.startsWith('https://objects.githubusercontent.com/'));
    assert.equal(apiReqs.length, 3);
    assert.equal(cdnReqs.length, 2);
    for (const r of apiReqs) assert.equal(r.auth, 'Bearer synthetic-test-token');
    for (const r of cdnReqs) assert.equal(r.auth, null, 'Authorization header MUST be stripped on cross-origin redirect');

    const updatedInfo = JSON.parse(fs.readFileSync(path.join(localProject, 'build-info.json'), 'utf8'));
    assert.equal(updatedInfo.version, '1.1.0');
    assert.equal(updatedInfo.sourceCommit, 'bbbb2222');
    const updatedDict = JSON.parse(fs.readFileSync(path.join(localProject, 'dicts/common.json'), 'utf8'));
    assert.equal(updatedDict['New Feature'], '新功能');

    // Verify unauthorized redirect target host is rejected immediately.
    await assert.rejects(() => updater.httpGetBuffer('https://api.github.com/repos/mxh110708/Antigravity2CN/releases/latest', {
        _httpGetSingle: async () => ({ statusCode: 302, headers: { location: 'https://untrusted.example.com/evil.zip' }, body: Buffer.alloc(0) }),
    }), /不在白名单内的地址/);
});

test('verifyAndApplyPayload rejects tampered archives, incompatible launcher/node versions, bad syntax/dicts and git worktrees', t => {
    const work = tempDir(t, 'ag-reject-');
    const localProject = path.join(work, 'portable-1.0.0');
    const remoteSource = path.join(work, 'release-1.1.0');
    const outDir = path.join(work, 'out');
    createSyntheticProject(localProject, '1.0.0', { Settings: '设置' });
    createSyntheticProject(remoteSource, '1.1.0', { Settings: '设置', Added: '新增' });
    const built = buildPayload({ projectRoot: remoteSource, outputDir: outDir, sourceCommit: 'cccc3333' });
    const validZip = fs.readFileSync(built.archivePath);
    const validSha = fs.readFileSync(built.shaPath, 'utf8');

    // 1. Bad SHA-256
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: validZip,
        sha256Text: `${'0'.repeat(64)}  ${PAYLOAD_ARCHIVE_NAME}\n`,
    }), /SHA-256/);

    // 2. Git worktree guard
    fs.mkdirSync(path.join(localProject, '.git'));
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: validZip,
        sha256Text: validSha,
    }), /Git 源码仓库/);
    fs.rmSync(path.join(localProject, '.git'), { recursive: true, force: true });

    // 3. minLauncherVersion > localLauncherVersion
    const entries = parseZipBuffer(validZip);
    const manifestObj = JSON.parse(entries.get('payload-manifest.json').toString('utf8'));
    manifestObj.minLauncherVersion = 2;
    const launcherMismatchZip = createZipBuffer([
        { name: 'payload-manifest.json', data: Buffer.from(JSON.stringify(manifestObj)) },
        ...[...entries.entries()].filter(([k]) => k !== 'payload-manifest.json').map(([name, data]) => ({ name, data })),
    ]);
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: launcherMismatchZip,
        sha256Text: `${sha256(launcherMismatchZip)}  ${PAYLOAD_ARCHIVE_NAME}\n`,
    }), /新版启动脚本/);

    // 4. Node version mismatch
    manifestObj.minLauncherVersion = 1;
    manifestObj.nodeVersion = 'v26.0.0';
    const nodeMismatchZip = createZipBuffer([
        { name: 'payload-manifest.json', data: Buffer.from(JSON.stringify(manifestObj)) },
        ...[...entries.entries()].filter(([k]) => k !== 'payload-manifest.json').map(([name, data]) => ({ name, data })),
    ]);
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: nodeMismatchZip,
        sha256Text: `${sha256(nodeMismatchZip)}  ${PAYLOAD_ARCHIVE_NAME}\n`,
    }), /Node\.js 运行时/);

    // 5. Invalid JS syntax in staged payload leaves local v1.0.0 untouched
    const badJsSource = path.join(work, 'bad-js-src');
    createSyntheticProject(badJsSource, '1.1.0', { Settings: '设置' });
    fs.writeFileSync(path.join(badJsSource, 'localization_engine.js'), 'function broken( {\n');
    const badJsBuilt = buildPayload({ projectRoot: badJsSource, outputDir: path.join(work, 'bad-js-out'), sourceCommit: 'bad1' });
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: fs.readFileSync(badJsBuilt.archivePath),
        sha256Text: fs.readFileSync(badJsBuilt.shaPath, 'utf8'),
    }), /语法校验失败/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(localProject, 'build-info.json'), 'utf8')).version, '1.0.0');

    // 6. Unauthorized extra file path inside ZIP
    const sneakyZip = createZipBuffer([
        ...[...entries.entries()].map(([name, data]) => ({ name, data })),
        { name: 'install-cn.bat', data: Buffer.from('@echo evil\r\n') },
    ]);
    assert.throws(() => updater.verifyAndApplyPayload({
        projectRoot: localProject,
        zipBuffer: sneakyZip,
        sha256Text: `${sha256(sneakyZip)}  ${PAYLOAD_ARCHIVE_NAME}\n`,
    }), /未授权的文件路径/);
});

test('ensure_localized detects older injected version and re-injects when local tool is newer', t => {
    const dir = tempDir(t, 'ag-ver-upgrade-');
    const resources = path.join(dir, 'resources');
    fs.mkdirSync(resources);
    const archive = path.join(resources, 'app.asar');

    const writeAsar = (bodyText) => {
        const body = Buffer.from(bodyText);
        const header = Buffer.from(JSON.stringify({ files: { dist: { files: { 'preload.js': { size: body.length, offset: '0' } } } } }));
        const aligned = Math.ceil(header.length / 4) * 4;
        const prefix = Buffer.alloc(16 + aligned);
        prefix.writeUInt32LE(4, 0);
        prefix.writeUInt32LE(8 + aligned, 4);
        prefix.writeUInt32LE(4 + aligned, 8);
        prefix.writeUInt32LE(header.length, 12);
        header.copy(prefix, 16);
        fs.writeFileSync(archive, Buffer.concat([prefix, body]));
    };

    const sig = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
    const loc = '/* ANTIGRAVITY PRIVATE LOCALE: zh-CN */';
    const brd = '/* ANTIGRAVITY BRAND: Antigravity */';
    writeAsar(`${sig}\n${loc}\n${brd}\n/* ANTIGRAVITY2CN VERSION: 1.0.3 */`);
    assert.equal(ensure.getInjectedVersion(archive), '1.0.3');

    let repairs = 0;
    const code = ensure.main(['--fix', '--install-dir', dir], {
        platform: 'win32',
        localVersion: '1.1.0',
        execFileSync: () => 'INFO: No tasks.',
        spawnSync: () => {
            repairs++;
            writeAsar(`${sig}\n${loc}\n${brd}\n/* ANTIGRAVITY2CN VERSION: 1.1.0 */`);
            return { status: 0 };
        },
    });
    assert.equal(code, 0);
    assert.equal(repairs, 1);
    assert.equal(ensure.getInjectedVersion(archive), '1.1.0');
});

test('self_update rejects macOS root and effective-root sessions before loading modules', () => {
    const src = fs.readFileSync(path.join(repo, 'scripts/self_update.js'), 'utf8');
    for (const [uid, euid] of [[0, 0], [501, 0], [0, 501]]) {
        const ctx = {
            process: { platform: 'darwin', getuid: () => uid, geteuid: () => euid },
            require() { throw new Error('Should not require modules when root'); },
        };
        assert.throws(() => vm.runInNewContext(src, ctx), /macOS.*root/);
    }
});
