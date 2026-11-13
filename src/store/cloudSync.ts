/**
 * 项目与云端的双向同步。
 *
 * 方向：本机 ↔ 云端（同一个微信账号下的私有目录）
 *   - 本机改了、云端没改  → 上传
 *   - 云端改了、本机没改  → 下载
 *   - 两边都改了          → 不自动覆盖，弹窗让用户选（保留本机 / 用云端 / 两个都留）
 *   - 云端独有的项目      → 下载（换电脑后第一次同步就是把项目拉回来）
 *
 * 离线优先：编辑永远先写本机，同步只是后台通道；断网时只有状态栏那一行字变化。
 * 判断依据是「内容哈希 + 上次同步基线」，不看文件时间戳，避免时区/时钟偏差误判。
 */
import { create } from 'zustand';
import {
  activeProjects,
  metaFromProject,
  upsertMeta,
  type LibraryIndex,
} from '@/domain/library';
import { deserializeProject, newId, serializeProject } from '@/domain/project';
import {
  hashText,
  normalizeMemory,
  planSync,
  rememberSynced,
  type LocalSyncEntry,
  type RemoteSyncEntry,
  type SyncConflict,
  type SyncMemory,
} from '@/domain/sync';
import { loadLibrary, loadProjectById, saveIndex, writeProjectFile } from '@/store/projectLibrary';
import { useCloud } from '@/store/cloudStore';

/** 项目写盘后由 projectLibrary 派发 */
export const PROJECT_SAVED_EVENT = 'shotflow:project-saved';
/** 与 SharePanel 的 LIBRARY_CHANGED_EVENT 保持同一个字符串 */
const LIBRARY_CHANGED = 'shotflow:library-changed';
/** 彻底删除项目时由 projectLibrary 派发，用于登记墓碑并清掉云端对象 */
export const PROJECT_PURGED_EVENT = 'shotflow:project-purged';
/** 云端地址切换：由 cloudEndpoint store 派发 */
export const ENDPOINT_CHANGED_EVENT = 'shotflow:cloud-endpoint-changed';

const DEBOUNCE_MS = 2200;
const FOCUS_THROTTLE_MS = 60_000;
const POLL_MS = 180_000;
const ENTRY_PREFIX = 'shotflow.cloud.sync.v1.';
const PURGED_KEY = 'shotflow.cloud.purged.v1';

export type ConflictChoice = 'local' | 'remote' | 'both';

interface CloudSyncState {
  /** 正在跟云端对账 / 传输 */
  syncing: boolean;
  /** 云端项目总数（同步成功后才知道） */
  count: number;
  uploaded: number;
  downloaded: number;
  at: string | null;
  error: string | null;
  conflicts: SyncConflict[];
  /** 冲突弹窗是否展开；收起后仍保留 conflicts，便于再次打开 */
  conflictsOpen: boolean;
  resolving: boolean;
  reset: () => void;
}

export const useCloudSync = create<CloudSyncState>((set) => ({
  syncing: false,
  count: 0,
  uploaded: 0,
  downloaded: 0,
  at: null,
  error: null,
  conflicts: [],
  conflictsOpen: false,
  resolving: false,
  reset() {
    set({ syncing: false, count: 0, uploaded: 0, downloaded: 0, at: null, error: null, conflicts: [], conflictsOpen: false, resolving: false });
  },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let queued = false;
let applying = false;
let lastRun = 0;

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function signedInUserId(): string | null {
  const cloud = useCloud.getState();
  if (cloud.status !== 'signed-in') return null;
  return cloud.user?.id ?? null;
}

function notifyLibraryChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED));
}

// ---------- 同步记忆（基线 + 墓碑） ----------

function readPurged(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PURGED_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'string') out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function writePurged(purged: Record<string, string>): void {
  try {
    // 只保留最近 300 条，防止无限增长
    const entries = Object.entries(purged).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 300);
    window.localStorage.setItem(PURGED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* localStorage 不可用时只是少了防复活能力 */
  }
}

function loadMemory(uid: string): SyncMemory {
  let entries: SyncMemory['entries'] = {};
  try {
    const raw = window.localStorage.getItem(ENTRY_PREFIX + uid);
    if (raw) entries = normalizeMemory(JSON.parse(raw)).entries;
  } catch {
    entries = {};
  }
  return { entries, tombstones: readPurged() };
}

function saveMemory(uid: string, memory: SyncMemory): void {
  try {
    window.localStorage.setItem(ENTRY_PREFIX + uid, JSON.stringify({ version: 1, entries: memory.entries }));
  } catch {
    /* 忽略：下次同步退化成按更新时间判断 */
  }
  writePurged(memory.tombstones);
}

// ---------- 读取本机项目 ----------

interface LocalSnapshot {
  entries: LocalSyncEntry[];
  texts: Map<string, string>;
  hashes: Map<string, string>;
}

async function readLocalEntries(index: LibraryIndex): Promise<LocalSnapshot> {
  const entries: LocalSyncEntry[] = [];
  const texts = new Map<string, string>();
  const hashes = new Map<string, string>();

  for (const meta of index.projects) {
    if (meta.deletedAt) {
      // 回收站属于本机状态：不上传、不下载，也不因为云端有就自动恢复
      entries.push({ id: meta.id, name: meta.name, updatedAt: meta.updatedAt, hash: '', deleted: true });
      continue;
    }
    const project = await loadProjectById(meta.id).catch(() => null);
    if (!project) continue;
    const text = serializeProject(project);
    const hash = hashText(text);
    texts.set(meta.id, text);
    hashes.set(meta.id, hash);
    entries.push({
      id: meta.id,
      name: project.name,
      updatedAt: project.updatedAt,
      hash,
      deleted: false,
    });
  }
  return { entries, texts, hashes };
}

function normalizeRemote(raw: unknown): RemoteSyncEntry[] {
  const source = raw as { projects?: unknown } | undefined;
  const list = Array.isArray(source?.projects) ? source.projects : [];
  const out: RemoteSyncEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.id)) continue;
    out.push({
      id: value.id,
      name: typeof value.name === 'string' ? value.name : '',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      hash: typeof value.hash === 'string' ? value.hash : '',
    });
  }
  return out;
}

/** 把云端项目写成本机文件 + 索引记录；返回新的索引与内容哈希 */
async function applyRemote(
  id: string,
  json: string,
  index: LibraryIndex,
): Promise<{ index: LibraryIndex; hash: string } | null> {
  let project;
  try {
    project = deserializeProject(json);
  } catch {
    return null;
  }
  const normalized = project.id === id ? project : { ...project, id };
  const text = serializeProject(normalized);
  await writeProjectFile(id, text);
  const previous = index.projects.find((meta) => meta.id === id) ?? null;
  return { index: upsertMeta(index, metaFromProject(normalized, previous)), hash: hashText(text) };
}

/** 「两个都留」：把云端那一版另存成一个新项目，不覆盖本机 */
async function importRemoteCopy(json: string, index: LibraryIndex): Promise<LibraryIndex> {
  let source;
  try {
    source = deserializeProject(json);
  } catch {
    return index;
  }
  const now = new Date().toISOString();
  const copy = {
    ...source,
    id: newId('proj'),
    name: `${source.name}（云端副本）`,
    createdAt: now,
    updatedAt: now,
    sampleRevision: undefined,
  };
  await writeProjectFile(copy.id, serializeProject(copy));
  return upsertMeta(index, metaFromProject(copy));
}

// ---------- 主流程 ----------

interface PullResponse {
  files?: { id?: string; json?: string | null }[];
}

interface BackupResponse {
  count?: number;
  uploaded?: number;
}

async function uploadTexts(
  api: NonNullable<ReturnType<typeof bridge>>,
  ids: string[],
  snapshot: LocalSnapshot,
): Promise<{ uploaded: number; count: number | null }> {
  const items: { id: string; name: string; updatedAt: string; hash: string; json: string }[] = [];
  for (const id of ids) {
    const json = snapshot.texts.get(id);
    const hash = snapshot.hashes.get(id);
    if (!json || !hash) continue;
    const entry = snapshot.entries.find((item) => item.id === id);
    items.push({ id, name: entry?.name ?? '', updatedAt: entry?.updatedAt ?? '', hash, json });
  }
  if (items.length === 0) return { uploaded: 0, count: null };
  const result = (await api.cloudCall('backup', { items }, { timeout: 120_000 })) as BackupResponse | undefined;
  return { uploaded: items.length, count: typeof result?.count === 'number' ? result.count : null };
}

/** 完整同步一轮：读清单 → 判断 → 拉取 → 上传 → 落基线 */
export async function syncNow(reason = 'manual'): Promise<void> {
  void reason;
  const api = bridge();
  const uid = signedInUserId();
  if (!api?.cloudCall || !uid) return;
  if (running) {
    queued = true;
    return;
  }

  running = true;
  useCloudSync.setState({ syncing: true, error: null });

  try {
    const index = await loadLibrary();
    const snapshot = await readLocalEntries(index);
    const memory = loadMemory(uid);
    const remote = normalizeRemote(await api.cloudCall('manifest'));
    const plan = planSync(snapshot.entries, remote, memory);

    // 墓碑清理：离线时彻底删除的项目，云端对象还留着，下次同步顺手删掉，
    // 否则云端总数会一直比本机多。
    const ghosts = remote.filter((item) => memory.tombstones[item.id]).map((item) => item.id);
    if (ghosts.length > 0) {
      try {
        await api.cloudCall('backup', { items: [], remove: ghosts }, { timeout: 60_000 });
        for (const id of ghosts) {
          const at = remote.findIndex((item) => item.id === id);
          if (at >= 0) remote.splice(at, 1);
        }
      } catch {
        /* 清不掉不影响本轮同步，下次再试 */
      }
    }

    let nextIndex = index;
    const synced: { id: string; hash: string }[] = [];
    let downloaded = 0;

    // 1) 先拉：把云端新增 / 更新过的项目落成本机文件
    if (plan.download.length > 0) {
      const pulled = (await api.cloudCall('pull', { ids: plan.download }, { timeout: 120_000 })) as PullResponse | undefined;
      applying = true;
      try {
        for (const file of pulled?.files ?? []) {
          if (!file?.id || typeof file.json !== 'string') continue;
          const applied = await applyRemote(file.id, file.json, nextIndex);
          if (!applied) continue;
          nextIndex = applied.index;
          synced.push({ id: file.id, hash: applied.hash });
          downloaded += 1;
        }
        if (downloaded > 0) await saveIndex(nextIndex);
      } finally {
        applying = false;
      }
      if (downloaded > 0) notifyLibraryChanged();
    }

    // 2) 再传：本机新增 / 改过的项目
    const uploadedResult = await uploadTexts(api, plan.upload, snapshot);
    for (const id of plan.upload) {
      const hash = snapshot.hashes.get(id);
      if (hash) synced.push({ id, hash });
    }

    // 3) 已经一致的项目也补一条基线，避免下次重新判定
    for (const id of plan.inSync) {
      const hash = snapshot.hashes.get(id);
      if (hash && !synced.some((item) => item.id === id)) synced.push({ id, hash });
    }

    const at = new Date().toISOString();
    saveMemory(uid, rememberSynced(memory, synced, at));

    // 云端总数：以清单为底，加上这次新上传的，减掉这次没处理的（不可能有删除路径）
    const remoteCount = uploadedResult.count ?? remote.length;

    useCloudSync.setState({
      syncing: false,
      count: remoteCount,
      uploaded: uploadedResult.uploaded,
      downloaded,
      at,
      error: null,
      conflicts: plan.conflicts,
      conflictsOpen: plan.conflicts.length > 0,
    });
  } catch (error) {
    useCloudSync.setState({
      syncing: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
    lastRun = Date.now();
    if (queued) {
      queued = false;
      scheduleSync();
    }
  }
}

/** 排队一次同步：本地改动很密集时只跑一次 */
export function scheduleSync(): void {
  if (!signedInUserId()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow('local-change');
  }, DEBOUNCE_MS);
}

// ---------- 冲突处理 ----------

/** 用户在冲突弹窗里做完选择后调用 */
export async function resolveConflicts(choices: Record<string, ConflictChoice>): Promise<void> {
  const api = bridge();
  const uid = signedInUserId();
  if (!api?.cloudCall || !uid) return;

  const list = useCloudSync.getState().conflicts;
  if (list.length === 0) return;

  useCloudSync.setState({ resolving: true, error: null });
  try {
    const index = await loadLibrary();
    const snapshot = await readLocalEntries(index);
    const memory = loadMemory(uid);
    let nextIndex = index;
    const synced: { id: string; hash: string }[] = [];
    const uploadIds: string[] = [];
    const downloadIds: string[] = [];
    const copyFrom: string[] = [];

    for (const conflict of list) {
      const choice = choices[conflict.id];
      if (!choice) continue;
      if (choice === 'remote') downloadIds.push(conflict.id);
      else {
        uploadIds.push(conflict.id);
        if (choice === 'both') copyFrom.push(conflict.id);
      }
    }

    // 选「用云端」的直接覆盖本机
    if (downloadIds.length > 0) {
      const pulled = (await api.cloudCall('pull', { ids: downloadIds }, { timeout: 120_000 })) as PullResponse | undefined;
      applying = true;
      try {
        for (const file of pulled?.files ?? []) {
          if (!file?.id || typeof file.json !== 'string') continue;
          const applied = await applyRemote(file.id, file.json, nextIndex);
          if (!applied) continue;
          nextIndex = applied.index;
          synced.push({ id: file.id, hash: applied.hash });
        }
      } finally {
        applying = false;
      }
    }

    // 选「保留本机」/「两个都留」的先上传本机版本
    if (uploadIds.length > 0) {
      await uploadTexts(api, uploadIds, snapshot);
      for (const id of uploadIds) {
        const hash = snapshot.hashes.get(id);
        if (hash) synced.push({ id, hash });
      }
    }

    // 「两个都留」再把云端版本存成副本
    if (copyFrom.length > 0) {
      const pulled = (await api.cloudCall('pull', { ids: copyFrom }, { timeout: 120_000 })) as PullResponse | undefined;
      applying = true;
      try {
        for (const file of pulled?.files ?? []) {
          if (!file || typeof file.json !== 'string') continue;
          nextIndex = await importRemoteCopy(file.json, nextIndex);
        }
        await saveIndex(nextIndex);
      } finally {
        applying = false;
      }
    } else if (synced.length > 0) {
      await saveIndex(nextIndex);
    }

    saveMemory(uid, rememberSynced(memory, synced, new Date().toISOString()));
    useCloudSync.setState({ resolving: false, conflicts: [], conflictsOpen: false });
    if (copyFrom.length > 0 || downloadIds.length > 0) notifyLibraryChanged();
    // 收尾再对一次账，把副本也传上去
    void syncNow('resolve');
  } catch (error) {
    useCloudSync.setState({
      resolving: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 稍后处理：只收起弹窗，不改变任何数据 */
export function dismissConflicts(): void {
  useCloudSync.setState({ conflictsOpen: false });
}

/** 重新打开冲突弹窗 */
export function openConflicts(): void {
  if (useCloudSync.getState().conflicts.length > 0) useCloudSync.setState({ conflictsOpen: true });
}

// ---------- 生命周期 ----------

/** 彻底删除项目：登记墓碑 + 清掉云端对象，避免下次同步又把它拉回来 */
async function forgetProject(id: string): Promise<void> {
  const purged = readPurged();
  purged[id] = new Date().toISOString();
  writePurged(purged);

  const uid = signedInUserId();
  if (uid) {
    const memory = loadMemory(uid);
    delete memory.entries[id];
    saveMemory(uid, memory);
  }
  const api = bridge();
  if (!api?.cloudCall || !signedInUserId()) return;
  try {
    await api.cloudCall('backup', { items: [], remove: [id] });
  } catch {
    /* 离线时留在墓碑里，下次联网同步不会再拉回来 */
  }
}

/** 应用启动挂一次；返回解绑函数 */
export function initCloudSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const unsubscribe = useCloud.subscribe((state, previous) => {
    const was = previous?.status;
    if (state.status === 'signed-in' && was !== 'signed-in') void syncNow('login');
    if (state.status !== 'signed-in' && was === 'signed-in') useCloudSync.getState().reset();
  });

  const onSaved = (event: Event) => {
    // 应用云端项目时也会写盘，这时不能再触发一轮同步
    if (applying) return;
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) scheduleSync();
  };
  const onLibraryChanged = () => {
    if (applying) return;
    scheduleSync();
  };
  const onPurged = (event: Event) => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) void forgetProject(id);
  };
  const onFocus = () => {
    if (Date.now() - lastRun < FOCUS_THROTTLE_MS) return;
    void syncNow('focus');
  };
  // 换了云端地址：旧云端的进度、冲突、节流时间都作废，等重新登录后再同步
  const onEndpointChanged = () => {
    running = false;
    queued = false;
    lastRun = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    useCloudSync.getState().reset();
  };

  window.addEventListener(PROJECT_SAVED_EVENT, onSaved);
  window.addEventListener(LIBRARY_CHANGED, onLibraryChanged);
  window.addEventListener(PROJECT_PURGED_EVENT, onPurged);
  window.addEventListener('focus', onFocus);
  window.addEventListener(ENDPOINT_CHANGED_EVENT, onEndpointChanged);

  const poll = window.setInterval(() => {
    if (document.hidden) return;
    void syncNow('poll');
  }, POLL_MS);

  return () => {
    unsubscribe();
    window.removeEventListener(PROJECT_SAVED_EVENT, onSaved);
    window.removeEventListener(LIBRARY_CHANGED, onLibraryChanged);
    window.removeEventListener(PROJECT_PURGED_EVENT, onPurged);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener(ENDPOINT_CHANGED_EVENT, onEndpointChanged);
    window.clearInterval(poll);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** 供界面使用：当前是否有未删除项目（空库时不显示同步入口） */
export function hasLocalProjects(index: LibraryIndex | null): boolean {
  return Boolean(index && activeProjects(index).length > 0);
}
