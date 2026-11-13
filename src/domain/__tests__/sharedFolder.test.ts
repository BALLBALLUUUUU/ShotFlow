import { describe, expect, it } from 'vitest';
import {
  canPublish,
  compareVersions,
  normalizeSharedIndex,
  sharedFileName,
  upsertSharedEntry,
  type SharedEntry,
} from '../sharedFolder';

const entry: SharedEntry = {
  projectId: 'proj_a',
  name: '咖啡短片',
  fileName: 'proj_a.shotflow',
  updatedAt: '2026-11-11T10:00:00.000Z',
  exportedAt: '2026-11-11T10:05:00.000Z',
  author: '球球',
  contentHash: 'aaaaaaaa',
  shotCount: 12,
  dayCount: 1,
};

describe('共享索引防御性解析', () => {
  it('空输入降级为空索引', () => {
    expect(normalizeSharedIndex(null)).toEqual({ version: 1, updatedAt: '', projects: [] });
    expect(normalizeSharedIndex({ projects: 'bad' })).toEqual({ version: 1, updatedAt: '', projects: [] });
  });

  it('丢弃非法项目 ID、危险文件名与重复项', () => {
    const result = normalizeSharedIndex({
      version: 1,
      projects: [
        entry,
        { ...entry, projectId: '../evil' },
        { ...entry, projectId: 'proj_b', fileName: '../../outside.shotflow' },
        { ...entry, projectId: 'proj_a', name: '重复项' },
        'not an object',
      ],
    });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe('咖啡短片');
  });

  it('缺字段补默认，不抛异常', () => {
    const result = normalizeSharedIndex({ projects: [{ projectId: 'proj_c', fileName: 'proj_c.shotflow' }] });
    expect(result.projects[0]).toMatchObject({ name: '未命名项目', author: '', shotCount: 0, contentHash: '' });
  });
});

describe('共享条目维护', () => {
  it('新增与更新按 projectId 去重', () => {
    const added = upsertSharedEntry({ version: 1, updatedAt: '', projects: [] }, entry);
    expect(added.projects).toHaveLength(1);
    expect(added.updatedAt).not.toBe('');
    const updated = upsertSharedEntry(added, { ...entry, name: '改名了', shotCount: 20 });
    expect(updated.projects).toHaveLength(1);
    expect(updated.projects[0]).toMatchObject({ name: '改名了', shotCount: 20 });
  });

  it('文件名只接受安全 ID', () => {
    expect(sharedFileName('proj_abc-123')).toBe('proj_abc-123.shotflow');
    expect(() => sharedFileName('../etc')).toThrow(/非法/);
  });
});

describe('版本判定与覆盖保护', () => {
  const remote = { updatedAt: entry.updatedAt, contentHash: entry.contentHash };

  it('无远端记录 → 新项目', () => {
    expect(compareVersions(remote, null)).toBe('new');
    expect(canPublish('new')).toBe(true);
  });

  it('指纹一致 → 无变化，可安全重发', () => {
    expect(compareVersions(remote, remote)).toBe('identical');
    expect(canPublish('identical')).toBe(true);
  });

  it('本地更新可发布；远端更新禁止自动发布', () => {
    expect(compareVersions({ ...remote, updatedAt: '2026-11-11T12:00:00.000Z', contentHash: 'bbbbbbbb' }, remote)).toBe('local-newer');
    expect(canPublish('local-newer')).toBe(true);
    expect(compareVersions({ ...remote, updatedAt: '2026-11-11T08:00:00.000Z', contentHash: 'cccccccc' }, remote)).toBe('remote-newer');
    expect(canPublish('remote-newer')).toBe(false);
    expect(canPublish('same-time-different')).toBe(false);
  });

  it('时间相同但内容不同 → 必须人工决定', () => {
    expect(compareVersions({ ...remote, contentHash: 'dddddddd' }, remote)).toBe('same-time-different');
  });

  it('时间非法也不静默判为可发布', () => {
    expect(compareVersions({ updatedAt: 'bad', contentHash: 'x' }, remote)).toBe('same-time-different');
  });
});
