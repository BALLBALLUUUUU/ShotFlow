import { describe, expect, it } from 'vitest';
import {
  computeSchedule,
  durationFromShots,
  findOverruns,
  minutesToTime,
  parseTimeToMinutes,
  reorderRundown,
  syncShotDurations,
  totalDurationMin,
} from '../rundown';
import { createShot } from '../project';
import type { RundownItem } from '../types';

function item(order: number, durationMin: number, extra: Partial<RundownItem> = {}): RundownItem {
  return {
    id: `rd_${order}`,
    dayId: 'day_1',
    order,
    kind: 'shoot',
    group: '',
    title: `环节 ${order}`,
    content: '',
    durationMin,
    fixedStart: null,
    owner: '',
    camera: '',
    shotIds: [],
    note: '',
    ...extra,
  };
}

describe('时间解析', () => {
  it('HH:mm 转分钟并可逆，支持跨午夜', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1500)).toBe('01:00');
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('非法时间直接抛错', () => {
    expect(() => parseTimeToMinutes('25:00')).toThrow();
    expect(() => parseTimeToMinutes('8:60')).toThrow();
    expect(() => parseTimeToMinutes('abc')).toThrow();
    expect(() => computeSchedule([item(0, 30)], '99:00')).toThrow();
  });
});

describe('Rundown 时间轴', () => {
  it('按上一环节结束时间自动顺延', () => {
    const slots = computeSchedule([item(0, 30), item(1, 45), item(2, 60)], '08:00', '18:00');
    expect(slots.map((slot) => [minutesToTime(slot.startMin), minutesToTime(slot.endMin)])).toEqual([
      ['08:00', '08:30'], ['08:30', '09:15'], ['09:15', '10:15'],
    ]);
    expect(slots.every((slot) => !slot.overrun && !slot.conflict)).toBe(true);
  });

  it('固定开始时间生效，后续仍从较晚的结束时间顺延', () => {
    const slots = computeSchedule(
      [item(0, 30), item(1, 60, { fixedStart: '09:00' }), item(2, 30)],
      '08:00',
      '18:00',
    );
    expect(minutesToTime(slots[1]?.startMin ?? -1)).toBe('09:00');
    expect(minutesToTime(slots[2]?.startMin ?? -1)).toBe('10:00');
  });

  it('固定时间早于上一环节结束时标记冲突且不倒退游标', () => {
    const slots = computeSchedule(
      [item(0, 60), item(1, 30, { fixedStart: '08:00' }), item(2, 30)],
      '08:00',
      '18:00',
    );
    expect(slots[1]?.conflict).toBe(true);
    expect(minutesToTime(slots[2]?.startMin ?? -1)).toBe('09:00');
    expect(findOverruns(slots)).toHaveLength(1);
  });

  it('超过当日收工时间的条目标记超时', () => {
    const slots = computeSchedule([item(0, 60), item(1, 90)], '08:00', '09:30');
    expect(slots[1]?.overrun).toBe(true);
    expect(findOverruns(slots)).toHaveLength(1);
  });

  it('空列表与零/负时长不崩溃', () => {
    expect(computeSchedule([], '08:00')).toEqual([]);
    const slots = computeSchedule([item(0, -5), item(1, 0), item(2, 10)], '08:00');
    expect(slots[2]?.startMin).toBe(480);
    expect(totalDurationMin([item(0, -5), item(1, Number.NaN), item(2, 10)])).toBe(10);
  });

  it('重排保持不可变并重编号，越界抛错', () => {
    const items = [item(0, 10), item(1, 20), item(2, 30)];
    const moved = reorderRundown(items, 0, 2);
    expect(moved.map((entry) => entry.id)).toEqual(['rd_1', 'rd_2', 'rd_0']);
    expect(moved.map((entry) => entry.order)).toEqual([0, 1, 2]);
    expect(items.map((entry) => entry.order)).toEqual([0, 1, 2]);
    expect(() => reorderRundown(items, 0, 9)).toThrow(RangeError);
    expect(reorderRundown([], 0, 0)).toEqual([]);
  });
});

describe('镜头时长联动', () => {
  const shotA = createShot(1);
  const shotB = createShot(2);
  shotA.durationSec = 120;
  shotB.durationSec = 90;

  it('关联镜头秒数换算为分钟并向上取整', () => {
    expect(durationFromShots(item(0, 0, { shotIds: [shotA.id, shotB.id] }), [shotA, shotB])).toBe(4);
    expect(durationFromShots(item(0, 0, { shotIds: ['missing'] }), [shotA])).toBe(0);
  });

  it('只同步包含被修改镜头的环节', () => {
    const items = [
      item(0, 30, { shotIds: [shotA.id] }),
      item(1, 45, { shotIds: [shotB.id] }),
      item(2, 60),
    ];
    const synced = syncShotDurations(items, [shotA, shotB], [shotB.id]);
    expect(synced[0]?.durationMin).toBe(30);
    expect(synced[1]?.durationMin).toBe(2);
    expect(synced[2]?.durationMin).toBe(60);
  });
});
