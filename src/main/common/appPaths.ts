import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 统一运行时路径推导。
 *
 * 系统 Electron（Arch 原生包）下 app.getPath('exe') 指向 /usr/lib/electron41 等运行时目录，
 * 因此不能再像 Windows/electron-builder 那样用 exe 目录当应用安装根目录；
 * 应用资源必须在 /usr/lib/fntv-plus，用户可写内容必须落到 ~/.config/mpv 或 userData。
 */

const ASAR_NAME = /[\\/]app\.asar$/i;

/**
 * 是否为 Arch 原生包运行形态（/usr/lib/fntv-plus/app.asar + 系统 electron）。
 * 显式环境变量优先；未设置时通过安装布局探测，兼容直接 electron41 <app.asar> 启动。
 */
export function isArchNativeRuntime(): boolean {
    if (process.platform !== 'linux') return false;
    if (process.env.FNTV_SYSTEM_ELECTRON === '1' || process.env.FNTV_INSTALL_ROOT) return true;
    if (!app.isPackaged) return false;
    const appPath = app.getAppPath();
    if (!ASAR_NAME.test(appPath)) return false;
    const asarDir = path.dirname(appPath);
    // 只有标准 Arch 布局才把 third_party 放在 app.asar 同级
    return /^\/usr\/lib\//.test(asarDir)
        && fs.existsSync(path.join(asarDir, 'third_party', 'proxy', 'proxy'));
}

function hasThirdPartyDir(root: string): boolean {
    try {
        return fs.statSync(path.join(root, 'third_party')).isDirectory();
    } catch {
        return false;
    }
}

/**
 * 应用只读安装根目录：
 * - 开发态：项目根；
 * - Windows/macOS/electron-builder：exe 或 .app Contents 同级；
 * - Arch 系统 Electron：/usr/lib/fntv-plus（app.asar 同级）。
 */
export function getAppInstallRoot(): string {
    const envRoot = process.env.FNTV_INSTALL_ROOT;
    if (envRoot) return path.resolve(envRoot);

    if (!app.isPackaged) return app.getAppPath();

    if (process.platform === 'darwin') {
        // app.asar -> Resources -> Contents
        return path.dirname(path.dirname(app.getAppPath()));
    }
    if (process.platform === 'win32') {
        return path.dirname(app.getPath('exe'));
    }

    // Linux：优先 app.asar 同级（Arch /usr/lib/fntv-plus），
    // 否则回退 electron-builder 的安装根（AppImage 挂载根等）。
    const asarDir = path.dirname(app.getAppPath());
    return hasThirdPartyDir(asarDir) ? asarDir : path.dirname(asarDir);
}

/**
 * 应用安装目录是否为只读系统资源。
 * Arch 原生包中 /usr/lib/fntv-plus 由 pacman 管理，普通用户不能写入。
 */
export function isReadOnlyAppInstallDir(p: string): boolean {
    if (!isArchNativeRuntime()) return false;
    const root = path.resolve(getAppInstallRoot());
    const target = path.resolve(p);
    return target === root || target.startsWith(root + path.sep);
}

/** 用户 MPV 配置目录（Linux 优先 XDG_CONFIG_HOME，与系统 mpv 一致；Windows 用 Roaming）。 */
export function getUserMpvConfigDir(): string {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(home, 'AppData', 'Roaming', 'mpv');
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    return xdgConfig ? path.join(xdgConfig, 'mpv') : path.join(home, '.config', 'mpv');
}

/** 安装目录携带的 MPV 默认配置（portable_config）。 */
export function getBundledMpvConfigDir(): string {
    return path.join(getAppInstallRoot(), 'third_party', 'fntv-mpv', 'portable_config');
}

/** 应用第三方运行资源根目录。 */
export function getThirdPartyDir(): string {
    return path.join(getAppInstallRoot(), 'third_party');
}
