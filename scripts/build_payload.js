'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createZipBuffer } = require('../src/zip_utils');

const FORMAT_VERSION = 1;
const LAUNCHER_VERSION = 1;
const MIN_LAUNCHER_VERSION = 1;
const PAYLOAD_ARCHIVE_NAME = 'antigravity2cn-payload.zip';

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function collectPayloadFiles(projectRoot) {
    const entries = [];
    const addFile = (relPath) => {
        const full = path.join(projectRoot, relPath);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
            throw new Error(`Missing required payload file: ${relPath}`);
        }
        entries.push({ name: relPath.replace(/\\/g, '/'), data: fs.readFileSync(full) });
    };

    for (const rootFile of ['localization_engine.js', 'LICENSE', 'README.md']) {
        addFile(rootFile);
    }

    for (const dirName of ['dicts', 'src']) {
        const dirPath = path.join(projectRoot, dirName);
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            throw new Error(`Missing required payload directory: ${dirName}`);
        }
        const ext = dirName === 'dicts' ? '.json' : '.js';
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith(ext)).sort();
        if (files.length === 0) {
            throw new Error(`No ${ext} files found in ${dirName}/`);
        }
        for (const f of files) {
            addFile(`${dirName}/${f}`);
        }
    }

    for (const scriptName of ['ensure_localized.js', 'self_update.js', 'validate_dicts.js', 'node-runtime.json']) {
        addFile(`scripts/${scriptName}`);
    }

    return entries;
}

function buildPayload(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'dist'));
    const sourceCommit = String(options.sourceCommit || '');

    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const version = String(options.version || pkg.version || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Invalid package version for payload build: ${version}`);
    }

    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/node-runtime.json'), 'utf8'));
    const files = collectPayloadFiles(projectRoot);
    const fileDigests = {};
    for (const item of files) {
        fileDigests[item.name] = sha256Hex(item.data);
    }

    const manifest = {
        formatVersion: FORMAT_VERSION,
        version,
        launcherVersion: LAUNCHER_VERSION,
        minLauncherVersion: MIN_LAUNCHER_VERSION,
        sourceCommit,
        nodeVersion: runtimeManifest.version,
        files: fileDigests,
    };

    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const zipEntries = [
        { name: 'payload-manifest.json', data: manifestBuf },
        ...files,
    ];
    const zipBuf = createZipBuffer(zipEntries);
    const zipHash = sha256Hex(zipBuf);

    fs.mkdirSync(outputDir, { recursive: true });
    const archivePath = path.join(outputDir, PAYLOAD_ARCHIVE_NAME);
    const shaPath = `${archivePath}.sha256`;
    fs.writeFileSync(archivePath, zipBuf);
    fs.writeFileSync(shaPath, `${zipHash}  ${PAYLOAD_ARCHIVE_NAME}\n`, 'ascii');

    return { archivePath, shaPath, sha256: zipHash, size: zipBuf.length, manifest };
}

function parseCliArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--output-dir') {
            out.outputDir = argv[++i];
        } else if (arg.startsWith('--output-dir=')) {
            out.outputDir = arg.slice('--output-dir='.length);
        } else if (arg === '--source-commit') {
            out.sourceCommit = argv[++i];
        } else if (arg.startsWith('--source-commit=')) {
            out.sourceCommit = arg.slice('--source-commit='.length);
        } else if (arg === '--version') {
            out.version = argv[++i];
        } else if (arg.startsWith('--version=')) {
            out.version = arg.slice('--version='.length);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return out;
}

if (require.main === module) {
    try {
        const result = buildPayload(parseCliArgs(process.argv.slice(2)));
        console.log(`Created ${result.archivePath} (${result.size} bytes, sha256=${result.sha256})`);
    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    FORMAT_VERSION,
    LAUNCHER_VERSION,
    MIN_LAUNCHER_VERSION,
    PAYLOAD_ARCHIVE_NAME,
    buildPayload,
    collectPayloadFiles,
};
