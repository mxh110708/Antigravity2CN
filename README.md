# Antigravity 简体中文汉化 · 私人维护版

个人独立维护使用的 Antigravity 中文界面汉化工具。仅支持简体中文，保留 Windows 和 macOS 的安装、还原与界面内容隔离功能。

本仓库为独立仓库，上游历史保留，但后续更新由本仓库自行审阅和维护。

---

## 环境与范围

| 项目 | 说明 |
| --- | --- |
| 支持系统与架构 | Windows（x64 / ARM64）、macOS（Apple Silicon `arm64` / Intel `x64`） |
| 适用客户端 | Electron 架构、安装目录包含 `resources/app.asar` 或 `Contents/Resources/app.asar` 的 Antigravity |
| 语言与品牌 | 仅支持简体中文；品牌固定保留英文 **Antigravity**（`--tw` 会明确拒绝，不提供品牌选择菜单） |
| 普通使用运行环境 | Windows 与 macOS 发行包均内置经官方校验的便携 Node.js（`v24.22.3`），**无需本机安装 Node.js**，不修改系统或用户 `PATH` |
| 源码直跑 | 直接下载源码 ZIP 或 `git clone` 也可运行；首次缺少运行时会从 `nodejs.org` 官方 HTTPS 下载并校验缓存到 `.runtime/` |
| 开发测试环境 | 使用锁定的 `jsdom` 开发依赖；Windows 可用 `scripts/dev.ps1` 准备项目内开发工具链，macOS / Linux 使用 Node.js `^22.22.2`、`^24.15.0` 或 `>=26.0.0` |

> [!NOTE]
> 现有词典与回归用例包含上游 v2.34.0 相关界面。客户端每次升级都可能调整模块结构和注入位置，版本号相近也不等于已经验证兼容。

- **汉化范围**：主界面、顶部系统菜单、任务栏托盘与原生右键菜单、Sidecar 伴生面板（含 Swarm 面板与 `plugin://` 子框架）、主进程原生弹窗（退出确认、WSL/SSH 提示、设备与 Passkey 选择等）、更新弹窗、加载动画、设置面板、插件与自定义项、新手引导及登录页。
- **内容隔离**：代码编辑器、终端、消息正文、思考内容、文件路径/URI、表单输入值与 `<option>` 提交值保持英文原文，不由汉化引擎改写。

---

## 获取方式与分平台发行包

Windows 与 macOS **分开打包、独立发行**，各自只包含本平台所需脚本与运行时，互不混入对方平台文件。请使用已登录且有访问权限的 GitHub 账户从本私有仓库获取。

### 方式 A：下载对应平台的离线便携包（推荐）

前往 [Releases](https://github.com/mxh110708/Antigravity2CN/releases/latest)，按您的设备系统与 CPU 架构下载对应压缩包（建议核对随附的 `.sha256` 文件）：

| 平台与设备 | 发行包文件名 | 校验文件 | 适用说明 |
| --- | --- | --- | --- |
| Windows（Intel / AMD 电脑） | `antigravity2cn-windows-x64.zip` | `antigravity2cn-windows-x64.zip.sha256` | 最常见的 64 位 Windows 电脑 |
| Windows（ARM 设备） | `antigravity2cn-windows-arm64.zip` | `antigravity2cn-windows-arm64.zip.sha256` | Snapdragon / ARM64 Windows 设备 |
| macOS（Apple Silicon M 系列） | `antigravity2cn-macos-arm64.zip` | `antigravity2cn-macos-arm64.zip.sha256` | M1 / M2 / M3 / M4 及更新机型 |
| macOS（Intel 芯片） | `antigravity2cn-macos-x64.zip` | `antigravity2cn-macos-x64.zip.sha256` | Intel 处理器 Mac 电脑 |

离线包完整解压到**当前用户可写的目录**后即可离线运行（不要直接在压缩包预览窗口内双击运行）。

### 方式 B：通过 Git 克隆或下载源码 ZIP

需要同步源码或自行修改词典时，可使用源码仓库：

```sh
git clone https://github.com/mxh110708/Antigravity2CN.git
cd Antigravity2CN
```

直接运行源码目录中的 Windows `.bat` 或 macOS `.command` 入口时，脚本会检查项目内的 `.runtime/`：
- 首次运行且缺失运行时时，自动从 `https://nodejs.org/dist/` 官方地址（强制 HTTPS、禁止重定向）下载固定版本，逐一校验压缩包、`node` 可执行文件和 `LICENSE` 的 SHA-256 摘要后缓存到 `.runtime/`。
- 后续重复运行直接校验本地缓存后复用，无需再次联网。如果当前网络无法直连 `nodejs.org`，请改用上方对应平台的离线便携包。

---

## 使用指南

### Windows

> [!IMPORTANT]
> 操作前请先保存工作并**完全退出** Antigravity 客户端（含系统托盘图标）。默认情况下引擎会自动尝试关闭仍在运行的客户端；传入 `--no-kill` 可禁止自动关闭进程。

1. **安装简体中文汉化**：
   完整解压 `antigravity2cn-windows-<架构>.zip` 后，双击运行 **`install-cn.bat`**。
   若客户端安装在非常规路径，也可在终端（PowerShell / CMD）中手动指定目录：
   ```powershell
   .\install-cn.bat --install-dir "C:\Path\To\Antigravity" --brand-title english --no-kill
   ```
   自动探测依次检查环境变量（`ANTIGRAVITY_INSTALL_DIR` / `ANTIGRAVITY_HOME`）、卸载注册表和常见安装路径；探测失败时可传入客户端根目录、其 `resources` 目录或 `app.asar` 文件路径。

2. **自动检查汉化并启动（应对官方自动更新）**：
   Antigravity 内置静默自动更新器，退出客户端后可能自动替换 `resources/app.asar` 导致界面变回英文。建议平时双击 **`launch-antigravity.bat`**（或为其创建桌面快捷方式）来启动客户端：
   - 客户端未运行且检测到汉化丢失（或缺少本版固定标记）时，会自动重新注入简体中文与固定英文品牌，修复成功后再启动 Antigravity。
   - 若自动修复失败，启动器会**中止启动并报错**，避免直接启动未汉化版本；若检测到客户端已在运行，会跳过覆盖操作以防打断当前会话。
   - 终端调用示例（或仅检查状态不安装、不启动）：
     ```powershell
     & '.\launch-antigravity.bat' --install-dir "C:\Path\To\Antigravity"
     powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_windows.ps1 check --install-dir "C:\Path\To\Antigravity"
     ```
   - 自检启动器退出码：`0` 已汉化或修复成功；`2` 未汉化且未修复；`1` 参数、检测或修复出错。

3. **卸载汉化并还原官方英文**：
   完全退出客户端后，双击运行 **`restore-en.bat`**（或带参数运行）：
   ```powershell
   .\restore-en.bat --install-dir "C:\Path\To\Antigravity" --no-kill
   ```

---

### macOS

> [!IMPORTANT]
> 所有 macOS 入口**仅允许当前普通用户运行**，禁止使用 `sudo` 或 root 身份执行；包装脚本与 Node 引擎都会在最早期拒绝真实 UID 或有效 UID 为 root 的会话，权限不足时直接报错退出，不会自动调用 `sudo` 或修改系统目录所有权。

1. **准备当前用户拥有且可写的应用副本**：
   推荐将官方 `Antigravity.app` 放在当前用户的 **`~/Applications/Antigravity.app`**（不要同时运行多个应用副本）。自动探测优先检查 `~/Applications/Antigravity.app`，再检查 `/Applications/Antigravity.app`；若系统 `/Applications` 下的副本不可写，请复制到 `~/Applications/` 后再操作，不要通过 `sudo` 绕过。

2. **安装简体中文汉化**：
   保存工作并**完全退出** Antigravity 后，在解压的 `antigravity2cn-macos-<架构>/` 目录中双击 **`install-cn.command`**，或在终端运行：
   ```sh
   /bin/bash ./install-cn.command --install-dir "$HOME/Applications/Antigravity.app"
   ```
   - **首次双击遇权限或安全提示**：
     - 如果解压工具丢失了可执行权限，可在项目目录执行：
       `chmod +x install-cn.command restore-en.command scripts/run_macos.sh scripts/portable_runtime.sh`
       或直接使用上面的 `/bin/bash ./install-cn.command` 运行。
     - 如果 macOS 提示“无法验证开发者”或安全拦截，可在终端右键点击脚本选择“打开”，或在“系统设置 -> 隐私与安全性”中点击“仍要打开”。
   - **签名与完整性更新**：引擎仅修改用户自己的 `.app` 资源，同步更新 `Contents/Info.plist` 中的 `ElectronAsarIntegrity` 校验值，并调用系统绝对路径 `/usr/bin/xattr` 与 `/usr/bin/codesign` 完成本地 ad-hoc 深度重签名（注意：本地 ad-hoc 重签名不是官方开发者签名，不能作为官方发布者认证）。

3. **卸载汉化并还原官方英文**：
   完全退出客户端后，双击 **`restore-en.command`**，或在终端执行：
   ```sh
   /bin/bash ./restore-en.command --install-dir "$HOME/Applications/Antigravity.app"
   ```

4. **官方更新后恢复汉化**：
   macOS 暂无自检启动器；客户端更新完成并完全退出后，重新运行一次 `install-cn.command` 即可恢复简体中文。

---

## 快捷入口与命令行参数对照

### 快捷入口文件

| 文件名 | 适用平台 | 底层操作 | 说明 |
| --- | --- | --- | --- |
| `install-cn.bat` | Windows | `scripts/run_windows.ps1 install` | 安装 / 更新简体中文汉化 |
| `restore-en.bat` | Windows | `scripts/run_windows.ps1 restore` | 使用 `app.asar.bak` 还原官方英文版 |
| `launch-antigravity.bat` | Windows | `scripts/run_windows.ps1 launch` | 启动前自检并在未运行时自动补回汉化 |
| `install-cn.command` | macOS | `scripts/run_macos.sh install` | 安装 / 更新简体中文汉化并重签名 |
| `restore-en.command` | macOS | `scripts/run_macos.sh restore` | 使用 `app.asar.bak` 还原官方英文版并重签名 |

### 命令行参数

所有 `.bat`、`.command` 入口以及直接调用 `localization_engine.js` 均支持转发以下参数（`--huifu` 不适用于 `launch-antigravity.bat`）：

| 参数 | 用途 |
| --- | --- |
| `--install-dir <path>` | 手动指定客户端目录、`resources` 目录或 `app.asar` 文件路径 |
| `--brand-title english` | 固定保留英文 **Antigravity** 品牌（默认值，唯一受支持的值） |
| `--no-kill` | 不自动关闭运行中的客户端进程（建议先手工完全退出） |
| `--huifu` | 卸载汉化，使用 `app.asar.bak` 恢复官方原版 |

- **语言与品牌约束**：旧 `--sc` 仅作为无操作兼容参数接受；`--tw` 及其赋值形式均会被拒绝；不再提供品牌交互菜单，也不读取旧的隐藏或中文品牌偏好。旧汉化包若缺少当前标记（`/* ANTIGRAVITY PRIVATE LOCALE: zh-CN */` 与 `/* ANTIGRAVITY BRAND: Antigravity */`），Windows 自检会按需重新迁移处理。
- 在开发或系统已装受支持 Node.js 的环境下，也可直接调用引擎：
  ```sh
  node localization_engine.js --install-dir "/path/to/Antigravity" --no-kill
  node localization_engine.js --huifu --install-dir "/path/to/Antigravity" --no-kill
  ```

---

## 汉化原理与安全保护

1. **零依赖原生 ASAR 校验重包**：
   `src/asar_patcher.js` 直接解析与重建 Electron `app.asar`，在写入客户端前先在临时目录生成候选包，核验目录结构、保留 `unpacked` 布局、逐文件检查允许修改目标以外的所有文件字节完全一致，并对修改后的 JS 模块执行 `node --check` 语法校验，最后才原子替换目标文件。
2. **备份保护与回滚**：
   首次汉化会在资源目录保存 `app.asar.bak`。若检测到当前 `app.asar` 已被汉化但 `app.asar.bak` 丢失，安装会直接中止以防误将已汉化包存为官方备份。还原前会先解析校验备份包完整性，Windows/macOS 替换或重签名失败时自动回滚至修改前状态。注意：`app.asar.bak` 仅作为本地还原资料，不构成官方来源认证。
3. **进程释放与多级字节码缓存清理**：
   安装前按阶段安全释放文件锁；完成后清理 `Antigravity` / `Antigravity IDE` 及其 `Partitions/hub-browser-*` 等分区的 `Cache`、`Code Cache`、`GPUCache` 等目录，防止新旧字节码缓存冲突。
4. **精准注入与内容隔离**：
   - `src/preload_runtime.js` 使用 `WeakMap` / `WeakSet`、微任务合批 `MutationObserver` 与 Shadow DOM 穿透动态翻译界面，通过安全序列化加载词典，同时严格隔离编辑器（Monaco/CodeMirror/Lexical）、终端、用户消息、AI 回复、文件路径、`contenteditable` 与表单输入/选项值。
   - `src/main_patches.js` 注入 Sidecar 子框架校验钩子（`utils.js`）、顶部菜单（`menu.js`）、托盘菜单（`tray.js`）、加载页（`loadingOverlay.js`）、更新弹窗（`updater.js`）及主进程原生弹窗。
5. **便携运行时与边界控制**：
   - 运行时仅缓存在项目 `.runtime/` 内，只提取 `node`（Windows 为 `node.exe`）与 `LICENSE`，每次运行前验证文件非符号链接/重解析点且 SHA-256 精确匹配；损坏或校验失败立即停止，不会回退调用系统 `PATH` 中的其他 Node.js。
   - 启动便携运行时前在子进程中清除 `NODE_OPTIONS` 与 `NODE_PATH`，避免继承外部预加载脚本或模块路径。
   - 本仓库不会自动删除外部工具遗留的客户端文件，也不会复制或修改任何代理配置。

---

## 词典自定义与开发测试

### 词典自定义

简体词典位于 `dicts/` 目录，按界面模块拆分为 6 个 JSON 文件：

| 词典文件 | 内容范围 |
| --- | --- |
| `dicts/common.json` | 公共基础词汇、登录引导、通用按钮与提示 |
| `dicts/menu_nav.json` | 顶部菜单与导航栏 |
| `dicts/page_main.json` | 主界面、对话区周边控件与编辑器面板 |
| `dicts/page_agents.json` | 智能体、子代理与 Swarm 协作面板 |
| `dicts/page_settings.json` | 设置面板、权限规则与配置项 |
| `dicts/page_mcp_knowledge.json` | MCP 目录与知识库说明 |

以英文原文为键、简体译文为值维护 JSON：
```json
"Original English Text": "对应的简体中文翻译"
```
维护原则：避免全局单字替换，保留占位符、命令、路径、百分比及动态参数；涉及用户内容的规则应在明确界面容器内生效。修改保存后，重新运行 `install-cn.bat` 或 `install-cn.command` 即可重新注入生效。

### 开发与隔离测试

普通用户使用**不需要**运行 `npm install`。开发和提交前请在仓库根目录执行校验与隔离测试（测试仅操作临时 ASAR 与模拟对象，**不会修改本机真实 Antigravity**）：

- **Windows 开发（项目独立工具链，无需系统 Node/npm，不改全局 PATH）**：
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 setup
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 ci
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 check
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 test
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check_powershell.ps1
  ```
  `scripts/dev.ps1` 会从 Node.js 官方下载并验证同版本完整工具链解压到 `.dev-tools/`（含 `npm` 与独立 `npm-cache`），仅在当前开发子进程生效，不进入普通用户发布包。

- **macOS / Linux / CI 标准命令**：
  ```sh
  npm ci --ignore-scripts --no-audit --no-fund
  npm run check
  npm test
  ```

`npm run check` 检查 JS/CJS 源码语法与词典完整性（拒绝空值、非字符串、保留键 `__proto__`/`prototype`/`constructor` 以及规范化碰撞键）；`npm test` 覆盖内容隔离、表单值、Shadow DOM、Sidecar/Swarm、ASAR 校验、macOS root 拒绝及双平台便携运行时与分包回归。

### 可选开发诊断工具（谨慎使用）

`scripts/dev_tool.js` 可在明确需要排查界面文案或 MCP 目录变化时，直连本机正在运行的 Antigravity `language_server`（如 `scan-ui`、`dump-mcp`、`search`、`slice`）。它**不是安装必需组件**，也不在回归测试或 CI 中执行。其命令会读取本地运行会话（`port` 命令会输出 CSRF 令牌），请勿将未脱敏的输出、会话信息或 `scratch/` 目录上传至仓库。

---

## 项目文件结构与自动化流程

```text
install-cn.bat / restore-en.bat / launch-antigravity.bat   Windows 快捷入口（纯 ASCII + CRLF）
install-cn.command / restore-en.command                    macOS 快捷入口（UTF-8 + LF + +x）
localization_engine.js                                     核心安装、备份、还原与平台安全检查引擎
src/
  ├── asar_patcher.js                                      ASAR 解析、重包与候选包校验
  ├── main_patches.js                                      主进程菜单、托盘、弹窗与 Sidecar 补丁
  └── preload_runtime.js                                   前端 DOM 动态翻译与内容隔离运行时
dicts/                                                     简体中文分模块词典（6 个 JSON）
scripts/
  ├── run_windows.ps1 / portable_runtime.ps1               Windows 共用启动器与便携运行时校验
  ├── run_macos.sh / portable_runtime.sh                   macOS 共用启动器与便携运行时校验
  ├── node-runtime.json                                    双平台固定 Node.js 版本与 SHA-256 清单
  ├── build_windows_package.ps1 / build_macos_package.sh   Windows / macOS 分平台离线包构建脚本
  ├── dev.ps1 / dev_toolchain.ps1                          Windows 项目独立开发工具链
  ├── ensure_localized.js                                  Windows 启动前自检与修复
  ├── check_syntax.js / check_powershell.ps1               源码与 PowerShell 5.1 语法检查
  ├── validate_dicts.js                                    简体词典校验器
  └── dev_tool.js                                          可选本地语言服务器诊断工具
tests/                                                     隔离回归与安全边界测试套件
docs/security/                                             固定版本的历史审查与维护记录
```

- **GitHub Actions**（[`.github/workflows/tests.yml`](.github/workflows/tests.yml)）：
  - 在 `ubuntu-latest`、`windows-latest`、`macos-latest` 上使用 Node 24 执行锁定依赖安装（禁用生命周期脚本）、源码/词典检查、PowerShell / bash 静态检查与隔离回归测试（不操作真实客户端）。
  - 三平台测试全部通过后，分别构建 **Windows（`x64`、`arm64`）** 与 **macOS（`arm64`、`x64`）** 四个独立离线包并生成 `.sha256`；对可执行的原生架构成品在无系统 Node、离线条件下验证包内文件隔离、可执行权限、运行时与共用启动器。
  - 工作流仅申请 `contents: read`、checkout 不保留凭据、所有官方 Actions 均固定到完整提交 SHA。
- **历史安全审查与维护记录**：
  - [2026-11-21 安全审查记录](docs/security/2026-11-21/README.md) 对应修复前固定提交（仅作历史存档，其中可能提及已删除功能）。
  - [2026-11-22 维护记录](docs/security/2026-11-22/README.md) 记录初始安全修复快照，部分早期描述（如旧品牌偏好沿用）已被后续固定英文品牌与双平台分包提交取代，当前行为以本 README 与最新源码为准。

---

## 常见问题解答 (FAQ)

- **1. Windows 运行提示 `node` 不是内部或外部命令，或找不到运行时？**
  您使用的可能是旧版入口。请重新获取本版完整代码或从 Releases 下载 `antigravity2cn-windows-<架构>.zip` 后运行 `install-cn.bat`，无需在本机单独安装 Node.js。

- **2. 首次运行源码版时无法下载运行时 / 无法连接 `nodejs.org`？**
  源码包首次运行缺少 `.runtime/` 时需要从 `nodejs.org` 下载固定版本；本项目不会自动切换代理或使用第三方镜像。受限网络环境请直接下载 Releases 中对应平台与架构的完整离线包，解压后即可离线使用。

- **3. 提示运行时 SHA-256 校验失败或 `.runtime` 不完整 / 符号链接被拒绝？**
  程序拒绝使用校验失败或非普通文件/目录的缓存。请删除项目下的 `.runtime/` 后通过可信网络重新运行源码入口，或重新下载并核对官方 Release 离线包，切勿跳过校验或替换未知来源的可执行文件。

- **4. Windows 提示 PowerShell 执行策略被阻止？**
  `.bat` 入口仅在当前子进程传入 `-ExecutionPolicy Bypass`，不会改动系统策略。若设备启用了强制组织策略，请联系设备管理员提供允许的执行方式。

- **5. 提示找不到 Antigravity 安装目录？**
  使用 `--install-dir` 指向真实的 Antigravity 客户端目录（确认其中包含 `resources/app.asar` 或 `Contents/Resources/app.asar`），不要指向本汉化包目录或安装包 `.exe`/`.dmg`。

- **6. macOS 双击 `.command` 提示无法打开、没有执行权限，或提示无写入权限 / 拒绝 root？**
  - **执行权限**：在终端进入解压目录执行 `chmod +x install-cn.command restore-en.command scripts/run_macos.sh scripts/portable_runtime.sh`，或改用 `/bin/bash ./install-cn.command`。
  - **系统安全拦截**：在“系统设置 -> 隐私与安全性”中点击“仍要打开”。
  - **权限不足或拒绝 root**：退出 `sudo`/root 会话，将应用复制到当前用户拥有的 `~/Applications/Antigravity.app` 后再运行；程序不会提权或修改系统应用目录所有权。

- **7. 提示文件被占用或无法替换 `app.asar`？**
  请先保存工作并完全退出 Antigravity 及其托盘/后台进程，等待官方自动更新完成后，再带 `--no-kill` 重试；不要在官方更新解压写入过程中同时运行汉化。

- **8. 客户端更新后恢复成英文，或新版本安装后缺少部分界面汉化？**
  官方更新会整包覆盖 `app.asar`：Windows 使用 `launch-antigravity.bat` 启动即可自动补回，macOS 退出客户端后重新运行 `install-cn.command`。若新版本客户端调整了注入点或新增英文文案，可收集客户端版本号与控制台告警（先脱敏路径与会话信息），在隔离环境下更新词典/补丁并补充测试。

- **9. 还原失败或提示 `app.asar.bak` 缺失？**
  切勿手动将已汉化的 `app.asar` 复制为 `app.asar.bak`，也不要混用其他版本的备份。请保留当前报错信息，先从 Antigravity 官方渠道重装/恢复原版客户端后，再重新执行汉化。

---

## 项目上游与来源

- 主要上游：[qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)。本仓库从其 `f7a0c4ebe088917bdc5121ac9b3bbad1c89b6059` 独立导入，保留作者提交历史，并在此基础上进行独立维护。
- 词典来源致谢：[yiheng8023/antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese)。上游 README 对部分词典成果标注了 MIT 来源（仅针对相应词典成果，不代表整库采用 MIT；本仓库未设置整库开源许可）。
- 便携 Node.js 运行时：[Node.js](https://nodejs.org/)，使用官方固定版本；Windows 与 macOS 离线包中的 `.runtime/node-<版本>-<平台>-<架构>/LICENSE` 均保留 Node.js 原始许可证及第三方组件许可。
