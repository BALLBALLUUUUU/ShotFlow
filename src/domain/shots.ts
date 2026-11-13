import { createShot } from './project';
import type { ImageAsset, Shot } from './types';

export type CellValue = string | number | ImageAsset | null;

/** 允许写入的内置字段白名单，其余键一律落在 custom */
const EDITABLE_KEYS = new Set([
  'shotNo', 'sceneId', 'frame', 'reference', 'shotSize', 'durationSec',
  'content', 'notes', 'sceneExpectation', 'sound', 'cameraAngle',
  'cameraMove', 'cameraBody', 'focalLength',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'id', 'custom', 'createdAt', 'updatedAt']);

/** 按数组当前顺序重编号（拖拽后必须用这个，不能重新按旧 sortIndex 排序） */
function reindex(shots: Shot[]): Shot[] {
  return shots.map((shot, index) => (shot.sortIndex === index ? shot : { ...shot, sortIndex: index }));
}

/** 读入数据时先按已有 sortIndex 归位，再重编号 */
function normalizeSortIndex(shots: Shot[]): Shot[] {
  return reindex([...shots].sort((a, b) => a.sortIndex - b.sortIndex));
}

function nextShotNo(shots: Shot[]): number {
  return shots.reduce((max, shot) => Math.max(max, shot.shotNo), 0) + 1;
}

/** 追加任意数量的镜头；总数无上限，仅拦截非法数量 */
export function appendShots(shots: Shot[], count: number, sceneId: string | null = null): Shot[] {
  const amount = Math.floor(count);
  if (!Number.isFinite(amount) || amount <= 0) return shots;
  const baseNo = nextShotNo(shots);
  const baseIndex = shots.length;
  const added = Array.from({ length: amount }, (_, index) =>
    createShot(baseNo + index, sceneId, baseIndex + index),
  );
  return [...shots, ...added];
}

/** 在指定行之后插入一个镜头，并重排 sortIndex（镜号保持唯一、不覆盖用户自定义编号） */
export function insertShotAfter(shots: Shot[], index: number, sceneId: string | null = null): Shot[] {
  const sorted = normalizeSortIndex(shots);
  if (sorted.length === 0) return appendShots(sorted, 1, sceneId);
  const position = Math.min(Math.max(index + 1, 0), sorted.length);
  const inherited = sorted[position - 1]?.sceneId ?? sorted[position]?.sceneId ?? null;
  const shot = createShot(nextShotNo(sorted), sceneId ?? inherited, position);
  sorted.splice(position, 0, shot);
  return reindex(sorted);
}

export function deleteShots(shots: Shot[], ids: string[]): Shot[] {
  const removed = new Set(ids);
  if (removed.size === 0) return shots;
  return reindex(shots.filter((shot) => !removed.has(shot.id)));
}

/** 拖拽排序：越界索引做夹取，避免拖拽事件给出异常值 */
export function moveShot(shots: Shot[], from: number, to: number): Shot[] {
  const sorted = normalizeSortIndex(shots);
  if (sorted.length < 2) return sorted;
  const start = Math.min(Math.max(from, 0), sorted.length - 1);
  const end = Math.min(Math.max(to, 0), sorted.length - 1);
  const moved = sorted[start];
  if (!moved || start === end) return sorted;
  sorted.splice(start, 1);
  sorted.splice(end, 0, moved);
  return reindex(sorted);
}

/** 一键重编号：按当前顺序把镜号重置为 1..n */
export function renumberShots(shots: Shot[]): Shot[] {
  return normalizeSortIndex(shots).map((shot, index) =>
    shot.shotNo === index + 1 ? shot : { ...shot, shotNo: index + 1 },
  );
}

/** 单元格写入；内置字段走白名单，其余写入 custom（自定义列数量无上限） */
export function updateShotField(shots: Shot[], id: string, key: string, value: CellValue): Shot[] {
  const index = shots.findIndex((shot) => shot.id === id);
  const current = shots[index];
  if (index < 0 || !current) return shots;
  if (FORBIDDEN_KEYS.has(key) || key.startsWith('__')) return shots;

  const updatedAt = new Date().toISOString();
  let next: Shot;
  if (EDITABLE_KEYS.has(key)) {
    next = { ...current, [key]: value, updatedAt } as Shot;
  } else {
    const scalar = typeof value === 'string' || typeof value === 'number' ? value : '';
    next = { ...current, custom: { ...current.custom, [key]: scalar }, updatedAt } as Shot;
  }
  const result = [...shots];
  result[index] = next;
  return result;
}
