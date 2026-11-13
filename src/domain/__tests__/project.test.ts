import { describe, expect, it } from 'vitest';
import {
  ProjectParseError,
  createEmptyProject,
  createSampleProject,
  createShot,
  deserializeProject,
  serializeProject,
} from '../project';
import { addCustomColumn } from '../schema';
import { SCHEMA_VERSION } from '../types';

describe('示例项目', () => {
  it('包含 10 个已规划镜头、2 个场次、1 个拍摄日与 22 条分组的 Rundown', () => {
    const project = createSampleProject();
    expect(project.shots).toHaveLength(10);
    expect(project.shots.map((shot) => shot.shotNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(project.scenes).toHaveLength(2);
    expect(project.days).toHaveLength(1);
    expect(project.days[0]?.shotIds).toHaveLength(10);
    expect(project.people).toHaveLength(6);
    expect(project.rundown).toHaveLength(22);
    expect(new Set(project.rundown.map((item) => item.group)).size).toBe(5);
    expect(project.rundown.every((item) => item.group.trim().length > 0)).toBe(true);
    expect(project.columnSchema.columns).toHaveLength(15);
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('项目序列化', () => {
  it('保存后打开内容完全一致', () => {
    const project = createSampleProject();
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it('自定义列在往返后保留', () => {
    const project = createEmptyProject('自定义列测试');
    project.columnSchema = addCustomColumn(project.columnSchema, '道具清单');
    const restored = deserializeProject(serializeProject(project));
    expect(restored.columnSchema.columns.at(-1)?.label).toBe('道具清单');
    expect(restored.columnSchema.preset).toBe('custom');
  });

  it('画面与参考图片资源在往返后保留', () => {
    const project = createEmptyProject();
    const shot = createShot(1);
    shot.frame = { id: 'img_1', path: 'assets/frame_1.png', kind: 'draw', updatedAt: '2026-11-11T00:00:00.000Z' };
    shot.reference = { id: 'img_2', path: 'assets/ref_1.png', kind: 'upload', updatedAt: '2026-11-11T00:00:00.000Z' };
    project.shots = [shot];
    const restored = deserializeProject(serializeProject(project));
    expect(restored.shots[0]?.frame?.path).toBe('assets/frame_1.png');
    expect(restored.shots[0]?.frame?.kind).toBe('draw');
    expect(restored.shots[0]?.reference?.path).toBe('assets/ref_1.png');
  });

  it('缺失字段补默认值', () => {
    const restored = deserializeProject('{"name":"仅有名称"}');
    expect(restored.name).toBe('仅有名称');
    expect(restored.columnSchema.columns).toHaveLength(15);
    expect(restored.shots).toEqual([]);
    expect(restored.days).toEqual([]);
    expect(restored.settings.storyboardColumns).toBe(5);
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('非法值降级而不崩溃', () => {
    const restored = deserializeProject(JSON.stringify({
      shots: [{ shotNo: 'x', durationSec: 'oops', custom: { a: null, b: 3 } }],
      days: 'not-an-array',
      settings: { storyboardColumns: 999, rundownView: 'unknown' },
    }));
    expect(restored.shots).toHaveLength(1);
    expect(restored.shots[0]?.shotNo).toBe(1);
    expect(restored.shots[0]?.durationSec).toBe(0);
    expect(restored.shots[0]?.custom).toEqual({ b: 3 });
    expect(restored.days).toEqual([]);
    expect(restored.settings.storyboardColumns).toBe(10);
    expect(restored.settings.rundownView).toBe('rundown');
  });

  it('损坏文件与高版本文件明确报错', () => {
    expect(() => deserializeProject('{ broken')).toThrow(ProjectParseError);
    expect(() => deserializeProject('[]')).toThrow('根节点必须是对象');
    expect(() => deserializeProject('{"schemaVersion":99}')).toThrow('高于当前程序支持');
  });
});
