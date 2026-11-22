const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = ['localization_engine.js'];
for (const directory of ['src', 'scripts', 'tests', 'tests/helpers']) {
    for (const file of fs.readdirSync(path.join(root, directory))) {
        if (/\.(?:js|cjs)$/.test(file)) files.push(path.join(directory, file));
    }
}
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${files.length} files.`);
