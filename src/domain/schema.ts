import type { ColumnDef, ColumnSchema, FieldKind, PresetId, Scene, Shot } from './types';

/** 列顺序按专业分镜表的惯用顺序定义：镜号 → 画面 → 参考 → 景别 → 运镜 … */
export const DEFAULT_COLUMNS: ReadonlyArray<Omit<ColumnDef, 'order'>> = [
  { id: 'sort', key: '__sort__', label: '排序', kind: 'text', width: 56, visible: true, builtin: true },
  { id: 'shotNo', key: 'shotNo', label: '镜号', kind: 'number', width: 64, visible: true, builtin: true },
  { id: 'frame', key: 'frame', label: '画面', kind: 'image', width: 150, visible: true, builtin: true },
  { id: 'reference', key: 'reference', label: '参考', kind: 'image', width: 200, visible: true, builtin: true },
  { id: 'shotSize', key: 'shotSize', label: '景别', kind: 'select', width: 96, visible: true, builtin: true, options: ['特写', '近景', '中近景', '中景', '全景', '远景', '大远景'] },
  { id: 'durationSec', key: 'durationSec', label: '时长（秒）', kind: 'duration', width: 100, visible: true, builtin: true },
  { id: 'content', key: 'content', label: '内容', kind: 'textarea', width: 220, visible: true, builtin: true },
  { id: 'notes', key: 'notes', label: '备注', kind: 'textarea', width: 180, visible: true, builtin: true },
  { id: 'sceneExpectation', key: 'sceneExpectation', label: '场景预期', kind: 'text', width: 160, visible: true, builtin: true },
  { id: 'sound', key: 'sound', label: '声音', kind: 'text', width: 160, visible: true, builtin: true },
  { id: 'cameraAngle', key: 'cameraAngle', label: '摄影机角度', kind: 'text', width: 160, visible: true, builtin: true },
  { id: 'cameraMove', key: 'cameraMove', label: '运镜', kind: 'select', width: 120, visible: true, builtin: true, options: ['固定', '推', '拉', '摇', '移', '跟', '升降', '手持'] },
  { id: 'cameraBody', key: 'cameraBody', label: '摄影机设备', kind: 'text', width: 160, visible: true, builtin: true },
  { id: 'focalLength', key: 'focalLength', label: '镜头焦段', kind: 'text', width: 120, visible: true, builtin: true },
  { id: 'sceneNo', key: '__sceneNo__', label: '场号', kind: 'text', width: 80, visible: true, builtin: true },
];

/** 简洁预设：只显示 Vlog / 快速策划需要的列 */
const SIMPLE_VISIBLE = new Set(['sort', 'shotNo', 'frame', 'shotSize', 'durationSec', 'content', 'notes']);

export function createColumnSchema(preset: PresetId = 'professional'): ColumnSchema {
  return {
    preset,
    columns: DEFAULT_COLUMNS.map((column, index) => ({
      ...column,
      options: column.options ? [...column.options] : undefined,
      visible: preset === 'simple' ? SIMPLE_VISIBLE.has(column.id) : true,
      order: index,
    })),
  };
}

function nextColumnId(schema: ColumnSchema): string {
  let n = schema.columns.length + 1;
  let id = `col_${n}`;
  while (schema.columns.some((column) => column.id === id || column.key === id)) {
    n += 1;
    id = `col_${n}`;
  }
  return id;
}

export function addCustomColumn(schema: ColumnSchema, label: string, kind: FieldKind = 'text'): ColumnSchema {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('自定义列名称不能为空');
  if (schema.columns.some((column) => column.label === trimmed)) throw new Error(`列「${trimmed}」已存在`);
  const id = nextColumnId(schema);
  return {
    preset: 'custom',
    columns: [
      ...schema.columns,
      { id, key: id, label: trimmed, kind, width: 160, visible: true, builtin: false, order: schema.columns.length },
    ],
  };
}

export function removeColumn(schema: ColumnSchema, id: string): ColumnSchema {
  const target = schema.columns.find((column) => column.id === id);
  if (!target) return schema;
  if (target.builtin) throw new Error('内置列不可删除，只能隐藏');
  return {
    preset: 'custom',
    columns: schema.columns.filter((column) => column.id !== id).map((column, index) => ({ ...column, order: index })),
  };
}

export function toggleColumn(schema: ColumnSchema, id: string): ColumnSchema {
  return {
    ...schema,
    columns: schema.columns.map((column) =>
      column.id === id ? { ...column, visible: !column.visible } : column,
    ),
  };
}

export function moveColumn(schema: ColumnSchema, id: string, delta: number): ColumnSchema {
  const columns = [...schema.columns].sort((a, b) => a.order - b.order);
  const index = columns.findIndex((column) => column.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= columns.length) return schema;
  const item = columns[index];
  if (!item) return schema;
  columns.splice(index, 1);
  columns.splice(target, 0, item);
  return { preset: 'custom', columns: columns.map((column, i) => ({ ...column, order: i })) };
}

export function visibleColumns(schema: ColumnSchema): ColumnDef[] {
  return [...schema.columns].sort((a, b) => a.order - b.order).filter((column) => column.visible);
}

/** 表格单元格取值：特殊键由关联实体或派生逻辑提供 */
export function resolveFieldValue(
  shot: Shot,
  key: string,
  scenes: Scene[],
): string | number | Shot['frame'] {
  if (key === '__sort__') return shot.sortIndex;
  if (key === '__sceneNo__') {
    return scenes.find((scene) => scene.id === shot.sceneId)?.sceneNo ?? '';
  }
  if (key === 'frame' || key === 'reference') return shot[key];
  if (key in shot) {
    const value = (shot as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' || typeof value === 'number' ? value : '';
  }
  return shot.custom[key] ?? '';
}

export function renameColumn(schema: ColumnSchema, id: string, label: string): ColumnSchema {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('列名不能为空');
  if (schema.columns.some((column) => column.id !== id && column.label === trimmed)) {
    throw new Error(`列「${trimmed}」已存在`);
  }
  return {
    ...schema,
    columns: schema.columns.map((column) => (column.id === id ? { ...column, label: trimmed } : column)),
  };
}

export function setColumnWidth(schema: ColumnSchema, id: string, width: number): ColumnSchema {
  const safeWidth = Number.isFinite(width) ? Math.min(800, Math.max(56, Math.round(width))) : 160;
  return {
    ...schema,
    columns: schema.columns.map((column) => (column.id === id ? { ...column, width: safeWidth } : column)),
  };
}

/** 切换预设只影响内置列的显隐，自定义列保持用户当前设置 */
export function setPreset(schema: ColumnSchema, preset: PresetId): ColumnSchema {
  if (preset === 'custom') return { ...schema, preset };
  return {
    preset,
    columns: schema.columns.map((column) => ({
      ...column,
      visible: column.builtin ? (preset === 'simple' ? SIMPLE_VISIBLE.has(column.id) : true) : column.visible,
    })),
  };
}
