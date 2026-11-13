// M4 拍摄通告：从拍摄日 + 流程派生，可编辑、发布、归档
import type { Notice, NoticeStatus, RundownSlot, ShootingDay } from './types';
import { groupRundownSlots, minutesToTime } from './rundown';

/**
 * 通告里的流程文本：先给组标题（含时间范围与时长），再列本组环节。
 * 分组标题用【】包住，粘贴到微信里一眼能看出各组。
 */
export function noticeSchedule(slots: RundownSlot[]): string {
  const lines: string[] = [];
  for (const group of groupRundownSlots(slots)) {
    const label = group.name || '未分组';
    lines.push(`【${label}】${minutesToTime(group.startMin)}–${minutesToTime(group.endMin)} · ${group.totalMin} 分钟`);
    for (const slot of group.slots) {
      const owner = slot.owner ? `（${slot.owner}）` : '';
      lines.push(`${minutesToTime(slot.startMin)}–${minutesToTime(slot.endMin)} ${slot.title}${owner}`);
    }
  }
  return lines.join('\n');
}

export function createNoticeFromDay(
  day: ShootingDay,
  slots: RundownSlot[],
  patch: Partial<Omit<Notice, 'id'>> = {},
): Notice {
  const schedule = noticeSchedule(slots);
  return {
    id: `notice_${crypto.randomUUID()}`,
    dayId: day.id,
    status: 'draft',
    title: `${day.date || '待定日期'} 拍摄通告`,
    publishedAt: null,
    crew: day.crew.join('、'),
    groups: '',
    actors: day.actors.join('、'),
    schedule,
    note: day.note,
    ...patch,
  };
}

export function updateNotice(notices: Notice[], id: string, patch: Partial<Omit<Notice, 'id'>>): Notice[] {
  return notices.map((notice) => (notice.id === id ? { ...notice, ...patch } : notice));
}

export function removeNotice(notices: Notice[], id: string): Notice[] {
  return notices.filter((notice) => notice.id !== id);
}

/** 发布：草稿 → 待执行，记录发布时间 */
export function publishNotice(notices: Notice[], id: string, at = new Date().toISOString()): Notice[] {
  return updateNotice(notices, id, { status: 'pending', publishedAt: at });
}

export function completeNotice(notices: Notice[], id: string): Notice[] {
  return updateNotice(notices, id, { status: 'done' });
}

export function expireNotice(notices: Notice[], id: string): Notice[] {
  return updateNotice(notices, id, { status: 'expired' });
}

export function restoreNotice(notices: Notice[], id: string): Notice[] {
  return updateNotice(notices, id, { status: 'pending' });
}

function todayKey(today = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

/** 展示用状态：过了拍摄日期的待执行通告自动视为已过期（不写回数据） */
export function effectiveNoticeStatus(notice: Notice, day: ShootingDay | undefined, today = new Date()): NoticeStatus {
  if (notice.status === 'done' || notice.status === 'expired') return notice.status;
  if (day?.date && day.date < todayKey(today)) return 'expired';
  if (!notice.publishedAt) return 'draft';
  return notice.status;
}

export interface NoticeBuckets {
  draft: Notice[];
  pending: Notice[];
  expired: Notice[];
  done: Notice[];
}

export function noticeBuckets(notices: Notice[], days: ShootingDay[], today = new Date()): NoticeBuckets {
  const dayById = new Map(days.map((day) => [day.id, day]));
  const buckets: NoticeBuckets = { draft: [], pending: [], expired: [], done: [] };
  for (const notice of notices) {
    buckets[effectiveNoticeStatus(notice, dayById.get(notice.dayId), today)].push(notice);
  }
  return buckets;
}

/** 可粘贴到微信的纯文本通告 */
export function noticeText(notice: Notice, day: ShootingDay | undefined, slots: RundownSlot[] = []): string {
  const lines: string[] = [notice.title || '拍摄通告'];
  if (day?.date) lines.push(`日期：${day.date}`);
  if (day?.location) lines.push(`地点：${day.location}`);
  if (day) lines.push(`时间：${day.startTime}–${day.endTime}（集合 ${day.startTime}）`);
  if (notice.crew) lines.push(`主创：${notice.crew}`);
  if (notice.groups) lines.push(`部门：${notice.groups}`);
  if (notice.actors) lines.push(`演员：${notice.actors}`);
  if (notice.schedule) {
    lines.push('流程：');
    for (const line of notice.schedule.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      // 组标题（【xx】开头）只缩进两格，组内明细再缩进两格，微信里层次清楚
      lines.push(text.startsWith('【') ? `  ${text}` : `    ${text}`);
    }
  }
  if (slots.length > 0) {
    const total = slots.reduce((sum, slot) => sum + slot.durationMin, 0);
    lines.push(`合计 ${total} 分钟`);
  }
  if (notice.note) lines.push(`备注：${notice.note}`);
  return lines.join('\n');
}
