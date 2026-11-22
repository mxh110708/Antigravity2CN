const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');
const { readAsarLayout } = require('../src/asar_patcher');
const ensure = require('../scripts/ensure_localized');
const { validateDicts } = require('../scripts/validate_dicts');

const repo = path.resolve(__dirname, '..');
const signature = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const locale = '/* ANTIGRAVITY PRIVATE LOCALE: zh-CN */';
const brand = '/* ANTIGRAVITY BRAND: Antigravity */';

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-private-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function writePreloadAsar(file, content) {
    const body = Buffer.from(content);
    const header = Buffer.from(JSON.stringify({ files: { dist: { files: {
        'preload.js': { size: body.length, offset: '0' },
    } } } }));
    const aligned = Math.ceil(header.length / 4) * 4;
    const prefix = Buffer.alloc(16 + aligned);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(8 + aligned, 4);
    prefix.writeUInt32LE(4 + aligned, 8);
    prefix.writeUInt32LE(header.length, 12);
    header.copy(prefix, 16);
    fs.writeFileSync(file, Buffer.concat([prefix, body]));
}

test('removed language and brand modes fail in both entry points before installation', t => {
    const missingInstall = path.join(fixture(t), 'must-not-exist');
    const cases = ['--tw', '--tw=true', '--tw=false'].map(flag => ({ args: [flag], message: /仅支持简体中文/ }));
    for (const value of ['hidden', 'translated', 'hide', 'none', 'chinese', 'cn', 'zh', 'en', 'default', '']) {
        cases.push({ args: [`--brand-title=${value}`], message: /仅支持 --brand-title english/ });
        if (value) cases.push({ args: ['--brand-title', value], message: /仅支持 --brand-title english/ });
    }
    cases.push({ args: ['--brand-title'], message: /仅支持 --brand-title english/ });
    cases.push({ args: ['--brand-title=hidden', '--brand-title=english'], message: /仅支持 --brand-title english/ });
    for (const { args, message } of cases) {
        assert.throws(() => ensure.parseArgs(args), message);
        const result = childProcess.spawnSync(process.execPath, [path.join(repo, 'localization_engine.js'), ...args, '--install-dir', missingInstall], {
            encoding: 'utf8', timeout: 5000,
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
    }
});

test('old localized archives and stored brand choices migrate to the fixed English brand', t => {
    const directory = fixture(t);
    const resources = path.join(directory, 'resources');
    fs.mkdirSync(resources);
    const archive = path.join(resources, 'app.asar');
    const originalAppData = process.env.APPDATA;
    const originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = directory;
    process.env.XDG_CONFIG_HOME = directory;
    t.after(() => {
        if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
        if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalXdg;
    });
    const prefsFile = path.join(directory, 'Antigravity', 'localization-prefs.json');
    fs.mkdirSync(path.dirname(prefsFile));
    for (const oldBrand of ['hidden', 'translated']) {
        writePreloadAsar(archive, `${signature}\n${locale}\nconst map = new Map(Object.entries({"Antigravity":""}));`);
        assert.equal(ensure.isLocalized(archive), false);
        const originalPrefs = JSON.stringify({ [path.resolve(directory).toLowerCase()]: { useTw: true, brandTitle: oldBrand } });
        fs.writeFileSync(prefsFile, originalPrefs);
        let repairs = 0;
        const result = ensure.main(['--fix', '--install-dir', directory], {
            platform: 'win32', execFileSync: () => 'INFO: No tasks.',
            spawnSync: (_exe, args) => {
                repairs++;
                assert.equal(args[args.indexOf('--brand-title') + 1], 'english');
                assert.equal(args.includes(oldBrand), false);
                writePreloadAsar(archive, `${signature}\n${locale}\n${brand}`);
                return { status: 0 };
            },
        });
        assert.equal(result, 0);
        assert.equal(repairs, 1);
        assert.equal(ensure.isLocalized(archive), true);
        assert.equal(fs.readFileSync(prefsFile, 'utf8'), originalPrefs);
    }
});

test('Simplified dictionaries reject normalized collisions, reserved keys and invalid translations', t => {
    const directory = fixture(t);
    const first = path.join(directory, 'first.json');
    const second = path.join(directory, 'second.json');
    fs.writeFileSync(first, JSON.stringify({ 'Hello world': '你好' }));
    assert.equal(validateDicts(directory), true);
    fs.writeFileSync(second, JSON.stringify({ ' Hello   world ': '你好' }));
    assert.equal(validateDicts(directory), false);
    fs.unlinkSync(second);
    for (const invalid of ['{"__proto__":"x"}', '{"Hello":null}', '{"Hello":""}', '[]', '{}']) {
        fs.writeFileSync(first, invalid);
        assert.equal(validateDicts(directory), false);
    }
});

test('isolated install and restore preserve client files and never copy legacy proxy inputs', t => {
    const directory = fixture(t);
    const tool = path.join(directory, 'localization tool');
    fs.mkdirSync(tool);
    fs.copyFileSync(path.join(repo, 'localization_engine.js'), path.join(tool, 'localization_engine.js'));
    for (const name of ['src', 'dicts']) fs.cpSync(path.join(repo, name), path.join(tool, name), { recursive: true });
    const app = path.join(directory, 'synthetic client');
    const resources = path.join(app, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const archive = path.join(resources, 'app.asar');
    writePreloadAsar(archive, '// synthetic original preload');
    const original = fs.readFileSync(archive);

    const legacyInputs = path.join(tool, 'proxy_config');
    fs.mkdirSync(legacyInputs);
    fs.writeFileSync(path.join(legacyInputs, 'client-sentinel.txt'), 'unsupported legacy input');
    fs.writeFileSync(path.join(legacyInputs, 'config.json'), '{}');
    const sentinel = path.join(app, 'client-sentinel.txt');
    fs.writeFileSync(sentinel, 'keep existing client file');

    const run = extra => childProcess.spawnSync(process.execPath, [
        '--require', path.join(repo, 'tests/helpers/isolated-installer.cjs'),
        path.join(tool, 'localization_engine.js'), '--install-dir', app, '--no-kill', ...extra,
    ], {
        cwd: tool, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, AG_TEST_HOME: directory, APPDATA: directory, XDG_CONFIG_HOME: directory },
    });
    const installed = run([]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(ensure.isLocalized(archive), true);
    assert.deepEqual(fs.readFileSync(path.join(resources, 'app.asar.bak')), original);
    assert.ok(readAsarLayout(archive).files.get('dist/preload.js').body.includes(Buffer.from(locale)));
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep existing client file');
    assert.equal(fs.existsSync(path.join(app, 'config.json')), false);

    const restored = run(['--huifu']);
    assert.equal(restored.status, 0, restored.stderr || restored.stdout);
    assert.deepEqual(fs.readFileSync(archive), original);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep existing client file');
});

test('ordinary-user macOS launcher forwards paths and flags without invoking the real installer', {
    skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0),
}, t => {
    const directory = fixture(t);
    const bin = path.join(directory, 'Library/Application Support/fnm/aliases/default/bin');
    fs.mkdirSync(bin, { recursive: true });
    const fakeNode = path.join(bin, 'node');
    fs.writeFileSync(fakeNode, '#!/bin/bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    for (const [file, extra] of [['双击安装中文汉化.command', []], ['双击卸载还原官方英文.command', ['--huifu']]]) {
        const result = childProcess.spawnSync('/bin/bash', [path.join(repo, file), '--install-dir', '/synthetic/path with spaces'], {
            encoding: 'utf8', env: { ...process.env, HOME: directory }, timeout: 5000,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.deepEqual(result.stdout.trim().split('\n'), [path.join(repo, 'localization_engine.js'), ...extra, '--install-dir', '/synthetic/path with spaces']);
    }
});
