// Only preload this helper for synthetic installer tests, never normal usage.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');

const testHome = process.env.AG_TEST_HOME;
if (!testHome || !fs.statSync(testHome).isDirectory()) throw new Error('AG_TEST_HOME must name a synthetic test directory.');
os.homedir = () => testHome;
childProcess.execSync = command => {
    if (command.startsWith('tasklist ') || command.startsWith('pgrep ')) return '';
    throw new Error(`Test cannot execute shell command: ${command}`);
};
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
    const target = args && args[1] && path.resolve(args[1]);
    const relative = target && path.relative(testHome, target);
    if (command !== process.execPath || args[0] !== '--check' || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Synthetic installer can only syntax-check its own temporary candidate.');
    }
    return originalExecFileSync(command, args, options);
};
childProcess.spawn = childProcess.spawnSync = () => { throw new Error('Synthetic installer cannot start applications or system tools.'); };
