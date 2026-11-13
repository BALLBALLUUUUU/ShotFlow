import { describe, expect, it } from 'vitest';
import {
  appendShots,
  deleteShots,
  insertShotAfter,
  moveShot,
  renumberShots,
  updateShotField,
} from '../shots';
import { createEmptyProject, serializeProject, deserializeProject } from '../project';
import { addCustomColumn } from '../schema';

describe('行无限制增删插移', () => {
  it('一次追加 5000 行，镜号与顺序连续且不修改原数组', () => {
    const original = appendShots([], 3);
    const result = appendShots(original, 5000);
    expect(result).toHaveLength(5003);
    expect(original).toHaveLength(3);
    expect(result.slice(0, 3).map((shot) => shot.shotNo)).toEqual([1, 2, 3]);
    expect(result.at(-1)?.shotNo).toBe(5003);
    expect(result.at(-1)?.sortIndex).toBe(5002);
    expect(new Set(result.map((shot) => shot.id)).size).toBe(result.length);
  });

  it('非法数量直接返回原数组', () => {
    const shots = appendShots([], 2);
    expect(appendShots(shots, 0)).toBe(shots);
    expect(appendShots(shots, -10)).toBe(shots);
    expect(appendShots(shots, Number.NaN)).toBe(shots);
    expect(appendShots(shots, Number.POSITIVE_INFINITY)).toBe(shots);
  });

  it('中间插入后 sortIndex 连续、镜号唯一且继承场景', () => {
    const initial = appendShots([], 4, 'scene_A');
    const inserted = insertShotAfter(initial, 1);
    expect(inserted).toHaveLength(5);
    expect(inserted.map((shot) => shot.sortIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(inserted[2]?.sceneId).toBe('scene_A');
    expect(new Set(inserted.map((shot) => shot.shotNo)).size).toBe(5);
    expect(inserted[2]?.shotNo).toBe(5);
    expect(insertShotAfter([], 0)).toHaveLength(1);
  });

  it('批量删除后顺序连续', () => {
    const shots = appendShots([], 5000);
    const ids = shots.slice(0, 1000).map((shot) => shot.id);
    const result = deleteShots(shots, ids);
    expect(result).toHaveLength(4000);
    expect(result.map((shot) => shot.sortIndex)).toEqual(Array.from({ length: 4000 }, (_, i) => i));
    expect(deleteShots(shots, [])).toBe(shots);
  });

  it('拖拽移动与越界夹取', () => {
    const shots = appendShots([], 4);
    const ids = shots.map((shot) => shot.id);
    const moved = moveShot(shots, 0, 3);
    expect(moved.map((shot) => shot.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(moved.map((shot) => shot.sortIndex)).toEqual([0, 1, 2, 3]);
    expect(moveShot(shots, 0, 999).map((shot) => shot.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(moveShot(shots, 2, 2)).toEqual(shots);
  });

  it('一键重编号覆盖自定义镜号', () => {
    const shots = appendShots([], 3);
    const changed = updateShotField(shots, shots[1]!.id, 'shotNo', 88);
    expect(renumberShots(changed).map((shot) => shot.shotNo)).toEqual([1, 2, 3]);
  });
});

describe('单元格写入与自定义列', () => {
  it('内置字段、图片资源、自定义列分别落到正确位置', () => {
    const [shot] = appendShots([], 1);
    if (!shot) throw new Error('测试镜头创建失败');
    let shots = updateShotField([shot], shot.id, 'content', '主角入场');
    shots = updateShotField(shots, shot.id, 'durationSec', 12);
    shots = updateShotField(shots, shot.id, 'frame', {
      id: 'img_1', path: 'data:image/jpeg;base64,AAA', kind: 'draw', updatedAt: '2026-11-11T00:00:00.000Z',
    });
    shots = updateShotField(shots, shot.id, 'col_16', '道具：咖啡杯');
    expect(shots[0]?.content).toBe('主角入场');
    expect(shots[0]?.durationSec).toBe(12);
    expect(shots[0]?.frame?.path).toBe('data:image/jpeg;base64,AAA');
    expect(shots[0]?.custom['col_16']).toBe('道具：咖啡杯');
  });

  it('拒绝危险键与派生键写入', () => {
    const [shot] = appendShots([], 1);
    if (!shot) throw new Error('测试镜头创建失败');
    const shots = [shot];
    expect(updateShotField(shots, shot.id, '__proto__', 'x')).toBe(shots);
    expect(updateShotField(shots, shot.id, '__sort__', 9)).toBe(shots);
    expect(updateShotField(shots, shot.id, 'id', 'hacked')).toBe(shots);
    expect(updateShotField(shots, 'missing-id', 'content', 'x')).toBe(shots);
  });
});

describe('大规模项目往返', () => {
  it('5000 行 + 200 自定义列序列化后仍完整一致', () => {
    const project = createEmptyProject('压力测试');
    project.shots = appendShots([], 5000);
    for (let i = 0; i < 200; i += 1) {
      project.columnSchema = addCustomColumn(project.columnSchema, `自定义列 ${i + 1}`);
    }
    project.shots = updateShotField(project.shots, project.shots[0]!.id, 'content', '第一行内容');
    const text = serializeProject(project);
    const restored = deserializeProject(text);
    expect(restored.shots).toHaveLength(5000);
    expect(restored.columnSchema.columns).toHaveLength(215);
    expect(restored.shots[0]?.content).toBe('第一行内容');
    expect(restored).toEqual(project);
  });
});
