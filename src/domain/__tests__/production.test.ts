import { describe, expect, it } from 'vitest';
import {
  assignShots,
  createShootingDay,
  dayLoad,
  dayWindowMinutes,
  plannedShotIds,
  pruneRemovedShots,
  reorderDayShots,
  unassignShots,
  unplannedShots,
  updateDay,
} from '@/domain/days';
import {
  addRundownItem,
  buildRundownForDay,
  computeSchedule,
  createRundownItem,
  groupRundownSlots,
  moveRundownItem,
  renameRundownGroup,
  reorderRundownItem,
  removeRundownItem,
  rundownToText,
  updateRundownItem,
} from '@/domain/rundown';
import {
  completeNotice,
  createNoticeFromDay,
  effectiveNoticeStatus,
  noticeBuckets,
  noticeText,
  publishNotice,
} from '@/domain/notices';
import { createSampleProject } from '@/domain/project';
import type { ShootingDay } from '@/domain/types';

function day(overrides: Partial<ShootingDay> = {}): ShootingDay {
  return createShootingDay({ date: '2026-11-20', ...overrides });
}

describe('M3 拍摄计划', () => {
  it('新建拍摄日带默认时间且字段完整', () => {
    const created = createShootingDay();
    expect(created.startTime).toBe('09:00');
    expect(created.endTime).toBe('18:00');
    expect(created.shotIds).toEqual([]);
    expect(created.id).toMatch(/^day_/);
  });

  it('分派镜头会从其它天移走，不产生重复', () => {
    const a = day({ id: 'a', shotIds: ['s1', 's2'] });
    const b = day({ id: 'b', shotIds: [] });
    const result = assignShots([a, b], 'b', ['s2', 's3', 's2']);
    expect(result[0]?.shotIds).toEqual(['s1']);
    expect(result[1]?.shotIds).toEqual(['s2', 's3']);
  });

  it('移除镜头与天内排序', () => {
    const a = day({ id: 'a', shotIds: ['s1', 's2', 's3'] });
    expect(unassignShots([a], 'a', ['s2'])[0]?.shotIds).toEqual(['s1', 's3']);
    expect(reorderDayShots([a], 'a', 0, 2)[0]?.shotIds).toEqual(['s2', 's3', 's1']);
    expect(reorderDayShots([a], 'a', 5, 2)[0]?.shotIds).toEqual(['s1', 's2', 's3']);
  });

  it('工时统计能算出超时分钟数', () => {
    const project = createSampleProject();
    const shots = project.shots;
    const totalSeconds = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
    const target = day({ shotIds: shots.map((shot) => shot.id) });
    const load = dayLoad(target, shots);
    expect(load.shotCount).toBe(shots.length);
    expect(load.shootMinutes).toBe(Math.ceil(totalSeconds / 60));
    expect(load.windowMinutes).toBe(9 * 60);
    const tight = dayLoad({ ...target, startTime: '09:00', endTime: '10:00' }, shots);
    expect(tight.overrunMinutes).toBe(Math.max(0, Math.ceil(totalSeconds / 60) - 60));
  });

  it('跨午夜工时按 +24h 计算，非法时间降级为 0', () => {
    expect(dayWindowMinutes(day({ startTime: '22:00', endTime: '02:00' }))).toBe(240);
    expect(dayWindowMinutes(day({ startTime: 'bad', endTime: '18:00' }))).toBe(0);
  });

  it('更新拍摄日会去重并保留合法时间', () => {
    const a = day({ id: 'a' });
    const updated = updateDay([a], 'a', { location: '咖啡馆', shotIds: ['s1', 's1', 's2'], startTime: '7:05' });
    expect(updated[0]?.location).toBe('咖啡馆');
    expect(updated[0]?.shotIds).toEqual(['s1', 's2']);
    expect(updated[0]?.startTime).toBe('07:05');
  });

  it('未规划镜头按分镜顺序返回', () => {
    const project = createSampleProject();
    const first = project.shots[0]!;
    const second = project.shots[1]!;
    const days = [day({ id: 'a', shotIds: [second.id] })];
    const rest = unplannedShots(days, project.shots);
    expect(rest[0]?.id).toBe(first.id);
    expect(plannedShotIds(days).has(second.id)).toBe(true);
    expect(rest.some((shot) => shot.id === second.id)).toBe(false);
  });

  it('删除镜头后清理拍摄日与 Rundown 引用', () => {
    const items = [createRundownItem('a', 0, { shotIds: ['s1', 's2'] })];
    const result = pruneRemovedShots([day({ id: 'a', shotIds: ['s1', 's2'] })], items, ['s1']);
    expect(result.days[0]?.shotIds).toEqual(['s2']);
    expect(result.rundown[0]?.shotIds).toEqual(['s2']);
  });
});

describe('M4 Rundown 编辑', () => {
  it('追加条目排在当天末尾', () => {
    const first = createRundownItem('a', 0, { title: 'A' });
    const second = createRundownItem('a', 0, { title: 'B' });
    const items = addRundownItem(addRundownItem([], first), second);
    expect(items.map((item) => item.order)).toEqual([0, 1]);
    expect(addRundownItem(items, createRundownItem('b', 0)).at(-1)?.order).toBe(0);
  });

  it('更新条目会规整时长与固定开始时间', () => {
    const item = createRundownItem('a', 0);
    const [updated] = updateRundownItem([item], item.id, { durationMin: 12.6, fixedStart: '08:05' });
    expect(updated?.durationMin).toBe(13);
    expect(updated?.fixedStart).toBe('08:05');
    const [cleaned] = updateRundownItem([item], item.id, { fixedStart: '不是时间' });
    expect(cleaned?.fixedStart).toBeNull();
  });

  it('删除后同一天重新编号', () => {
    const items = [0, 1, 2].map((order) => createRundownItem('a', order, { title: `环节${order}` }));
    const left = removeRundownItem(items, items[1]!.id);
    expect(left.map((item) => item.order)).toEqual([0, 1]);
    expect(left.map((item) => item.title)).toEqual(['环节0', '环节2']);
  });

  it('上下移动与拖拽排序改写 order', () => {
    const items = [0, 1, 2].map((order) => createRundownItem('a', order, { title: `环节${order}` }));
    const moved = moveRundownItem(items, items[0]!.id, 1);
    expect([...moved].sort((a, b) => a.order - b.order).map((item) => item.title)).toEqual(['环节1', '环节0', '环节2']);
    const dragged = reorderRundownItem(items, items[2]!.id, 0);
    expect([...dragged].sort((a, b) => a.order - b.order).map((item) => item.title)).toEqual(['环节2', '环节0', '环节1']);
  });

  it('按当天镜头生成流程：准备 + 每场一段 + 收工', () => {
    const project = createSampleProject();
    const target = day({ id: 'd1', shotIds: project.shots.map((shot) => shot.id) });
    const items = buildRundownForDay(target, project.shots, project.scenes);
    expect(items[0]?.kind).toBe('setup');
    expect(items.at(-1)?.kind).toBe('wrap');
    const shootItems = items.filter((item) => item.kind === 'shoot');
    expect(shootItems.length).toBeGreaterThan(0);
    expect(shootItems.flatMap((item) => item.shotIds)).toHaveLength(project.shots.length);
    // 一分钟短片排不满 4 小时，不应插入午餐
    expect(items.some((item) => item.kind === 'break')).toBe(false);
    expect(items.map((item) => item.order)).toEqual(items.map((_, index) => index));
  });

  it('拍摄时长超过 4 小时自动插入午餐', () => {
    const project = createSampleProject();
    const longShots = project.shots.map((shot) => ({ ...shot, durationSec: 1800 }));
    const target = day({ id: 'd1', shotIds: longShots.map((shot) => shot.id) });
    const items = buildRundownForDay(target, longShots, project.scenes);
    expect(items.some((item) => item.kind === 'break')).toBe(true);
  });

  it('生成的时间轴与文本可直接执行', () => {
    const project = createSampleProject();
    const target = day({ id: 'd1', shotIds: project.shots.map((shot) => shot.id) });
    const items = buildRundownForDay(target, project.shots, project.scenes);
    const slots = computeSchedule(items, target.startTime, target.endTime);
    expect(slots[0]?.startMin).toBe(9 * 60);
    const text = rundownToText(target, slots);
    expect(text).toContain('【拍摄流程】2026-11-20');
    expect(text).toContain('合计');
    // 文本里也能看出分组：组标题带时间范围
    expect(text).toMatch(/【准备】\d{2}:\d{2}–\d{2}:\d{2} · \d+ 分钟/);
  });

  it('分组：连续同名合成一组，同名但不相邻算两组', () => {
    const items = [
      createRundownItem('a', 0, { title: 'A1', group: '准备', durationMin: 10 }),
      createRundownItem('a', 1, { title: 'A2', group: '准备', durationMin: 5 }),
      createRundownItem('a', 2, { title: 'B1', group: '第 1 场', durationMin: 20 }),
      createRundownItem('a', 3, { title: 'A3', group: '准备', durationMin: 5 }),
    ];
    const groups = groupRundownSlots(computeSchedule(items, '08:00', '18:00'));
    expect(groups.map((group) => group.name)).toEqual(['准备', '第 1 场', '准备']);
    expect(groups[0]?.slots).toHaveLength(2);
    expect(groups[0]?.totalMin).toBe(15);
    expect(groups[0]?.startMin).toBe(480);
    expect(groups[0]?.endMin).toBe(495);
    expect(groups[1]?.startMin).toBe(495);
  });

  it('未分组的环节归到空名组，方便在表格里补命名', () => {
    const slots = computeSchedule([createRundownItem('a', 0, { title: '散条' })], '08:00', '18:00');
    expect(groupRundownSlots(slots)[0]?.name).toBe('');
  });

  it('整组改名作用组内所有条目，但不影响别的拍摄日', () => {
    const items = [
      createRundownItem('a', 0, { group: '旧组', title: '1' }),
      createRundownItem('a', 1, { group: '旧组', title: '2' }),
      createRundownItem('a', 2, { group: '', title: '3' }),
      createRundownItem('b', 0, { group: '旧组', title: '别的天' }),
    ];
    const renamed = renameRundownGroup(items, 'a', '旧组', '新组');
    expect(renamed.filter((item) => item.dayId === 'a' && item.group === '新组')).toHaveLength(2);
    expect(renamed.find((item) => item.dayId === 'b')?.group).toBe('旧组');
    const merged = renameRundownGroup(renamed, 'a', '', '散条');
    expect(merged.find((item) => item.title === '3')?.group).toBe('散条');
  });

  it('按镜头生成自带分组，组名跟随场次', () => {
    const project = createSampleProject();
    const target = day({ id: 'd1', shotIds: project.shots.map((shot) => shot.id) });
    const items = buildRundownForDay(target, project.shots, project.scenes);
    expect(items[0]?.group).toBe('准备');
    expect(items.at(-1)?.group).toBe('收工');
    const groups = groupRundownSlots(computeSchedule(items, target.startTime, target.endTime));
    expect(groups.map((group) => group.name)).toEqual([
      '准备',
      '第 1 场 · 咖啡馆吧台',
      '第 2 场 · 靠窗座位',
      '收工',
    ]);
  });
});

describe('M4 拍摄通告', () => {
  const project = createSampleProject();

  it('从拍摄日生成草稿，日程来自 Rundown', () => {
    const target = day({ id: 'd1', crew: ['导演 球球', '摄影 阿伟'], actors: ['小林'] });
    const slots = computeSchedule(buildRundownForDay(target, project.shots, project.scenes));
    const notice = createNoticeFromDay(target, slots);
    expect(notice.status).toBe('draft');
    expect(notice.title).toContain('2026-11-20');
    expect(notice.crew).toBe('导演 球球、摄影 阿伟');
    expect(notice.actors).toBe('小林');
    // 每个组一行组标题 + 每个环节一行明细
    expect(notice.schedule.split('\n').length).toBe(groupRundownSlots(slots).length + slots.length);
    expect(notice.schedule).toContain('【准备】');
  });

  it('发布后记录发布时间，完成后状态为 done', () => {
    const notice = createNoticeFromDay(day({ id: 'd1' }), []);
    const published = publishNotice([notice], notice.id, '2026-11-12T08:00:00.000Z');
    expect(published[0]?.status).toBe('pending');
    expect(published[0]?.publishedAt).toBe('2026-11-12T08:00:00.000Z');
    const done = completeNotice(published, notice.id);
    expect(done[0]?.status).toBe('done');
  });

  it('过了拍摄日的待执行通告按已过期展示', () => {
    const past = day({ id: 'd1', date: '2026-11-01' });
    const notice = createNoticeFromDay(past, []);
    const published = publishNotice([notice], notice.id)[0]!;
    const buckets = noticeBuckets([published], [past], new Date('2026-11-12T10:00:00'));
    expect(buckets.expired).toHaveLength(1);
    expect(effectiveNoticeStatus(published, past, new Date('2026-11-12T10:00:00'))).toBe('expired');
  });

  it('未发布的通知归入草稿', () => {
    const notice = createNoticeFromDay(day({ id: 'd1' }), []);
    expect(noticeBuckets([notice], [day({ id: 'd1' })]).draft).toHaveLength(1);
  });

  it('通告文本包含日期、地点与流程', () => {
    const target = day({ id: 'd1', location: '杭州 · 咖啡馆', crew: ['导演 球球'] });
    const slots = computeSchedule(buildRundownForDay(target, project.shots.slice(0, 2), project.scenes));
    const notice = createNoticeFromDay(target, slots, { note: '带好备用电池' });
    const text = noticeText(notice, target, slots);
    expect(text).toContain('日期：2026-11-20');
    expect(text).toContain('地点：杭州 · 咖啡馆');
    expect(text).toContain('主创：导演 球球');
    expect(text).toContain('备注：带好备用电池');
  });
});
