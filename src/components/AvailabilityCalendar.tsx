import { ChevronLeft, ChevronRight } from 'lucide-react';
import { availabilityFor, monthCells, todayKey, type Profile } from '@/domain/profile';

interface Props {
  profile: Profile;
  month: Date;
  onMonthChange: (next: Date) => void;
  /** 点日期切换档期状态（空 → 有档期 → 已排期 → 空） */
  onToggleDate: (date: string) => void;
  /** 项目里真实的拍摄日，自动打点，不参与点击状态 */
  shootDates?: string[];
  compact?: boolean;
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/** 月历：周一开头，显示手动档期 + 项目拍摄日 */
export default function AvailabilityCalendar({ profile, month, onMonthChange, onToggleDate, shootDates = [], compact = false }: Props) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const cells = monthCells(year, monthIndex);
  const today = todayKey();

  const shift = (delta: number) => onMonthChange(new Date(year, monthIndex + delta, 1));

  return (
    <div className={`cal${compact ? ' compact' : ''}`}>
      <div className="cal-head">
        <button className="icon-btn small" type="button" aria-label="上个月" onClick={() => shift(-1)}><ChevronLeft size={14} /></button>
        <span className="cal-title">{year} 年 {monthIndex + 1} 月</span>
        <button className="icon-btn small" type="button" aria-label="下个月" onClick={() => shift(1)}><ChevronRight size={14} /></button>
      </div>

      <div className="cal-grid cal-week">
        {WEEK_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>

      <div className="cal-grid">
        {cells.map((date, index) => {
          if (!date) return <span className="cal-empty" key={`empty-${index}`} />;
          const status = availabilityFor(profile, date);
          const isShoot = shootDates.includes(date);
          const classes = [
            'cal-day',
            status ? `is-${status}` : '',
            isShoot ? 'is-shoot' : '',
            date === today ? 'is-today' : '',
          ].filter(Boolean).join(' ');
          const label = status === 'available' ? '有档期' : status === 'busy' ? '已排期' : '未标注';
          return (
            <button
              key={date}
              className={classes}
              type="button"
              title={`${date} · ${label}${isShoot ? ' · 有拍摄计划' : ''}`}
              onClick={() => onToggleDate(date)}
            >
              <span>{Number(date.slice(-2))}</span>
              {isShoot ? <i className="cal-dot shoot" /> : status ? <i className={`cal-dot ${status}`} /> : null}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="cal-dot available" />有档期</span>
        <span><i className="cal-dot busy" />已排期</span>
        <span><i className="cal-dot shoot" />拍摄日</span>
      </div>
    </div>
  );
}
