# Antigravity 简体中文汉化 · 私人维护版

个人独立维护使用的 Antigravity 中文界面汉化工具。仅支持简体中文，保留 Windows 和 macOS 的安装、还原与界面内容隔离功能。

本仓库为独立仓库，上游历史保留，但后续更新由本仓库自行审阅和维护。

## 环境与范围

| 项目 | 说明 |
| --- | --- |
| 系统 | Windows x64 / ARM64、macOS |
| 客户端 | Electron 架构、安装目录包含 `resources/app.asar` 或 `Contents/Resources/app.asar` 的 Antigravity |
| 语言 | 简体中文；旧繁体入口、资源与运行分支已删除，`--tw` 会明确报错 |
| Windows 安装 | 项目管理便携 Node.js，无需在本机安装 Node.js，也不修改系统或用户 PATH |
| macOS / 源码开发 | Node.js `^22.22.2`、`^24.15.0` 或 `>=26.0.0`；CI 使用 Node 24 |
| 普通安装 | 不需要 `npm install`；Windows 发布包已含所需运行时 |
| 开发测试 | 使用锁定的 jsdom 开发依赖，需要先执行 `npm ci` |

现有词典与回归用例包含上游 v2.34.0 相关界面。客户端每次升级都可能调整模块和注入位置，版本号相近也不等于已经验证兼容。

汉化覆盖主界面、菜单、托盘、部分原生弹窗、Sidecar、设置和提示文字。代码编辑器、终端、消息正文、文件路径及输入值应保持原样；这部分行为由隔离规则和回归测试约束。

## 获取与安装

使用已登录且有访问权限的 GitHub 账户获取本私有仓库。Windows 优先下载下方的免安装发布包；需要修改源码时再克隆：

```sh
git clone https://github.com/mxh110708/antigravity2-cn.git
cd antigravity2-cn
```

安装前保存工作并完全退出 Antigravity。引擎默认会尝试关闭仍在运行的客户端；指定 `--no-kill` 可以禁止关闭进程，遇到文件占用时应退出客户端后重试。

### Windows

**推荐：下载免安装发布包。** 打开 [Releases](https://github.com/mxh110708/antigravity2-cn/releases/latest)，普通 Intel / AMD 电脑选择 `antigravity2-cn-windows-x64.zip`，Windows ARM 电脑选择 `antigravity2-cn-windows-arm64.zip`。完整解压到当前用户可写的目录，双击 `双击安装中文汉化.bat`。发布包自带便携 Node.js，可以离线运行，不依赖本机是否安装 Node.js。

**使用源码 ZIP 或 git clone 也可以直接双击。** 三个 `.bat` 入口都会检查项目内的 `.runtime/`；首次运行缺少运行时时，从 `nodejs.org` 官方 HTTPS 地址下载固定版本，校验 ZIP、`node.exe` 和许可证的 SHA-256 后缓存到本项目。后续重复使用，无需再次下载。网络不可达时请使用上面的完整发布包。

运行时只放在项目的 `.runtime/` 中，不安装到系统、不修改系统或用户 PATH，也不需要管理员权限。每次执行前都会核对运行时和许可证摘要；校验失败会停止，不会调用系统 PATH 中的其他 Node.js。安装和还原对客户端目录的写入要求仍然适用。

默认保留 Antigravity 英文品牌，安装成功后重新启动客户端。

也可在终端指定安装目录：

```powershell
.\双击安装中文汉化.bat --install-dir "C:\Path\To\Antigravity" --brand-title english --no-kill
```

优先使用当前用户可写的客户端目录。自动探测会检查环境变量、注册表和常见位置；探测失败时，传入实际客户端目录，或其 `resources` 目录 / `app.asar` 文件路径。

### macOS

所有 macOS 入口只允许普通用户运行；包装脚本和 Node 引擎都会拒绝真实 UID 或有效 UID 为 root 的会话，不再自动调用 sudo。

1. 准备当前用户拥有且可写的应用副本，推荐放在 `~/Applications/Antigravity.app`。不要同时运行多个副本。
2. 安装 Node.js，并完全退出客户端。
3. 双击 `双击安装中文汉化.command`，或从终端运行：

```sh
/bin/bash ./双击安装中文汉化.command --install-dir "$HOME/Applications/Antigravity.app"
```

自动探测优先检查 `~/Applications/Antigravity.app`，再检查 `/Applications/Antigravity.app`。若后者不可写，请改用当前用户拥有的副本；不要通过 sudo 绕过检查。

只对用户自己的 `.app` 修改资源。引擎会更新相关 ASAR 校验值，并调用系统绝对路径的 `xattr`、`codesign` 完成本地 ad-hoc 重签名；它不是官方开发者签名，不能作为官方发布者认证。

如果解压工具丢失了脚本执行权限，仍可使用上面的 `/bin/bash` 命令运行，或只给本仓库的 `.command` 文件恢复执行权限。

## 参数与品牌显示

| 参数 | 用途 |
| --- | --- |
| `--install-dir <path>` | 指定客户端目录、资源目录或 `app.asar` 路径 |
| `--brand-title english` | 保留 Antigravity 英文品牌，默认值 |
| `--no-kill` | 不关闭客户端进程；建议先自行退出客户端 |
| `--huifu` | 使用原始备份还原英文版 |

所有语言选择固定为简体中文。旧 `--sc` 仅作为兼容参数接受，不再提供语言切换；`--tw` 及其赋值形式均被拒绝。品牌固定保留英文 Antigravity，不再提供品牌选择菜单，也不读取旧的隐藏或中文品牌偏好。

## 还原与升级

Windows 双击 `双击卸载还原官方英文.bat`；macOS 双击同名 `.command`，或指定应用路径：

```powershell
.\双击卸载还原官方英文.bat --install-dir "C:\Path\To\Antigravity" --no-kill
```

macOS 或已有 Node.js 的源码开发环境也可直接调用引擎：

```sh
node localization_engine.js --huifu --install-dir "/path/to/Antigravity" --no-kill
```

首次安装会在资源目录保存 `app.asar.bak`。引擎先构建临时候选包，检查布局、非目标文件和补丁语法，再替换客户端资源。还原前会解析备份，避免直接提升无效文件。

- 保留备份，勿手动用已汉化的包替换它。备份本身不具备官方来源认证。
- 检测到已汉化但备份缺失时，安装会中止；请先从可信来源恢复官方客户端，再重新汉化。
- 官方自动更新可能覆盖汉化。更新完成并退出客户端后，再运行本仓库安装入口。
- 本版不会自动删除外部工具遗留的客户端文件。如果旧版本曾装入代理模块，请按其来源和安装记录单独确认、处理；汉化还原只负责自己的 ASAR 变更。

### Windows 启动前自检

双击 `启动Antigravity(自动检查汉化).bat`，或执行：

```powershell
& '.\启动Antigravity(自动检查汉化).bat'
```

启动器在客户端未运行时修复汉化，统一保留 Antigravity 英文品牌。旧汉化包缺少本版简体或固定英文品牌标记时会被重新处理；修复失败时不会继续启动客户端。可以传入 `--install-dir`，也可显式指定唯一支持的 `--brand-title english`。

只检查状态、不安装或启动：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_windows.ps1 check --install-dir "C:\Path\To\Antigravity"
```

启动器退出码：`0` 已汉化或修复成功；`2` 未汉化且未修复；`1` 参数、检测或修复出错。macOS 更新后使用普通安装入口，自检启动器仅适用于 Windows。

## 词典与维护

词典位于 `dicts/`，仅保留简体数据：

| 文件 | 内容 |
| --- | --- |
| `common.json` | 公共文字、登录和通用按钮 |
| `menu_nav.json` | 菜单与导航 |
| `page_agents.json` | 智能体与协作界面 |
| `page_main.json` | 主界面与会话周边控件 |
| `page_mcp_knowledge.json` | MCP 目录与知识库说明 |
| `page_settings.json` | 设置、权限与配置界面 |

以英文原文为键、简体译文为值维护 JSON。避免全局单字替换，保留占位符、命令、路径、百分比及动态参数；涉及用户内容的规则应在明确界面范围内生效。

修改后执行检查与测试，再完全退出客户端并手动重新安装：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

`npm run check` 检查引擎、脚本和测试源码语法，以及词典结构、空值、规范化重复键和保留键。测试使用临时 ASAR、模拟系统接口及 jsdom，验证简体显示、表单/正文隔离、备份还原、权限拒绝和旧版迁移；安装流程测试不会操作真实客户端。

### 开发诊断工具

`scripts/dev_tool.js` 可在明确选择诊断时，读取已运行客户端的本地语言服务器，用于 `scan-ui`、`dump-mcp`、`search` 和 `slice`。它不是安装必需步骤，也不在回归测试或 CI 中运行。

这些命令可能访问当前客户端会话，`port` 命令会输出 CSRF 令牌。不要把未经检查的输出、原始目录或会话信息直接上传到仓库；`scratch/` 是忽略的本地输出目录。使用诊断前应先明确读取范围。

### GitHub Actions

工作流检查 Windows、Linux 和 macOS，执行锁定依赖安装、源码/词典检查、shell / Windows PowerShell 5.1 语法检查与隔离回归测试。Windows 用例覆盖没有系统 Node.js、含空格的路径、参数转发、下载与缓存校验、文件损坏拒绝，以及运行时的外部预加载隔离。它不会安装或启动真实 Antigravity。

三个系统的测试全部通过后，自动构建 x64 / ARM64 的 Windows 便携 ZIP，并附带 ZIP 的 SHA-256 文件。可在该次 Actions 运行的 Artifacts 下载，审阅通过的成品再发布到 Releases。发布包仅包含安装必需的源码、词典、三个 Windows 入口、便携运行时及 Node.js 原始许可证；不打包开发依赖、本地配置或 Git 数据。x64 包会在无系统 Node.js 的环境执行运行时与启动器冒烟检查；ARM64 包校验固定摘要，尚未在 ARM64 实机执行验证。

工作流仅申请 `contents: read`，checkout 不保留凭据，官方 Actions 固定到经核实的完整提交 SHA，依赖安装禁用生命周期脚本。不需要配置仓库 Secrets。后续升级依赖或 Actions 时，应先审阅差异和完整性信息。

## 文件结构

```text
localization_engine.js       本地安装、备份、还原及平台权限检查
src/asar_patcher.js          ASAR 解析、重包与候选包校验
src/main_patches.js          主进程和 Sidecar 界面补丁
src/preload_runtime.js       简体 DOM 翻译与内容隔离运行时
dicts/                      简体词典
scripts/run_macos.sh         普通用户 macOS 共用入口
scripts/run_windows.ps1      Windows 共用入口，无需系统 Node.js
scripts/portable_runtime.ps1 官方运行时下载、缓存和校验
scripts/node-runtime.json    固定版本与 SHA-256 清单
scripts/build_windows_package.ps1  Windows 离线包构建
scripts/ensure_localized.js  Windows 启动前自检
scripts/validate_dicts.js    简体词典检查
scripts/dev_tool.js          可选开发诊断工具
tests/                      回归与安全边界测试
docs/security/              固定版本的历史审查与修复记录
```

历史安全审查位于 [docs/security/2026-11-21](docs/security/2026-11-21/README.md)，对应修复前的固定代码提交。历史材料可能提及已删除的功能，不代表当前版本仍支持它们；当前修复与验证说明见 [2026-11-22 维护记录](docs/security/2026-11-22/README.md)。

## 常见问题

**提示 `node` 不是内部或外部命令**：这是旧版 Windows 入口。重新获取本版完整源码或 Releases 免安装包，再运行 `.bat`；无需在本机安装 Node.js。

**首次运行无法下载 / 无法访问 nodejs.org**：下载并完整解压 Releases 中对应架构的免安装 ZIP。源码包的首次下载需要网络；本项目不会切换代理或自动使用第三方下载镜像。

**运行时 SHA-256 校验失败 / `.runtime` 不完整**：停止使用该缓存，重新完整解压可信发布包；也可删除项目中的 `.runtime/` 后让源码入口重新下载。不要跳过校验或混入其他来源的可执行文件。

**PowerShell 被组织策略阻止**：入口仅对当前进程使用执行策略参数，不修改机器策略；组织强制策略仍然有效，需由设备管理员提供允许的运行方式。

**找不到安装目录**：使用 `--install-dir` 指向实际客户端，确认目标中有 `app.asar`。不要指向本仓库或官方安装器下载文件。

**macOS 目录不可写或提示 root 被拒绝**：退出 sudo/root 会话，使用自己拥有的应用副本。程序不会改变系统目录所有权或为自己申请提权。

**文件被占用**：保存工作并完全退出客户端，待官方更新完成，再使用 `--no-kill` 重试。不要在更新过程同时重包。

**安装后仍是英文或缺少部分菜单**：确认启动的是同一应用副本；检查是否刚被自动更新覆盖。模块插入点变化可能造成局部汉化跳过，应收集版本和脱敏错误，在临时副本上更新补丁与测试。

**还原失败或备份缺失**：停止手动覆盖文件，保留现有备份与错误信息；从可信来源恢复官方客户端后再开始。不要把其他版本的备份直接当作当前版本原包。

## 项目上游与来源

- 主要上游：[qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)。本仓库从其 `f7a0c4ebe088917bdc5121ac9b3bbad1c89b6059` 独立导入，保留作者提交历史，并在此基础上进行独立维护。
- 词典来源致谢：[yiheng8023/antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese)。上游 README 对部分词典成果标注了 MIT 来源。
- Windows 便携运行时：[Node.js](https://nodejs.org/)，使用官方固定版本；发布包 `.runtime/node-<版本>-win-<架构>/LICENSE` 保留 Node.js 原始许可证及第三方组件许可。
