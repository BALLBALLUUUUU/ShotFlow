// M3 拍摄计划：按拍摄日把镜头分组，纯函数、不可变更新
import type { RundownItem, ShootingDay, Shot } from './types';
import { parseTimeToMinutes } from './rundown';

const MINUTES_PER_DAY = 24 * 60;

export function createShootingDay(patch: Partial<ShootingDay> = {}): ShootingDay {
  return {
    id: `day_${crypto.randomUUID()}`,
    date: '',
    location: '',
    startTime: '09:00',
    endTime: '18:00',
    crew: [],
    actors: [],
    equipment: [],
    shotIds: [],
    note: '',
    ...patch,
  };
}

function clampTime(value: string, fallback: string): string {
  try {
    const minutes = parseTimeToMinutes(value);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  } catch {
    return fallback;
  }
}

/** 单日可用工时（分钟）；跨午夜按 +24h 计算，非法时间返回 0 */
export function dayWindowMinutes(day: ShootingDay): number {
  try {
    const start = parseTimeToMinutes(day.startTime);
    let end = parseTimeToMinutes(day.endTime);
    if (end <= start) end += MINUTES_PER_DAY;
    return end - start;
  } catch {
    return 0;
  }
}

export function normalizeDay(day: ShootingDay): ShootingDay {
  return {
    ...day,
    startTime: clampTime(day.startTime, '09:00'),
    endTime: clampTime(day.endTime, '18:00'),
    shotIds: [...new Set(day.shotIds)],
  };
}

export function addDay(days: ShootingDay[], day: ShootingDay): ShootingDay[] {
  return [...days, normalizeDay(day)];
}

export function updateDay(days: ShootingDay[], id: string, patch: Partial<ShootingDay>): ShootingDay[] {
  return days.map((day) => (day.id === id ? normalizeDay({ ...day, ...patch }) : day));
}

export function removeDay(days: ShootingDay[], id: string): ShootingDay[] {
  return days.filter((day) => day.id !== id);
}

/** 把镜头分派到某天：先从其它天移除，再追加到目标天末尾 */
export function assignShots(days: ShootingDay[], dayId: string, shotIds: string[]): ShootingDay[] {
  const unique = [...new Set(shotIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return days;
  const moved = new Set(unique);
  return days.map((day) => {
    const kept = day.shotIds.filter((id) => !moved.has(id));
    if (day.id !== dayId) return kept.length === day.shotIds.length ? day : { ...day, shotIds: kept };
    return { ...day, shotIds: [...kept, ...unique] };
  });
}

export function unassignShots(days: ShootingDay[], dayId: string, shotIds: string[]): ShootingDay[] {
  const removed = new Set(shotIds);
  return days.map((day) => (day.id === dayId
    ? { ...day, shotIds: day.shotIds.filter((id) => !removed.has(id)) }
    : day));
}

export function reorderDayShots(days: ShootingDay[], dayId: string, from: number, to: number): ShootingDay[] {
  return days.map((day) => {
    if (day.id !== dayId) return day;
    if (from < 0 || from >= day.shotIds.length || to < 0 || to >= day.shotIds.length) return day;
    const next = [...day.shotIds];
    const [moved] = next.splice(from, 1);
    if (!moved) return day;
    next.splice(to, 0, moved);
    return { ...day, shotIds: next };
  });
}

export function plannedShotIds(days: ShootingDay[]): Set<string> {
  return new Set(days.flatMap((day) => day.shotIds));
}

/** 未安排到任何拍摄日的镜头，按分镜顺序 */
export function unplannedShots(days: ShootingDay[], shots: Shot[]): Shot[] {
  const planned = plannedShotIds(days);
  return [...shots].filter((shot) => !planned.has(shot.id)).sort((a, b) => a.sortIndex - b.sortIndex);
}

export interface DayLoad {
  shotCount: number;
  /** 当天镜头总时长（分钟，向上取整） */
  shootMinutes: number;
  windowMinutes: number;
  /** 超出可用工时的分钟数，0 表示排得下 */
  overrunMinutes: number;
  /** 工时占用比例 0..1+ */
  fill: number;
}

export function dayLoad(day: ShootingDay, shots: Shot[]): DayLoad {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const seconds = day.shotIds.reduce((sum, id) => {
    const shot = byId.get(id);
    return sum + (shot ? Math.max(0, shot.durationSec) : 0);
  }, 0);
  const shootMinutes = Math.ceil(seconds / 60);
  const windowMinutes = dayWindowMinutes(day);
  return {
    shotCount: day.shotIds.length,
    shootMinutes,
    windowMinutes,
    overrunMinutes: windowMinutes > 0 ? Math.max(0, shootMinutes - windowMinutes) : 0,
    fill: windowMinutes > 0 ? shootMinutes / windowMinutes : 0,
  };
}

/**
 * 镜头被删除后清理引用：拍摄日里的 id、Rundown 条目里的关联镜头。
 * 重新计算受影响的 Rundown 时长，避免流程单里出现指向已删镜头的空洞。
 */
export function pruneRemovedShots(
  days: ShootingDay[],
  rundown: RundownItem[],
  removedIds: string[],
): { days: ShootingDay[]; rundown: RundownItem[] } {
  const removed = new Set(removedIds);
  if (removed.size === 0) return { days, rundown };
  return {
    days: days.map((day) => (day.shotIds.some((id) => removed.has(id))
      ? { ...day, shotIds: day.shotIds.filter((id) => !removed.has(id)) }
      : day)),
    rundown: rundown.map((item) => (item.shotIds.some((id) => removed.has(id))
      ? { ...item, shotIds: item.shotIds.filter((id) => !removed.has(id)) }
      : item)),
  };
}
