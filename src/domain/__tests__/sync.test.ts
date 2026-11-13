import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEMORY,
  hashText,
  normalizeMemory,
  planSync,
  rememberPurged,
  rememberSynced,
  type LocalSyncEntry,
  type RemoteSyncEntry,
  type SyncMemory,
} from '../sync';

const T1 = '2026-11-13T01:00:00.000Z';
const T2 = '2026-11-13T02:00:00.000Z';
const T3 = '2026-11-13T03:00:00.000Z';

function local(id: string, hash: string, updatedAt: string, deleted = false): LocalSyncEntry {
  return { id, name: `项目 ${id}`, updatedAt, hash, deleted };
}

function remote(id: string, hash: string, updatedAt: string): RemoteSyncEntry {
  return { id, name: `项目 ${id}`, updatedAt, hash };
}

function memory(entries: Record<string, string>, tombstones: Record<string, string> = {}): SyncMemory {
  const map: SyncMemory['entries'] = {};
  for (const [id, hash] of Object.entries(entries)) map[id] = { hash, at: T1 };
  return { entries: map, tombstones };
}

describe('内容哈希', () => {
  it('同样内容同样哈希，改一个字符就变', () => {
    expect(hashText('{"a":1}')).toBe(hashText('{"a":1}'));
    expect(hashText('{"a":1}')).not.toBe(hashText('{"a":2}'));
    expect(hashText('')).toHaveLength(10);
  });
});

describe('同步计划', () => {
  it('只有本机有 → 上传', () => {
    const plan = planSync([local('a', 'h1', T1)], [], EMPTY_MEMORY);
    expect(plan.upload).toEqual(['a']);
    expect(plan.download).toEqual([]);
  });

  it('只有云端有 → 下载（换电脑后把项目拉回来）', () => {
    const plan = planSync([], [remote('a', 'h1', T1)], EMPTY_MEMORY);
    expect(plan.download).toEqual(['a']);
    expect(plan.upload).toEqual([]);
  });

  it('两边哈希一致 → 什么都不做', () => {
    const plan = planSync([local('a', 'h1', T1)], [remote('a', 'h1', T1)], memory({ a: 'h1' }));
    expect(plan.inSync).toEqual(['a']);
    expect(plan.upload).toEqual([]);
    expect(plan.download).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('本机改过、云端没改 → 上传', () => {
    const plan = planSync([local('a', 'h2', T2)], [remote('a', 'h1', T1)], memory({ a: 'h1' }));
    expect(plan.upload).toEqual(['a']);
    expect(plan.conflicts).toEqual([]);
  });

  it('云端改过、本机没改 → 下载', () => {
    const plan = planSync([local('a', 'h1', T1)], [remote('a', 'h2', T2)], memory({ a: 'h1' }));
    expect(plan.download).toEqual(['a']);
    expect(plan.conflicts).toEqual([]);
  });

  it('两边都改过 → 冲突，绝不自动覆盖', () => {
    const plan = planSync([local('a', 'h2', T2)], [remote('a', 'h3', T3)], memory({ a: 'h1' }));
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ id: 'a', localHash: 'h2', remoteHash: 'h3' });
    expect(plan.upload).toEqual([]);
    expect(plan.download).toEqual([]);
  });

  it('第一次同步没有基线：按更新时间判断新旧', () => {
    const newerLocal = planSync([local('a', 'h2', T2)], [remote('a', 'h1', T1)], EMPTY_MEMORY);
    expect(newerLocal.upload).toEqual(['a']);

    const newerRemote = planSync([local('a', 'h1', T1)], [remote('a', 'h2', T2)], EMPTY_MEMORY);
    expect(newerRemote.download).toEqual(['a']);
  });

  it('第一次同步且时间相同、内容不同 → 交给用户', () => {
    const plan = planSync([local('a', 'h1', T1)], [remote('a', 'h2', T1)], EMPTY_MEMORY);
    expect(plan.conflicts).toHaveLength(1);
  });

  it('旧版清单没有哈希时按更新时间决定，并补上哈希', () => {
    const plan = planSync([local('a', 'h2', T2)], [remote('a', '', T1)], EMPTY_MEMORY);
    expect(plan.upload).toEqual(['a']);
  });

  it('回收站里的项目不参与同步', () => {
    const plan = planSync([local('a', '', T1, true)], [remote('a', 'h1', T1)], memory({ a: 'h1' }));
    expect(plan.skipped).toEqual([{ id: 'a', reason: 'trashed' }]);
    expect(plan.download).toEqual([]);
    expect(plan.upload).toEqual([]);
  });

  it('本机彻底删除过的项目不会从云端复活', () => {
    const plan = planSync([], [remote('a', 'h1', T1)], memory({}, { a: T1 }));
    expect(plan.skipped).toEqual([{ id: 'a', reason: 'tombstone' }]);
    expect(plan.download).toEqual([]);
  });

  it('多个项目各走各的路，互不影响', () => {
    const plan = planSync(
      [local('a', 'h2', T2), local('b', 'h1', T1), local('c', 'h2', T2), local('d', '', T1, true)],
      [remote('a', 'h1', T1), remote('b', 'h2', T2), remote('c', 'h3', T3), remote('e', 'h1', T1)],
      memory({ a: 'h1', b: 'h1', c: 'h1' }),
    );
    expect(plan.upload).toEqual(['a']);
    expect(plan.download).toEqual(['b', 'e']);
    expect(plan.conflicts.map((item) => item.id)).toEqual(['c']);
    expect(plan.skipped.map((item) => item.id)).toEqual(['d']);
  });
});

describe('同步记忆', () => {
  it('记下已对齐的哈希', () => {
    const next = rememberSynced(EMPTY_MEMORY, [{ id: 'a', hash: 'h1' }], T1);
    expect(next.entries.a).toEqual({ hash: 'h1', at: T1 });
  });

  it('空哈希不写，避免把坏数据当基线', () => {
    const next = rememberSynced(EMPTY_MEMORY, [{ id: 'a', hash: '' }], T1);
    expect(next.entries.a).toBeUndefined();
  });

  it('彻底删除时登记墓碑并清掉基线', () => {
    const next = rememberPurged(memory({ a: 'h1' }), 'a', T2);
    expect(next.entries.a).toBeUndefined();
    expect(next.tombstones.a).toBe(T2);
  });

  it('坏掉的记忆文件降级为空，不让同步崩掉', () => {
    expect(normalizeMemory(null)).toEqual({ entries: {}, tombstones: {} });
    expect(normalizeMemory({ entries: { a: { hash: 1 } } })).toEqual({ entries: {}, tombstones: {} });
    expect(normalizeMemory({ entries: { a: { hash: 'h', at: T1 } }, tombstones: { b: T2 } }))
      .toEqual({ entries: { a: { hash: 'h', at: T1 } }, tombstones: { b: T2 } });
  });
});
