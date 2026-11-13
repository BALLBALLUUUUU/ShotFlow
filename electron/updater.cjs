/**
 * 启动版本校验与更新包下载。
 *
 * 只做三件事：取远端版本清单、把安装包下载到本机、把安装包交给系统。
 * 版本新旧判定不在这里，主进程只负责「把远端说法原样带回来」，
 * 由渲染层的纯函数决定是否锁住界面 —— 这样判定逻辑能被单测覆盖。
 *
 * 走 Electron 的 net.fetch 而不是 Node 的 fetch：前者读系统代理，
 * 国内网络下差异很实际。
 */
const { app, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { once } = require('node:events');

const DEFAULT_SLUG = 'BALLBALLUUUUU/ShotFlow';
const MANIFEST_TIMEOUT = 3000;
/** 第一个源成功后再等一小会儿，尽量拿到第二份好比较版本（CDN 可能是旧缓存） */
const COLLECT_GRACE = 450;
const API_TIMEOUT = 2600;
const MAX_ASSET_BYTES = 600 * 1024 * 1024;

/** 只允许从这些域名拉安装包，清单被改成别处也不会把任意文件写进磁盘 */
const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
]);

const PAGE_HOSTS = new Set(['github.com', 'shotflow.app.workbuddy.host']);
const ASSET_NAME = /^[A-Za-z0-9._-]{1,120}\.(dmg|exe|zip)$/i;

const downloaded = new Set();

function normalizeSlug(input) {
  const slug = String(input ?? '').trim();
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug) ? slug : DEFAULT_SLUG;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ShotFlow' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GitHub Contents API：raw 域名在国内经常不可达、jsDelivr 的 @main 又会缓存，
 * 这条接口一般能连上，代价是未登录每小时 60 次（启动一次只发一个请求）。
 */
async function fetchManifestViaApi(slug) {
  const data = await fetchJson(
    `https://api.github.com/repos/${slug}/contents/version.json?ref=main`,
    API_TIMEOUT,
  );
  if (!data || typeof data.content !== 'string' || !data.content) throw new Error('清单内容为空');
  const text = Buffer.from(String(data.content).replace(/\s/g, ''), 'base64').toString('utf8');
  return JSON.parse(text);
}

function releaseToManifest(data, slug) {
  const tag = String(data && data.tag_name ? data.tag_name : '');
  const assets = Array.isArray(data && data.assets) ? data.assets : [];
  const pick = (extension) => {
    const hit = assets.find((item) => typeof item.name === 'string' && item.name.toLowerCase().endsWith(extension));
    if (!hit || typeof hit.browser_download_url !== 'string') return null;
    return { url: hit.browser_download_url, name: hit.name, size: Number(hit.size) || 0 };
  };
  return {
    version: tag,
    notes: String((data && data.body) || ''),
    publishedAt: String((data && data.published_at) || ''),
    page: String((data && data.html_url) || `https://github.com/${slug}/releases`),
    mandatory: true,
    assets: { mac: pick('.dmg'), win: pick('.exe') },
  };
}

/**
 * 并行取多个源，第一个成功后只再等一小会儿就收尾：
 * 国内 raw.githubusercontent.com 经常直接超时，不能让它拖住启动。
 */
function collectManifests(sources) {
  return new Promise((resolve) => {
    const results = [];
    let settled = 0;
    let firstOk = false;
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(results);
    };
    sources.forEach(([source, load]) => {
      Promise.resolve()
        .then(load)
        .then((payload) => {
          results.push({ source, payload });
          if (!firstOk) {
            firstOk = true;
            timer = setTimeout(finish, COLLECT_GRACE);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          settled += 1;
          if (settled === sources.length) finish();
        });
    });
  });
}

/**
 * 返回若干候选清单。raw 与 jsDelivr 并行（CDN 可能缓存旧版本，
 * 所以两份都带回渲染层比版本，取高的那份），都失败再用 GitHub API。
 */
async function collectCandidates(repoInput) {
  const slug = normalizeSlug(repoInput);
  const forced = process.env.SHOTFLOW_UPDATE_MANIFEST;
  if (forced) {
    const payload = await fetchJson(forced, MANIFEST_TIMEOUT);
    return { slug, candidates: [{ source: 'override', payload }] };
  }

  const sources = [
    ['jsdelivr', () => fetchJson(`https://cdn.jsdelivr.net/gh/${slug}@main/version.json`, MANIFEST_TIMEOUT)],
    ['raw', () => fetchJson(`https://raw.githubusercontent.com/${slug}/main/version.json`, MANIFEST_TIMEOUT)],
    ['api', () => fetchManifestViaApi(slug)],
  ];
  const candidates = await collectManifests(sources);

  if (candidates.length > 0) {
    // 调试用：伪造一个更高的远端版本，验证强制更新墙，不影响真实清单
    if (process.env.SHOTFLOW_FORCE_REMOTE) {
      candidates.push({
        source: 'debug',
        payload: { version: String(process.env.SHOTFLOW_FORCE_REMOTE), notes: '调试用强制更新', mandatory: true },
      });
    }
    return { slug, candidates };
  }

  const release = await fetchJson(`https://api.github.com/repos/${slug}/releases/latest`, API_TIMEOUT);
  return { slug, candidates: [{ source: 'release', payload: releaseToManifest(release, slug) }] };
}

/** 本机回环地址只用于本地联调（SHOTFLOW_UPDATE_MANIFEST 指向本地清单） */
function isLocalHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

function assertDownloadUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('更新包地址无效');
  }
  const local = isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('更新包地址必须是 https');
  }
  if (!local && !DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error(`不在允许的下载域名内：${url.hostname}`);
  }
  return url;
}

/**
 * 轻量确认安装包真的存在。清单里写了地址但没上传时，
 * 如果直接锁住界面，用户会卡在没有包的更新页上。
 */
async function probeAsset(rawUrl) {
  const url = assertDownloadUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2600);
  try {
    const response = await net.fetch(url.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'ShotFlow' },
    });
    return { ok: response.ok, status: response.status, size: Number(response.headers.get('content-length')) || 0 };
  } catch {
    return { ok: false, status: 0, size: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function updateDir() {
  return process.env.SHOTFLOW_DOWNLOAD_DIR || path.join(app.getPath('downloads'), 'ShotFlow 更新');
}

async function downloadAsset(rawUrl, rawName, onProgress) {
  const url = assertDownloadUrl(rawUrl);
  const name = ASSET_NAME.test(String(rawName || '')) ? String(rawName) : '';
  if (!name) throw new Error('更新包文件名不合法');

  const dir = updateDir();
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  const part = `${target}.part`;
  await fsp.rm(part, { force: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  try {
    const response = await net.fetch(url.toString(), {
      headers: { 'User-Agent': 'ShotFlow' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    if (!response.body) throw new Error('下载失败：服务器没有返回内容');

    // 跟随重定向后校验最终域名，防止 302 到不受控的地址
    try {
      const finalHost = new URL(response.url).hostname;
      if (!DOWNLOAD_HOSTS.has(finalHost)) throw new Error(`下载被重定向到不受信任的域名：${finalHost}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('下载被重定向')) throw error;
    }

    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_ASSET_BYTES) throw new Error('更新包体积异常，已中止下载');

    const reader = response.body.getReader();
    const file = fs.createWriteStream(part);
    let received = 0;
    let lastTick = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_ASSET_BYTES) throw new Error('更新包体积异常，已中止下载');
        if (!file.write(Buffer.from(value))) await once(file, 'drain');
        const now = Date.now();
        if (onProgress && now - lastTick > 120) {
          lastTick = now;
          onProgress({ received, total, percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0 });
        }
      }
    } finally {
      await new Promise((resolve, reject) => {
        file.end((error) => (error ? reject(error) : resolve()));
      });
    }

    if (received <= 0) throw new Error('下载失败：文件为空');
    if (total > 0 && received !== total) throw new Error('下载不完整，请重试');

    await fsp.rename(part, target);
    if (onProgress) onProgress({ received, total: total || received, percent: 100 });
    downloaded.add(target);
    return { filePath: target, size: received };
  } finally {
    clearTimeout(timer);
    await fsp.rm(part, { force: true }).catch(() => undefined);
  }
}

async function installAsset(filePath) {
  const target = path.resolve(String(filePath || ''));
  if (!downloaded.has(target)) throw new Error('只能安装本次下载的更新包');
  if (!ASSET_NAME.test(path.basename(target))) throw new Error('更新包文件名不合法');
  await fsp.access(target);

  if (process.platform === 'darwin') {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { mode: 'open-dmg' };
  }
  if (process.platform === 'win32') {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    // 安装器会覆盖正在运行的程序文件，先把本身退掉
    setTimeout(() => app.quit(), 1500);
    return { mode: 'installer' };
  }
  throw new Error('当前平台不支持自动安装，请到发布页下载');
}

function openPage(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('发布页地址无效');
  }
  if (url.protocol !== 'https:' || !PAGE_HOSTS.has(url.hostname)) throw new Error('发布页地址不在允许范围内');
  return shell.openExternal(url.toString());
}

module.exports = {
  DEFAULT_SLUG,
  collectCandidates,
  probeAsset,
  downloadAsset,
  installAsset,
  openPage,
  normalizeSlug,
};
