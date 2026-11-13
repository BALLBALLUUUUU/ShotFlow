/** 项目库领域逻辑：纯函数，不依赖浏览器或 Electron，可独立单测 */
import type { Project, ProjectTag } from './types';
import { normalizeTag } from './tags';

export const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  shotCount: number;
  dayCount: number;
  /** 非 null 表示在回收站中（软删除） */
  deletedAt: string | null;
  /**
   * 项目里的拍摄日（YYYY-MM-DD，升序去重）。
   * 供「个人设置 → 拍摄提醒」使用；旧索引没有这个字段时为 undefined，读取时回填一次。
   */
  shootDates?: string[];
  /** 示例项目的内建内容版本号；普通项目没有这个字段 */
  sampleRevision?: number;
  /** 颜色标签（null = 未标注）。项目文件是唯一来源，这里只是索引副本，便于筛选不读盘 */
  tag: ProjectTag | null;
}

export interface LibraryIndex {
  version: 1;
  /** 上次打开的项目；为 null 时启动进入项目库 */
  currentId: string | null;
  projects: ProjectMeta[];
}

export const EMPTY_LIBRARY: LibraryIndex = { version: 1, currentId: null, projects: [] };

export type SortMode = 'updated' | 'created' | 'name';

/** 新建项目必须是完全空白的：没有任何镜头、场次、拍摄日、串联单或通告 */
export function isBlankProject(project: Project): boolean {
  return project.shots.length === 0
    && project.scenes.length === 0
    && project.days.length === 0
    && project.rundown.length === 0
    && project.notices.length === 0;
}

export function metaFromProject(project: Project, previous?: ProjectMeta | null): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    shotCount: project.shots.length,
    dayCount: project.days.length,
    deletedAt: previous?.deletedAt ?? null,
    shootDates: projectShootDates(project),
    sampleRevision: project.sampleRevision,
    tag: normalizeTag(project.tag),
  };
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 项目里所有拍摄日：拍摄计划里的日期 + 片头信息的拍摄日期。
 * 只认 YYYY-MM-DD，避免把「待定」「11月20日」这类自由文本当成日期。
 */
export function projectShootDates(project: Project): string[] {
  const dates = new Set<string>();
  for (const day of project.days) {
    if (DATE_KEY_RE.test(day.date)) dates.add(day.date);
  }
  const exportDate = project.exportInfo?.shootDate ?? '';
  if (DATE_KEY_RE.test(exportDate)) dates.add(exportDate);
  return [...dates].sort();
}

export function upsertMeta(index: LibraryIndex, meta: ProjectMeta): LibraryIndex {
  const found = index.projects.some((item) => item.id === meta.id);
  return {
    ...index,
    projects: found
      ? index.projects.map((item) => (item.id === meta.id ? meta : item))
      : [...index.projects, meta],
  };
}

export function removeMeta(index: LibraryIndex, id: string): LibraryIndex {
  return {
    ...index,
    currentId: index.currentId === id ? null : index.currentId,
    projects: index.projects.filter((item) => item.id !== id),
  };
}

export function activeProjects(index: LibraryIndex): ProjectMeta[] {
  return index.projects.filter((item) => item.deletedAt === null);
}

export function trashedProjects(index: LibraryIndex): ProjectMeta[] {
  return index.projects
    .filter((item) => item.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export function filterProjects(list: ProjectMeta[], query: string): ProjectMeta[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return list;
  return list.filter((item) => item.name.toLocaleLowerCase().includes(keyword));
}

export function sortProjects(list: ProjectMeta[], mode: SortMode): ProjectMeta[] {
  const sorted = [...list];
  if (mode === 'name') return sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const key = mode === 'created' ? 'createdAt' : 'updatedAt';
  return sorted.sort((a, b) => b[key].localeCompare(a[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** 防御性反序列化：索引文件损坏/被手改时降级为可用状态，不让整个项目库打不开 */
export function normalizeIndex(raw: unknown): LibraryIndex {
  if (!isRecord(raw) || !Array.isArray(raw.projects)) return { ...EMPTY_LIBRARY, projects: [] };
  const now = new Date().toISOString();
  const projects: ProjectMeta[] = [];
  for (const item of raw.projects) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    if (!SAFE_ID.test(id)) continue;
    if (projects.some((meta) => meta.id === id)) continue;
    projects.push({
      id,
      name: text(item.name, '未命名项目') || '未命名项目',
      createdAt: text(item.createdAt, now),
      updatedAt: text(item.updatedAt, now),
      shotCount: count(item.shotCount),
      dayCount: count(item.dayCount),
      deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : null,
      // 缺失时保持 undefined，让启动流程知道这条需要回填
      shootDates: Array.isArray(item.shootDates)
        ? [...new Set(item.shootDates.filter((date): date is string => typeof date === 'string' && DATE_KEY_RE.test(date)))].sort().slice(0, 200)
        : undefined,
      sampleRevision: typeof item.sampleRevision === 'number' && Number.isFinite(item.sampleRevision) && item.sampleRevision >= 0
        ? item.sampleRevision
        : undefined,
      tag: normalizeTag(item.tag),
    });
  }
  const wanted = text(raw.currentId);
  const currentId = projects.some((meta) => meta.id === wanted && meta.deletedAt === null) ? wanted : null;
  return { version: 1, currentId, projects };
}
