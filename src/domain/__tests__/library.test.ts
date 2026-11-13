import { describe, expect, it } from 'vitest';
import { createEmptyProject, createSampleProject, createShot, deserializeProject, serializeProject } from '../project';
import {
  EMPTY_LIBRARY,
  activeProjects,
  filterProjects,
  isBlankProject,
  metaFromProject,
  normalizeIndex,
  removeMeta,
  sortProjects,
  trashedProjects,
  upsertMeta,
  type LibraryIndex,
} from '../library';

describe('空白项目判定', () => {
  it('createEmptyProject 完全空白，不含任何示例数据', () => {
    const project = createEmptyProject('新项目');
    expect(isBlankProject(project)).toBe(true);
    expect(project.shots).toHaveLength(0);
    expect(project.scenes).toHaveLength(0);
    expect(project.days).toHaveLength(0);
    expect(project.rundown).toHaveLength(0);
    expect(project.notices).toHaveLength(0);
  });

  it('示例项目不是空白，序列化往返后仍不是空白', () => {
    const sample = createSampleProject();
    expect(isBlankProject(sample)).toBe(false);
    expect(isBlankProject(deserializeProject(serializeProject(sample)))).toBe(false);
  });

  it('新建项目只加行后就不再算空白，但依然没有示例场次与通告', () => {
    const project = createEmptyProject();
    project.shots.push(createShot(1));
    expect(isBlankProject(project)).toBe(false);
    expect(project.scenes).toHaveLength(0);
  });
});

describe('索引纯函数', () => {
  const base: LibraryIndex = { ...EMPTY_LIBRARY, projects: [] };

  function meta(id: string, name: string, updatedAt: string, deletedAt: string | null = null) {
    return {
      id,
      name,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt,
      shotCount: 0,
      dayCount: 0,
      deletedAt,
      tag: null,
    };
  }

  it('upsert 新增与覆盖，且不修改原对象', () => {
    const first = upsertMeta(base, meta('a', '项目 A', '2026-01-02T00:00:00.000Z'));
    expect(first.projects).toHaveLength(1);
    const second = upsertMeta(first, meta('a', '改名 A', '2026-01-03T00:00:00.000Z'));
    expect(second.projects).toHaveLength(1);
    expect(second.projects[0]!.name).toBe('改名 A');
    expect(first.projects[0]!.name).toBe('项目 A');
    expect(base.projects).toHaveLength(0);
  });

  it('metaFromProject 继承软删除状态，避免编辑把回收站项目复活', () => {
    const project = createEmptyProject('被删项目');
    const previous = meta(project.id, project.name, project.updatedAt, '2026-02-01T00:00:00.000Z');
    expect(metaFromProject(project, previous).deletedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(metaFromProject(project).deletedAt).toBeNull();
  });

  it('active / trashed 分流，回收站按删除时间倒序', () => {
    const index: LibraryIndex = {
      ...base,
      projects: [
        meta('a', 'A', '2026-01-01T00:00:00.000Z'),
        meta('b', 'B', '2026-01-02T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
        meta('c', 'C', '2026-01-03T00:00:00.000Z', '2026-03-03T00:00:00.000Z'),
      ],
    };
    expect(activeProjects(index).map((item) => item.id)).toEqual(['a']);
    expect(trashedProjects(index).map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('remove 删除条目并清空指向它的 currentId', () => {
    const index: LibraryIndex = { ...base, currentId: 'a', projects: [meta('a', 'A', '2026-01-01'), meta('b', 'B', '2026-01-02')] };
    const next = removeMeta(index, 'a');
    expect(next.projects.map((item) => item.id)).toEqual(['b']);
    expect(next.currentId).toBeNull();
    expect(next.version).toBe(1);
  });

  it('搜索忽略大小写，排序支持更新时间与名称', () => {
    const list = [
      meta('a', '咖啡馆短片', '2026-01-01T00:00:00.000Z'),
      meta('b', 'Alpha 广告', '2026-03-01T00:00:00.000Z'),
      meta('c', '咖啡豆特写', '2026-02-01T00:00:00.000Z'),
    ];
    expect(filterProjects(list, '咖啡').map((item) => item.id)).toEqual(['a', 'c']);
    expect(filterProjects(list, 'ALPHA').map((item) => item.id)).toEqual(['b']);
    expect(sortProjects(list, 'updated').map((item) => item.id)).toEqual(['b', 'c', 'a']);

    // 名称排序用纯拉丁字母样本，避免断言依赖 zh-CN 的 ICU 排序实现
    const latin = [meta('1', 'Beta', '2026-01-01'), meta('2', 'Gamma', '2026-01-01'), meta('3', 'Alpha', '2026-01-01')];
    expect(sortProjects(latin, 'name').map((item) => item.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('索引防御性反序列化', () => {
  it('空值、坏结构、非法 ID、重复 ID 都能降级', () => {
    expect(normalizeIndex(null)).toEqual({ version: 1, currentId: null, projects: [] });
    expect(normalizeIndex({ projects: 'bad' }).projects).toEqual([]);
    const raw = {
      currentId: '../etc/passwd',
      projects: [
        { id: 'ok_1', name: '正常', shotCount: 3, dayCount: 1 },
        { id: '../evil', name: '路径穿越' },
        { id: 'ok_1', name: '重复' },
        { id: 123 },
        null,
      ],
    };
    const index = normalizeIndex(raw);
    expect(index.projects).toHaveLength(1);
    expect(index.projects[0]!.id).toBe('ok_1');
    expect(index.projects[0]!.shotCount).toBe(3);
    expect(index.currentId).toBeNull();
  });

  it('currentId 指向回收站项目时会被清空', () => {
    const index = normalizeIndex({
      currentId: 'a',
      projects: [{ id: 'a', name: 'A', deletedAt: '2026-03-01T00:00:00.000Z' }],
    });
    expect(index.currentId).toBeNull();
  });
});
