/**
 * 云端地址（云桥页 Origin）。
 *
 * 为什么需要它：云服务按应用分配，一个应用一个云环境。默认走 ShotFlow 自带的云，
 * 但用户也可以把自己应用里发布的云桥页地址填进来，数据就落到他自己的云环境里。
 *
 * 安全约束：云桥页会被注入一个能跟主进程通信的 preload，所以只接受
 * WorkBuddy 云服务分配的域名（https + *.workbuddy.host），不接受任意地址。
 */

export const DEFAULT_CLOUD_ENDPOINT = 'https://shotflow.app.workbuddy.host';
export const DEFAULT_CLOUD_SHARECODE = '3ZR6HXGIGI';

export interface CloudTarget {
  /** 归一化后的 Origin，例如 https://shotflow.app.workbuddy.host */
  endpoint: string;
  /** 站点访问码，可留空 */
  sharecode: string;
}

export type CloudTargetResult =
  | { ok: true; target: CloudTarget }
  | { ok: false; error: string };

/** 只放行 WorkBuddy 云服务域名：平台分配的站点都是 <prefix>.app.workbuddy.host */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'workbuddy.host'
    || host.endsWith('.workbuddy.host')
    || host === 'workbuddy.cn'
    || host.endsWith('.workbuddy.cn');
}

/**
 * 归一化用户输入的云桥地址。
 *
 * 允许直接粘贴微信回调页那种带 sharecode 的完整链接：
 * https://xxx.app.workbuddy.host/?sharecode=ABC123
 * 这时会把 sharecode 一起接住，用户不用再单独填一次。
 */
export function normalizeCloudTarget(input: { endpoint: string; sharecode?: string }): CloudTargetResult {
  const raw = (input.endpoint || '').trim();
  if (!raw) return { ok: false, error: '请填写云桥地址，或点「恢复默认」' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: '地址格式不对，需要以 https:// 开头' };
  }

  if (url.protocol !== 'https:') return { ok: false, error: '只支持 https:// 地址' };
  if (!isAllowedHost(url.hostname)) {
    return { ok: false, error: '只支持 WorkBuddy 云服务分配的地址（…app.workbuddy.host）' };
  }

  // 从粘贴的链接里带出访问码，显式填写的优先
  const fromUrl = url.searchParams.get('sharecode') || '';
  const sharecode = (input.sharecode || '').trim() || fromUrl.trim();

  if (sharecode && !/^[A-Za-z0-9_-]{4,64}$/.test(sharecode)) {
    return { ok: false, error: '访问码只能包含字母、数字、下划线和连字符' };
  }

  return {
    ok: true,
    target: { endpoint: `https://${url.hostname.toLowerCase()}`, sharecode },
  };
}

/** 地址是否就是官方默认云端 */
export function isDefaultCloud(endpoint: string | null | undefined): boolean {
  if (!endpoint) return true;
  return normalizeEndpoint(endpoint) === DEFAULT_CLOUD_ENDPOINT;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

/** 界面上展示用的短名：只留主机名，避免长地址挤满一行 */
export function cloudHostLabel(endpoint: string | null | undefined): string {
  if (!endpoint) return new URL(DEFAULT_CLOUD_ENDPOINT).hostname;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

/** 访问码只显示首尾，避免截图外泄 */
export function maskSharecode(code: string): string {
  if (!code) return '未设置';
  if (code.length <= 6) return `${code.slice(0, 2)}****`;
  return `${code.slice(0, 3)}****${code.slice(-2)}`;
}
