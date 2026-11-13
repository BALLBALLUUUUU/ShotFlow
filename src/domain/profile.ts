/**
 * 个人设置：本机级的用户资料（头像 / 姓名 / 职务 / 日历档期 / 拍摄提醒）。
 *
 * 与项目数据分开存放：项目可以发给同事，但「我是谁」属于这台机器上的这个人。
 * 导出分镜与 Rundown 时按这里自动补全片头署名，不写回项目文件。
 * 全部为纯函数，便于单测。
 */
import type { ExportInfo } from './types';

/** 能直接对应到片头固定字段的职务 */
export type ProfileInfoKey = 'director' | 'cinematographer' | 'producer';

export interface ProfileAvailability {
  /** YYYY-MM-DD（本地日期） */
  date: string;
  status: 'available' | 'busy';
}

export interface ProfileReminder {
  enabled: boolean;
  /** 拍摄日前多少小时提醒，1–336（两周） */
  leadHours: number;
}

export interface Profile {
  name: string;
  role: string;
  /** 头像 data URL；空字符串表示用姓名首字作为默认头像 */
  avatar: string;
  availability: ProfileAvailability[];
  reminder: ProfileReminder;
  updatedAt: string;
}

export const PROFILE_ROLE_OPTIONS = [
  '导演', '执行导演', '制片', '制片人', '制片主任',
  '摄影指导', '摄影师', '摄影', '灯光', '录音', '美术', '场记', '剪辑', '编剧', 'DIT',
] as const;

export const REMINDER_PRESETS = [6, 12, 24, 48, 72] as const;

export const MIN_LEAD_HOURS = 1;
export const MAX_LEAD_HOURS = 336;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AVATAR_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;
const MAX_AVATAR_CHARS = 400_000;
const MAX_AVAILABILITY = 400;

export function createEmptyProfile(): Profile {
  return {
    name: '',
    role: '',
    avatar: '',
    availability: [],
    reminder: { enabled: true, leadHours: 24 },
    updatedAt: '',
  };
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** 本地日期键，避免 toISOString 的 UTC 偏移把「今天」算错一天 */
export function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now);
}

export function parseDateKey(value: string): Date | null {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function formatDateCn(value: string): string {
  const date = parseDateKey(value);
  if (!date) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 周${WEEKDAY_CN[date.getDay()]}`;
}

/** 防御性反序列化：损坏字段降级，任何异常都不该让应用打不开 */
export function normalizeProfile(raw: unknown): Profile {
  const base = createEmptyProfile();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const record = raw as Record<string, unknown>;

  if (typeof record.name === 'string') base.name = record.name.trim().slice(0, 40);
  if (typeof record.role === 'string') base.role = record.role.trim().slice(0, 30);
  if (typeof record.avatar === 'string' && record.avatar.length <= MAX_AVATAR_CHARS && AVATAR_RE.test(record.avatar)) {
    base.avatar = record.avatar;
  }

  if (Array.isArray(record.availability)) {
    const seen = new Set<string>();
    const list: ProfileAvailability[] = [];
    for (const item of record.availability) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const date = entry.date;
      const status = entry.status;
      if (!isDateKey(date) || seen.has(date)) continue;
      if (status !== 'available' && status !== 'busy') continue;
      seen.add(date);
      list.push({ date, status });
      if (list.length >= MAX_AVAILABILITY) break;
    }
    base.availability = list.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (record.reminder && typeof record.reminder === 'object') {
    const reminder = record.reminder as Record<string, unknown>;
    const hours = typeof reminder.leadHours === 'number' && Number.isFinite(reminder.leadHours)
      ? Math.round(reminder.leadHours)
      : base.reminder.leadHours;
    base.reminder = {
      enabled: typeof reminder.enabled === 'boolean' ? reminder.enabled : base.reminder.enabled,
      leadHours: Math.min(MAX_LEAD_HOURS, Math.max(MIN_LEAD_HOURS, hours)),
    };
  }

  base.updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : '';
  return base;
}

/** 默认头像上的文字：取姓名首字，没填就显示「我」 */
export function profileInitials(profile: Profile): string {
  const name = profile.name.trim();
  if (!name) return '我';
  return [...name][0] ?? '我';
}

/** 职务 → 片头固定字段；对不上就返回 null（调用方会补成自定义行） */
export function roleToInfoKey(role: string): ProfileInfoKey | null {
  const value = role.replace(/[\s·/（）()]/g, '').toLowerCase();
  if (!value) return null;
  if (['导演', '总导演', '执行导演', '导演组', 'director'].includes(value)) return 'director';
  if (['摄影', '摄影指导', '摄影师', '摄影老师', 'dp', 'cinematographer', 'dop'].includes(value)) return 'cinematographer';
  if (['制片', '制片人', '制片主任', '监制', '出品人', 'producer'].includes(value)) return 'producer';
  return null;
}

function customFieldId(): string {
  return `info_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把个人设置补进片头信息：只填空位，绝不覆盖项目里已经填过的名字。
 * 职务能对上固定字段就填固定字段，否则作为一条自定义信息追加。
 */
export function applyProfileToExportInfo(info: ExportInfo, profile: Profile): ExportInfo {
  const name = profile.name.trim();
  const role = profile.role.trim();
  // 没填姓名就没有可自动填入的内容，保持项目原样
  if (!name) return info;
  const key = roleToInfoKey(role);

  if (key === 'director') {
    return info.director.trim() ? info : { ...info, director: name };
  }
  if (key === 'cinematographer') {
    return info.cinematographer.trim() ? info : { ...info, cinematographer: name };
  }
  if (key === 'producer') {
    return info.producer.trim() ? info : { ...info, producer: name };
  }

  const label = role || '署名';
  const duplicated = info.custom.some((field) => field.label.trim() === label && field.value.trim() === name);
  if (duplicated) return info;
  return { ...info, custom: [...info.custom, { id: customFieldId(), label, value: name }] };
}

export function hasProfileIdentity(profile: Profile): boolean {
  return profile.name.trim() !== '';
}

/** 「导演 · 球球」，用于 UI 提示 */
export function profileSignature(profile: Profile): string {
  const parts = [profile.role.trim(), profile.name.trim()].filter(Boolean);
  return parts.join(' · ');
}

/* ---------------- 日历档期 ---------------- */

export function availabilityFor(profile: Profile, date: string): ProfileAvailability['status'] | null {
  return profile.availability.find((entry) => entry.date === date)?.status ?? null;
}

export function setAvailability(profile: Profile, date: string, status: ProfileAvailability['status'] | null): Profile {
  const rest = profile.availability.filter((entry) => entry.date !== date);
  if (!status) return { ...profile, availability: rest };
  return {
    ...profile,
    availability: [...rest, { date, status }].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** 点一下循环：空 → 有档期 → 已排期 → 空 */
export function cycleAvailability(profile: Profile, date: string): Profile {
  const current = availabilityFor(profile, date);
  if (current === null) return setAvailability(profile, date, 'available');
  if (current === 'available') return setAvailability(profile, date, 'busy');
  return setAvailability(profile, date, null);
}

/** 月视图格子：周一开头，空位为 null（本地日期键） */
export function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(dateKey(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* ---------------- 拍摄提醒 ---------------- */

export interface ShootEvent {
  projectId: string;
  projectName: string;
  date: string;
}

export interface DueShoot extends ShootEvent {
  hoursUntil: number;
  isToday: boolean;
}

/** 从项目库索引的元数据里取全部拍摄日（回收站里的不算） */
export function shootEventsFromIndex(index: { projects: Array<{ id: string; name: string; deletedAt: string | null; shootDates?: string[] }> }): ShootEvent[] {
  const events: ShootEvent[] = [];
  const seen = new Set<string>();
  for (const meta of index.projects) {
    if (meta.deletedAt !== null) continue;
    for (const date of meta.shootDates ?? []) {
      if (!isDateKey(date)) continue;
      const key = `${meta.id}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ projectId: meta.id, projectName: meta.name, date });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** 命中提醒窗口的拍摄日：从「提前 N 小时」到当天结束前都算 */
export function dueShoots(events: ShootEvent[], reminder: ProfileReminder, now: Date = new Date()): DueShoot[] {
  if (!reminder.enabled) return [];
  const today = todayKey(now);
  const list: DueShoot[] = [];
  for (const event of events) {
    const date = parseDateKey(event.date);
    if (!date) continue;
    const hoursUntil = (date.getTime() - now.getTime()) / 3_600_000;
    // 拍摄日当天仍然提醒（不能因为过了零点就不提示），完全过去后才消失
    if (hoursUntil > reminder.leadHours || hoursUntil <= -24) continue;
    list.push({ ...event, hoursUntil, isToday: event.date === today });
  }
  return list.sort((a, b) => a.hoursUntil - b.hoursUntil);
}

/** 最近一个还没过去的拍摄日，用于右侧栏常驻显示 */
export function nextShoot(events: ShootEvent[], now: Date = new Date()): { event: ShootEvent; daysUntil: number } | null {
  const today = parseDateKey(todayKey(now)) ?? now;
  let best: { event: ShootEvent; daysUntil: number } | null = null;
  for (const event of events) {
    const date = parseDateKey(event.date);
    if (!date) continue;
    const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) continue;
    if (!best || days < best.daysUntil) best = { event, daysUntil: days };
  }
  return best;
}

export function formatLead(hoursUntil: number): string {
  if (hoursUntil <= 0) return '今天';
  if (hoursUntil < 24) return `${Math.ceil(hoursUntil)} 小时后`;
  const days = Math.floor(hoursUntil / 24);
  return `${days} 天后`;
}

export function formatDaysUntil(daysUntil: number): string {
  if (daysUntil <= 0) return '今天';
  if (daysUntil === 1) return '明天';
  return `${daysUntil} 天后`;
}
