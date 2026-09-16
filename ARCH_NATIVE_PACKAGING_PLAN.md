# Fntv-Plus Arch Linux 原生打包实施记录

更新日期：2026-09-16

## 1. 目标

将当前 Electron 应用从 AppImage 分发方式迁移为符合 Arch Linux 包管理习惯的原生软件包，重点改善冷启动、系统集成、依赖管理和升级维护体验。

最终目标架构：

```text
Arch PKGBUILD
+ 系统 Electron 运行时
+ /usr/lib/fntv-plus/app.asar
+ 系统 /usr/bin/mpv
+ 应用自带 Go proxy
+ XDG 用户配置目录
+ 原生 Wayland Ozone
+ XWayland 兼容入口
```

## 2. 已确认的运行环境

- Arch Linux x86_64
- Linux Zen 内核 `7.2.6-zen2-1-zen`
- niri 26.04，Wayland 会话
- Intel Core i7-10750H
- Intel UHD Graphics 与 NVIDIA GTX 1660 Ti Mobile 双显卡
- 约 16 GiB 内存
- Btrfs，启用 zstd 压缩与 noatime
- Node.js 26.8.2
- npm 12.0.2
- pnpm 命令版本 12.4.1
- 已安装 `electron41`、`electron43`、`mpv`
- 已安装 `base-devel`、`fakeroot`、`debugedit`、`desktop-file-utils`、`hicolor-icon-theme`

## 3. 当前项目基线

- 应用版本：3.7.0
- Electron：38.0.0
- electron-builder：26.0.12
- 主入口：`dest/main/main.js`
- Linux 当前仅配置 AppImage，目标架构包含 x64 与 arm64
- 包含 TypeScript 主程序、Go proxy、MPV 配置与脚本、热补丁机制
- 现有热补丁逻辑依赖 `app.asar`、`app.getAppPath()` 和用户数据目录
- 已改用 pnpm，并生成 `pnpm-lock.yaml`、`pnpm-workspace.yaml`
- 已通过 `pnpm install --frozen-lockfile`、`pnpm run compile` 与
  `pnpm run build:proxy:linux` 恢复可复现构建

## 3.1 系统 Electron 41 冒烟结论

使用 electron-builder 生成的标准 `app.asar` 与 `/usr/lib/fntv-plus` 只读布局，
通过 `/usr/bin/electron41` 启动验证：

- Electron 41.10.7 可正常加载应用
- Go proxy 启动成功并监听 `127.0.0.1:22346`
- 系统托盘创建成功
- MPV 默认配置复制到 `$XDG_CONFIG_HOME/mpv`
- `/usr/lib/fntv-plus` 无写入错误
- 无 Electron 41 `console-message` 弃用警告

冒烟目录：`/tmp/fntv-arch-smoke2-xGBL3y`

手工 `pnpm deploy` 加 `@electron/asar` 打包的 `app.asar` 已确认包含
`dest/main/main.js` 与 `dest/main/patchOverlay.js`（约 79M）。最后一次对
该 asar 的图形冒烟需要沙箱外审批，未能自动完成；当前关键路径验证以
electron-builder 标准 asar 为准。

## 4. 核心决策

### 4.1 最终采用标准 Arch 包

最终包使用 PKGBUILD 构建，通过 pacman 安装，不再使用 AppImage。应用文件安装到 `/usr/lib/fntv-plus`，启动器、桌面文件、图标和许可证分别安装到 Arch 标准目录。

### 4.2 优先迁移到系统 electron41

先将项目从 Electron 38迁移并验证到 Electron 41，再使用 `/usr/bin/electron41` 启动。Electron 43升级作为后续独立任务，避免把运行时大版本升级与打包迁移混为一个高风险变更。

当前开发依赖仍停留在 Electron 38，正式打包时仅用系统 Electron 41 运行。
后续应另立任务升级 `devDependencies.electron`，避免开发态与运行态差异。

### 4.3 保留 app.asar

第一阶段继续生成和安装 `app.asar`，避免破坏现有热补丁映射和模块解析逻辑。系统 Electron 只负责运行时，应用代码及生产依赖仍封装在应用自己的 asar 中。

### 4.4 Linux 使用系统 MPV

Linux 包依赖系统 `mpv`，程序默认调用 `/usr/bin/mpv`。应用只分发自有 Lua 脚本、配置模板和弹幕资源，不重复分发 MPV、FFmpeg、libplacebo 等系统组件。

### 4.5 严格分离只读资源与用户数据

```text
只读应用资源：/usr/lib/fntv-plus
用户配置：${XDG_CONFIG_HOME:-~/.config}/fntv-plus
缓存：${XDG_CACHE_HOME:-~/.cache}/fntv-plus
持久数据：${XDG_DATA_HOME:-~/.local/share}/fntv-plus
```

安装目录不得用于保存 Cookie、MPV 用户配置、着色器设置、弹幕过滤规则或运行时文件。

## 5. 目标安装布局

```text
/usr/bin/fntv-plus
/usr/bin/fntv-plus-x11
/usr/lib/fntv-plus/app.asar
/usr/lib/fntv-plus/third_party/proxy/proxy
/usr/lib/fntv-plus/third_party/anime/
/usr/lib/fntv-plus/third_party/fntv-mpv/portable_config/
/usr/share/applications/fntv-plus.desktop
/usr/share/icons/hicolor/256x256/apps/fntv-plus.png
/usr/share/licenses/fntv-plus/LICENSE
/usr/share/doc/fntv-plus/README.md
```

## 6. 分阶段实施

### 阶段 1：恢复可复现构建

完成标准：依赖能由锁文件稳定安装，TypeScript 与 Go proxy 可重复构建。

当前状态：已完成。

任务：

1. 确认工作区和构建目录可写。
2. 统一使用 pnpm，排除 npm、Yarn 混用。
3. 在经过验证的 Node LTS 环境生成 `pnpm-lock.yaml`。
4. 将锁文件纳入版本控制。
5. 使用冻结锁文件安装依赖。
6. 完成 TypeScript 编译和 Linux Go proxy 构建。
7. 审查生产依赖、许可证及是否存在原生 Node 扩展。

验证：

```bash
pnpm install --frozen-lockfile
pnpm run compile
pnpm run build:proxy:linux
```

### 阶段 2：Electron 41兼容迁移

完成标准：应用使用 Electron 41在开发态和打包态均能完成核心流程。

当前状态：系统 Electron 41 打包态核心冒烟已通过；开发依赖从 38 升级到 41
另行执行。

任务：

1. 将 Electron 开发和测试基线升级至 41。
2. 验证主进程、preload、IPC、托盘和单实例逻辑。
3. 验证证书处理、登录、热补丁、Go proxy 与 MPV 播放。
4. 检查 `contextIsolation`、sandbox 和远程内容边界。
5. 移除或收紧全局 `--no-sandbox`、`--disable-web-security`、`--ignore-ssl-errors` 等高风险参数。
6. 单独验证 `VizDisplayCompositor`、GPU rasterization 和 zero-copy 开关。

### 阶段 3：资源路径重构

完成标准：程序不再把系统 Electron 的资源目录或 `/usr/lib` 当作用户可写目录。

当前状态：已完成 Arch 原生路径集中推导与只读保护，关键调用点已迁移。

建立集中式路径模块，统一提供：

```text
appAsarPath
readOnlyResourceRoot
userConfigRoot
userCacheRoot
userDataRoot
```

迁移范围：

- Go proxy 路径
- MPV 可执行文件及配置模板
- Bilibili Cookie
- 弹幕脚本与屏蔽规则
- 二维码与 Wiki 资源
- 热补丁目录
- 日志目录
- 设置面板展示的路径

首次启动时，可将只读 MPV 默认模板复制到用户配置目录。后续仅修改用户目录中的副本。

### 阶段 4：Wayland 与双显卡适配

完成标准：niri 原生 Wayland 为默认路径，XWayland 可作为清晰可控的兜底。

当前状态：已提供 `fntv-plus-x11` 兜底入口；系统 Electron 默认 Wayland 会话
由 Chromium/Ozone 自动选择，双显卡专项验证待系统包安装后执行。

默认启动参数：

```bash
--ozone-platform=wayland
--enable-features=WaylandWindowDecorations
```

提供独立 XWayland 启动入口，使用 `--ozone-platform=x11`，避免用户临时修改应用代码。

Electron 默认使用 Intel 核显以降低桌面功耗。需要独显时允许用户通过 `prime-run fntv-plus` 启动。MPV 的硬解码和 Vulkan 配置独立测试，不强制与 Electron 使用同一 GPU。

### 阶段 5：编写 Arch 打包文件

已完成新增：

```text
packaging/arch/PKGBUILD
packaging/arch/fntv-plus
packaging/arch/fntv-plus-x11
packaging/arch/fntv-plus.desktop
```

`PKGBUILD` 以 `/usr/bin/electron41 /usr/lib/fntv-plus/app.asar` 为默认启动，
另提供 `fntv-plus-x11` 显式走 XWayland。构建流程为：

```bash
pnpm install --frozen-lockfile
pnpm run build:proxy:linux
pnpm run compile
pnpm deploy --prod --frozen-lockfile "$srcdir/deploy"
pnpm exec asar pack "$srcdir/app" "$srcdir/fntv-plus.asar"
```

`package()` 只安装 `app.asar`、Linux Go proxy、`portable_config`、弹幕资源、
启动器、桌面文件、图标、LICENSE 和 README，并过滤 `*.bak*` 调试备份，
避免把本地 Lua 备份文件带进软件包。当前源码提交
`5bfd4e48...` 尚未包含本套路径改动，发布前必须把 `_commit` 更新到包含
`appPaths.ts` 等修复的提交并补上源码 tarball 的 SHA-256。

已通过的静态检查：

```bash
bash -n fntv-plus fntv-plus-x11
desktop-file-validate fntv-plus.desktop
makepkg --printsrcinfo
namcap PKGBUILD
```

PKGBUILD 原则：

- `arch=('x86_64')`
- `depends` 至少包含 `electron41` 与 `mpv`
- `makedepends` 包含 Node/pnpm、TypeScript、Go、asar 等实际构建工具
- `prepare()`、`build()`、`package()` 职责分离
- `package()` 阶段禁止联网
- 不以 root 身份运行 pnpm
- 所有源码和构建输入固定版本并校验哈希
- Go 构建使用 `-trimpath` 等可复现参数
- 不把缓存、日志和用户配置打进软件包
- 正确安装许可证、桌面文件和图标

### 阶段 6：安装与包质量验证

完成标准：包可正常安装、升级、降级和卸载，用户数据不随卸载丢失。

验证项目：

当前状态：PKGBUILD 已生成，但尚未执行 `makepkg`、`pacman -U` 或系统安装。
下面的检查应在发布提交固定后执行。

1. 使用 `makepkg` 构建软件包。
2. 使用 `namcap` 检查 PKGBUILD 和生成包。
3. 检查包内文件、权限和依赖。
4. 使用 pacman 安装并启动。
5. 验证桌面菜单、图标、托盘、单实例和窗口 app_id。
6. 验证升级与降级。
7. 卸载应用后确认 XDG 用户数据仍保留。

安装依赖、`pacman -U`、系统包变更等操作必须在执行前取得用户明确确认。

### 阶段 7：性能基准与验收

对以下三个版本进行同机对比：

1. 当前 AppImage。
2. bundled Electron 的普通目录或 pacman 过渡包。
3. 系统 Electron 的标准 Arch 包。

每组至少测量 10次，冷启动和热启动分别统计。记录：

- 命令执行到首个窗口出现的时间
- 首屏可交互时间
- Go proxy 就绪时间
- 主进程和 Renderer 峰值内存
- 首次启动 MPV 的时间
- Intel 与 NVIDIA 两种路径
- Wayland 与 XWayland 差异
- 包体大小及磁盘占用

正式验收建议使用中位数和 P95，不只看单次最好成绩。

## 7. 过渡方案

在系统 Electron 迁移完成前，可先让 electron-builder 生成普通目录或 pacman 包，但暂时保留 bundled Electron 38。

该过渡包用于单独验证移除 AppImage 的 FUSE、SquashFS 和镜像读取开销，不作为最终发布架构。验证完成后再迁移到系统 electron41。

## 8. 关键风险

### Electron 版本不一致

源码基于 Electron 38，系统只有 41和 43。未经回归直接使用系统 Electron 可能产生 API、Chromium、Node 或 preload 行为差异。

### Linux 路径推导错误

现有部分 Linux 逻辑依据 macOS 风格向上推导资源目录，标准 `/usr/lib/fntv-plus` 布局下可能定位错误。

### 安装目录写入

现有 `portable_config` 被当作可写目录。迁移后若仍写 `/usr/lib`，普通用户运行会失败，也会破坏 pacman 管理边界。

### 系统 Electron 生命周期

Arch 仓库中的 Electron 大版本会滚动更新和淘汰。应定期将项目迁移到受支持的大版本，必要时短期保留 bundled Electron 作为回退。

### 安全启动参数

当前全局关闭 sandbox、Web Security 和 SSL 检查会扩大远程内容风险。原生包迁移应同步收紧这些参数，但必须通过受控回归避免破坏内网自签名证书场景。

## 9. 推荐执行顺序

```text
依赖锁定
  -> Electron 41兼容
  -> 资源路径与 XDG 拆分
  -> 系统 MPV
  -> Wayland/XWayland 验证
  -> PKGBUILD
  -> 安装与升级测试
  -> 三组冷启动基准
```

不要同时推进 Electron 43升级、全面安全重构和 Arch 打包。每个阶段完成后先进行针对性验证和用户验收，再进入下一阶段。

## 10. 下一步

下一步是固定发布提交：提交本套路径修复与 `packaging/arch/`，更新
`PKGBUILD` 的 `_commit` 和源码 SHA-256，然后执行 `makepkg`、`namcap`、
`pacman -U` 与 Wayland/XWayland 验收。
