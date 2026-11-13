/**
 * 多项目存储适配层。
 * 桌面端：每个项目一个本地 JSON + 一个索引文件（Electron IPC，原子写）。
 * 浏览器/PWA/Capacitor：localStorage 等价实现。
 * 两条通道对上层暴露同一组 API，UI 不感知运行平台。
 */
import {
  SAFE_ID,
  metaFromProject,
  normalizeIndex,
  projectShootDates,
  removeMeta,
  upsertMeta,
  type LibraryIndex,
} from '@/domain/library';
import {
  createEmptyProject,
  createSampleProject,
  deserializeProject,
  newId,
  serializeProject,
} from '@/domain/project';
import { needsSampleUpgrade, upgradedSample } from '@/domain/sampleUpgrade';
import { normalizeTag } from '@/domain/tags';
import type { Project, ProjectTag } from '@/domain/types';

const INDEX_KEY = 'shotflow.library.v1';
const projectKey = (id: string) => `shotflow.project.${id}`;

function bridge() {
  return window.electronAPI;
}

function assertId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error('非法项目 ID');
}

function parse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadIndex(): Promise<LibraryIndex> {
  const api = bridge();
  if (api?.libraryLoadIndex) return normalizeIndex(parse(await api.libraryLoadIndex()));
  return normalizeIndex(parse(window.localStorage.getItem(INDEX_KEY)));
}

async function saveIndex(index: LibraryIndex): Promise<void> {
  const text = JSON.stringify(index);
  const api = bridge();
  if (api?.librarySaveIndex) {
    await api.librarySaveIndex(text);
    return;
  }
  window.localStorage.setItem(INDEX_KEY, text);
}

async function readProject(id: string): Promise<string | null> {
  assertId(id);
  const api = bridge();
  if (api?.libraryReadProject) return api.libraryReadProject(id);
  return window.localStorage.getItem(projectKey(id));
}

async function writeProject(id: string, text: string): Promise<void> {
  assertId(id);
  const api = bridge();
  if (api?.libraryWriteProject) {
    await api.libraryWriteProject({ id, text });
    notifyProjectSaved(id);
    return;
  }
  window.localStorage.setItem(projectKey(id), text);
  notifyProjectSaved(id);
}

/** 通知云端备份：只在这里派发，保证所有落盘路径都会触发 */
function notifyProjectSaved(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('shotflow:project-saved', { detail: { id } }));
}

async function deleteProjectFile(id: string): Promise<void> {
  assertId(id);
  const api = bridge();
  if (api?.libraryDeleteProject) {
    await api.libraryDeleteProject(id);
    return;
  }
  window.localStorage.removeItem(projectKey(id));
}

export { loadIndex as loadLibrary, saveIndex, writeProject as writeProjectFile };

/**
 * 旧索引没有 shootDates 时按需回填一次，供个人设置里的拍摄提醒使用。
 * 只读缺失项，读不到的（文件被删）就跳过，不影响项目库打开。
 */
async function backfillShootDates(index: LibraryIndex): Promise<LibraryIndex> {
  const missing = index.projects.filter((meta) => meta.deletedAt === null && !Array.isArray(meta.shootDates));
  if (missing.length === 0) return index;
  let next = index;
  let changed = false;
  for (const meta of missing) {
    const project = await loadProjectById(meta.id).catch(() => null);
    if (!project) continue;
    next = {
      ...next,
      projects: next.projects.map((item) => (
        item.id === meta.id ? { ...item, shootDates: projectShootDates(project) } : item
      )),
    };
    changed = true;
  }
  if (!changed) return index;
  await saveIndex(next);
  return next;
}

/** 启动时升级示例项目后给用户的一次性提示，读取后清空 */
let pendingSampleNotice: string | null = null;

/**
 * 示例项目升级：旧版示例（没有图片、备注等）在启动时按最新内容重建。
 * 保留原项目 id / 名称 / 创建时间，项目库里不会多出一条；
 * 覆盖前把旧文件另存为 backup-* 备份，万一用户改过示例也能找回。
 * 只处理未删除记录，回收站里的示例保持原样。
 */
async function upgradeSampleProjects(index: LibraryIndex): Promise<LibraryIndex> {
  const candidates = index.projects.filter((meta) => (
    meta.deletedAt === null
    && (meta.sampleRevision !== undefined || meta.name.startsWith('示例 ·'))
  ));
  if (candidates.length === 0) return index;

  let next = index;
  let changed = false;
  for (const meta of candidates) {
    const existing = await loadProjectById(meta.id).catch(() => null);
    if (!existing || !needsSampleUpgrade(existing)) continue;

    try {
      const backupId = `backup-${meta.id}-${Date.now().toString(36)}`;
      await writeProject(backupId, serializeProject(existing));
    } catch {
      // 备份失败不阻断升级：示例内容随时可以用 createSampleProject 重新生成
    }

    const upgraded = upgradedSample(existing);
    await writeProject(upgraded.id, serializeProject(upgraded));
    next = upsertMeta(next, metaFromProject(upgraded, meta));
    changed = true;
    pendingSampleNotice = `示例项目「${upgraded.name}」已更新到最新内容（${upgraded.shots.length} 个镜头 · ${upgraded.shots.filter((shot) => shot.frame).length} 张分镜图）`;
  }
  if (!changed) return next;
  await saveIndex(next);
  return next;
}

/** 启动时升级示例项目后给用户的一次性提示，读取后清空 */
export function consumeSampleUpgradeNotice(): string | null {
  const message = pendingSampleNotice;
  pendingSampleNotice = null;
  return message;
}

/**
 * 首次启动把旧版单项目 autosave 迁移成项目库里的第一条记录，避免升级后数据丢失。
 * 不会凭空生成示例项目。
 */
export async function ensureLibrary(): Promise<LibraryIndex> {
  const upgraded = await upgradeSampleProjects(await loadIndex());
  const index = await backfillShootDates(upgraded);
  if (index.projects.length > 0) return index;
  const api = bridge();
  if (!api?.loadAutosave) return index;
  const text = await api.loadAutosave().catch(() => null);
  if (!text) return index;
  try {
    const project = deserializeProject(text);
    await writeProject(project.id, serializeProject(project));
    const migrated: LibraryIndex = {
      ...upsertMeta(index, metaFromProject(project)),
      currentId: project.id,
    };
    await saveIndex(migrated);
    return migrated;
  } catch {
    return index;
  }
}

/** 新建项目：永远从 createEmptyProject 开始，绝不带示例镜头/场次/通告 */
export async function createBlankProject(name: string): Promise<{ project: Project; index: LibraryIndex }> {
  const project = createEmptyProject(name.trim() || '未命名项目');
  if (!SAFE_ID.test(project.id)) throw new Error('项目 ID 生成失败');
  await writeProject(project.id, serializeProject(project));
  const index = await loadIndex();
  const next: LibraryIndex = { ...upsertMeta(index, metaFromProject(project)), currentId: project.id };
  await saveIndex(next);
  return { project, index: next };
}

/** 显式载入演示项目（仅项目库空态入口调用，新建流程不会走这里） */
export async function createDemoProject(): Promise<{ project: Project; index: LibraryIndex }> {
  const project = createSampleProject();
  await writeProject(project.id, serializeProject(project));
  const index = await loadIndex();
  const next: LibraryIndex = { ...upsertMeta(index, metaFromProject(project)), currentId: project.id };
  await saveIndex(next);
  return { project, index: next };
}

export async function loadProjectById(id: string): Promise<Project | null> {
  const text = await readProject(id);
  if (!text) return null;
  try {
    return deserializeProject(text);
  } catch {
    return null;
  }
}

/** 编辑后按项目落盘，同时刷新索引里的镜头数/更新时间 */
export async function persistProject(project: Project): Promise<LibraryIndex> {
  await writeProject(project.id, serializeProject(project));
  const index = await loadIndex();
  const previous = index.projects.find((item) => item.id === project.id) ?? null;
  // 正在编辑的项目即当前项目，顺便修正索引指针，规避与 setCurrentProject 的写入竞态
  const next: LibraryIndex = { ...upsertMeta(index, metaFromProject(project, previous)), currentId: project.id };
  await saveIndex(next);
  return next;
}

export async function renameProjectRecord(id: string, name: string): Promise<LibraryIndex> {
  const project = await loadProjectById(id);
  const index = await loadIndex();
  const trimmed = name.trim();
  if (!project || !trimmed) return index;
  const renamed: Project = { ...project, name: trimmed, updatedAt: new Date().toISOString() };
  await writeProject(id, serializeProject(renamed));
  const previous = index.projects.find((item) => item.id === id) ?? null;
  const next = upsertMeta(index, metaFromProject(renamed, previous));
  await saveIndex(next);
  return next;
}

/**
 * 改颜色标签：写项目文件（标签随项目走）+ 同步索引副本。
 * 标签不算内容修改，不动 updatedAt，避免只换个颜色就把项目顶到「最近编辑」第一位。
 */
export async function setProjectTag(id: string, tag: ProjectTag | null): Promise<LibraryIndex> {
  const index = await loadIndex();
  const meta = index.projects.find((item) => item.id === id);
  if (!meta) return index;
  const project = await loadProjectById(id);
  if (!project) return index;
  const nextTag = normalizeTag(tag);
  // 项目文件是标签的唯一来源，索引只是副本；不一致时先修文件
  if (normalizeTag(project.tag) !== nextTag) {
    await writeProject(id, serializeProject({ ...project, tag: nextTag }));
  }
  if (meta.tag === nextTag) return index;
  const next = upsertMeta(index, { ...meta, tag: nextTag });
  await saveIndex(next);
  return next;
}

export async function duplicateProjectRecord(id: string): Promise<LibraryIndex> {
  const source = await loadProjectById(id);
  const index = await loadIndex();
  if (!source) return index;
  const timestamp = new Date().toISOString();
  const copy: Project = {
    ...source,
    id: newId('proj'),
    name: `${source.name} 副本`,
    createdAt: timestamp,
    updatedAt: timestamp,
    // 副本是用户自己的项目，不再跟随后续示例升级
    sampleRevision: undefined,
  };
  await writeProject(copy.id, serializeProject(copy));
  const next = upsertMeta(index, metaFromProject(copy));
  await saveIndex(next);
  return next;
}

export async function softDeleteProject(id: string): Promise<LibraryIndex> {
  const index = await loadIndex();
  const next: LibraryIndex = {
    ...index,
    currentId: index.currentId === id ? null : index.currentId,
    projects: index.projects.map((item) => (
      item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item
    )),
  };
  await saveIndex(next);
  return next;
}

export async function restoreProject(id: string): Promise<LibraryIndex> {
  const index = await loadIndex();
  const next: LibraryIndex = {
    ...index,
    projects: index.projects.map((item) => (item.id === id ? { ...item, deletedAt: null } : item)),
  };
  await saveIndex(next);
  return next;
}

export async function purgeProject(id: string): Promise<LibraryIndex> {
  await deleteProjectFile(id);
  const index = await loadIndex();
  const next = removeMeta(index, id);
  await saveIndex(next);
  // 彻底删除要通知云端：登记墓碑并清掉云端对象，否则下次同步会把项目又拉回来
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shotflow:project-purged', { detail: { id } }));
  }
  return next;
}

export async function setCurrentProject(id: string | null): Promise<LibraryIndex> {
  const index = await loadIndex();
  const next: LibraryIndex = { ...index, currentId: id };
  await saveIndex(next);
  return next;
}
