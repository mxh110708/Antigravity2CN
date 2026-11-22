/**
 * ensure_localized.js — 启动前自检汉化（Windows）
 *
 * 背景：Antigravity 自带 electron-updater，autoDownload=true 且 autoInstallOnAppQuit=true，
 * 退出软件时会静默安装已下载的更新包并整包替换 resources\app.asar，汉化随之丢失。
 *
 * 用法：
 *   node scripts/ensure_localized.js                 # 仅检查并报告状态
 *   node scripts/ensure_localized.js --fix           # 未汉化且软件未运行时自动重新注入
 *   node scripts/ensure_localized.js --fix --launch  # 自动修复后启动 Antigravity
 * 支持 --brand-title english、--install-dir <dir>（不支持 --huifu）。
 * 退出码：0 = 已汉化（或已修复）；2 = 未汉化且未修复；1 = 出错或修复失败。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SIGNATURE_START = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const LOCALE_MARKER = '/* ANTIGRAVITY PRIVATE LOCALE: zh-CN */';
const BRAND_MARKER = '/* ANTIGRAVITY BRAND: Antigravity */';

function createLogger() {
    return { log: (...args) => console.log(...args), error: (...args) => console.error(...args) };
}

function parseArgs(argv) {
    let fix = false;
    let launchApp = false;
    let installDir = null;
    const passthrough = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--fix') {
            fix = true;
        } else if (arg === '--launch') {
            launchApp = true;
        } else if (arg === '--tw' || arg.startsWith('--tw=')) {
            throw new Error('本仓库仅支持简体中文，不支持 --tw。');
        } else if (arg === '--sc') {
            // Legacy Simplified flag is a no-op.
        } else if (arg === '--huifu') {
            throw new Error('ensure_localized.js 不支持 --huifu 参数；如需卸载恢复英文原版，请直接运行 localization_engine.js --huifu。');
        } else if (arg === '--install-dir') {
            if (i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('--')) {
                throw new Error('--install-dir 缺少有效的路径参数！');
            }
            installDir = argv[++i];
        } else if (arg.startsWith('--install-dir=')) {
            installDir = arg.slice('--install-dir='.length);
            if (!installDir) {
                throw new Error('--install-dir= 路径不能为空！');
            }
        } else if (arg === '--brand-title' || arg.startsWith('--brand-title=')) {
            const value = arg === '--brand-title' ? argv[++i] : arg.slice('--brand-title='.length);
            if (String(value || '').toLowerCase() !== 'english') {
                throw new Error('品牌固定为 Antigravity，仅支持 --brand-title english。');
            }
        } else {
            passthrough.push(arg);
        }
    }

    return { fix, launch: launchApp, installDir, brandTitle: 'english', passthrough };
}

function normalizeInstallDir(rawDir) {
    if (!rawDir) return null;
    let resolved = path.resolve(rawDir);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile() && /app\.asar$/i.test(resolved)) {
        resolved = path.dirname(resolved);
    }
    if (/[\\/]resources$/i.test(resolved) && fs.existsSync(path.join(resolved, 'app.asar'))) {
        resolved = path.dirname(resolved);
    }
    return resolved;
}

function hasResources(dir) {
    return !!dir && fs.existsSync(path.join(dir, 'resources', 'app.asar'));
}

function cleanRegistryIconPath(rawValue) {
    let v = String(rawValue || '').trim();
    v = v.replace(/,\s*-?\d+\s*$/, '').trim();
    v = v.replace(/^"|"$/g, '').trim();
    if (/\.exe$/i.test(v)) {
        v = path.dirname(v);
    }
    return v;
}

function detectInstallDir(manualDir, execFileSyncFn = child_process.execFileSync) {
    if (manualDir) {
        const normalized = normalizeInstallDir(manualDir);
        if (!normalized || !hasResources(normalized)) {
            throw new Error(`手动指定的安装目录无效或未找到 resources\\app.asar: ${manualDir}`);
        }
        return normalized;
    }

    const candidates = [];
    const seen = new Set();
    const addCandidate = (candidate) => {
        if (!candidate) return;
        const normalized = normalizeInstallDir(candidate);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            candidates.push(normalized);
        }
    };

    addCandidate(process.env.ANTIGRAVITY_INSTALL_DIR);
    addCandidate(process.env.ANTIGRAVITY_HOME);

    for (const root of [
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ]) {
        try {
            const out = execFileSyncFn(
                'cmd',
                ['/d', '/u', '/c', `reg query "${root}" /s /f Antigravity /d`],
                { encoding: 'utf16le', stdio: 'pipe', timeout: 5000 }
            );
            for (const line of String(out || '').split(/\r?\n/)) {
                const m = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
                if (!m) continue;
                addCandidate(cleanRegistryIconPath(m[2]));
            }
        } catch (e) { /* 注册表根可能不存在或无权限，继续尝试其余候选路径 */ }
    }

    for (const drive of ['C', 'D', 'E', 'F']) {
        addCandidate(`${drive}:\\Programs\\Antigravity`);
        addCandidate(`${drive}:\\Antigravity`);
    }
    if (process.env.ProgramFiles) addCandidate(path.join(process.env.ProgramFiles, 'Antigravity'));
    if (process.env['ProgramFiles(x86)']) addCandidate(path.join(process.env['ProgramFiles(x86)'], 'Antigravity'));
    addCandidate('C:\\Program Files\\Antigravity');
    if (process.env.LOCALAPPDATA) addCandidate(path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity'));

    return candidates.find(hasResources) || null;
}

function queryTasklistHasAntigravity(execFileSyncFn) {
    try {
        const out = execFileSyncFn(
            'tasklist',
            ['/fi', 'imagename eq Antigravity.exe', '/nh'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }
        );
        return String(out || '').toLowerCase().includes('antigravity.exe');
    } catch (e) {
        throw new Error(`无法通过 tasklist 检测 Antigravity.exe 运行状态: ${e.message}`);
    }
}

function isRunning(installDir, execFileSyncFn = child_process.execFileSync) {
    if (!queryTasklistHasAntigravity(execFileSyncFn)) {
        return false;
    }

    let psOut;
    try {
        psOut = execFileSyncFn(
            'powershell',
            [
                '-NoProfile',
                '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | ForEach-Object { if ($_.ExecutablePath) { $_.ExecutablePath } else { '__EMPTY_PATH__' } }"
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }
        );
    } catch (e) {
        throw new Error(`检测到 Antigravity.exe 正在运行，但无法查询进程路径，已中止操作以防止文件损坏: ${e.message}`);
    }

    const lines = String(psOut || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.includes('__EMPTY_PATH__')) {
        throw new Error('检测到 Antigravity.exe 正在运行，但无法读取其可执行路径（可能以管理员权限运行）。请先完全退出 Antigravity 后重试。');
    }
    if (lines.length === 0) {
        if (queryTasklistHasAntigravity(execFileSyncFn)) {
            throw new Error('检测到 Antigravity.exe 正在运行，但未能获取任何进程路径。请先完全退出 Antigravity 后重试。');
        }
        return false;
    }

    const target = path.resolve(installDir).toLowerCase();
    return lines.some(p => path.dirname(path.resolve(p)).toLowerCase() === target);
}

function isLocalized(asarPath) {
    const body = fs.readFileSync(asarPath);
    return [SIGNATURE_START, LOCALE_MARKER, BRAND_MARKER].every(marker => body.includes(Buffer.from(marker)));
}

function pendingUpdate() {
    const dir = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'antigravity-updater', 'pending');
    return dir && fs.existsSync(dir) && fs.readdirSync(dir).some(f => /\.exe$/i.test(f)) ? dir : null;
}

function launch(installDir, logger = createLogger(), spawnFn = child_process.spawn) {
    const exe = path.join(installDir, 'Antigravity.exe');
    if (!fs.existsSync(exe)) {
        logger.error(`[错误] 未找到 ${exe}`);
        return false;
    }
    const child = spawnFn(exe, [], { detached: true, stdio: 'ignore', cwd: installDir });
    if (child && typeof child.unref === 'function') child.unref();
    logger.log('[启动] 已启动 Antigravity。');
    return true;
}

function main(argv = process.argv.slice(2), deps = {}) {
    const platform = deps.platform || process.platform;
    const execFileSyncFn = deps.execFileSync || child_process.execFileSync;
    const spawnSyncFn = deps.spawnSync || child_process.spawnSync;
    const spawnFn = deps.spawn || child_process.spawn;

    let parsed;
    try {
        parsed = parseArgs(argv);
    } catch (e) {
        createLogger().error(`[错误] ${e.message}`);
        return 1;
    }

    const earlyLogger = createLogger();
    if (platform !== 'win32') {
        earlyLogger.log('[提示] 自检启动器目前仅支持 Windows；macOS 请在更新后重新运行 双击安装中文汉化.command。');
        return 1;
    }

    let installDir;
    try {
        installDir = detectInstallDir(parsed.installDir, execFileSyncFn);
    } catch (e) {
        earlyLogger.error(`[错误] ${e.message}`);
        return 1;
    }
    if (!installDir) {
        earlyLogger.error('[错误] 未找到 Antigravity 安装目录，可用 --install-dir 指定。');
        return 1;
    }

    const asarPath = path.join(installDir, 'resources', 'app.asar');
    let localized = isLocalized(asarPath);
    const logger = createLogger();

    let running;
    try {
        running = isRunning(installDir, execFileSyncFn);
    } catch (e) {
        logger.error(`[错误] ${e.message}`);
        return 1;
    }

    const pending = pendingUpdate();
    logger.log(`[检测] 安装目录: ${installDir}`);
    logger.log(`[检测] 汉化状态: ${localized ? '已汉化' : '未汉化（可能已被官方自动更新覆盖）'}`);
    logger.log(`[检测] 运行状态: ${running ? '正在运行' : '未运行'}`);
    if (pending) {
        logger.log(`[提示] 检测到已下载的官方更新包: ${pending}`);
        logger.log('       退出 Antigravity 时它会被静默安装并覆盖汉化；下次通过本启动器打开会自动修复。');
    }

    let fixFailed = false;
    if (!localized && parsed.fix) {
        if (running) {
            logger.log('[跳过] Antigravity 正在运行，为避免强制关闭您的会话，本次不自动修复。请完全退出后再运行。');
        } else {
            const engineArgs = [
                '--brand-title',
                'english',
                '--no-kill',
                '--install-dir',
                installDir
            ];
            for (const extra of parsed.passthrough) {
                if (extra !== '--no-kill') engineArgs.push(extra);
            }
            logger.log(`[修复] 正在重新注入汉化: node localization_engine.js ${engineArgs.join(' ')}`);
            const res = spawnSyncFn(
                process.execPath,
                [path.join(ROOT, 'localization_engine.js'), ...engineArgs],
                { stdio: 'inherit', cwd: ROOT }
            );
            localized = res.status === 0 && isLocalized(asarPath);
            if (localized) {
                logger.log('[√] 汉化已恢复。');
            } else {
                fixFailed = true;
                logger.error(`[×] 重新注入失败（退出码 ${res.status ?? 1}），已中止启动客户端，请查看上方信息。`);
                return 1;
            }
        }
    }

    if (parsed.launch) {
        if (running) {
            logger.log('[提示] Antigravity 已在运行，未重复启动。');
        } else if (!localized || fixFailed) {
            logger.error('[×] 客户端当前未汉化，已中止启动（请使用 --fix 自动修复后再启动）。');
            return 2;
        } else if (!launch(installDir, logger, spawnFn)) {
            return 1;
        }
    }

    return localized ? 0 : 2;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (e) {
        console.error('[错误]', e.message);
        process.exitCode = 1;
    }
}

module.exports = {
    parseArgs,
    normalizeInstallDir,
    cleanRegistryIconPath,
    detectInstallDir,
    isRunning,
    isLocalized,
    launch,
    main
};
