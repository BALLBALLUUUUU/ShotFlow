import type { RundownItem, RundownKind, RundownSlot, Scene, ShootingDay, Shot } from './types';

const MINUTES_PER_DAY = 24 * 60;

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match || !match[1] || !match[2]) throw new Error(`非法时间格式：${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`非法时间值：${value}`);
  return hours * 60 + minutes;
}

/** 允许跨午夜：累计分钟数按 24h 取模显示 */
export function minutesToTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function nonNegativeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 按 order 生成时间轴：
 * - fixedStart 为 null → 从上一环节结束时间顺延
 * - fixedStart 有值 → 固定开始，若早于上一环节结束则标记 conflict
 * - 超过当日 endTime 的条目标记 overrun
 */
export function computeSchedule(
  items: RundownItem[],
  dayStartTime = '08:00',
  dayEndTime = '18:00',
): RundownSlot[] {
  let cursor = parseTimeToMinutes(dayStartTime);
  const endLimit = parseTimeToMinutes(dayEndTime);
  const sorted = [...items].sort((a, b) => a.order - b.order);

  return sorted.map((item) => {
    const duration = nonNegativeDuration(item.durationMin);
    const startMin = item.fixedStart ? parseTimeToMinutes(item.fixedStart) : cursor;
    const endMin = startMin + duration;
    const conflict = startMin < cursor;
    // 冲突时不倒退游标，避免后续环节被整体前移
    cursor = Math.max(cursor, endMin);
    return {
      ...item,
      startMin,
      endMin,
      overrun: endMin > endLimit,
      conflict,
    };
  });
}

/** 不可变重排，并重排 order 为 0..n-1 */
export function reorderRundown(items: RundownItem[], from: number, to: number): RundownItem[] {
  if (items.length === 0) return [];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    throw new RangeError(`重排索引越界：${from} -> ${to}（共 ${items.length} 条）`);
  }
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const moved = sorted[from];
  if (!moved) return sorted;
  sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return sorted.map((item, index) => ({ ...item, order: index }));
}

export function totalDurationMin(items: RundownItem[]): number {
  return items.reduce((sum, item) => sum + nonNegativeDuration(item.durationMin), 0);
}

/** 关联镜头的总时长（秒 -> 分钟，向上取整） */
export function durationFromShots(item: RundownItem, shots: Shot[]): number {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const seconds = item.shotIds.reduce((sum, id) => {
    const shot = byId.get(id);
    return sum + (shot ? Math.max(0, shot.durationSec) : 0);
  }, 0);
  return Math.ceil(seconds / 60);
}

/** 镜头时长变更后同步环节时长（只更新含该镜头的环节） */
export function syncShotDurations(items: RundownItem[], shots: Shot[], changedShotIds: string[]): RundownItem[] {
  const changed = new Set(changedShotIds);
  return items.map((item) => {
    if (!item.shotIds.some((id) => changed.has(id))) return item;
    return { ...item, durationMin: durationFromShots(item, shots) };
  });
}

export function findOverruns(slots: RundownSlot[]): RundownSlot[] {
  return slots.filter((slot) => slot.overrun || slot.conflict);
}

/** 一组连续相邻、group 同名的环节 */
export interface RundownGroupBlock {
  /** 分组名；空字符串表示未分组 */
  name: string;
  slots: RundownSlot[];
  startMin: number;
  endMin: number;
  totalMin: number;
}

/**
 * 按 group 把时间轴切成连续的组。
 * 采用「连续同值」语义：同名的两段中间被别的组隔开时算两组，
 * 这样拖动排序后不会把中间环节误吞进组里。
 */
export function groupRundownSlots(slots: RundownSlot[]): RundownGroupBlock[] {
  const blocks: RundownGroupBlock[] = [];
  for (const slot of slots) {
    const name = (slot.group ?? '').trim();
    const last = blocks.at(-1);
    if (last && last.name === name) {
      last.slots.push(slot);
      last.endMin = Math.max(last.endMin, slot.endMin);
      last.totalMin += slot.durationMin;
      continue;
    }
    blocks.push({
      name,
      slots: [slot],
      startMin: slot.startMin,
      endMin: slot.endMin,
      totalMin: slot.durationMin,
    });
  }
  return blocks;
}

/** 整组改名：当天 group 等于 from 的条目一起改成 to，空 from 表示把「未分组」并成一组 */
export function renameRundownGroup(items: RundownItem[], dayId: string, from: string, to: string): RundownItem[] {
  const source = from.trim();
  const target = to.trim();
  if (source === target) return items;
  return items.map((item) => (
    item.dayId === dayId && (item.group ?? '').trim() === source
      ? { ...item, group: target }
      : item
  ));
}

/** 插入到当天第 indexInDay 个位置（用于「在本组末尾加一条」），并把 order 重排为 0..n-1 */
export function insertRundownItemAt(
  items: RundownItem[],
  item: RundownItem,
  indexInDay: number,
): RundownItem[] {
  const siblings = itemsForDay(items, item.dayId).filter((entry) => entry.id !== item.id);
  const at = Math.max(0, Math.min(siblings.length, Math.round(indexInDay)));
  siblings.splice(at, 0, item);
  const byId = new Map(siblings.map((entry, index) => [entry.id, index]));
  const base = items.some((entry) => entry.id === item.id) ? items : [...items, item];
  return base.map((entry) => (
    byId.has(entry.id) ? { ...entry, order: byId.get(entry.id) ?? entry.order } : entry
  ));
}

/** 环节类型的中文名，编辑下拉与导出共用 */
export const RUNDOWN_KIND_LABELS: Record<RundownKind, string> = {
  setup: '准备',
  shoot: '拍摄',
  move: '转场',
  break: '休息',
  wrap: '收工',
  custom: '其它',
};

export const RUNDOWN_KINDS: RundownKind[] = ['setup', 'shoot', 'move', 'break', 'wrap', 'custom'];

export function createRundownItem(
  dayId: string,
  order: number,
  patch: Partial<Omit<RundownItem, 'id' | 'dayId'>> = {},
): RundownItem {
  return {
    id: `rd_${crypto.randomUUID()}`,
    dayId,
    order,
    kind: 'custom',
    group: '',
    title: '',
    content: '',
    durationMin: 10,
    fixedStart: null,
    owner: '',
    camera: '',
    shotIds: [],
    note: '',
    ...patch,
  };
}

/** 追加到当天末尾 */
export function addRundownItem(items: RundownItem[], item: RundownItem): RundownItem[] {
  const siblings = items.filter((entry) => entry.dayId === item.dayId);
  const maxOrder = siblings.reduce((max, entry) => Math.max(max, entry.order), -1);
  return [...items, { ...item, order: maxOrder + 1 }];
}

function cleanFixedStart(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return minutesToTime(parseTimeToMinutes(value));
  } catch {
    return null;
  }
}

export function updateRundownItem(
  items: RundownItem[],
  id: string,
  patch: Partial<Omit<RundownItem, 'id'>>,
): RundownItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch };
    return {
      ...next,
      durationMin: Number.isFinite(next.durationMin) ? Math.max(0, Math.round(next.durationMin)) : 0,
      fixedStart: cleanFixedStart(next.fixedStart),
      shotIds: [...new Set(next.shotIds)],
    };
  });
}

/** 删除后把同一天剩余条目重新编号，保持 0..n-1 */
export function removeRundownItem(items: RundownItem[], id: string): RundownItem[] {
  const target = items.find((item) => item.id === id);
  if (!target) return items;
  const remaining = items.filter((item) => item.id !== id);
  let index = 0;
  return [...remaining]
    .sort((a, b) => (a.dayId === b.dayId ? a.order - b.order : a.dayId.localeCompare(b.dayId)))
    .map((item) => (item.dayId === target.dayId ? { ...item, order: index++ } : item));
}

export function itemsForDay(items: RundownItem[], dayId: string): RundownItem[] {
  return [...items].filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
}

/** 同一天内上移/下移一位 */
export function moveRundownItem(items: RundownItem[], id: string, delta: number): RundownItem[] {
  const target = items.find((item) => item.id === id);
  if (!target) return items;
  const siblings = itemsForDay(items, target.dayId);
  const from = siblings.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= siblings.length) return items;
  const reordered = [...siblings];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return items;
  reordered.splice(to, 0, moved);
  const byId = new Map(reordered.map((item, index) => [item.id, index]));
  return items.map((item) => (byId.has(item.id) ? { ...item, order: byId.get(item.id) ?? item.order } : item));
}

/** 拖拽排序：按当前天内的顺序重排 */
export function reorderRundownItem(items: RundownItem[], id: string, toIndex: number): RundownItem[] {
  const target = items.find((item) => item.id === id);
  if (!target) return items;
  const siblings = itemsForDay(items, target.dayId);
  const from = siblings.findIndex((item) => item.id === id);
  const to = Math.max(0, Math.min(siblings.length - 1, toIndex));
  if (from < 0 || from === to) return items;
  const reordered = [...siblings];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return items;
  reordered.splice(to, 0, moved);
  const byId = new Map(reordered.map((item, index) => [item.id, index]));
  return items.map((item) => (byId.has(item.id) ? { ...item, order: byId.get(item.id) ?? item.order } : item));
}

/**
 * 按当天镜头一键生成流程：准备 → 逐场拍摄 → 午餐（超过 4 小时）→ 收工。
 * 每条都带 group，表格里会按「准备 / 第 1 场 / 午餐 / 收工」分组显示；生成的时长可直接再编辑。
 */
export function buildRundownForDay(day: ShootingDay, shots: Shot[], scenes: Scene[] = []): RundownItem[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const dayShots = day.shotIds.map((id) => byId.get(id)).filter((shot): shot is Shot => Boolean(shot));
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));

  const groups: { sceneId: string | null; shots: Shot[] }[] = [];
  for (const shot of dayShots) {
    const last = groups.at(-1);
    if (last && last.sceneId === shot.sceneId) last.shots.push(shot);
    else groups.push({ sceneId: shot.sceneId, shots: [shot] });
  }

  const items: RundownItem[] = [];
  let order = 0;
  items.push(createRundownItem(day.id, order++, {
    kind: 'setup',
    group: '准备',
    title: '机位、灯光与收音准备',
    durationMin: 30,
    owner: day.crew[0] ?? '',
    content: '确认机位、收音、监看与素材卡',
  }));

  let total = 0;
  for (const group of groups) {
    const seconds = group.shots.reduce((sum, shot) => sum + Math.max(0, shot.durationSec), 0);
    const minutes = Math.max(5, Math.ceil(seconds / 60) + 5);
    const scene = group.sceneId ? sceneById.get(group.sceneId) : null;
    const label = scene
      ? `第 ${scene.sceneNo || '—'} 场${scene.location ? ` · ${scene.location}` : ''}`
      : '拍摄';
    items.push(createRundownItem(day.id, order++, {
      kind: 'shoot',
      group: label,
      title: label,
      content: group.shots.map((shot) => shot.content).filter(Boolean).slice(0, 2).join('；'),
      durationMin: minutes,
      shotIds: group.shots.map((shot) => shot.id),
    }));
    total += minutes;
  }

  if (total >= 240) {
    items.push(createRundownItem(day.id, order++, {
      kind: 'break',
      group: '午餐与休整',
      title: '午餐与休息',
      durationMin: 45,
    }));
  }

  items.push(createRundownItem(day.id, order++, {
    kind: 'wrap',
    group: '收工',
    title: '收工、素材备份与场地恢复',
    durationMin: 20,
    owner: day.crew[0] ?? '',
    content: '双备份素材，检查设备与场地',
  }));

  return items;
}

/** 生成可粘贴到微信/通告里的纯文本流程（按组输出，组标题带时间范围） */
export function rundownToText(day: ShootingDay, slots: RundownSlot[]): string {
  const head = `${day.date || '待定日期'}${day.location ? ` · ${day.location}` : ''}`;
  const body: string[] = [];
  for (const group of groupRundownSlots(slots)) {
    const label = group.name || '未分组';
    body.push(`【${label}】${minutesToTime(group.startMin)}–${minutesToTime(group.endMin)} · ${group.totalMin} 分钟`);
    for (const slot of group.slots) {
      const owner = slot.owner ? `（${slot.owner}）` : '';
      body.push(`  ${minutesToTime(slot.startMin)}–${minutesToTime(slot.endMin)} ${slot.title}${owner}`);
    }
  }
  const total = slots.reduce((sum, slot) => sum + slot.durationMin, 0);
  return [`【拍摄流程】${head}`, ...body, `合计 ${total} 分钟`].join('\n');
}

