/**
 * 云端双向同步的纯逻辑：内容哈希、同步计划、冲突判定。
 *
 * 这里不碰磁盘、不碰网络，只做判断，方便单测把「什么时候该传、什么时候该拉、
 * 什么时候必须问用户」钉死。真正的读写由 store/cloudSync.ts 执行。
 *
 * 判定原则（离线优先）：
 *   - 本机改了、云端没改  → 上传
 *   - 云端改了、本机没改  → 下载
 *   - 两边都改了          → 冲突，交给用户选，绝不自动覆盖
 *   - 只有云端有          → 下载（换电脑后第一次同步就是把项目拉回来）
 *   - 只有本机有          → 上传
 *   - 回收站里的项目      → 跳过（回收站属于本机状态，不同步）
 */

export interface LocalSyncEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** 规范化序列化后的内容哈希；回收站里的项目为空串 */
  hash: string;
  /** 在回收站里 */
  deleted: boolean;
}

export interface RemoteSyncEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** 旧版清单没有哈希，空串表示「未知」 */
  hash: string;
}

export interface SyncConflict {
  id: string;
  name: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localHash: string;
  remoteHash: string;
}

export interface SyncMemory {
  /** 上一次同步成功时各项目的内容哈希（id → 哈希） */
  entries: Record<string, { hash: string; at: string }>;
  /** 本机彻底删除过的项目，防止下一次同步又把它从云端拉回来 */
  tombstones: Record<string, string>;
}

export interface SyncPlan {
  upload: string[];
  download: string[];
  conflicts: SyncConflict[];
  inSync: string[];
  skipped: { id: string; reason: 'trashed' | 'tombstone' }[];
}

export const EMPTY_MEMORY: SyncMemory = { entries: {}, tombstones: {} };

/**
 * FNV-1a 32 位哈希，带长度前缀降低碰撞。
 * 只用于「内容有没有变」的判断，不做安全用途。
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

/** 时间比较：无效时间按 0 处理，避免 NaN 让判定随机 */
function stamp(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * 计算这一轮要做什么。同一个 id 只会出现在一个桶里。
 */
export function planSync(
  local: LocalSyncEntry[],
  remote: RemoteSyncEntry[],
  memory: SyncMemory,
): SyncPlan {
  const plan: SyncPlan = { upload: [], download: [], conflicts: [], inSync: [], skipped: [] };
  const remoteMap = new Map(remote.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));

  for (const item of local) {
    if (item.deleted) {
      plan.skipped.push({ id: item.id, reason: 'trashed' });
      continue;
    }
    const cloud = remoteMap.get(item.id);
    if (!cloud) {
      // 云端没有：本机有就传上去。注意不因为「云端缺」就删本机文件。
      plan.upload.push(item.id);
      continue;
    }
    if (cloud.hash && cloud.hash === item.hash) {
      plan.inSync.push(item.id);
      continue;
    }

    const base = memory.entries[item.id]?.hash;
    if (!base) {
      // 第一次同步（或旧清单没有哈希）：更新时间新的赢，时间相同按内容定
      if (!cloud.hash) {
        if (stamp(item.updatedAt) >= stamp(cloud.updatedAt)) plan.upload.push(item.id);
        else plan.download.push(item.id);
        continue;
      }
      const localTime = stamp(item.updatedAt);
      const remoteTime = stamp(cloud.updatedAt);
      if (localTime > remoteTime) plan.upload.push(item.id);
      else if (remoteTime > localTime) plan.download.push(item.id);
      else plan.conflicts.push(conflictOf(item, cloud));
      continue;
    }

    const localChanged = base !== item.hash;
    const remoteChanged = !cloud.hash || base !== cloud.hash;
    if (!localChanged && !remoteChanged) {
      plan.inSync.push(item.id);
    } else if (localChanged && !remoteChanged) {
      plan.upload.push(item.id);
    } else if (!localChanged && remoteChanged) {
      plan.download.push(item.id);
    } else {
      plan.conflicts.push(conflictOf(item, cloud));
    }
  }

  for (const item of remote) {
    if (localMap.has(item.id)) continue;
    if (memory.tombstones[item.id]) {
      plan.skipped.push({ id: item.id, reason: 'tombstone' });
      continue;
    }
    plan.download.push(item.id);
  }

  return plan;
}

function conflictOf(local: LocalSyncEntry, remote: RemoteSyncEntry): SyncConflict {
  return {
    id: local.id,
    name: local.name || remote.name || '未命名项目',
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
    localHash: local.hash,
    remoteHash: remote.hash,
  };
}

/** 同步成功后更新记忆：写入已对齐的哈希，清掉多余的墓碑（防止无限增长） */
export function rememberSynced(
  memory: SyncMemory,
  synced: { id: string; hash: string }[],
  at: string,
): SyncMemory {
  const entries = { ...memory.entries };
  for (const item of synced) {
    if (!item.hash) continue;
    entries[item.id] = { hash: item.hash, at };
  }
  return { entries, tombstones: { ...memory.tombstones } };
}

/** 彻底删除项目时登记墓碑，并把它从记忆里移除 */
export function rememberPurged(memory: SyncMemory, id: string, at: string): SyncMemory {
  const entries = { ...memory.entries };
  delete entries[id];
  return { entries, tombstones: { ...memory.tombstones, [id]: at } };
}

/** 反序列化记忆文件，坏值一律降级为空，不让同步因此崩掉 */
export function normalizeMemory(raw: unknown): SyncMemory {
  if (!raw || typeof raw !== 'object') return { entries: {}, tombstones: {} };
  const source = raw as { entries?: unknown; tombstones?: unknown };
  const entries: SyncMemory['entries'] = {};
  if (source.entries && typeof source.entries === 'object') {
    for (const [id, value] of Object.entries(source.entries as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as { hash?: unknown; at?: unknown };
      if (typeof item.hash !== 'string' || !item.hash) continue;
      entries[id] = { hash: item.hash, at: typeof item.at === 'string' ? item.at : '' };
    }
  }
  const tombstones: SyncMemory['tombstones'] = {};
  if (source.tombstones && typeof source.tombstones === 'object') {
    for (const [id, value] of Object.entries(source.tombstones as Record<string, unknown>)) {
      if (typeof value === 'string') tombstones[id] = value;
    }
  }
  return { entries, tombstones };
}
