/**
 * 共享文件夹协议（无云端的多人协作路径）。
 *
 * 同事把同一个网络共享盘 / NAS / 网盘同步文件夹设为「共享目录」，
 * 目录里放：
 *   shotflow-index.json  —— 项目清单与版本指纹
 *   <projectId>.shotflow —— 每个项目一份统一项目包
 *
 * 只做「显式发布 / 显式取回 + 版本检测」，不做实时协同；
 * 任何可能覆盖他人修改的操作都必须先由用户确认。
 */

export const SHARE_INDEX_FILE = 'shotflow-index.json';
export const SHARE_INDEX_VERSION = 1;
export const SAFE_PACKAGE_FILE = /^[A-Za-z0-9_-]+\.shotflow$/;

export interface SharedEntry {
  projectId: string;
  name: string;
  fileName: string;
  updatedAt: string;
  exportedAt: string;
  author: string;
  contentHash: string;
  shotCount: number;
  dayCount: number;
}

export interface SharedIndex {
  version: 1;
  updatedAt: string;
  projects: SharedEntry[];
}

export const EMPTY_SHARED_INDEX: SharedIndex = { version: 1, updatedAt: '', projects: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** 防御性解析：共享目录里的索引可能被别的程序或手改弄坏 */
export function normalizeSharedIndex(raw: unknown): SharedIndex {
  if (!isRecord(raw) || !Array.isArray(raw.projects)) return { ...EMPTY_SHARED_INDEX, projects: [] };
  const projects: SharedEntry[] = [];
  for (const item of raw.projects) {
    if (!isRecord(item)) continue;
    const projectId = text(item.projectId);
    const fileName = text(item.fileName);
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) continue;
    if (!SAFE_PACKAGE_FILE.test(fileName)) continue;
    if (projects.some((entry) => entry.projectId === projectId)) continue;
    projects.push({
      projectId,
      fileName,
      name: text(item.name, '未命名项目') || '未命名项目',
      updatedAt: text(item.updatedAt),
      exportedAt: text(item.exportedAt),
      author: text(item.author),
      contentHash: text(item.contentHash),
      shotCount: count(item.shotCount),
      dayCount: count(item.dayCount),
    });
  }
  return { version: 1, updatedAt: text(raw.updatedAt), projects };
}

export function upsertSharedEntry(index: SharedIndex, entry: SharedEntry): SharedIndex {
  const found = index.projects.some((item) => item.projectId === entry.projectId);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: found
      ? index.projects.map((item) => (item.projectId === entry.projectId ? entry : item))
      : [...index.projects, entry],
  };
}

export function sharedFileName(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('非法项目 ID');
  return `${projectId}.shotflow`;
}

export type VersionRelation = 'new' | 'identical' | 'local-newer' | 'remote-newer' | 'same-time-different';

interface Versioned {
  updatedAt: string;
  contentHash: string;
}

/**
 * 比较本地与共享版本。contentHash 相同视为同一版；
 * 否则按项目 updatedAt 判定，时间相同但内容不同必须由人决定。
 */
export function compareVersions(local: Versioned, remote: Versioned | null): VersionRelation {
  if (!remote) return 'new';
  if (local.contentHash && remote.contentHash && local.contentHash === remote.contentHash) return 'identical';
  const a = new Date(local.updatedAt).getTime();
  const b = new Date(remote.updatedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return 'same-time-different';
  return a > b ? 'local-newer' : 'remote-newer';
}

/** 发布前检查：共享目录里若有更新的他人版本，必须阻止自动覆盖 */
export function canPublish(relation: VersionRelation): boolean {
  return relation === 'new' || relation === 'identical' || relation === 'local-newer';
}
