const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const enginePath = path.join(root, 'localization_engine.js');

function macEngine(uid, writable, euid = uid) {
    const calls = [];
    const fsCalls = [];
    const context = {
        __dirname: root, __filename: enginePath, Buffer,
        console: { log() {}, warn() {}, error() {} },
        process: {
            platform: 'darwin', getuid: () => uid, geteuid: () => euid,
            argv: [process.execPath, enginePath], execPath: process.execPath,
            env: { PATH: '/synthetic/user/bin:/usr/bin:/bin', SUDO_USER: 'other-user' },
            exit(code) { throw new Error(`exit ${code}`); },
        },
        require(name) {
            if (name === 'fs') return {
                constants: fs.constants,
                existsSync(target) { fsCalls.push(target); return false; },
                accessSync(target) {
                    fsCalls.push(target);
                    if (!writable) throw Object.assign(new Error('denied'), { code: 'EACCES' });
                },
            };
            if (name === 'os') return { homedir: () => '/synthetic/user' };
            if (name === 'child_process') return {
                spawnSync(command, args) { calls.push({ command, args }); return { status: 1 }; },
            };
            if (name.startsWith('./src/')) return require(path.join(root, name));
            return require(name);
        },
    };
    const source = fs.readFileSync(enginePath, 'utf8').replace(/\bmain\(\);\s*$/, '');
    return { context, calls, fsCalls, load() { vm.runInNewContext(source, context, { filename: enginePath }); } };
}

test('macOS root execution fails before PATH changes, filesystem checks or subprocesses', () => {
    const engine = macEngine(0, false);
    const originalPath = engine.context.process.env.PATH;
    assert.throws(() => engine.load(), /macOS.*root/);
    assert.equal(engine.context.process.env.PATH, originalPath);
    assert.deepEqual(engine.fsCalls, []);
    assert.deepEqual(engine.calls, []);
});

test('macOS denied write access returns false without an elevation attempt', () => {
    const engine = macEngine(501, false);
    engine.load();
    assert.equal(engine.context.ensureWritePermission('/synthetic/app/resources'), false);
    assert.deepEqual(engine.calls, []);
});

test('macOS effective-root session is rejected even with a non-root real UID', () => {
    const engine = macEngine(501, true, 0);
    assert.throws(() => engine.load(), /macOS.*root/);
    assert.deepEqual(engine.fsCalls, []);
    assert.deepEqual(engine.calls, []);
});

test('macOS real-root session is rejected even after lowering effective UID', () => {
    const engine = macEngine(0, true, 501);
    assert.throws(() => engine.load(), /macOS.*root/);
    assert.deepEqual(engine.fsCalls, []);
    assert.deepEqual(engine.calls, []);
});

test('macOS ordinary user can continue with a writable application', () => {
    const engine = macEngine(501, true);
    engine.load();
    assert.equal(engine.context.ensureWritePermission('/synthetic/app/resources'), true);
    assert.deepEqual(engine.calls, []);
});
