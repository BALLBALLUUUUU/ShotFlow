import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { dueShoots, formatDateCn, formatLead, shootEventsFromIndex } from '@/domain/profile';
import type { LibraryIndex } from '@/domain/library';
import { useProfile } from '@/store/profileStore';

const DISMISS_KEY = 'shotflow.reminder.dismissed';

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(-60) : [];
  } catch {
    return [];
  }
}

function persistDismissed(list: string[]): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-60)));
  } catch {
    // 忽略存储失败，仅本次会话内不再提示
  }
}

/** 到达提醒窗口的拍摄计划横幅；关掉后同一条不再打扰 */
export default function ShootReminder({ index }: { index: LibraryIndex | null }) {
  const profile = useProfile();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  if (!profile.reminder.enabled) return null;
  const events = index ? shootEventsFromIndex(index) : [];
  const due = dueShoots(events, profile.reminder)
    .filter((item) => !dismissed.includes(`${item.projectId}:${item.date}`));
  const first = due[0];
  if (!first) return null;

  function dismiss(key: string) {
    const next = [...dismissed, key];
    setDismissed(next);
    persistDismissed(next);
  }

  return (
    <div className="shoot-alert" role="status">
      <span className="shoot-alert-icon"><BellRing size={16} /></span>
      <div className="shoot-alert-text">
        <strong>拍摄提醒 · {first.projectName}</strong>
        <span>
          {formatDateCn(first.date)}
          {first.isToday ? '（今天）' : ''} · {formatLead(first.hoursUntil)}
          {' · '}已按「提前 {profile.reminder.leadHours} 小时」提醒
        </span>
      </div>
      {due.length > 1 ? <span className="shoot-alert-more">另有 {due.length - 1} 个拍摄日</span> : null}
      <button
        className="icon-btn small"
        type="button"
        title="知道了"
        aria-label="关闭提醒"
        onClick={() => dismiss(`${first.projectId}:${first.date}`)}
      ><X size={14} /></button>
    </div>
  );
}
