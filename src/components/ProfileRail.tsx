import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, Settings2, UserRound } from 'lucide-react';
import AvailabilityCalendar from '@/components/AvailabilityCalendar';
import ProfileAvatar from '@/components/ProfileAvatar';
import {
  cycleAvailability,
  dueShoots,
  formatDateCn,
  formatDaysUntil,
  formatLead,
  nextShoot,
  profileSignature,
  shootEventsFromIndex,
} from '@/domain/profile';
import type { LibraryIndex } from '@/domain/library';
import { saveProfile, useProfile } from '@/store/profileStore';

interface Props {
  index: LibraryIndex | null;
  onEdit: () => void;
  /** 点拍摄提醒卡片直接打开对应项目 */
  onOpenProject: (id: string) => void;
}

function railMonth(events: ReturnType<typeof shootEventsFromIndex>): Date {
  const now = new Date();
  // 有拍摄计划时直接翻到最近那个月，省得用户自己找
  const next = nextShoot(events);
  if (next) {
    const [year, month] = next.event.date.split('-').map(Number) as [number, number];
    return new Date(year, month - 1, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** 项目库右侧常驻栏：个人资料、档期、下一个拍摄日 */
export default function ProfileRail({ index, onEdit, onOpenProject }: Props) {
  const profile = useProfile();
  const events = index ? shootEventsFromIndex(index) : [];
  const [month, setMonth] = useState<Date>(() => railMonth(events));
  const jumped = useRef(false);
  // 项目库是异步加载的：等拿到拍摄日后再跳到最近那个月，只跳一次
  useEffect(() => {
    if (jumped.current || events.length === 0) return;
    jumped.current = true;
    const nearest = nextShoot(events);
    if (!nearest) return;
    const [year, monthIndex] = nearest.event.date.split('-').map(Number) as [number, number];
    setMonth(new Date(year, monthIndex - 1, 1));
  }, [events]);
  const next = nextShoot(events);
  const due = dueShoots(events, profile.reminder);
  const shootDates = [...new Set(events.map((event) => event.date))];

  function toggleDate(date: string) {
    saveProfile(cycleAvailability(profile, date));
  }

  return (
    <aside className="profile-rail" aria-label="个人设置">
      <div className="rail-head">
        <h2><UserRound size={14} />个人设置</h2>
        <button className="icon-btn small" type="button" title="编辑个人设置" aria-label="编辑个人设置" onClick={onEdit}>
          <Settings2 size={14} />
        </button>
      </div>

      <button className="rail-identity" type="button" onClick={onEdit}>
        <ProfileAvatar profile={profile} size={46} />
        <span className="rail-identity-text">
          <strong>{profile.name || '未填写名称'}</strong>
          <small>{profile.role || '点击设置职务'}</small>
        </span>
      </button>

      <section className="rail-section">
        <div className="rail-section-head">
          <span><CalendarDays size={13} />日历档期</span>
          <span className="rail-count">{profile.availability.length} 天</span>
        </div>
        <AvailabilityCalendar
          compact
          profile={profile}
          month={month}
          onMonthChange={setMonth}
          onToggleDate={toggleDate}
          shootDates={shootDates}
        />
        <p className="rail-hint">点日期：有档期 → 已排期 → 清空</p>
      </section>

      <section className="rail-section">
        <div className="rail-section-head">
          <span><Bell size={13} />拍摄提醒</span>
          <span className="rail-count">{profile.reminder.enabled ? `提前 ${profile.reminder.leadHours} 小时` : '已关闭'}</span>
        </div>
        {next ? (
          <button
            className={`rail-next${due.length > 0 ? ' due' : ''}`}
            type="button"
            title={`打开「${next.event.projectName}」的分镜脚本`}
            aria-label={`打开项目 ${next.event.projectName}`}
            onClick={() => onOpenProject(next.event.projectId)}
          >
            <strong>{next.event.projectName}</strong>
            <span>{formatDateCn(next.event.date)}</span>
            <span className="rail-next-lead">
              {due.length > 0
                ? `提醒中 · ${formatLead((due[0]?.hoursUntil ?? 0))}`
                : formatDaysUntil(next.daysUntil)}
            </span>
          </button>
        ) : (
          <p className="rail-empty">还没有拍摄日，去拍摄计划里定个日期。</p>
        )}
      </section>

      <p className="rail-foot">
        导出分镜 / Rundown 时自动填入：
        <b>{profile.name ? profileSignature(profile) : '（先填名称与职务）'}</b>
      </p>
    </aside>
  );
}
