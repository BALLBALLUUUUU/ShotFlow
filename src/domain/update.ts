/**
 * 版本号与「检查更新」相关的纯函数。
 *
 * 只有解析与比较，不含网络请求：桌面端交给主进程走 IPC，
 * 浏览器预览时由组件自己 fetch，两条路都复用这里的类型与比较逻辑。
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** owner/repo，拼链接用 */
  slug: string;
}

export interface LatestRelease {
  /** 去掉前缀 v 的版本号 */
  version: string;
  /** GitHub 上的原始 tag */
  tag: string;
  url: string;
  name: string;
  notes: string;
  publishedAt: string;
}

/** 接受 `owner/repo`、`https://github.com/owner/repo`、带 .git 或末尾斜杠的写法 */
export function parseRepoRef(input: string): RepoRef | null {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const stripped = text
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const parts = stripped.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  // GitHub 的用户名/仓库名只允许字母数字与 . _ -
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(owner) || !valid.test(repo)) return null;
  return { owner, repo, slug: `${owner}/${repo}` };
}

export function releasesUrl(ref: RepoRef): string {
  return `https://github.com/${ref.slug}/releases`;
}

export function releaseTagUrl(ref: RepoRef, tag: string): string {
  return `https://github.com/${ref.slug}/releases/tag/${encodeURIComponent(tag)}`;
}

/** 语义化版本比较：a 比 b 新返回 1，旧返回 -1，相同返回 0 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => {
    const cleaned = String(value ?? '').trim().replace(/^v/i, '').split(/[+-]/)[0] ?? '';
    return cleaned.split('.').map((part) => {
      const digits = part.replace(/[^\d]/g, '');
      const num = Number.parseInt(digits, 10);
      return Number.isFinite(num) ? num : 0;
    });
  };
  const left = parse(a);
  const right = parse(b);
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

/** `v1.2.3` → `1.2.3`，空值兜底成 0.0.0 */
export function normalizeTagVersion(tag: string): string {
  const value = String(tag ?? '').trim().replace(/^v/i, '');
  return value || '0.0.0';
}
