import { describe, expect, it } from 'vitest';
import { createEmptyProject, createSampleProject } from '../project';
import { metaFromProject, normalizeIndex, projectShootDates } from '../library';
import {
  applyProfileToExportInfo,
  availabilityFor,
  createEmptyProfile,
  cycleAvailability,
  dueShoots,
  formatDaysUntil,
  formatLead,
  isDateKey,
  monthCells,
  nextShoot,
  normalizeProfile,
  profileInitials,
  profileSignature,
  roleToInfoKey,
  shootEventsFromIndex,
  type Profile,
} from '../profile';
import { defaultExportOptions, exportInfoRows } from '../exportInfo';
import { buildExportDocument } from '../exportDocument';

function profile(patch: Partial<Profile> = {}): Profile {
  return { ...createEmptyProfile(), name: '球球', role: '导演', ...patch };
}

describe('个人设置：规范化', () => {
  it('空白资料：没有姓名职务、默认提前 24 小时提醒、没有档期', () => {
    const empty = createEmptyProfile();
    expect(empty.name).toBe('');
    expect(empty.role).toBe('');
    expect(empty.avatar).toBe('');
    expect(empty.availability).toEqual([]);
    expect(empty.reminder).toEqual({ enabled: true, leadHours: 24 });
  });

  it('损坏数据降级：超长文本截断、非法头像丢弃、重复档期去重、提醒夹到 1–336', () => {
    const normalized = normalizeProfile({
      name: '  球球  ',
      role: '导演',
      avatar: 'javascript:alert(1)',
      availability: [
        { date: '2026-11-20', status: 'busy' },
        { date: '2026-11-20', status: 'available' },
        { date: '2026-13-01', status: 'busy' },
        { date: '2026-11-18', status: 'unknown' },
        { date: '2026-11-19', status: 'available' },
      ],
      reminder: { enabled: false, leadHours: 9999 },
    });
    expect(normalized.name).toBe('球球');
    expect(normalized.avatar).toBe('');
    expect(normalized.availability).toEqual([
      { date: '2026-11-19', status: 'available' },
      { date: '2026-11-20', status: 'busy' },
    ]);
    expect(normalized.reminder).toEqual({ enabled: false, leadHours: 336 });
  });

  it('接受 png/jpeg 头像 data URL', () => {
    const avatar = 'data:image/jpeg;base64,AAAA';
    expect(normalizeProfile({ avatar }).avatar).toBe(avatar);
    expect(normalizeProfile({ avatar: 'data:text/html;base64,AAAA' }).avatar).toBe('');
  });

  it('日期键校验：只认真实存在的 YYYY-MM-DD', () => {
    expect(isDateKey('2026-11-20')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-2-3')).toBe(false);
    expect(isDateKey('待定')).toBe(false);
  });

  it('头像占位与署名：没填姓名时显示「我」', () => {
    expect(profileInitials(createEmptyProfile())).toBe('我');
    expect(profileInitials(profile())).toBe('球');
    expect(profileSignature(profile())).toBe('导演 · 球球');
    expect(profileSignature(profile({ role: '' }))).toBe('球球');
  });
});

describe('个人设置：职务映射与导出自动填入', () => {
  it('常见职务能对上片头固定字段', () => {
    expect(roleToInfoKey('导演')).toBe('director');
    expect(roleToInfoKey('执行导演')).toBe('director');
    expect(roleToInfoKey('摄影指导')).toBe('cinematographer');
    expect(roleToInfoKey('DP')).toBe('cinematographer');
    expect(roleToInfoKey('制片人')).toBe('producer');
    expect(roleToInfoKey('灯光')).toBeNull();
    expect(roleToInfoKey('')).toBeNull();
  });

  it('空白片头会被补上姓名，项目里已有的署名不覆盖', () => {
    const project = createEmptyProject('新项目');
    const filled = applyProfileToExportInfo(project.exportInfo, profile());
    expect(filled.director).toBe('球球');

    project.exportInfo.director = '张导';
    const kept = applyProfileToExportInfo(project.exportInfo, profile());
    expect(kept.director).toBe('张导');
  });

  it('没有对应固定字段的职务作为自定义信息追加，且不会重复追加', () => {
    const project = createEmptyProject('新项目');
    const lighting = profile({ role: '灯光' });
    const once = applyProfileToExportInfo(project.exportInfo, lighting);
    expect(once.custom).toHaveLength(1);
    expect(once.custom[0]).toMatchObject({ label: '灯光', value: '球球' });
    const twice = applyProfileToExportInfo(once, lighting);
    expect(twice.custom).toHaveLength(1);
  });

  it('没填姓名时不改动项目', () => {
    const project = createEmptyProject('新项目');
    const untouched = applyProfileToExportInfo(project.exportInfo, createEmptyProfile());
    expect(untouched).toBe(project.exportInfo);
  });

  it('PDF / Excel 片头信息与导出文档都带上自动填入的署名', () => {
    const project = createEmptyProject('新项目');
    const rows = exportInfoRows(project, profile());
    expect(rows).toContainEqual({ label: '导演', value: '球球' });

    const doc = buildExportDocument(project, { ...defaultExportOptions(), columnIds: ['shotNo'] }, profile());
    expect(doc.infoRows).toContainEqual({ label: '导演', value: '球球' });
    // 只影响导出结果，不写回项目文件
    expect(project.exportInfo.director).toBe('');
  });
});

describe('个人设置：日历档期', () => {
  it('点日期循环：空 → 有档期 → 已排期 → 空', () => {
    const empty = createEmptyProfile();
    const available = cycleAvailability(empty, '2026-11-20');
    expect(availabilityFor(available, '2026-11-20')).toBe('available');
    const busy = cycleAvailability(available, '2026-11-20');
    expect(availabilityFor(busy, '2026-11-20')).toBe('busy');
    const cleared = cycleAvailability(busy, '2026-11-20');
    expect(availabilityFor(cleared, '2026-11-20')).toBeNull();
    expect(cleared.availability).toEqual([]);
  });

  it('月视图周一开头，2026 年 11 月 1 日是周日，前面空 6 格', () => {
    const cells = monthCells(2026, 10);
    expect(cells).toHaveLength(42);
    expect(cells.slice(0, 6).every((cell) => cell === null)).toBe(true);
    expect(cells[6]).toBe('2026-11-01');
    expect(cells[35]).toBe('2026-11-30');
    expect(cells.filter(Boolean)).toHaveLength(30);
  });
});

describe('个人设置：拍摄提醒', () => {
  const now = new Date(2026, 10, 12, 16, 0);
  const events = [
    { projectId: 'a', projectName: '咖啡馆短片', date: '2026-11-13' },
    { projectId: 'b', projectName: '远处的项目', date: '2026-11-20' },
    { projectId: 'c', projectName: '今天拍', date: '2026-11-12' },
  ];

  it('提前 24 小时：明天与今天都提醒，远处的项目不提醒', () => {
    const due = dueShoots(events, { enabled: true, leadHours: 24 }, now);
    expect(due.map((item) => item.projectName)).toEqual(['今天拍', '咖啡馆短片']);
    expect(due[0]?.isToday).toBe(true);
  });

  it('关掉提醒就不再提醒；提前量为 0 时只剩当天', () => {
    expect(dueShoots(events, { enabled: false, leadHours: 24 }, now)).toEqual([]);
    expect(dueShoots(events, { enabled: true, leadHours: 0 }, now).map((item) => item.projectName)).toEqual(['今天拍']);
  });

  it('下一个拍摄日跳过已经过去的日期', () => {
    const withPast = [...events, { projectId: 'd', projectName: '昨天', date: '2026-11-11' }];
    const next = nextShoot(withPast, now);
    expect(next?.event.projectName).toBe('今天拍');
    expect(next?.daysUntil).toBe(0);
    expect(nextShoot([], now)).toBeNull();
  });

  it('文案：今天 / 小时后 / 天后', () => {
    expect(formatLead(-3)).toBe('今天');
    expect(formatLead(5.2)).toBe('6 小时后');
    expect(formatLead(49)).toBe('2 天后');
    expect(formatDaysUntil(0)).toBe('今天');
    expect(formatDaysUntil(1)).toBe('明天');
    expect(formatDaysUntil(8)).toBe('8 天后');
  });
});

describe('项目库拍摄日索引', () => {
  it('元数据带上拍摄日：拍摄计划 + 片头拍摄日期，去重排序', () => {
    const project = createSampleProject();
    project.days[0]!.date = '2026-11-21';
    project.exportInfo.shootDate = '2026-11-20';
    expect(projectShootDates(project)).toEqual(['2026-11-20', '2026-11-21']);
    expect(metaFromProject(project).shootDates).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('索引规范化：非法日期丢弃，缺失字段保持 undefined 以便回填', () => {
    const index = normalizeIndex({
      version: 1,
      currentId: 'proj_a',
      projects: [
        { id: 'proj_a', name: 'A', createdAt: '', updatedAt: '', shotCount: 0, dayCount: 0, deletedAt: null, shootDates: ['2026-11-20', 'bad', '2026-11-20'] },
        { id: 'proj_b', name: 'B', createdAt: '', updatedAt: '', shotCount: 0, dayCount: 0, deletedAt: null },
      ],
    });
    expect(index.projects[0]?.shootDates).toEqual(['2026-11-20']);
    expect(index.projects[1]?.shootDates).toBeUndefined();
  });

  it('提醒事件跳过回收站并去重', () => {
    const events = shootEventsFromIndex({
      projects: [
        { id: 'a', name: 'A', deletedAt: null, shootDates: ['2026-11-20', '2026-11-20'] },
        { id: 'b', name: 'B', deletedAt: '2026-11-01', shootDates: ['2026-11-18'] },
      ],
    });
    expect(events).toEqual([{ projectId: 'a', projectName: 'A', date: '2026-11-20' }]);
  });
});
