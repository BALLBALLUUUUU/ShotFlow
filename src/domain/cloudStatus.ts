/**
 * 云端状态的文案。
 *
 * 单独抽出来是为了能被测试盯住：
 *   1. 没有真正同步成功之前，界面不允许出现「已同步」这种话；
 *   2. 失败时必须同时说明项目仍保存在本机；
 *   3. 有冲突时不能假装同步完了。
 */
export const LOCAL_ONLY_NOTE = 'ShotFlow · 项目保存在本机，不上传云端';

export interface CloudNoteInput {
  signedIn: boolean;
  name: string | null;
  /** 正在跟云端对账 / 传输 */
  syncing: boolean;
  /** 待用户选择保留哪一版的项目数 */
  conflicts: number;
  /** 云端项目数（同步成功后才知道） */
  count: number;
  uploaded: number;
  downloaded: number;
  at: string | null;
  error: string | null;
}

export function backupClock(at: string | null): string {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 本次同步的方向统计，全为 0 时不显示 */
function flow(uploaded: number, downloaded: number): string {
  const parts: string[] = [];
  if (uploaded > 0) parts.push(`↑${uploaded}`);
  if (downloaded > 0) parts.push(`↓${downloaded}`);
  return parts.length > 0 ? `（${parts.join(' ')}）` : '';
}

/** 项目库底部状态栏 */
export function cloudFooterNote(input: CloudNoteInput): string {
  if (!input.signedIn) return LOCAL_ONLY_NOTE;
  const name = input.name || '微信用户';
  if (input.error) return `已登录：${name} · 与云端同步失败，项目仍保存在本机`;
  if (input.syncing) return `已登录：${name} · 正在与云端同步…`;
  if (input.conflicts > 0) return `已登录：${name} · ${input.conflicts} 个项目两边都改过，需要你选一版`;
  if (input.count > 0) {
    const clock = backupClock(input.at);
    return `已登录：${name} · 已与云端同步 ${input.count} 个项目${flow(input.uploaded, input.downloaded)}${clock ? ` · ${clock}` : ''}`;
  }
  return `已登录：${name} · 正在读取云端…`;
}

/** 个人设置抽屉里的账号副标题 */
export function cloudAccountNote(input: CloudNoteInput): string {
  if (!input.signedIn) return '未登录';
  if (input.error) return '同步失败，项目仍在本机';
  if (input.syncing) return '正在与云端同步…';
  if (input.conflicts > 0) return `${input.conflicts} 个项目冲突待处理`;
  if (input.count > 0) {
    const clock = backupClock(input.at);
    return `已同步 ${input.count} 个项目${clock ? ` · ${clock}` : ''}`;
  }
  return '已登录，正在读取云端';
}

/** 冲突弹窗里的时间：只到分钟，跨年才带年份 */
export function dateTimeLabel(at: string | null): string {
  if (!at) return '时间未知';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
