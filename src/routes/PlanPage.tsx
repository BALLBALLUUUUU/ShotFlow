import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock,
  MapPin,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { dayLoad, dayWindowMinutes, unplannedShots } from '@/domain/days';
import PeoplePicker from '@/components/PeoplePicker';
import { useProfile } from '@/store/profileStore';
import { useProjectStore } from '@/store/useProjectStore';

function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function hoursLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

function joinList(values: string[]): string {
  return values.join('、');
}

function splitList(value: string): string[] {
  return value
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PlanPage() {
  const project = useProjectStore((state) => state.project);
  const createDay = useProjectStore((state) => state.createDay);
  const updateDayById = useProjectStore((state) => state.updateDayById);
  const deleteDayById = useProjectStore((state) => state.deleteDayById);
  const assignShotsToDay = useProjectStore((state) => state.assignShotsToDay);
  const unassignShotsFromDay = useProjectStore((state) => state.unassignShotsFromDay);
  const reorderDayShot = useProjectStore((state) => state.reorderDayShot);
  const generateRundown = useProjectStore((state) => state.generateRundown);
  const setToast = useProjectStore((state) => state.setToast);
  const navigate = useNavigate();
  const profile = useProfile();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragShotId, setDragShotId] = useState<string | null>(null);
  const [overDayId, setOverDayId] = useState<string | null>(null);

  const shotsById = useMemo(() => new Map(project.shots.map((shot) => [shot.id, shot])), [project.shots]);
  const unplanned = useMemo(() => unplannedShots(project.days, project.shots), [project.days, project.shots]);
  const plannedCount = project.shots.length - unplanned.length;

  const busyDates = useMemo(() => {
    const map = new Map<string, 'available' | 'busy'>();
    for (const entry of profile.availability) map.set(entry.date, entry.status);
    return map;
  }, [profile.availability]);

  function toggleSelect(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    const id = createDay({ date: todayKey(), location: project.days.at(-1)?.location ?? '' });
    setToast('已新建拍摄日，填好日期和场地后把镜头拖进来');
    return id;
  }

  function assignSelected(dayId: string) {
    if (selected.size === 0) return;
    assignShotsToDay(dayId, [...selected]);
    setSelected(new Set());
  }

  return (
    <section className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>制定拍摄计划</h1>
          <span className="help-dot" title="左侧勾选或拖动镜头到拍摄日；同一镜头只会出现在一个拍摄日">?</span>
          <button className="btn primary" type="button" onClick={handleCreate}><Plus size={15} />新建拍摄计划</button>
        </div>
        <div className="tool-row">
          <span className="grid-stat">
            {project.days.length} 个拍摄日 · 已安排 {plannedCount} / {project.shots.length} 个镜头 · 未安排 {unplanned.length} 个
          </span>
        </div>
      </div>

      <div className="plan-layout">
        <aside className="plan-pool">
          <div className="pool-head">
            <span>未规划镜头 <span className="count">{unplanned.length}</span></span>
            <div className="pool-bulk">
              <button
                className="link-btn"
                type="button"
                disabled={unplanned.length === 0}
                onClick={() => setSelected(new Set(unplanned.map((shot) => shot.id)))}
              >全选</button>
              <button
                className="link-btn"
                type="button"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >清空</button>
            </div>
          </div>

          <div className="pool-list">
            {unplanned.length === 0 ? <p className="pool-empty">所有镜头都已排进拍摄日。</p> : null}
            {unplanned.map((shot) => (
              <div
                className={selected.has(shot.id) ? 'pool-item selectable selected' : 'pool-item selectable'}
                key={shot.id}
                draggable
                onDragStart={(event) => {
                  setDragShotId(shot.id);
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('text/plain', shot.id);
                }}
                onDragEnd={() => { setDragShotId(null); setOverDayId(null); }}
                onClick={() => toggleSelect(shot.id)}
                title="点击勾选，或拖到右侧拍摄日"
              >
                <span className={selected.has(shot.id) ? 'checkbox checked' : 'checkbox'} aria-hidden="true" />
                <div className="pool-thumb">{shot.frame ? <img src={shot.frame.path} alt="" /> : '无图'}</div>
                <div className="pool-info">
                  <strong>镜头 {String(shot.shotNo).padStart(2, '0')}</strong>
                  <span>{shot.content || '未填写内容'}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="pool-hint">
            {selected.size > 0
              ? `已选 ${selected.size} 个，点右侧「加入已选」或直接拖过去`
              : '勾选或拖动镜头到右侧拍摄日'}
          </p>
        </aside>

        <div className="plan-canvas">
          {project.days.length === 0 ? (
            <div className="plan-empty">
              <CalendarDays size={26} />
              <p>还没有拍摄计划</p>
              <button className="btn primary" type="button" onClick={handleCreate}><Plus size={15} />新建拍摄计划</button>
            </div>
          ) : null}

          <div className="day-grid">
            {project.days.map((day) => {
              const load = dayLoad(day, project.shots);
              const busy = day.date ? busyDates.get(day.date) === 'busy' : false;
              const className = [
                'day-card',
                'editable',
                overDayId === day.id && dragShotId ? 'drop-target' : '',
              ].filter(Boolean).join(' ');
              return (
                <article
                  className={className}
                  key={day.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (overDayId !== day.id) setOverDayId(day.id);
                  }}
                  onDragLeave={() => setOverDayId((current) => (current === day.id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = dragShotId ?? event.dataTransfer.getData('text/plain');
                    if (id) assignShotsToDay(day.id, [id]);
                    setDragShotId(null);
                    setOverDayId(null);
                  }}
                >
                  <header className="day-head">
                    <div className="day-head-main">
                      <input
                        className="text-input date-input"
                        type="date"
                        value={day.date}
                        onChange={(event) => updateDayById(day.id, { date: event.currentTarget.value })}
                      />
                      <label className="inline-field">
                        <MapPin size={14} />
                        <input
                          className="text-input"
                          placeholder="拍摄场地"
                          defaultValue={day.location}
                          key={`loc-${day.id}-${day.location}`}
                          onBlur={(event) => {
                            const value = event.currentTarget.value.trim();
                            if (value !== day.location) updateDayById(day.id, { location: value });
                          }}
                        />
                      </label>
                    </div>
                    <div className="day-head-actions">
                      {selected.size > 0 ? (
                        <button className="btn compact" type="button" onClick={() => assignSelected(day.id)}>
                          加入已选（{selected.size}）
                        </button>
                      ) : null}
                      <button
                        className="icon-btn small danger"
                        type="button"
                        title="删除这个拍摄日"
                        onClick={() => {
                          if (window.confirm('删除这个拍摄日？当天的流程与通告会一起删除，镜头会回到未规划。')) {
                            deleteDayById(day.id);
                          }
                        }}
                      ><Trash2 size={14} /></button>
                    </div>
                  </header>

                  <div className="day-time-row">
                    <label className="inline-field">
                      <Clock size={14} />
                      <input
                        className="text-input time-input"
                        type="time"
                        value={day.startTime}
                        onChange={(event) => updateDayById(day.id, { startTime: event.currentTarget.value })}
                      />
                      <span className="dash">–</span>
                      <input
                        className="text-input time-input"
                        type="time"
                        value={day.endTime}
                        onChange={(event) => updateDayById(day.id, { endTime: event.currentTarget.value })}
                      />
                    </label>
                    <span className="day-window">可用 {hoursLabel(dayWindowMinutes(day))}</span>
                    {busy ? <span className="badge badge-warn">个人档期标记为没空</span> : null}
                  </div>

                  <div className="day-load">
                    <div className="day-load-text">
                      <span>已排 <strong>{load.shotCount}</strong> 个镜头</span>
                      <span>预计 <strong>{load.shootMinutes}</strong> 分钟 / 可用 {load.windowMinutes} 分钟</span>
                      {load.overrunMinutes > 0
                        ? <span className="badge badge-warn">超出 {load.overrunMinutes} 分钟</span>
                        : <span className="badge">排得下</span>}
                    </div>
                    <div className="load-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.round(load.fill * 100))}%` }} />
                    </div>
                  </div>

                  <div className="day-shot-list">
                    {day.shotIds.length === 0 ? (
                      <p className="day-shot-empty">把左侧镜头拖进来，或勾选后点「加入已选」</p>
                    ) : null}
                    {day.shotIds.map((shotId, index) => {
                      const shot = shotsById.get(shotId);
                      if (!shot) return null;
                      return (
                        <div className="day-shot-row" key={shotId}>
                          <div className="day-shot-thumb">
                            {shot.frame ? <img src={shot.frame.path} alt="" /> : <span>{shot.shotNo}</span>}
                          </div>
                          <div className="day-shot-info">
                            <strong>镜头 {String(shot.shotNo).padStart(2, '0')}</strong>
                            <span>{shot.content || '未填写内容'}</span>
                          </div>
                          <span className="day-shot-time">{shot.durationSec > 0 ? `${shot.durationSec}s` : '—'}</span>
                          <div className="day-shot-ops">
                            <button
                              className="icon-btn small"
                              type="button"
                              disabled={index === 0}
                              title="上移"
                              onClick={() => reorderDayShot(day.id, index, index - 1)}
                            ><ArrowUp size={13} /></button>
                            <button
                              className="icon-btn small"
                              type="button"
                              disabled={index === day.shotIds.length - 1}
                              title="下移"
                              onClick={() => reorderDayShot(day.id, index, index + 1)}
                            ><ArrowDown size={13} /></button>
                            <button
                              className="icon-btn small"
                              type="button"
                              title="移回未规划"
                              onClick={() => unassignShotsFromDay(day.id, [shotId])}
                            ><X size={13} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="day-people">
                    <PeoplePicker
                      people={project.people}
                      tokens={day.crew}
                      roles={['director', 'camera', 'lighting', 'sound', 'art', 'producer', 'other']}
                      icon={<UserRound size={14} />}
                      placeholder="主创，用、分隔，或点右侧选人"
                      ariaLabel="剧组成员"
                      onChange={(tokens) => updateDayById(day.id, { crew: tokens })}
                    />
                    <PeoplePicker
                      people={project.people}
                      tokens={day.actors}
                      roles={['actor']}
                      icon={<span className="people-tag">演员</span>}
                      placeholder="演员，用、分隔，或点右侧选人"
                      ariaLabel="演员"
                      onChange={(tokens) => updateDayById(day.id, { actors: tokens })}
                    />
                    <label className="inline-field">
                      <span className="people-tag">器材</span>
                      <input
                        className="text-input"
                        placeholder="器材清单，用、分隔"
                        defaultValue={joinList(day.equipment)}
                        key={`equip-${day.id}-${joinList(day.equipment)}`}
                        onBlur={(event) => updateDayById(day.id, { equipment: splitList(event.currentTarget.value) })}
                      />
                    </label>
                  </div>

                  <textarea
                    className="text-input day-note"
                    rows={2}
                    placeholder="当天备注：集合地点、天气备案、特殊要求…"
                    defaultValue={day.note}
                    key={`note-${day.id}-${day.note}`}
                    onBlur={(event) => {
                      const value = event.currentTarget.value;
                      if (value !== day.note) updateDayById(day.id, { note: value });
                    }}
                  />

                  <footer className="day-foot">
                    <button
                      className="btn ghost compact"
                      type="button"
                      disabled={day.shotIds.length === 0}
                      onClick={() => {
                        generateRundown(day.id);
                        navigate('/rundown', { state: { dayId: day.id } });
                      }}
                    >生成流程单</button>
                    <span className="day-foot-note">生成后可在 Rundown 里逐条微调</span>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
