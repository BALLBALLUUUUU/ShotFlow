/**
 * 云宿主：用一个隐藏的浏览器窗口承载「正式域名下的云桥页面」。
 *
 * 为什么需要它：云端按精确 Origin 校验，Electron 的 file:// 页面无法直接调用
 * 云接口。这里把云调用放进一个加载 https://<release-domain> 的窗口里，Origin 天然正确，
 * 登录会话也存在这个窗口的持久分区里，主窗口通过 IPC 请求它。
 *
 * 离线优先：这个窗口加载失败时只把云功能标记为不可用，主程序照常工作。
 */
const { BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { DEFAULT_TARGET } = require('./cloud-config.cjs');

const CHANNEL = 'cloud:msg';
const DEFAULT_TIMEOUT = 25000;

// 登录链路上必须留在本窗口内的域名：微信授权页 + 平台 OAuth 中转
// （云桥自身的域名在切换地址时会变，由 isAuthFlow 动态补上）
const FIXED_AUTH_HOSTS = new Set([
  'open.weixin.qq.com',
  'www.workbuddy.cn',
  'workbuddy.cn',
]);

/** 当前云端目标：可在运行时切换（设置里改云端地址） */
let cloudTarget = { ...DEFAULT_TARGET };

function cloudOrigin() {
  return cloudTarget.endpoint;
}

/** 站点有访问码网关，首次访问会写 __wb_rsc cookie；之后直接访问根路径即可 */
function cloudEntry() {
  const code = cloudTarget.sharecode ? `?sharecode=${encodeURIComponent(cloudTarget.sharecode)}` : '';
  return `${cloudOrigin()}/${code}`;
}

function isAuthFlow(url) {
  try {
    const { hostname } = new URL(url);
    return FIXED_AUTH_HOSTS.has(hostname) || hostname === new URL(cloudOrigin()).hostname;
  } catch {
    return false;
  }
}

let win = null;
let pageReady = false;
let seq = 0;
let lastError = null;
const pending = new Map();
let emit = () => {};

function notify(payload) {
  try {
    emit(payload);
  } catch {
    /* 主窗口已关闭 */
  }
}

function rejectAll(reason) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
}

function handleMessage(_event, message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'res' && message.id) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.data);
    else entry.reject(new Error(message.error || 'cloud_call_failed'));
    return;
  }

  if (message.type === 'event') {
    if (message.event === 'ready') {
      pageReady = true;
      lastError = message.data && message.data.error ? message.data.error : null;
      flushQueue();
    }
    if (message.event === 'auth') {
      // 登录成功后自动收起登录窗口
      if (message.data && message.data.signedIn && win && !win.isDestroyed()) {
        win.hide();
      }
    }
    notify({ event: message.event, data: message.data });
  }
}

function sendNow(entry) {
  try {
    win.webContents.send(CHANNEL, { type: 'req', id: entry.id, method: entry.method, params: entry.params });
  } catch {
    pending.delete(entry.id);
    clearTimeout(entry.timer);
    entry.reject(new Error('cloud_window_unavailable'));
  }
}

function flushQueue() {
  for (const [id, entry] of pending) {
    if (!entry.queued) continue;
    entry.queued = false;
    if (!win || win.isDestroyed()) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error('cloud_window_unavailable'));
      continue;
    }
    sendNow(entry);
  }
}

function createWindow() {
  const created = new BrowserWindow({
    width: 460,
    height: 620,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'ShotFlow 微信登录',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'cloud-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 持久分区：cookie 与登录会话跨重启保留
      partition: 'persist:shotflow-cloud',
    },
  });

  created.on('closed', () => {
    if (win === created) {
      win = null;
      pageReady = false;
      rejectAll('cloud_window_closed');
    }
  });

  // 授权过程都在这个窗口内完成，不弹新窗口；外链交给系统浏览器。
  // 关键：微信授权页与平台 OAuth 中转会用 window.open 处理回跳，若把它们丢给系统浏览器，
  // 登录态就落在浏览器里而不是这台应用的分区里，所以这些域名必须在本窗口内加载。
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthFlow(url)) {
      created.loadURL(url).catch(() => {});
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 离开云桥页（例如跳去微信授权）时复位就绪标记，等桥接页重新加载并上报 ready
  created.webContents.on('did-navigate', (_event, url) => {
    if (!url.startsWith(cloudOrigin())) pageReady = false;
  });

  created.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    pageReady = false;
    lastError = `cloud_offline:${code}`;
    rejectAll('cloud_offline');
    notify({ event: 'offline', data: { code, description, url } });
  });

  created.webContents.on('render-process-gone', () => {
    pageReady = false;
    rejectAll('cloud_renderer_gone');
  });

  created.loadURL(cloudEntry()).catch(() => {
    lastError = 'cloud_load_failed';
  });

  win = created;
  return created;
}

function ensureWindow() {
  if (!win || win.isDestroyed()) {
    pageReady = false;
    createWindow();
  }
  return win;
}

function call(method, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const target = ensureWindow();
    if (!target || target.isDestroyed()) {
      reject(new Error('cloud_window_unavailable'));
      return;
    }
    const id = `r${Date.now().toString(36)}${(seq += 1)}`;
    const entry = { id, method, params, resolve, reject, queued: false, timer: null };
    pending.set(id, entry);

    // 超时覆盖「等页面 ready」和「等页面回包」两段
    entry.timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('cloud_timeout'));
    }, options.timeout || DEFAULT_TIMEOUT);

    if (pageReady) sendNow(entry);
    else entry.queued = true;
  });
}

async function login() {
  const target = ensureWindow();
  if (!target || target.isDestroyed()) throw new Error('cloud_window_unavailable');
  const current = await call('session').catch(() => null);
  if (current && current.signedIn) {
    target.hide();
    return current;
  }
  target.show();
  target.focus();
  // 授权页跳转会离开云桥页，这一步的回包可能在导航中丢失；结果以 auth 事件为准
  await call('login', {}, { timeout: 20000 }).catch(() => null);
  return { started: true };
}

async function logout() {
  return call('logout');
}

async function session() {
  try {
    return await call('session');
  } catch (error) {
    return { signedIn: false, user: null, error: error.message, offline: error.message === 'cloud_offline' };
  }
}

function dispose() {
  rejectAll('cloud_host_disposed');
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  pageReady = false;
}

/**
 * 切换云端地址。地址没变就什么都不做（保留登录态与窗口）；
 * 变了就销毁旧窗口，下次调用时按新地址重建。
 *
 * 登录态按域名隔离：不同云端是不同的 Origin，cookie 与 localStorage 各存一份，
 * 所以切换后不会把 A 云端的会话带到 B 云端，界面会回到未登录。
 */
function configure(next) {
  if (!next || typeof next.endpoint !== 'string' || !next.endpoint) return { changed: false };
  const normalized = {
    endpoint: next.endpoint.replace(/\/+$/, ''),
    sharecode: typeof next.sharecode === 'string' ? next.sharecode : '',
  };
  const same = normalized.endpoint === cloudTarget.endpoint
    && normalized.sharecode === cloudTarget.sharecode;
  if (same) return { changed: false };

  cloudTarget = normalized;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  pageReady = false;
  lastError = null;
  rejectAll('cloud_endpoint_changed');
  return { changed: true, target: { ...cloudTarget } };
}

function createCloudHost(options = {}) {
  emit = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const { ipcMain } = require('electron');
  ipcMain.on(CHANNEL, handleMessage);
  return {
    call,
    login,
    logout,
    session,
    dispose,
    configure,
    get error() {
      return lastError;
    },
    get ready() {
      return pageReady;
    },
    get identity() {
      return { origin: cloudOrigin() };
    },
  };
}

module.exports = { createCloudHost, DEFAULT_TARGET };
