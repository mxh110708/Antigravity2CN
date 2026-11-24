'use strict';

// macOS never crosses into a root session, including direct Node invocation.
if (process.platform === 'darwin' && (
    typeof process.getuid !== 'function' || typeof process.geteuid !== 'function' ||
    process.getuid() === 0 || process.geteuid() === 0
)) {
    throw new Error('[安全] macOS 禁止以 root 或 sudo 运行更新器。');
}

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const readline = require('node:readline');
const childProcess = require('node:child_process');
const { parseZipBuffer } = require('../src/zip_utils');
const { validateDicts } = require('./validate_dicts');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'mxh110708/Antigravity2CN';
const PAYLOAD_ASSET_NAME = 'antigravity2cn-payload.zip';
const PAYLOAD_SHA_NAME = 'antigravity2cn-payload.zip.sha256';
const DEFAULT_LAUNCHER_VERSION = 1;
const MAX_REDIRECTS = 5;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXACT_HOSTS = new Set([
    'api.github.com',
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'codeload.github.com',
]);

const ALLOWED_SCRIPT_PATHS = new Set([
    'scripts/ensure_localized.js',
    'scripts/self_update.js',
    'scripts/validate_dicts.js',
    'scripts/node-runtime.json',
]);

const ALLOWED_ROOT_PATHS = new Set([
    'payload-manifest.json',
    'localization_engine.js',
    'LICENSE',
    'README.md',
]);

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function compareSemver(a, b) {
    const pa = String(a || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10));
    const pb = String(b || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10));
    if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) {
        return 0;
    }
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
    }
    return 0;
}

function isValidSemver(v) {
    return /^\d+\.\d+\.\d+$/.test(String(v || '').trim().replace(/^v/i, ''));
}

function normalizeSemver(v) {
    const clean = String(v || '').trim().replace(/^v/i, '');
    return /^\d+\.\d+\.\d+$/.test(clean) ? clean : null;
}

function readLocalState(projectRoot = ROOT) {
    let version = null;
    let launcherVersion = DEFAULT_LAUNCHER_VERSION;
    let sourceCommit = '';
    let nodeVersion = null;

    const buildInfoPath = path.join(projectRoot, 'build-info.json');
    if (fs.existsSync(buildInfoPath)) {
        try {
            const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
            if (info && typeof info === 'object') {
                const v = normalizeSemver(info.version);
                if (v) version = v;
                if (Number.isInteger(info.launcherVersion) && info.launcherVersion >= 1) {
                    launcherVersion = info.launcherVersion;
                }
                if (typeof info.sourceCommit === 'string') sourceCommit = info.sourceCommit;
                if (typeof info.nodeVersion === 'string') nodeVersion = info.nodeVersion;
            }
        } catch (_e) {}
    }

    if (!version) {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const v = normalizeSemver(pkg && pkg.version);
                if (v) version = v;
            } catch (_e) {}
        }
    }

    if (!nodeVersion) {
        const rtPath = path.join(projectRoot, 'scripts', 'node-runtime.json');
        if (fs.existsSync(rtPath)) {
            try {
                const rt = JSON.parse(fs.readFileSync(rtPath, 'utf8'));
                if (typeof rt.version === 'string') nodeVersion = rt.version;
            } catch (_e) {}
        }
    }

    return {
        version: version || '0.0.0',
        launcherVersion,
        sourceCommit,
        nodeVersion,
    };
}

function getConfigPath(env = process.env, platform = process.platform) {
    if (env.ANTIGRAVITY2CN_CONFIG_DIR) {
        return path.join(env.ANTIGRAVITY2CN_CONFIG_DIR, 'updater.json');
    }
    if (platform === 'win32') {
        const base = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(base, 'Antigravity2CN', 'updater.json');
    }
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity2CN', 'updater.json');
    }
    const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(base, 'antigravity2cn', 'updater.json');
}

function validateProxyUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (/[\r\n\0]/.test(trimmed)) {
        throw new Error('代理地址包含非法控制字符。');
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (_e) {
        throw new Error(`无效的代理地址格式: ${trimmed}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`仅支持 http:// 或 https:// 代理协议，当前为: ${parsed.protocol}`);
    }
    if (!parsed.hostname) {
        throw new Error(`代理地址缺少主机名: ${trimmed}`);
    }
    return parsed.toString().replace(/\/$/, '');
}

function defaultConfig() {
    return {
        autoUpdate: 'off',
        proxy: '',
        checkIntervalHours: 24,
        lastCheckedAt: null,
    };
}

function loadConfig(configPath = getConfigPath()) {
    const base = defaultConfig();
    if (!fs.existsSync(configPath)) return base;
    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!raw || typeof raw !== 'object') return base;
        if (['off', 'prompt', 'auto'].includes(raw.autoUpdate)) {
            base.autoUpdate = raw.autoUpdate;
        }
        if (typeof raw.proxy === 'string' && raw.proxy.trim()) {
            base.proxy = validateProxyUrl(raw.proxy);
        }
        if (typeof raw.checkIntervalHours === 'number' && Number.isFinite(raw.checkIntervalHours) && raw.checkIntervalHours >= 1 && raw.checkIntervalHours <= 720) {
            base.checkIntervalHours = raw.checkIntervalHours;
        }
        if (typeof raw.lastCheckedAt === 'string' && !Number.isNaN(Date.parse(raw.lastCheckedAt))) {
            base.lastCheckedAt = raw.lastCheckedAt;
        }
    } catch (_e) {
        return base;
    }
    return base;
}

function saveConfig(cfg, configPath = getConfigPath()) {
    const normalized = {
        autoUpdate: ['off', 'prompt', 'auto'].includes(cfg.autoUpdate) ? cfg.autoUpdate : 'off',
        proxy: cfg.proxy ? validateProxyUrl(cfg.proxy) : '',
        checkIntervalHours: (typeof cfg.checkIntervalHours === 'number' && Number.isFinite(cfg.checkIntervalHours) && cfg.checkIntervalHours >= 1 && cfg.checkIntervalHours <= 720)
            ? cfg.checkIntervalHours
            : 24,
        lastCheckedAt: (typeof cfg.lastCheckedAt === 'string' && !Number.isNaN(Date.parse(cfg.lastCheckedAt)))
            ? cfg.lastCheckedAt
            : null,
    };
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    fs.renameSync(tmp, configPath);
    if (process.platform !== 'win32') {
        try { fs.chmodSync(configPath, 0o600); } catch (_e) {}
    }
    return normalized;
}

function shouldBypassProxy(hostname, noProxyValue) {
    if (!noProxyValue) return false;
    const host = String(hostname || '').toLowerCase();
    const rules = String(noProxyValue).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const rule of rules) {
        if (rule === '*') return true;
        const clean = rule.replace(/:\d+$/, '');
        if (!clean) continue;
        if (clean.startsWith('.')) {
            if (host.endsWith(clean) || host === clean.slice(1)) return true;
        } else if (host === clean || host.endsWith('.' + clean)) {
            return true;
        }
    }
    return false;
}

function resolveProxy({ cliProxy = '', noProxy = false, config = defaultConfig(), env = process.env, targetUrl = '' } = {}) {
    if (noProxy) return null;
    if (cliProxy) return validateProxyUrl(cliProxy);
    if (config && config.proxy) return validateProxyUrl(config.proxy);

    let targetHost = '';
    let isHttps = true;
    if (targetUrl) {
        try {
            const u = new URL(targetUrl);
            targetHost = u.hostname;
            isHttps = u.protocol === 'https:';
        } catch (_e) {}
    }
    const noProxyEnv = env.NO_PROXY || env.no_proxy || '';
    if (targetHost && shouldBypassProxy(targetHost, noProxyEnv)) {
        return null;
    }
    const envProxy = isHttps
        ? (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '')
        : (env.HTTP_PROXY || env.http_proxy || '');
    return envProxy ? validateProxyUrl(envProxy) : null;
}

function isAllowedRemoteUrl(urlObj, allowInsecureForTest = false) {
    if (allowInsecureForTest) {
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    }
    if (urlObj.protocol !== 'https:') return false;
    const host = urlObj.hostname.toLowerCase();
    return ALLOWED_EXACT_HOSTS.has(host) || host.endsWith('.githubusercontent.com');
}

function formatProxyAuthHeader(proxyUrlObj) {
    if (!proxyUrlObj.username && !proxyUrlObj.password) return null;
    const raw = `${decodeURIComponent(proxyUrlObj.username)}:${decodeURIComponent(proxyUrlObj.password)}`;
    return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

function openConnectTunnel(proxyUrlObj, targetHost, targetPort, timeoutMs) {
    return new Promise((resolve, reject) => {
        const transport = proxyUrlObj.protocol === 'https:' ? https : http;
        const headers = {
            Host: `${targetHost}:${targetPort}`,
        };
        const proxyAuth = formatProxyAuthHeader(proxyUrlObj);
        if (proxyAuth) headers['Proxy-Authorization'] = proxyAuth;

        const req = transport.request({
            host: proxyUrlObj.hostname,
            port: proxyUrlObj.port || (proxyUrlObj.protocol === 'https:' ? 443 : 80),
            method: 'CONNECT',
            path: `${targetHost}:${targetPort}`,
            headers,
            timeout: timeoutMs,
        });

        let settled = false;
        const fail = (err) => {
            if (settled) return;
            settled = true;
            req.destroy();
            reject(err);
        };

        req.on('timeout', () => fail(new Error(`代理连接超时 (${timeoutMs}ms)`)));
        req.on('error', (err) => fail(new Error(`代理连接失败: ${err.message}`)));
        req.on('connect', (res, socket) => {
            if (settled) {
                socket.destroy();
                return;
            }
            if (res.statusCode !== 200) {
                socket.destroy();
                fail(new Error(`代理 CONNECT 隧道被拒绝 (HTTP ${res.statusCode})`));
                return;
            }
            settled = true;
            resolve(socket);
        });
        req.end();
    });
}

async function httpGetSingle(urlObj, options) {
    const timeoutMs = options.timeoutMs || 15000;
    const maxBytes = options.maxBytes || MAX_METADATA_BYTES;
    const headers = {
        'User-Agent': 'Antigravity2CN-Updater',
        ...(options.headers || {}),
    };
    const proxyStr = options.proxy || null;

    if (!proxyStr) {
        const transport = urlObj.protocol === 'https:' ? https : http;
        return await new Promise((resolve, reject) => {
            const req = transport.request(urlObj, { method: 'GET', headers, timeout: timeoutMs }, (res) => {
                collectResponse(res, maxBytes, resolve, reject);
            });
            req.on('timeout', () => { req.destroy(new Error(`请求超时 (${timeoutMs}ms)`)); });
            req.on('error', reject);
            req.end();
        });
    }

    const proxyUrlObj = new URL(proxyStr);
    if (urlObj.protocol === 'http:') {
        const proxyTransport = proxyUrlObj.protocol === 'https:' ? https : http;
        const reqHeaders = { ...headers, Host: urlObj.host };
        const proxyAuth = formatProxyAuthHeader(proxyUrlObj);
        if (proxyAuth) reqHeaders['Proxy-Authorization'] = proxyAuth;
        return await new Promise((resolve, reject) => {
            const req = proxyTransport.request({
                host: proxyUrlObj.hostname,
                port: proxyUrlObj.port || (proxyUrlObj.protocol === 'https:' ? 443 : 80),
                method: 'GET',
                path: urlObj.toString(),
                headers: reqHeaders,
                timeout: timeoutMs,
            }, (res) => {
                collectResponse(res, maxBytes, resolve, reject);
            });
            req.on('timeout', () => { req.destroy(new Error(`通过代理请求超时 (${timeoutMs}ms)`)); });
            req.on('error', reject);
            req.end();
        });
    }

    const targetPort = Number(urlObj.port) || 443;
    const tunnelSocket = await openConnectTunnel(proxyUrlObj, urlObj.hostname, targetPort, timeoutMs);
    return await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({
            socket: tunnelSocket,
            servername: urlObj.hostname,
            rejectUnauthorized: options._rejectUnauthorized !== false,
            ca: options._ca,
        });
        const agent = new https.Agent({ keepAlive: false });
        agent.createConnection = () => tlsSocket;

        const req = https.request({
            hostname: urlObj.hostname,
            port: targetPort,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: 'GET',
            headers,
            agent,
            timeout: timeoutMs,
        }, (res) => {
            collectResponse(res, maxBytes, resolve, reject);
        });
        req.on('timeout', () => {
            tlsSocket.destroy();
            req.destroy(new Error(`通过代理 HTTPS 请求超时 (${timeoutMs}ms)`));
        });
        req.on('error', (err) => {
            tlsSocket.destroy();
            reject(err);
        });
        req.end();
    });
}

function collectResponse(res, maxBytes, resolve, reject) {
    const chunks = [];
    let total = 0;
    res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
            res.destroy(new Error(`响应体超出最大限制 (${maxBytes} 字节)`));
            return;
        }
        chunks.push(chunk);
    });
    res.on('error', reject);
    res.on('end', () => {
        resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks),
        });
    });
}

async function httpGetBuffer(urlStr, options = {}) {
    let currentUrl = new URL(urlStr);
    let currentHeaders = { ...(options.headers || {}) };
    const allowInsecure = Boolean(options._allowInsecureForTest);
    const singleGet = typeof options._httpGetSingle === 'function' ? options._httpGetSingle : httpGetSingle;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!isAllowedRemoteUrl(currentUrl, allowInsecure)) {
            throw new Error(`拒绝访问不在白名单内的地址: ${currentUrl.origin}`);
        }
        const res = await singleGet(currentUrl, { ...options, headers: currentHeaders });
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (hop === MAX_REDIRECTS) {
                throw new Error('HTTP 重定向次数过多。');
            }
            const nextUrl = new URL(res.headers.location, currentUrl);
            if (nextUrl.origin !== currentUrl.origin) {
                // Never forward Authorization across origins (e.g. GitHub API -> asset CDN).
                const sanitized = {};
                for (const [k, v] of Object.entries(currentHeaders)) {
                    if (k.toLowerCase() !== 'authorization') sanitized[k] = v;
                }
                currentHeaders = sanitized;
            }
            currentUrl = nextUrl;
            continue;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`请求失败 (${currentUrl.hostname}): HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            throw err;
        }
        return res.body;
    }
    throw new Error('HTTP 重定向处理异常。');
}

function isAllowedPayloadPath(relPath) {
    if (ALLOWED_ROOT_PATHS.has(relPath)) return true;
    if (ALLOWED_SCRIPT_PATHS.has(relPath)) return true;
    if (/^dicts\/[a-zA-Z0-9._-]+\.json$/.test(relPath)) return true;
    if (/^src\/[a-zA-Z0-9._-]+\.js$/.test(relPath)) return true;
    return false;
}

function parseSha256File(text, expectedFilename) {
    const line = String(text || '').trim().split(/\r?\n/)[0] || '';
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) {
        throw new Error('无效的 .sha256 校验文件格式。');
    }
    const recordedName = path.basename(match[2].trim());
    if (expectedFilename && recordedName !== expectedFilename) {
        throw new Error(`.sha256 文件名不匹配: 期望 ${expectedFilename}，实际 ${recordedName}`);
    }
    return match[1].toLowerCase();
}

function writeFileAtomic(targetPath, buffer) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, targetPath);
}

function verifyAndApplyPayload(options) {
    const {
        projectRoot = ROOT,
        zipBuffer,
        sha256Text,
        expectedVersion = null,
        forceGitWorktree = false,
        checkSyntaxFn = null,
    } = options;

    if (fs.existsSync(path.join(projectRoot, '.git')) && !forceGitWorktree) {
        throw new Error('检测到当前目录为 Git 源码仓库，请使用 git pull 更新，或显式传入 --force 覆盖。');
    }

    const expectedSha = parseSha256File(sha256Text, PAYLOAD_ASSET_NAME);
    const actualSha = sha256Hex(zipBuffer);
    if (actualSha !== expectedSha) {
        throw new Error(`更新包 SHA-256 校验失败: 期望 ${expectedSha}，实际 ${actualSha}`);
    }

    const filesMap = parseZipBuffer(zipBuffer, { maxTotalBytes: MAX_PAYLOAD_BYTES, maxEntries: 128 });
    for (const relPath of filesMap.keys()) {
        if (!isAllowedPayloadPath(relPath)) {
            throw new Error(`更新包包含未授权的文件路径: ${relPath}`);
        }
    }

    const manifestBuf = filesMap.get('payload-manifest.json');
    if (!manifestBuf) {
        throw new Error('更新包缺少 payload-manifest.json。');
    }
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    if (!manifest || manifest.formatVersion !== 1 || !isValidSemver(manifest.version) || !manifest.files || typeof manifest.files !== 'object') {
        throw new Error('更新包 payload-manifest.json 格式无效。');
    }
    const remoteVersion = normalizeSemver(manifest.version);
    if (expectedVersion && normalizeSemver(expectedVersion) !== remoteVersion) {
        throw new Error(`更新包版本 (${remoteVersion}) 与 Release 标签 (${expectedVersion}) 不一致。`);
    }

    const localState = readLocalState(projectRoot);
    if (Number.isInteger(manifest.minLauncherVersion) && manifest.minLauncherVersion > localState.launcherVersion) {
        throw new Error(`新版本 v${remoteVersion} 需要新版启动脚本（launcherVersion >= ${manifest.minLauncherVersion}），请前往 Releases 下载对应平台的完整离线包覆盖升级。`);
    }
    if (manifest.nodeVersion && localState.nodeVersion && manifest.nodeVersion !== localState.nodeVersion) {
        throw new Error(`新版本 v${remoteVersion} 升级了便携 Node.js 运行时 (${localState.nodeVersion} -> ${manifest.nodeVersion})，请前往 Releases 下载对应平台的完整离线包覆盖升级。`);
    }

    const declaredPaths = Object.keys(manifest.files).sort();
    if (declaredPaths.length === 0) {
        throw new Error('更新包清单未列出任何文件。');
    }
    for (const relPath of declaredPaths) {
        if (relPath === 'payload-manifest.json' || !isAllowedPayloadPath(relPath)) {
            throw new Error(`更新包清单包含非法路径: ${relPath}`);
        }
        const buf = filesMap.get(relPath);
        if (!buf) {
            throw new Error(`更新包缺少清单声明的文件: ${relPath}`);
        }
        const digest = sha256Hex(buf);
        if (digest !== String(manifest.files[relPath] || '').toLowerCase()) {
            throw new Error(`更新包文件校验失败 (${relPath})`);
        }
    }
    for (const relPath of filesMap.keys()) {
        if (relPath !== 'payload-manifest.json' && !Object.prototype.hasOwnProperty.call(manifest.files, relPath)) {
            throw new Error(`更新包包含清单之外的额外文件: ${relPath}`);
        }
    }

    const runId = `${process.pid}-${Date.now()}`;
    const stagingDir = path.join(projectRoot, `.update-staging-${runId}`);
    const backupDir = path.join(projectRoot, `.update-backup-${runId}`);
    const touchedFiles = [];
    const createdFiles = [];

    try {
        fs.mkdirSync(stagingDir, { recursive: true });
        for (const relPath of declaredPaths) {
            const dest = path.join(stagingDir, relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, filesMap.get(relPath));
        }

        // Validate staged JS syntax before applying anything.
        for (const relPath of declaredPaths) {
            if (!relPath.endsWith('.js')) continue;
            const stagedFile = path.join(stagingDir, relPath);
            if (typeof checkSyntaxFn === 'function') {
                checkSyntaxFn(stagedFile, relPath);
            } else {
                const res = childProcess.spawnSync(process.execPath, ['--check', stagedFile], { encoding: 'utf8' });
                if (res.status !== 0) {
                    throw new Error(`更新包语法校验失败 (${relPath}): ${(res.stderr || '').trim()}`);
                }
            }
        }

        // Validate staged Simplified Chinese dictionaries before applying anything.
        if (!validateDicts(path.join(stagingDir, 'dicts'))) {
            throw new Error('更新包词典校验失败，已中止更新。');
        }

        // Backup existing files and apply atomically.
        fs.mkdirSync(backupDir, { recursive: true });
        for (const relPath of declaredPaths) {
            const livePath = path.join(projectRoot, relPath);
            if (fs.existsSync(livePath)) {
                const bakPath = path.join(backupDir, relPath);
                fs.mkdirSync(path.dirname(bakPath), { recursive: true });
                fs.copyFileSync(livePath, bakPath);
                touchedFiles.push(relPath);
            } else {
                createdFiles.push(relPath);
            }
        }

        const buildInfoPath = path.join(projectRoot, 'build-info.json');
        let hadBuildInfo = false;
        if (fs.existsSync(buildInfoPath)) {
            hadBuildInfo = true;
            fs.copyFileSync(buildInfoPath, path.join(backupDir, 'build-info.json'));
        }

        try {
            for (const relPath of declaredPaths) {
                const livePath = path.join(projectRoot, relPath);
                writeFileAtomic(livePath, filesMap.get(relPath));
            }
            if (hadBuildInfo) {
                const currentInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
                currentInfo.version = remoteVersion;
                if (manifest.sourceCommit) currentInfo.sourceCommit = manifest.sourceCommit;
                currentInfo.updatedAt = new Date().toISOString();
                writeFileAtomic(buildInfoPath, Buffer.from(JSON.stringify(currentInfo, null, 2) + '\n', 'utf8'));
            }
        } catch (applyErr) {
            // Rollback all live files on partial failure.
            for (const relPath of touchedFiles) {
                const bakPath = path.join(backupDir, relPath);
                if (fs.existsSync(bakPath)) {
                    try { writeFileAtomic(path.join(projectRoot, relPath), fs.readFileSync(bakPath)); } catch (_e) {}
                }
            }
            for (const relPath of createdFiles) {
                try { fs.unlinkSync(path.join(projectRoot, relPath)); } catch (_e) {}
            }
            if (hadBuildInfo && fs.existsSync(path.join(backupDir, 'build-info.json'))) {
                try { writeFileAtomic(buildInfoPath, fs.readFileSync(path.join(backupDir, 'build-info.json'))); } catch (_e) {}
            }
            throw new Error(`应用更新失败并已自动回滚: ${applyErr.message}`);
        }
    } finally {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_e) {}
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (_e) {}
    }

    return {
        previousVersion: localState.version,
        version: remoteVersion,
        sourceCommit: manifest.sourceCommit || '',
        updatedFiles: declaredPaths.length,
    };
}

async function fetchLatestRelease(options = {}) {
    const repo = options.repo || DEFAULT_REPO;
    const apiBase = options.apiBase || 'https://api.github.com';
    const url = `${apiBase.replace(/\/$/, '')}/repos/${repo}/releases/latest`;
    const headers = {
        Accept: 'application/vnd.github+json',
    };
    const token = options.token || process.env.ANTIGRAVITY2CN_GITHUB_TOKEN || '';
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const body = await httpGetBuffer(url, {
        proxy: options.proxy || null,
        timeoutMs: options.timeoutMs || 15000,
        maxBytes: MAX_METADATA_BYTES,
        headers,
        _httpGetSingle: options._httpGetSingle,
        _allowInsecureForTest: options._allowInsecureForTest,
        _rejectUnauthorized: options._rejectUnauthorized,
        _ca: options._ca,
    });
    const release = JSON.parse(body.toString('utf8'));
    const version = normalizeSemver(release && release.tag_name);
    if (!version) {
        throw new Error(`远端 Release 标签不是有效的语义化版本: ${release && release.tag_name}`);
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const payloadAsset = assets.find(a => a && a.name === PAYLOAD_ASSET_NAME) || null;
    const shaAsset = assets.find(a => a && a.name === PAYLOAD_SHA_NAME) || null;
    return {
        tagName: release.tag_name,
        version,
        name: release.name || release.tag_name,
        htmlUrl: release.html_url || '',
        payloadAsset,
        shaAsset,
    };
}

async function downloadReleaseAsset(asset, options = {}) {
    if (!asset) throw new Error('Release 资产对象缺失。');
    const token = options.token || process.env.ANTIGRAVITY2CN_GITHUB_TOKEN || '';
    const useApiEndpoint = Boolean(token && asset.url);
    const targetUrl = useApiEndpoint ? asset.url : asset.browser_download_url;
    if (!targetUrl) {
        throw new Error(`资产 ${asset.name || ''} 缺少下载地址。`);
    }
    const headers = useApiEndpoint
        ? { Accept: 'application/octet-stream', Authorization: `Bearer ${token}` }
        : { Accept: 'application/octet-stream' };

    return await httpGetBuffer(targetUrl, {
        proxy: options.proxy || null,
        timeoutMs: options.timeoutMs || 30000,
        maxBytes: options.maxBytes || MAX_PAYLOAD_BYTES,
        headers,
        _httpGetSingle: options._httpGetSingle,
        _allowInsecureForTest: options._allowInsecureForTest,
        _rejectUnauthorized: options._rejectUnauthorized,
        _ca: options._ca,
    });
}

function isCooldownActive(config, nowMs = Date.now()) {
    if (!config.lastCheckedAt) return false;
    const lastMs = Date.parse(config.lastCheckedAt);
    if (Number.isNaN(lastMs)) return false;
    const intervalMs = (config.checkIntervalHours || 24) * 3600 * 1000;
    return (nowMs - lastMs) < intervalMs;
}

function askYesNo(promptText) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(promptText, (answer) => {
            rl.close();
            const norm = String(answer || '').trim().toLowerCase();
            resolve(norm === '' || norm === 'y' || norm === 'yes');
        });
    });
}

function parseArgs(argv) {
    const args = [...argv];
    let command = 'check';
    if (args.length > 0 && ['check', 'apply', 'auto', 'config'].includes(args[0])) {
        command = args.shift();
    }
    const opts = {
        command,
        proxy: '',
        noProxy: false,
        reinstall: false,
        noReinstall: false,
        installDir: '',
        noKill: false,
        force: false,
        quietWhenOff: false,
        show: false,
        autoUpdate: null,
        setProxy: null,
        clearProxy: false,
        interval: null,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--proxy') {
            if (i + 1 >= args.length) throw new Error('--proxy 缺少地址参数。');
            opts.proxy = args[++i];
        } else if (arg.startsWith('--proxy=')) {
            opts.proxy = arg.slice('--proxy='.length);
        } else if (arg === '--no-proxy') {
            opts.noProxy = true;
        } else if (arg === '--reinstall') {
            opts.reinstall = true;
        } else if (arg === '--no-reinstall') {
            opts.noReinstall = true;
        } else if (arg === '--install-dir') {
            if (i + 1 >= args.length) throw new Error('--install-dir 缺少路径参数。');
            opts.installDir = args[++i];
        } else if (arg.startsWith('--install-dir=')) {
            opts.installDir = arg.slice('--install-dir='.length);
        } else if (arg === '--no-kill') {
            opts.noKill = true;
        } else if (arg === '--force') {
            opts.force = true;
        } else if (arg === '--quiet-when-off') {
            opts.quietWhenOff = true;
        } else if (arg === '--show') {
            opts.show = true;
        } else if (arg === '--auto-update') {
            if (i + 1 >= args.length) throw new Error('--auto-update 需要 off、prompt 或 auto。');
            opts.autoUpdate = args[++i];
        } else if (arg.startsWith('--auto-update=')) {
            opts.autoUpdate = arg.slice('--auto-update='.length);
        } else if (arg === '--set-proxy') {
            if (i + 1 >= args.length) throw new Error('--set-proxy 缺少代理地址。');
            opts.setProxy = args[++i];
        } else if (arg.startsWith('--set-proxy=')) {
            opts.setProxy = arg.slice('--set-proxy='.length);
        } else if (arg === '--clear-proxy') {
            opts.clearProxy = true;
        } else if (arg === '--interval') {
            if (i + 1 >= args.length) throw new Error('--interval 缺少小时数。');
            opts.interval = Number(args[++i]);
        } else if (arg.startsWith('--interval=')) {
            opts.interval = Number(arg.slice('--interval='.length));
        } else if (arg === '--tw' || arg.startsWith('--tw=')) {
            throw new Error('本仓库仅支持简体中文，不支持 --tw。');
        } else if (arg === '--sc' || arg === '--brand-title' || arg.startsWith('--brand-title=')) {
            if (arg === '--brand-title') {
                const v = args[++i];
                if (String(v || '').toLowerCase() !== 'english') {
                    throw new Error('品牌固定为 Antigravity，仅支持 --brand-title english。');
                }
            } else if (arg.startsWith('--brand-title=')) {
                const v = arg.slice('--brand-title='.length);
                if (String(v || '').toLowerCase() !== 'english') {
                    throw new Error('品牌固定为 Antigravity，仅支持 --brand-title english。');
                }
            }
        } else {
            throw new Error(`不支持的参数: ${arg}`);
        }
    }
    return opts;
}

function runReinstall(projectRoot, opts, logger) {
    const engineArgs = [path.join(projectRoot, 'localization_engine.js'), '--brand-title', 'english'];
    if (opts.installDir) engineArgs.push('--install-dir', opts.installDir);
    if (opts.noKill) engineArgs.push('--no-kill');
    logger.log(`[更新] 正在将新版汉化重新注入 Antigravity...`);
    const res = childProcess.spawnSync(process.execPath, engineArgs, {
        cwd: projectRoot,
        stdio: 'inherit',
    });
    if (res.status !== 0) {
        logger.error(`[警告] 本地汉化文件已更新完成，但重新注入客户端失败（退出码 ${res.status ?? 1}）。请关闭 Antigravity 后手动运行 install-cn。`);
        return false;
    }
    return true;
}

async function performUpdateApply(projectRoot, release, proxy, opts, logger, deps = {}) {
    if (!release.payloadAsset || !release.shaAsset) {
        throw new Error(`远端版本 v${release.version} 未包含轻量更新包 (${PAYLOAD_ASSET_NAME})，请前往 Releases 页面下载对应平台的完整离线包：${release.htmlUrl}`);
    }
    logger.log(`[更新] 正在下载 v${release.version} 校验文件与轻量更新包...`);
    const shaBuf = await downloadReleaseAsset(release.shaAsset, {
        proxy,
        timeoutMs: deps.downloadTimeoutMs || 30000,
        maxBytes: MAX_METADATA_BYTES,
        token: deps.token,
        _httpGetSingle: deps._httpGetSingle,
        _allowInsecureForTest: deps._allowInsecureForTest,
        _rejectUnauthorized: deps._rejectUnauthorized,
        _ca: deps._ca,
    });
    const zipBuf = await downloadReleaseAsset(release.payloadAsset, {
        proxy,
        timeoutMs: deps.downloadTimeoutMs || 60000,
        maxBytes: MAX_PAYLOAD_BYTES,
        token: deps.token,
        _httpGetSingle: deps._httpGetSingle,
        _allowInsecureForTest: deps._allowInsecureForTest,
        _rejectUnauthorized: deps._rejectUnauthorized,
        _ca: deps._ca,
    });

    const applied = verifyAndApplyPayload({
        projectRoot,
        zipBuffer: zipBuf,
        sha256Text: shaBuf.toString('utf8'),
        expectedVersion: release.version,
        forceGitWorktree: opts.force,
        checkSyntaxFn: deps.checkSyntaxFn,
    });
    logger.log(`[√] 汉化工具已从 v${applied.previousVersion} 升级至 v${applied.version}（更新 ${applied.updatedFiles} 个文件）。`);
    return applied;
}

async function main(argv = process.argv.slice(2), deps = {}) {
    const projectRoot = deps.projectRoot || ROOT;
    const configPath = deps.configPath || getConfigPath();
    const logger = deps.logger || { log: (...a) => console.log(...a), error: (...a) => console.error(...a) };

    let opts;
    try {
        opts = parseArgs(argv);
    } catch (e) {
        logger.error(`[错误] ${e.message}`);
        return 1;
    }

    if (opts.command === 'config') {
        const cfg = loadConfig(configPath);
        let changed = false;
        if (opts.autoUpdate !== null) {
            if (!['off', 'prompt', 'auto'].includes(opts.autoUpdate)) {
                logger.error('[错误] --auto-update 仅支持 off、prompt 或 auto。');
                return 1;
            }
            cfg.autoUpdate = opts.autoUpdate;
            changed = true;
        }
        if (opts.clearProxy) {
            cfg.proxy = '';
            changed = true;
        } else if (opts.setProxy !== null) {
            try {
                cfg.proxy = validateProxyUrl(opts.setProxy);
            } catch (e) {
                logger.error(`[错误] ${e.message}`);
                return 1;
            }
            changed = true;
        }
        if (opts.interval !== null) {
            if (!Number.isFinite(opts.interval) || opts.interval < 1 || opts.interval > 720) {
                logger.error('[错误] --interval 必须为 1 至 720 之间的小时数。');
                return 1;
            }
            cfg.checkIntervalHours = opts.interval;
            changed = true;
        }
        const finalCfg = changed ? saveConfig(cfg, configPath) : cfg;
        logger.log(`[配置] 配置文件: ${configPath}`);
        logger.log(`  autoUpdate         : ${finalCfg.autoUpdate} (off=关闭联网, prompt=发现新版询问, auto=静默升级)`);
        logger.log(`  proxy              : ${finalCfg.proxy || '(未设置，将按需回退环境变量 HTTPS_PROXY/HTTP_PROXY)'}`);
        logger.log(`  checkIntervalHours : ${finalCfg.checkIntervalHours}`);
        logger.log(`  lastCheckedAt      : ${finalCfg.lastCheckedAt || '(从未检查)'}`);
        return 0;
    }

    const config = loadConfig(configPath);
    const localState = readLocalState(projectRoot);

    if (opts.command === 'auto') {
        if (config.autoUpdate === 'off') {
            return 0;
        }
        if (isCooldownActive(config, deps.nowMs || Date.now())) {
            return 0;
        }
        let proxy = null;
        try {
            proxy = resolveProxy({
                cliProxy: opts.proxy,
                noProxy: opts.noProxy,
                config,
                env: deps.env || process.env,
                targetUrl: (deps.apiBase || 'https://api.github.com') + '/repos/' + (deps.repo || DEFAULT_REPO),
            });
        } catch (e) {
            logger.error(`[更新提示] 代理配置无效，已跳过自动检查: ${e.message}`);
            return 0;
        }
        try {
            const release = await fetchLatestRelease({
                repo: deps.repo || DEFAULT_REPO,
                apiBase: deps.apiBase,
                proxy,
                timeoutMs: deps.autoTimeoutMs || 5000,
                token: deps.token,
                _httpGetSingle: deps._httpGetSingle,
                _allowInsecureForTest: deps._allowInsecureForTest,
                _rejectUnauthorized: deps._rejectUnauthorized,
                _ca: deps._ca,
            });
            config.lastCheckedAt = new Date(deps.nowMs || Date.now()).toISOString();
            try { saveConfig(config, configPath); } catch (_e) {}

            if (compareSemver(release.version, localState.version) <= 0) {
                return 0;
            }
            logger.error(`[更新] 检测到新版本汉化 v${release.version}（当前 v${localState.version}）。`);
            if (config.autoUpdate === 'prompt') {
                const confirmed = await (deps.askYesNo || askYesNo)(`是否立即更新本地汉化至 v${release.version}？[Y/n] `);
                if (!confirmed) {
                    logger.error('[更新] 已跳过本次升级；随时可运行 update-cn 手动升级。');
                    return 0;
                }
            }
            await performUpdateApply(projectRoot, release, proxy, opts, logger, deps);
        } catch (err) {
            logger.error(`[更新提示] 自动检查/更新未完成（不影响正常启动）: ${err.message}`);
        }
        return 0;
    }

    // Explicit `check` or `apply`
    let proxy = null;
    try {
        proxy = resolveProxy({
            cliProxy: opts.proxy,
            noProxy: opts.noProxy,
            config,
            env: deps.env || process.env,
            targetUrl: (deps.apiBase || 'https://api.github.com') + '/repos/' + (deps.repo || DEFAULT_REPO),
        });
    } catch (e) {
        logger.error(`[错误] ${e.message}`);
        return 1;
    }

    logger.log(`[检查] 当前本地版本: v${localState.version}${proxy ? ` | 代理: ${proxy}` : ' | 直连'}`);
    let release;
    try {
        release = await fetchLatestRelease({
            repo: deps.repo || DEFAULT_REPO,
            apiBase: deps.apiBase,
            proxy,
            timeoutMs: deps.timeoutMs || 15000,
            token: deps.token,
            _httpGetSingle: deps._httpGetSingle,
            _allowInsecureForTest: deps._allowInsecureForTest,
            _rejectUnauthorized: deps._rejectUnauthorized,
            _ca: deps._ca,
        });
    } catch (e) {
        logger.error(`[错误] 检查远端版本失败: ${e.message}`);
        if (e.statusCode === 404 || e.statusCode === 401) {
            logger.error('[提示] 若仓库当前为私有仓库，请设置只读环境变量 ANTIGRAVITY2CN_GITHUB_TOKEN，或等待仓库公开后重试。');
        } else if (!proxy) {
            logger.error('[提示] 如需通过代理联网，请传入 --proxy http://127.0.0.1:2080 或运行 config --set-proxy 保存代理。');
        }
        return 1;
    }

    const cmp = compareSemver(release.version, localState.version);
    if (cmp <= 0 && !opts.force) {
        logger.log(`[√] 当前已是最新版本 (v${localState.version}，远端最新 v${release.version})。`);
        return 0;
    }

    logger.log(`[发现] 远端最新版本: v${release.version} (${release.name})`);
    if (release.htmlUrl) logger.log(`       发布页面: ${release.htmlUrl}`);

    if (opts.command === 'check') {
        logger.log('[提示] 运行 update-cn.bat（Windows）或 update-cn.command（macOS）即可升级。');
        return 0;
    }

    try {
        await performUpdateApply(projectRoot, release, proxy, opts, logger, deps);
    } catch (e) {
        logger.error(`[错误] ${e.message}`);
        return 1;
    }

    if (opts.reinstall && !opts.noReinstall) {
        const ok = (deps.runReinstall || runReinstall)(projectRoot, opts, logger);
        if (!ok) return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }).catch((err) => {
        console.error(`[错误] ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_REPO,
    PAYLOAD_ASSET_NAME,
    PAYLOAD_SHA_NAME,
    DEFAULT_LAUNCHER_VERSION,
    compareSemver,
    isValidSemver,
    normalizeSemver,
    readLocalState,
    getConfigPath,
    validateProxyUrl,
    loadConfig,
    saveConfig,
    shouldBypassProxy,
    resolveProxy,
    isAllowedRemoteUrl,
    isAllowedPayloadPath,
    parseSha256File,
    httpGetBuffer,
    fetchLatestRelease,
    downloadReleaseAsset,
    verifyAndApplyPayload,
    isCooldownActive,
    parseArgs,
    main,
};
