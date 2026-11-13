/**
 * 版本号与「检查更新」相关的纯函数。
 *
 * 只有解析与比较，不含网络请求：桌面端交给主进程走 IPC，
 * 浏览器预览时由组件自己 fetch，两条路都复用这里的类型与比较逻辑。
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** owner/repo，拼链接用 */
  slug: string;
}

export interface LatestRelease {
  /** 去掉前缀 v 的版本号 */
  version: string;
  /** GitHub 上的原始 tag */
  tag: string;
  url: string;
  name: string;
  notes: string;
  publishedAt: string;
}

/** 接受 `owner/repo`、`https://github.com/owner/repo`、带 .git 或末尾斜杠的写法 */
export function parseRepoRef(input: string): RepoRef | null {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const stripped = text
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const parts = stripped.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  // GitHub 的用户名/仓库名只允许字母数字与 . _ -
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(owner) || !valid.test(repo)) return null;
  return { owner, repo, slug: `${owner}/${repo}` };
}

export function releasesUrl(ref: RepoRef): string {
  return `https://github.com/${ref.slug}/releases`;
}

export function releaseTagUrl(ref: RepoRef, tag: string): string {
  return `https://github.com/${ref.slug}/releases/tag/${encodeURIComponent(tag)}`;
}

/** 语义化版本比较：a 比 b 新返回 1，旧返回 -1，相同返回 0 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => {
    const cleaned = String(value ?? '').trim().replace(/^v/i, '').split(/[+-]/)[0] ?? '';
    return cleaned.split('.').map((part) => {
      const digits = part.replace(/[^\d]/g, '');
      const num = Number.parseInt(digits, 10);
      return Number.isFinite(num) ? num : 0;
    });
  };
  const left = parse(a);
  const right = parse(b);
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

/** `v1.2.3` → `1.2.3`，空值兜底成 0.0.0 */
export function normalizeTagVersion(tag: string): string {
  const value = String(tag ?? '').trim().replace(/^v/i, '');
  return value || '0.0.0';
}

// ---- 启动版本闸门：远端清单 → 本地判定 ----

export type UpdatePlatform = 'mac' | 'win' | 'other';

export interface UpdateAsset {
  url: string;
  /** 落盘时用的文件名，已按扩展名白名单校验过 */
  name: string;
  /** 字节数，未知为 0 */
  size: number;
}

export interface UpdateManifest {
  version: string;
  notes: string;
  publishedAt: string;
  /** 发布页，下载不到时兜底跳转 */
  pageUrl: string;
  /** 默认强制；只有清单显式写 false 才允许继续用旧版 */
  mandatory: boolean;
  assets: { mac: UpdateAsset | null; win: UpdateAsset | null };
}

export interface UpdateDecision {
  current: string;
  latest: string;
  hasUpdate: boolean;
  /** hasUpdate 且清单要求强制 */
  mandatory: boolean;
  notes: string;
  publishedAt: string;
  pageUrl: string;
  downloadUrl: string | null;
  downloadName: string;
  /** 安装包字节数，未知为 0 */
  downloadSize: number;
  /** 有对应平台的安装包，可一键下载；否则只能去发布页 */
  canDownload: boolean;
}

/** 自用仓库，启动校验默认打这里；关于面板里可以改成别处 */
export const DEFAULT_UPDATE_REPO = 'BALLBALLUUUUU/ShotFlow';

/** 安装包文件名只认这三种扩展名，避免清单把任意文件塞进下载流程 */
const ASSET_NAME = /^[A-Za-z0-9._-]{1,120}\.(dmg|exe|zip)$/i;
const VERSION_SHAPE = /^\d+(\.\d+){0,3}$/;

export function platformFrom(platform: string): UpdatePlatform {
  const value = String(platform ?? '').toLowerCase();
  if (value === 'darwin' || value === 'mac' || value === 'macos') return 'mac';
  if (value === 'win32' || value === 'win' || value === 'windows') return 'win';
  return 'other';
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 本机回环地址只用于本地联调（SHOTFLOW_UPDATE_MANIFEST 指向本地清单） */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

/** 安装包地址：线上必须 https，本机回环允许 http，方便联调 */
export function isAllowedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** 从下载地址推文件名；推不出来或扩展名不在白名单就返回 null */
export function assetNameFromUrl(url: string): string | null {
  if (!isAllowedAssetUrl(url)) return null;
  try {
    const pathname = new URL(url).pathname;
    const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
    return ASSET_NAME.test(last) ? last : null;
  } catch {
    return null;
  }
}

function readAsset(input: unknown): UpdateAsset | null {
  if (typeof input === 'string') {
    const url = input.trim();
    const name = assetNameFromUrl(url);
    return name ? { url, name, size: 0 } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!isAllowedAssetUrl(url)) return null;
  const declared = typeof record.name === 'string' ? record.name.trim() : '';
  const name = ASSET_NAME.test(declared) ? declared : assetNameFromUrl(url);
  if (!name) return null;
  const size = typeof record.size === 'number' && Number.isFinite(record.size) && record.size > 0
    ? Math.round(record.size)
    : 0;
  return { url, name, size };
}

/** 远端清单是外部输入，字段缺失、类型错、非 https 一律当没有，不许抛错 */
export function parseUpdateManifest(raw: unknown, fallbackPage = ''): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  // 空版本不能被 normalizeTagVersion 兜底成 0.0.0，否则空清单会变成「最新版」
  const declared = typeof record.version === 'string' ? record.version.trim() : '';
  if (!declared) return null;
  const version = normalizeTagVersion(declared);
  if (!VERSION_SHAPE.test(version)) return null;

  const pageRaw = typeof record.page === 'string' ? record.page.trim() : '';
  const pageUrl = isHttpsUrl(pageRaw) ? pageRaw : (isHttpsUrl(fallbackPage) ? fallbackPage : '');

  const assetsRaw = record.assets && typeof record.assets === 'object'
    ? record.assets as Record<string, unknown>
    : {};

  return {
    version,
    notes: typeof record.notes === 'string' ? record.notes.slice(0, 6000) : '',
    publishedAt: typeof record.publishedAt === 'string' ? record.publishedAt.slice(0, 40) : '',
    pageUrl,
    mandatory: record.mandatory !== false,
    assets: { mac: readAsset(assetsRaw.mac), win: readAsset(assetsRaw.win) },
  };
}

/**
 * 启动时的版本判定。返回 null 表示「没有可用的远端信息」——调用方必须放行，
 * 否则一次网络故障就会把软件锁死。
 */
export function decideUpdate(
  current: string,
  manifest: UpdateManifest | null,
  platform: UpdatePlatform,
): UpdateDecision | null {
  if (!manifest) return null;
  const now = normalizeTagVersion(current);
  const asset = platform === 'mac' ? manifest.assets.mac : platform === 'win' ? manifest.assets.win : null;
  const hasUpdate = compareVersions(manifest.version, now) > 0;
  return {
    current: now,
    latest: manifest.version,
    hasUpdate,
    mandatory: hasUpdate && manifest.mandatory,
    notes: manifest.notes,
    publishedAt: manifest.publishedAt,
    pageUrl: manifest.pageUrl,
    downloadUrl: hasUpdate && asset ? asset.url : null,
    downloadName: asset ? asset.name : '',
    downloadSize: asset ? asset.size : 0,
    canDownload: hasUpdate && Boolean(asset),
  };
}

/**
 * 多个更新源可能同时返回（raw 实时、CDN 有缓存），取版本最高的那份；
 * 版本相同则保留先出现的，调用方按「实时源在前」排列。
 */
export function pickManifest(
  candidates: { source: string; payload: unknown }[],
  fallbackPage = '',
): { manifest: UpdateManifest; source: string } | null {
  let best: { manifest: UpdateManifest; source: string } | null = null;
  for (const candidate of candidates) {
    const manifest = parseUpdateManifest(candidate.payload, fallbackPage);
    if (!manifest) continue;
    if (!best || compareVersions(manifest.version, best.manifest.version) > 0) {
      best = { manifest, source: candidate.source };
    }
  }
  return best;
}

/** 给更新墙用的大小文案，未知大小返回空串 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
