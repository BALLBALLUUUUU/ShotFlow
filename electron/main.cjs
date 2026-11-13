const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createCloudHost } = require('./cloud-host.cjs');
const { DEFAULT_TARGET, readTarget, writeTarget } = require('./cloud-config.cjs');
const updater = require('./updater.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
let currentFilePath = null;
let mainWindow = null;
// 强制更新期间锁住应用：只剩退出，重载/开发者工具也一并拦掉
let gateLocked = false;

// 自用调试开关：设置环境变量才启用，正常双击启动不受影响
if (process.env.SHOTFLOW_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SHOTFLOW_DEBUG_PORT);
}
if (process.env.SHOTFLOW_USER_DATA) {
  app.setPath('userData', process.env.SHOTFLOW_USER_DATA);
}

const autosavePath = () => path.join(app.getPath('userData'), 'autosave.json');

// 原子写：先写临时文件再 rename，避免中途崩溃损坏项目文件
async function writeAtomic(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, target);
}

function sendMenuAction(action) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';

  if (gateLocked) {
    const quit = { role: 'quit', label: '退出 ShotFlow' };
    const template = isMac
      ? [{ label: 'ShotFlow', submenu: [{ role: 'about', label: '关于 ShotFlow' }, { type: 'separator' }, quit] }]
      : [{ label: '文件', submenu: [quit] }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  const appMenu = {
    label: 'ShotFlow',
    submenu: [
      { role: 'about', label: '关于 ShotFlow' },
      { type: 'separator' },
      { role: 'services', label: '服务', submenu: [] },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 ShotFlow' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '显示全部' },
      { type: 'separator' },
      { role: 'quit', label: '退出 ShotFlow' },
    ],
  };

  const template = [
    ...(isMac ? [appMenu] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new') },
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: '导出分镜（PDF / Excel）…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenuAction('export:storyboard') },
        { label: '导出项目备份…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('export') },
        { type: 'separator' },
        { label: '载入示例项目', click: () => sendMenuAction('sample') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        // 用自定义撤销而非 role:'undo'：role 只会做原生文本撤销，改不了项目内容
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '分镜制作', accelerator: 'CmdOrCtrl+1', click: () => sendMenuAction('nav:/shots') },
        { label: '故事板', accelerator: 'CmdOrCtrl+2', click: () => sendMenuAction('nav:/storyboard') },
        { label: '拍摄计划', accelerator: 'CmdOrCtrl+3', click: () => sendMenuAction('nav:/plan') },
        { label: 'Rundown · 通告', accelerator: 'CmdOrCtrl+4', click: () => sendMenuAction('nav:/rundown') },
        { label: '人员', accelerator: 'CmdOrCtrl+5', click: () => sendMenuAction('nav:/people') },
        { type: 'separator' },
        { label: '切换明暗主题', click: () => sendMenuAction('theme') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入/退出全屏' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '置于最前' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => sendMenuAction('check-update'),
        },
        {
          label: '打开应用数据文件夹',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: 'ShotFlow 使用说明',
          click: () => sendMenuAction('help'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'ShotFlow',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // 强制更新时不给「刷新页面 / 打开开发者工具」这类绕过入口
  win.webContents.on('before-input-event', (event, input) => {
    if (!gateLocked) return;
    const key = String(input.key || '').toLowerCase();
    const mod = input.meta || input.control;
    const reload = key === 'f5' || (mod && key === 'r');
    const devtools = key === 'f12' || (mod && input.alt && key === 'i') || (mod && input.shift && key === 'i');
    if (reload || devtools) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 关于面板里的 GitHub 链接交给系统浏览器，不在应用里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.setName('ShotFlow');

const cloudHost = createCloudHost({
  onEvent: (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud:event', payload);
  },
});
// 启动即按配置的云端地址准备（可能是用户自己应用的云），不等渲染层
cloudHost.configure(readTarget());

app.whenReady().then(() => {
  buildApplicationMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:version', () => app.getVersion());

// 云桥：渲染进程不直接接触远端，统一由主进程的云宿主窗口转发
ipcMain.handle('cloud:call', (_event, payload) => {
  const method = payload && payload.method ? String(payload.method) : '';
  const params = (payload && payload.params) || {};
  // 大项目（含分镜图）上传/下载耗时更长，允许调用方指定超时
  const timeout = payload && Number.isFinite(payload.timeout) ? payload.timeout : undefined;
  return cloudHost.call(method, params, timeout ? { timeout } : {});
});
ipcMain.handle('cloud:session', () => cloudHost.session());

// 云端地址：读取 / 切换。写入文件后再改云宿主窗口，重启后仍然生效。
ipcMain.handle('cloud:config:get', () => {
  const target = readTarget();
  return { endpoint: target.endpoint, sharecode: target.sharecode, defaultEndpoint: DEFAULT_TARGET.endpoint };
});
ipcMain.handle('cloud:config:set', (_event, payload) => {
  const result = writeTarget(payload);
  if (!result.target) return { ok: false, error: result.error };
  const changed = cloudHost.configure(result.target).changed;
  return { ok: true, changed, endpoint: result.target.endpoint, sharecode: result.target.sharecode };
});
ipcMain.handle('cloud:login', () => cloudHost.login());
ipcMain.handle('cloud:logout', () => cloudHost.logout());

app.on('before-quit', () => {
  cloudHost.dispose();
});

/**
 * 版本校验：主进程只负责取远端清单（走系统代理、无 CORS 限制），
 * 「算不算新版本、要不要强制」交给渲染层的纯函数，便于单测。
 */
ipcMain.handle('update:check', async (_event, payload) => {
  const repo = typeof payload === 'string' ? payload : payload && payload.repo;
  try {
    const result = await updater.collectCandidates(repo);
    return {
      ok: true,
      ...result,
      platform: process.platform,
      packaged: app.isPackaged,
      current: app.getVersion(),
    };
  } catch (error) {
    const name = error && error.name;
    const status = error && error.status;
    const message = status === 404
      ? '更新服务器上还没有可用的版本清单'
      : name === 'AbortError'
        ? '检查更新超时，请检查网络后重试'
        : '无法连接更新服务器';
    return { ok: false, error: message };
  }
});

ipcMain.handle('update:probe', async (_event, url) => {
  try {
    return { ok: true, ...(await updater.probeAsset(url)) };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : '更新包地址无效' };
  }
});

ipcMain.handle('update:download', async (event, payload) => {
  try {
    const result = await updater.downloadAsset(payload && payload.url, payload && payload.name, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress);
    });
    return { ok: true, ...result };
  } catch (error) {
    const name = error && error.name;
    const code = error && error.code;
    const message = name === 'AbortError'
      ? '下载超时，请检查网络后重试'
      : code === 'ENOSPC'
        ? '磁盘空间不足，请清理后重试'
        : (error instanceof Error ? error.message : '下载失败');
    return { ok: false, error: message };
  }
});

ipcMain.handle('update:install', async (_event, payload) => {
  try {
    return { ok: true, ...(await updater.installAsset(payload && payload.filePath)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法启动安装程序' };
  }
});

ipcMain.handle('update:openPage', async (_event, url) => {
  try {
    await updater.openPage(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法打开下载页' };
  }
});

/** 渲染层告知是否处于强制更新状态：锁定时裁掉菜单与刷新/调试快捷键 */
ipcMain.handle('update:gate', (_event, locked) => {
  const next = Boolean(locked);
  if (next === gateLocked) return true;
  gateLocked = next;
  buildApplicationMenu();
  if (next) {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) win.webContents.closeDevTools();
  }
  return true;
});

ipcMain.handle('app:versionInfo', () => ({
  version: app.getVersion(),
  platform: process.platform,
  packaged: app.isPackaged,
}));

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

/** 界面切主题时同步原生主题与窗口底色，避免深色下露出浅色底 */
ipcMain.on('theme:set', (_event, dark) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) win.setBackgroundColor(dark ? '#1b1d21' : '#f7f8fa');
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: '打开 ShotFlow 项目',
    filters: [{ name: 'ShotFlow 项目', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, 'utf8');
  currentFilePath = filePath;
  return { canceled: false, text, filePath };
});

ipcMain.handle('project:save', async (_event, payload) => {
  let filePath = payload && payload.filePath ? payload.filePath : currentFilePath;
  if (!filePath) {
    const result = await dialog.showSaveDialog({
      title: '保存 ShotFlow 项目',
      defaultPath: 'ShotFlow-项目.json',
      filters: [{ name: 'ShotFlow 项目', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = result.filePath;
  }
  await writeAtomic(filePath, payload.text);
  currentFilePath = filePath;
  return { canceled: false, filePath };
});

ipcMain.handle('project:export', async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: '导出文件',
    defaultPath: payload && payload.defaultName ? payload.defaultName : 'export',
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const buffer = Buffer.from(payload.base64, 'base64');
  await writeAtomic(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});

// 自动保存：应用关闭再打开时恢复上一次的工作内容
ipcMain.handle('project:loadAutosave', async () => {
  try {
    return await fs.readFile(autosavePath(), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('project:writeAutosave', async (_event, text) => {
  await writeAtomic(autosavePath(), text);
  return true;
});

ipcMain.handle('project:clearAutosave', async () => {
  await fs.rm(autosavePath(), { force: true });
  currentFilePath = null;
  return true;
});

// ---- 多项目库：索引 + 每项目一个 JSON，全部原子写 ----
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const libraryDir = () => path.join(app.getPath('userData'), 'projects');
const libraryIndexPath = () => path.join(libraryDir(), 'index.json');

function projectFilePath(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('非法项目 ID');
  return path.join(libraryDir(), `${id}.json`);
}

async function readTextOrNull(target) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

ipcMain.handle('library:loadIndex', () => readTextOrNull(libraryIndexPath()));

ipcMain.handle('library:saveIndex', async (_event, text) => {
  if (typeof text !== 'string') throw new Error('索引内容必须是字符串');
  await writeAtomic(libraryIndexPath(), text);
  return true;
});

ipcMain.handle('library:readProject', (_event, id) => readTextOrNull(projectFilePath(id)));

ipcMain.handle('library:writeProject', async (_event, payload) => {
  const target = projectFilePath(payload && payload.id);
  if (!payload || typeof payload.text !== 'string') throw new Error('项目内容必须是字符串');
  await writeAtomic(target, payload.text);
  return true;
});

ipcMain.handle('library:deleteProject', async (_event, id) => {
  await fs.rm(projectFilePath(id), { force: true });
  return true;
});

// ---- 统一项目包（.shotflow，二进制 ZIP）导入导出 ----
ipcMain.handle('package:import', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入项目包',
    filters: [{ name: 'ShotFlow 项目包 / 项目文件', extensions: ['shotflow', 'json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  return { canceled: false, base64: buffer.toString('base64'), name: path.basename(filePath), filePath };
});

ipcMain.handle('package:export', async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: '导出项目包',
    defaultPath: (payload && payload.defaultName) || 'ShotFlow-项目.shotflow',
    filters: [{ name: 'ShotFlow 项目包', extensions: ['shotflow'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeAtomic(result.filePath, Buffer.from(payload.base64, 'base64'));
  return { canceled: false, filePath: result.filePath };
});

// ---- 共享文件夹：目录由用户显式选择，文件名严格白名单，禁止路径穿越 ----
const SAFE_PACKAGE_FILE = /^[A-Za-z0-9_-]+\.shotflow$/;

function resolveSharedFile(dir, fileName) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('共享目录路径无效');
  if (typeof fileName !== 'string' || !SAFE_PACKAGE_FILE.test(fileName)) throw new Error('项目包文件名不合法');
  const target = path.join(dir, fileName);
  if (path.dirname(target) !== path.resolve(dir)) throw new Error('项目包路径越界');
  return target;
}

ipcMain.handle('share:chooseDir', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择团队共享目录（网络共享盘 / 网盘同步文件夹）',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, dir: result.filePaths[0] };
});

ipcMain.handle('share:readIndex', async (_event, dir) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('共享目录路径无效');
  return readTextOrNull(path.join(dir, 'shotflow-index.json'));
});

ipcMain.handle('share:writeIndex', async (_event, payload) => {
  if (typeof payload.dir !== 'string' || !path.isAbsolute(payload.dir)) throw new Error('共享目录路径无效');
  if (typeof payload.text !== 'string') throw new Error('索引内容必须是字符串');
  await writeAtomic(path.join(payload.dir, 'shotflow-index.json'), payload.text);
  return true;
});

ipcMain.handle('share:readPackage', async (_event, payload) => {
  const buffer = await fs.readFile(resolveSharedFile(payload.dir, payload.fileName));
  return buffer.toString('base64');
});

ipcMain.handle('share:writePackage', async (_event, payload) => {
  const target = resolveSharedFile(payload.dir, payload.fileName);
  await writeAtomic(target, Buffer.from(payload.base64, 'base64'));
  return true;
});

// ---- 导出分镜：PDF 走 Chromium 打印管线（中文字体由系统提供，不嵌字体） ----
function escapeHtmlText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

ipcMain.handle('pdf:export', async (_event, payload) => {
  if (!payload || typeof payload.html !== 'string' || payload.html.length === 0) {
    throw new Error('导出内容为空，无法生成 PDF');
  }
  const tempFile = path.join(app.getPath('temp'), `shotflow-print-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tempFile, payload.html, 'utf8');

  const printWindow = new BrowserWindow({
    show: false,
    width: 1120,
    height: 794,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      javascript: false,
      webgl: false,
    },
  });

  try {
    await printWindow.loadFile(tempFile);
    const footerText = escapeHtmlText(payload.footer || 'ShotFlow · 分镜表');
    const footerTemplate = `<div style="width:100%;padding:0 10mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif;font-size:8px;color:#7b8695;"><span>${footerText}</span><span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span></div>`;
    const pdf = await printWindow.webContents.printToPDF({
      pageSize: payload.pageSize === 'A3' ? 'A3' : 'A4',
      landscape: payload.landscape !== false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      margins: { top: 0.45, bottom: 0.6, left: 0.35, right: 0.35 },
      preferCSSPageSize: false,
    });

    const result = await dialog.showSaveDialog({
      title: '导出 PDF 分镜表',
      defaultPath: payload.defaultName || '分镜表.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeAtomic(result.filePath, pdf);
    return { canceled: false, filePath: result.filePath };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(tempFile, { force: true });
  }
});

// ---- 导出分镜：Excel(.xlsx) 等二进制文档 ----
ipcMain.handle('document:export', async (_event, payload) => {
  if (!payload || typeof payload.base64 !== 'string') throw new Error('导出内容为空');
  const extension = /^[a-z0-9]{1,8}$/i.test(payload.extension || '') ? payload.extension : 'bin';
  const result = await dialog.showSaveDialog({
    title: '导出文档',
    defaultPath: payload.defaultName || `导出.${extension}`,
    filters: [{ name: payload.label || '文档', extensions: [extension.toLowerCase()] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeAtomic(result.filePath, Buffer.from(payload.base64, 'base64'));
  return { canceled: false, filePath: result.filePath };
});
