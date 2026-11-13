import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  addCustomColumn,
  createColumnSchema,
  moveColumn,
  removeColumn,
  resolveFieldValue,
  toggleColumn,
  visibleColumns,
} from '../schema';
import { createShot } from '../project';
import type { Scene } from '../types';

describe('列 schema', () => {
  it('专业预设的 15 列顺序与默认列定义一致', () => {
    const schema = createColumnSchema('professional');
    expect(schema.columns.map((column) => column.label)).toEqual(DEFAULT_COLUMNS.map((column) => column.label));
    expect(schema.columns).toHaveLength(15);
    expect(schema.columns.every((column) => column.visible && column.builtin)).toBe(true);
  });

  it('简洁预设只显示 7 列', () => {
    const visible = visibleColumns(createColumnSchema('simple'));
    expect(visible.map((column) => column.id)).toEqual([
      'sort', 'shotNo', 'frame', 'shotSize', 'durationSec', 'content', 'notes',
    ]);
  });

  it('新增自定义列：id 唯一、key 可取值、order 连续、preset 变 custom', () => {
    const schema = addCustomColumn(createColumnSchema(), '道具清单', 'textarea');
    const added = schema.columns.at(-1);
    expect(schema.preset).toBe('custom');
    expect(added?.label).toBe('道具清单');
    expect(added?.builtin).toBe(false);
    expect(added?.key).toBe(added?.id);
    expect(added?.order).toBe(15);
    expect(schema.columns.map((column) => column.order)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('拒绝空列名与重复列名', () => {
    const schema = createColumnSchema();
    expect(() => addCustomColumn(schema, '  ')).toThrow('不能为空');
    expect(() => addCustomColumn(schema, '内容')).toThrow('已存在');
  });

  it('内置列不可删除，自定义列可删除且 order 重排', () => {
    const withCustom = addCustomColumn(createColumnSchema(), '灯光备注');
    expect(() => removeColumn(withCustom, 'content')).toThrow('内置列不可删除');
    const customId = withCustom.columns.at(-1)?.id ?? '';
    const removed = removeColumn(withCustom, customId);
    expect(removed.columns).toHaveLength(15);
    expect(removed.columns.map((column) => column.order)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('隐藏列与移动列', () => {
    const hidden = toggleColumn(createColumnSchema(), 'sound');
    expect(visibleColumns(hidden).some((column) => column.id === 'sound')).toBe(false);

    const moved = moveColumn(createColumnSchema(), 'content', -2);
    expect(moved.columns.map((column) => column.id).slice(4, 8)).toEqual([
      'content', 'shotSize', 'durationSec', 'notes',
    ]);
    // 越界移动不改变原对象
    expect(moveColumn(moved, 'sort', -1).columns.map((c) => c.id)).toEqual(moved.columns.map((c) => c.id));
  });

  it('单元格取值：内置字段、排序、关联场号、自定义列、图片位', () => {
    const shot = createShot(3, 'scene_1', 2);
    shot.content = '主角入场';
    shot.durationSec = 8;
    shot.custom['col_props'] = '咖啡杯';
    const scenes: Scene[] = [
      { id: 'scene_1', sceneNo: '2A', interior: '内', dayNight: '日', location: '', synopsis: '' },
    ];
    expect(resolveFieldValue(shot, 'shotNo', scenes)).toBe(3);
    expect(resolveFieldValue(shot, '__sort__', scenes)).toBe(2);
    expect(resolveFieldValue(shot, '__sceneNo__', scenes)).toBe('2A');
    expect(resolveFieldValue(shot, 'content', scenes)).toBe('主角入场');
    expect(resolveFieldValue(shot, 'col_props', scenes)).toBe('咖啡杯');
    expect(resolveFieldValue(shot, 'unknown_key', scenes)).toBe('');
    expect(resolveFieldValue(shot, 'frame', scenes)).toBeNull();
  });
});
