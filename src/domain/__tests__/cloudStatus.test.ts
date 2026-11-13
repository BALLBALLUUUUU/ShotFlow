import { describe, expect, it } from 'vitest';
import {
  LOCAL_ONLY_NOTE,
  backupClock,
  cloudAccountNote,
  cloudFooterNote,
  dateTimeLabel,
  type CloudNoteInput,
} from '../cloudStatus';

function input(patch: Partial<CloudNoteInput> = {}): CloudNoteInput {
  return {
    signedIn: false,
    name: null,
    syncing: false,
    conflicts: 0,
    count: 0,
    uploaded: 0,
    downloaded: 0,
    at: null,
    error: null,
    ...patch,
  };
}

// 本地时间的 10:41，避免时区导致的断言漂移
const AT = new Date(2026, 10, 13, 10, 41, 0).toISOString();

describe('云端状态文案', () => {
  it('未登录只说保存在本机', () => {
    expect(cloudFooterNote(input())).toBe(LOCAL_ONLY_NOTE);
    expect(cloudFooterNote(input({ signedIn: false, count: 9, at: AT }))).toBe(LOCAL_ONLY_NOTE);
  });

  it('同步进行中不能说已同步', () => {
    const note = cloudFooterNote(input({ signedIn: true, name: '漂流人间', syncing: true, count: 3, at: AT }));
    expect(note).toBe('已登录：漂流人间 · 正在与云端同步…');
    expect(note).not.toContain('已与云端同步');
  });

  it('登录但还没拿到云端数据时只说正在读取', () => {
    const note = cloudFooterNote(input({ signedIn: true, name: '漂流人间' }));
    expect(note).toContain('正在读取云端');
    expect(note).not.toContain('已与云端同步');
  });

  it('真的同步成功后才报数量、方向与时间', () => {
    const note = cloudFooterNote(input({ signedIn: true, name: '漂流人间', count: 3, uploaded: 2, downloaded: 1, at: AT }));
    expect(note).toBe('已登录：漂流人间 · 已与云端同步 3 个项目（↑2 ↓1） · 10:41');
  });

  it('没有传输时省略方向', () => {
    const note = cloudFooterNote(input({ signedIn: true, name: '漂流人间', count: 2, at: AT }));
    expect(note).toBe('已登录：漂流人间 · 已与云端同步 2 个项目 · 10:41');
  });

  it('有冲突时不能假装同步完了', () => {
    const note = cloudFooterNote(
      input({ signedIn: true, name: '漂流人间', conflicts: 2, count: 3, at: AT }),
    );
    expect(note).toContain('2 个项目两边都改过');
    expect(note).not.toContain('已与云端同步 3 个项目');
  });

  it('失败时说明项目仍在本机，且不冒充成功', () => {
    const note = cloudFooterNote(
      input({ signedIn: true, name: '漂流人间', error: 'cloud_timeout', count: 3, at: AT }),
    );
    expect(note).toContain('同步失败');
    expect(note).toContain('仍保存在本机');
    expect(note).not.toContain('已与云端同步');
  });

  it('没有昵称时用微信用户兜底', () => {
    expect(cloudFooterNote(input({ signedIn: true }))).toContain('微信用户');
  });

  it('抽屉副标题同样按真实状态说话', () => {
    expect(cloudAccountNote(input())).toBe('未登录');
    expect(cloudAccountNote(input({ signedIn: true, count: 2, at: AT }))).toBe('已同步 2 个项目 · 10:41');
    expect(cloudAccountNote(input({ signedIn: true, syncing: true }))).toBe('正在与云端同步…');
    expect(cloudAccountNote(input({ signedIn: true, conflicts: 1 }))).toBe('1 个项目冲突待处理');
    expect(cloudAccountNote(input({ signedIn: true, error: 'upload_failed' }))).toContain('仍在本机');
  });

  it('时间格式化容错', () => {
    expect(backupClock(null)).toBe('');
    expect(backupClock('not-a-date')).toBe('');
    expect(backupClock(AT)).toBe('10:41');
    expect(dateTimeLabel(null)).toBe('时间未知');
    expect(dateTimeLabel(AT)).toBe('11月13日 10:41');
  });
});
