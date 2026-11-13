import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Copy,
  FileText,
  Plus,
  Send,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  RUNDOWN_KINDS,
  RUNDOWN_KIND_LABELS,
  computeSchedule,
  durationFromShots,
  groupRundownSlots,
  itemsForDay,
  minutesToTime,
  rundownToText,
  totalDurationMin,
  type RundownGroupBlock,
} from '@/domain/rundown';
import {
  createNoticeFromDay,
  effectiveNoticeStatus,
  noticeBuckets,
  noticeText,
} from '@/domain/notices';
import { useProjectStore } from '@/store/useProjectStore';
import type { Notice, NoticeStatus, RundownSlot } from '@/domain/types';

type ViewId = 'rundown' | 'notice';

const STATUS_LABEL: Record<NoticeStatus, string> = {
  draft: '草稿',
  pending: '待执行',
  expired: '已过期',
  done: '已完成',
};

/** 分组色条：与主题无关的中低饱和色，浅/深色主题都能看清 */
const GROUP_COLORS = ['#d9a13b', '#5f93c9', '#79a866', '#c2839b', '#8f86c4', '#c97f57', '#5fa8a1'];

export default function RundownPage() {
  const project = useProjectStore((state) => state.project);
  const setRundownView = useProjectStore((state) => state.setRundownView);
  const addRundown = useProjectStore((state) => state.addRundown);
  const updateRundown = useProjectStore((state) => state.updateRundown);
  const deleteRundown = useProjectStore((state) => state.deleteRundown);
  const moveRundown = useProjectStore((state) => state.moveRundown);
  const dragRundown = useProjectStore((state) => state.dragRundown);
  const renameRundownGroup = useProjectStore((state) => state.renameRundownGroup);
  const generateRundown = useProjectStore((state) => state.generateRundown);
  const createNotice = useProjectStore((state) => state.createNotice);
  const updateNoticeById = useProjectStore((state) => state.updateNoticeById);
  const deleteNoticeById = useProjectStore((state) => state.deleteNoticeById);
  const setNoticeStatus = useProjectStore((state) => state.setNoticeStatus);
  const setToast = useProjectStore((state) => state.setToast);

  const location = useLocation();
  const [view, setView] = useState<ViewId>(project.settings.rundownView);
  const [activeDayId, setActiveDayId] = useState<string>(() => {
    const requested = (location.state as { dayId?: string } | null)?.dayId;
    if (requested && project.days.some((day) => day.id === requested)) return requested;
    return project.days[0]?.id ?? '';
  });
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [shotPickerId, setShotPickerId] = useState<string | null>(null);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);

  useEffect(() => {
    if (!project.days.some((day) => day.id === activeDayId)) {
      setActiveDayId(project.days[0]?.id ?? '');
    }
  }, [project.days, activeDayId]);

  const day = project.days.find((entry) => entry.id === activeDayId);
  const items = useMemo(() => itemsForDay(project.rundown, activeDayId), [project.rundown, activeDayId]);
  const slots = useMemo(
    () => (day ? computeSchedule(items, day.startTime, day.endTime) : []),
    [day, items],
  );
  /** 按 group 切成连续的组，表格里每组前插一行组标题 */
  const groups = useMemo(() => groupRundownSlots(slots), [slots]);
  /** 行号的真实来源：组内渲染时要用全局下标做上移/下移与拖拽 */
  const indexById = useMemo(() => new Map(slots.map((slot, index) => [slot.id, index])), [slots]);
  const warnings = slots.filter((slot) => slot.overrun || slot.conflict);
  const lastEnd = slots.at(-1)?.endMin;

  const buckets = useMemo(() => noticeBuckets(project.notices, project.days), [project.notices, project.days]);
  const editingNotice = project.notices.find((notice) => notice.id === editingNoticeId) ?? null;
  const editingDay = project.days.find((entry) => entry.id === editingNotice?.dayId);
  const editingSlots = editingDay
    ? computeSchedule(itemsForDay(project.rundown, editingDay.id), editingDay.startTime, editingDay.endTime)
    : [];

  function switchView(next: ViewId) {
    setView(next);
    if (project.settings.rundownView !== next) setRundownView(next);
  }

  async function copyNotice(notice: Notice) {
    const targetDay = project.days.find((entry) => entry.id === notice.dayId);
    const targetSlots = targetDay
      ? computeSchedule(itemsForDay(project.rundown, targetDay.id), targetDay.startTime, targetDay.endTime)
      : [];
    const text = noticeText(notice, targetDay, targetSlots);
    try {
      await navigator.clipboard.writeText(text);
      setToast('通告已复制，可直接粘贴到微信群');
    } catch {
      setToast('复制失败，请手动选择文本复制');
    }
  }

  const pickerItem = shotPickerId ? project.rundown.find((item) => item.id === shotPickerId) : null;
  const dayShots = day
    ? day.shotIds
      .map((id) => project.shots.find((shot) => shot.id === id))
      .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot))
    : [];

  /** 在本组末尾插一条：新条目直接继承组名，不会掉进「未分组」 */
  function addInGroup(group: RundownGroupBlock) {
    const lastSlot = group.slots.at(-1);
    const at = lastSlot ? (indexById.get(lastSlot.id) ?? slots.length - 1) + 1 : slots.length;
    addRundown(activeDayId, { kind: 'custom', title: '新环节', durationMin: 10, group: group.name }, at);
  }

  /** 开一个新分组：默认名带序号，落在当天末尾，随后可直接改组名 */
  function addGroup() {
    const used = new Set(groups.map((group) => group.name));
    let index = groups.length + 1;
    while (used.has(`新分组 ${index}`)) index += 1;
    addRundown(activeDayId, { kind: 'custom', title: '新环节', durationMin: 10, group: `新分组 ${index}` });
  }

  function renderSlotRow(slot: RundownSlot, index: number) {
    return (
      <tr
        key={slot.id}
        className={[
          slot.overrun || slot.conflict ? 'row-warn' : '',
          dragItemId === slot.id ? 'dragging' : '',
          overIndex === index && dragItemId && dragItemId !== slot.id ? 'drop-target' : '',
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={(event) => {
          setDragItemId(slot.id);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', slot.id);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (overIndex !== index) setOverIndex(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragItemId) dragRundown(dragItemId, index);
          setDragItemId(null);
          setOverIndex(null);
        }}
        onDragEnd={() => { setDragItemId(null); setOverIndex(null); }}
      >
        <td className="col-order">{index + 1}</td>
        <td className="mono col-time">
          {minutesToTime(slot.startMin)} – {minutesToTime(slot.endMin)}
          {slot.fixedStart ? <span className="fixed-tag">固定</span> : null}
        </td>
        <td className="col-num">
          <input
            className="cell-number"
            type="number"
            min={0}
            step={5}
            value={slot.durationMin}
            onChange={(event) => updateRundown(slot.id, { durationMin: Number(event.currentTarget.value) })}
          />
        </td>
        <td className="col-kind">
          <select
            className="cell-select"
            value={slot.kind}
            onChange={(event) => updateRundown(slot.id, { kind: event.currentTarget.value as typeof slot.kind })}
          >
            {RUNDOWN_KINDS.map((kind) => <option key={kind} value={kind}>{RUNDOWN_KIND_LABELS[kind]}</option>)}
          </select>
        </td>
        <td className="col-title">
          <input
            className="cell-input strong"
            defaultValue={slot.title}
            key={`title-${slot.id}-${slot.title}`}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value !== slot.title) updateRundown(slot.id, { title: value });
            }}
          />
          <button
            className="cell-sub"
            type="button"
            title={slot.fixedStart ? '取消固定开始时间，改为顺延' : '设为固定开始时间'}
            onClick={() => updateRundown(slot.id, {
              fixedStart: slot.fixedStart ? null : minutesToTime(slot.startMin),
            })}
          >{slot.fixedStart ? '取消固定' : '固定时间'}</button>
          {slot.fixedStart ? (
            <input
              className="cell-time"
              type="time"
              value={slot.fixedStart}
              onChange={(event) => updateRundown(slot.id, { fixedStart: event.currentTarget.value })}
            />
          ) : null}
        </td>
        <td className="col-content">
          <input
            className="cell-input"
            defaultValue={slot.content}
            key={`content-${slot.id}-${slot.content}`}
            placeholder="—"
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value !== slot.content) updateRundown(slot.id, { content: value });
            }}
          />
        </td>
        <td className="col-owner">
          <input
            className="cell-input"
            defaultValue={slot.owner}
            key={`owner-${slot.id}-${slot.owner}`}
            placeholder="—"
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value !== slot.owner) updateRundown(slot.id, { owner: value });
            }}
          />
        </td>
        <td className="col-camera">
          <input
            className="cell-input"
            defaultValue={slot.camera}
            key={`camera-${slot.id}-${slot.camera}`}
            placeholder="—"
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value !== slot.camera) updateRundown(slot.id, { camera: value });
            }}
          />
        </td>
        <td className="col-shots">
          <button className="chip-btn" type="button" onClick={() => setShotPickerId(slot.id)}>
            {slot.shotIds.length > 0 ? `${slot.shotIds.length} 个` : '关联'}
          </button>
        </td>
        <td className="col-status">
          {slot.overrun ? <span className="badge badge-warn">超出收工</span>
            : slot.conflict ? <span className="badge badge-warn">时间冲突</span>
              : <span className="badge">正常</span>}
        </td>
        <td className="col-ops">
          <button className="icon-btn small" type="button" disabled={index === 0} title="上移" onClick={() => moveRundown(slot.id, -1)}><ArrowUp size={13} /></button>
          <button className="icon-btn small" type="button" disabled={index === slots.length - 1} title="下移" onClick={() => moveRundown(slot.id, 1)}><ArrowDown size={13} /></button>
          <button className="icon-btn small danger" type="button" title="删除环节" onClick={() => deleteRundown(slot.id)}><Trash2 size={13} /></button>
        </td>
      </tr>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>{view === 'rundown' ? '拍摄日流程串联单' : '拍摄通告'}</h1>
          <span className="help-dot" title="Rundown 与通告共用同一份拍摄日数据；改流程后重新生成即可刷新通告">?</span>
          <div className="rundown-view-switch">
            <button className={view === 'rundown' ? 'switch-btn active' : 'switch-btn'} type="button" onClick={() => switchView('rundown')}>Rundown</button>
            <button className={view === 'notice' ? 'switch-btn active' : 'switch-btn'} type="button" onClick={() => switchView('notice')}>拍摄通告</button>
          </div>
        </div>
        <div className="tool-row">
          {project.days.length > 0 ? (
            <select
              className="select-input"
              title="选择拍摄日"
              value={activeDayId}
              onChange={(event) => setActiveDayId(event.currentTarget.value)}
            >
              {project.days.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  第 {index + 1} 天{entry.date ? ` · ${entry.date}` : ''}{entry.location ? ` · ${entry.location}` : ''}
                </option>
              ))}
            </select>
          ) : null}

          {view === 'rundown' ? (
            <>
              <button
                className="btn ghost"
                type="button"
                disabled={!day || day.shotIds.length === 0}
                title="按当天镜头自动生成准备/拍摄/收工环节"
                onClick={() => {
                  if (!day) return;
                  if (items.length > 0 && !window.confirm('按当天镜头重新生成流程？现有环节会被替换。')) return;
                  generateRundown(day.id);
                }}
              ><Wand2 size={15} />按镜头生成</button>
              <button
                className="btn ghost"
                type="button"
                disabled={!day}
                title="在当天末尾新开一个分组"
                onClick={addGroup}
              ><Plus size={15} />新分组</button>
              <button
                className="btn primary"
                type="button"
                disabled={!day}
                onClick={() => addRundown(activeDayId, { kind: 'custom', title: '新环节', durationMin: 15 })}
              ><Plus size={15} />新增环节</button>
              <button
                className="btn ghost"
                type="button"
                disabled={!day || slots.length === 0}
                title="按分组复制成文本，可直接发群"
                onClick={async () => {
                  if (!day) return;
                  try {
                    await navigator.clipboard.writeText(rundownToText(day, slots));
                    setToast('流程已按分组复制，可直接发到群里');
                  } catch {
                    setToast('复制失败，请手动选择文本复制');
                  }
                }}
              ><Copy size={15} />复制流程</button>
              <span className="grid-stat">{groups.length} 组 · {items.length} 个环节 · 合计 {totalDurationMin(items)} 分钟</span>
            </>
          ) : (
            <>
              <button
                className="btn primary"
                type="button"
                disabled={!day}
                onClick={() => {
                  if (!day) return;
                  const id = createNotice(day.id);
                  if (id) {
                    setEditingNoticeId(id);
                    setToast('已按当前流程生成通告草稿，确认后点「发布」');
                  }
                }}
              ><Plus size={15} />创建通告</button>
              <span className="grid-stat">草稿 {buckets.draft.length} · 待执行 {buckets.pending.length} · 已过期 {buckets.expired.length} · 已完成 {buckets.done.length}</span>
            </>
          )}
        </div>
      </div>

      {!day ? (
        <div className="plan-empty">
          <FileText size={26} />
          <p>还没有拍摄日，先去「拍摄计划」建一个。</p>
        </div>
      ) : view === 'rundown' ? (
        <>
          <div className="rundown-summary">
            <div className="summary-item"><Clock size={15} />总时长 <strong>{totalDurationMin(items)} 分钟</strong></div>
            <div className="summary-item">分组 <strong>{groups.length} 个</strong></div>
            <div className="summary-item">开始 <strong>{day.startTime}</strong></div>
            <div className="summary-item">预计结束 <strong>{lastEnd === undefined ? '—' : minutesToTime(lastEnd)}</strong></div>
            <div className={warnings.length > 0 ? 'summary-item warn' : 'summary-item'}>
              {warnings.length > 0 ? <AlertTriangle size={15} /> : null}
              异常 <strong>{warnings.length} 条</strong>
            </div>
            <div className="summary-item">收工时间 <strong>{day.endTime}</strong></div>
          </div>

          <div className="table-scroll">
            <table className="rundown-table editable-table">
              <thead>
                <tr>
                  <th className="col-order">序</th>
                  <th className="col-time">时间段</th>
                  <th className="col-num">时长</th>
                  <th className="col-kind">类型</th>
                  <th className="col-title">环节</th>
                  <th className="col-content">内容</th>
                  <th className="col-owner">负责人</th>
                  <th className="col-camera">机位</th>
                  <th className="col-shots">关联镜头</th>
                  <th className="col-status">状态</th>
                  <th className="col-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, groupIndex) => {
                  const color = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
                  const groupWarn = group.slots.some((slot) => slot.overrun || slot.conflict);
                  return (
                    <Fragment key={`g-${group.name || 'none'}-${group.slots[0]?.id ?? groupIndex}`}>
                      <tr className="group-row">
                        <td colSpan={11}>
                          <div className="group-line">
                            <span className="group-bar" style={{ background: color }} />
                            <span className="group-no mono">{String(groupIndex + 1).padStart(2, '0')}</span>
                            <input
                              className="group-name-input"
                              defaultValue={group.name}
                              key={`gn-${day.id}-${group.name}-${group.slots[0]?.id ?? groupIndex}`}
                              placeholder="未分组（点此命名）"
                              title="改组名会同步改组内所有环节"
                              onBlur={(event) => {
                                const value = event.currentTarget.value.trim();
                                if (value !== group.name) renameRundownGroup(activeDayId, group.name, value);
                              }}
                              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                            />
                            <span className="group-meta">
                              {minutesToTime(group.startMin)}–{minutesToTime(group.endMin)}
                              <i>·</i>{group.slots.length} 项<i>·</i>{group.totalMin} 分钟
                            </span>
                            {groupWarn ? <span className="badge badge-warn">含异常</span> : null}
                            <button className="group-add" type="button" onClick={() => addInGroup(group)}>
                              <Plus size={12} />本组加一条
                            </button>
                          </div>
                        </td>
                      </tr>
                      {group.slots.map((slot) => renderSlotRow(slot, indexById.get(slot.id) ?? 0))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {slots.length === 0 ? (
            <div className="rundown-empty">
              <p>这一天还没有流程条目。</p>
              <div className="rundown-empty-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={day.shotIds.length === 0}
                  onClick={() => generateRundown(day.id)}
                ><Wand2 size={15} />按镜头生成流程</button>
                <button className="btn ghost" type="button" onClick={() => addRundown(activeDayId, { title: '新环节', durationMin: 15 })}>
                  <Plus size={15} />手动新增
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {project.notices.length === 0 ? (
            <button className="create-notice" type="button" onClick={() => { const id = createNotice(day.id); if (id) setEditingNoticeId(id); }}>
              <Plus size={18} />创建通告
            </button>
          ) : null}

          <div className="notice-groups">
            {(['draft', 'pending', 'expired', 'done'] as NoticeStatus[]).map((status) => (
              <div className="notice-group" key={status}>
                <h2 className="section-title">{STATUS_LABEL[status]} <span className="count">{buckets[status].length}</span></h2>
                {buckets[status].length === 0 ? (
                  <p className="notice-empty">{status === 'pending' ? '暂无待执行通告' : `暂无${STATUS_LABEL[status]}通告`}</p>
                ) : buckets[status].map((notice) => {
                  const noticeDay = project.days.find((entry) => entry.id === notice.dayId);
                  return (
                    <article className="notice-card" key={notice.id}>
                      <div className="notice-main">
                        <div className="notice-title-row">
                          <FileText size={16} />
                          <strong>{notice.title || '未命名通告'}</strong>
                          <span className={`badge ${status === 'pending' ? '' : 'badge-muted'}`}>{STATUS_LABEL[effectiveNoticeStatus(notice, noticeDay)]}</span>
                        </div>
                        <p className="notice-meta">
                          {noticeDay?.date || '日期待定'}{noticeDay?.location ? ` · ${noticeDay.location}` : ''}
                          {noticeDay ? ` · ${noticeDay.startTime}–${noticeDay.endTime}` : ''}
                          {notice.publishedAt ? ` · 发布于 ${notice.publishedAt.slice(0, 16).replace('T', ' ')}` : ' · 未发布'}
                        </p>
                        {notice.schedule ? <p className="notice-schedule-preview">{notice.schedule.split('\n').slice(0, 3).join(' / ')}</p> : null}
                      </div>
                      <div className="notice-actions">
                        <button className="btn ghost compact" type="button" onClick={() => setEditingNoticeId(notice.id)}>编辑</button>
                        {notice.status === 'draft' ? (
                          <button className="btn compact" type="button" onClick={() => setNoticeStatus(notice.id, 'pending')}><Send size={13} />发布</button>
                        ) : null}
                        {notice.status === 'pending' ? (
                          <button className="btn ghost compact" type="button" onClick={() => setNoticeStatus(notice.id, 'done')}><Check size={13} />完成</button>
                        ) : null}
                        {notice.status === 'done' || notice.status === 'expired' ? (
                          <button className="btn ghost compact" type="button" onClick={() => setNoticeStatus(notice.id, 'pending')}>恢复</button>
                        ) : null}
                        <button className="btn ghost compact" type="button" onClick={() => copyNotice(notice)}><Copy size={13} />复制</button>
                        <button
                          className="icon-btn small danger"
                          type="button"
                          title="删除通告"
                          onClick={() => {
                            if (window.confirm('删除这条通告？')) deleteNoticeById(notice.id);
                          }}
                        ><Trash2 size={13} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {pickerItem ? (
        <div className="drawer-backdrop" onClick={() => setShotPickerId(null)}>
          <aside className="drawer drawer-narrow" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-head">
              <h2>关联镜头</h2>
              <button className="icon-btn" type="button" onClick={() => setShotPickerId(null)} aria-label="关闭"><X size={17} /></button>
            </header>
            <div className="drawer-section">
              <p className="drawer-hint">只列出这个拍摄日已安排的镜头。勾选后会出现在流程单里。</p>
              <button
                className="btn ghost compact"
                type="button"
                onClick={() => updateRundown(pickerItem.id, { durationMin: durationFromShots(pickerItem, project.shots) })}
              >按时长重算本环节</button>
            </div>
            <div className="drawer-section grow">
              <div className="field-checklist">
                {dayShots.length === 0 ? <p className="notice-empty">这一天还没有安排镜头。</p> : null}
                {dayShots.map((shot) => (
                  <label className="check-row" key={shot.id}>
                    <input
                      type="checkbox"
                      checked={pickerItem.shotIds.includes(shot.id)}
                      onChange={() => {
                        const next = pickerItem.shotIds.includes(shot.id)
                          ? pickerItem.shotIds.filter((id) => id !== shot.id)
                          : [...pickerItem.shotIds, shot.id];
                        updateRundown(pickerItem.id, { shotIds: next });
                      }}
                    />
                    <span>镜头 {String(shot.shotNo).padStart(2, '0')} · {shot.content || '未填写'}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {editingNotice ? (
        <div className="drawer-backdrop" onClick={() => setEditingNoticeId(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-head">
              <h2>编辑通告</h2>
              <button className="icon-btn" type="button" onClick={() => setEditingNoticeId(null)} aria-label="关闭"><X size={17} /></button>
            </header>
            <div className="drawer-body">
              <section className="drawer-section">
                <label className="field block">
                  <span>标题</span>
                  <input
                    className="text-input"
                    defaultValue={editingNotice.title}
                    key={`n-title-${editingNotice.id}-${editingNotice.title}`}
                    onBlur={(event) => updateNoticeById(editingNotice.id, { title: event.currentTarget.value.trim() })}
                  />
                </label>
                <label className="field block">
                  <span>主创</span>
                  <input
                    className="text-input"
                    defaultValue={editingNotice.crew}
                    key={`n-crew-${editingNotice.id}-${editingNotice.crew}`}
                    placeholder="导演 球球、摄影 阿伟"
                    onBlur={(event) => updateNoticeById(editingNotice.id, { crew: event.currentTarget.value })}
                  />
                </label>
                <label className="field block">
                  <span>部门</span>
                  <input
                    className="text-input"
                    defaultValue={editingNotice.groups}
                    key={`n-groups-${editingNotice.id}-${editingNotice.groups}`}
                    placeholder="制片组、摄影组、灯光组"
                    onBlur={(event) => updateNoticeById(editingNotice.id, { groups: event.currentTarget.value })}
                  />
                </label>
                <label className="field block">
                  <span>演员</span>
                  <input
                    className="text-input"
                    defaultValue={editingNotice.actors}
                    key={`n-actors-${editingNotice.id}-${editingNotice.actors}`}
                    onBlur={(event) => updateNoticeById(editingNotice.id, { actors: event.currentTarget.value })}
                  />
                </label>
              </section>

              <section className="drawer-section">
                <label className="field block">
                  <span>流程（每行一条）</span>
                  <textarea
                    className="text-input notice-schedule-input"
                    rows={14}
                    defaultValue={editingNotice.schedule}
                    key={`n-schedule-${editingNotice.id}-${editingNotice.schedule}`}
                    onBlur={(event) => updateNoticeById(editingNotice.id, { schedule: event.currentTarget.value })}
                  />
                </label>
                <button
                  className="btn ghost compact"
                  type="button"
                  onClick={() => {
                    if (!editingDay) return;
                    const regenerated = createNoticeFromDay(editingDay, editingSlots);
                    updateNoticeById(editingNotice.id, { schedule: regenerated.schedule });
                  }}
                >用当前流程覆盖</button>
              </section>

              <section className="drawer-section">
                <label className="field block">
                  <span>备注</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    defaultValue={editingNotice.note}
                    key={`n-note-${editingNotice.id}-${editingNotice.note}`}
                    placeholder="集合地点、天气备案、联系人…"
                    onBlur={(event) => updateNoticeById(editingNotice.id, { note: event.currentTarget.value })}
                  />
                </label>
              </section>

              <section className="drawer-section">
                <div className="section-label">预览</div>
                <pre className="notice-preview">{noticeText(editingNotice, editingDay, editingSlots)}</pre>
              </section>
            </div>
            <footer className="modal-foot">
              <button className="btn ghost" type="button" onClick={() => copyNotice(editingNotice)}><Copy size={14} />复制文本</button>
              <button className="btn ghost" type="button" onClick={() => setEditingNoticeId(null)}>关闭</button>
              {editingNotice.status === 'draft' ? (
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => { setNoticeStatus(editingNotice.id, 'pending'); setToast('通告已发布为待执行'); }}
                ><Send size={14} />发布</button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => { setNoticeStatus(editingNotice.id, 'done'); setEditingNoticeId(null); }}
                ><Check size={14} />标记完成</button>
              )}
            </footer>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
