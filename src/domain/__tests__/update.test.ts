import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  normalizeTagVersion,
  parseRepoRef,
  releaseTagUrl,
  releasesUrl,
} from '@/domain/update';

describe('更新仓库解析', () => {
  it('接受 owner/repo 与常见的 GitHub 写法', () => {
    expect(parseRepoRef('yqiu/shotflow')?.slug).toBe('yqiu/shotflow');
    expect(parseRepoRef('  yqiu/shotflow  ')?.slug).toBe('yqiu/shotflow');
    expect(parseRepoRef('https://github.com/yqiu/shotflow')?.slug).toBe('yqiu/shotflow');
    expect(parseRepoRef('github.com/yqiu/shotflow/')?.slug).toBe('yqiu/shotflow');
    expect(parseRepoRef('https://github.com/yqiu/shotflow.git')?.slug).toBe('yqiu/shotflow');
  });

  it('拒绝缺少 owner、多余层级与非法字符', () => {
    expect(parseRepoRef('')).toBeNull();
    expect(parseRepoRef('shotflow')).toBeNull();
    expect(parseRepoRef('a/b/c')).toBeNull();
    expect(parseRepoRef('yi qiu/shotflow')).toBeNull();
    expect(parseRepoRef('https://gitlab.com/a/b')).toBeNull();
  });

  it('拼出发布页与 tag 链接', () => {
    const ref = parseRepoRef('yqiu/shotflow')!;
    expect(releasesUrl(ref)).toBe('https://github.com/yqiu/shotflow/releases');
    expect(releaseTagUrl(ref, 'v1.0.0')).toBe('https://github.com/yqiu/shotflow/releases/tag/v1.0.0');
  });
});

describe('版本比较', () => {
  it('按段比较，缺省位补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('v1.2', '1.10')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('忽略前缀 v 与预发布后缀', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1-beta.2', '1.0.1')).toBe(0);
    expect(compareVersions('1.0.1-beta', '1.0.0')).toBe(1);
  });

  it('空值按 0 处理，不会误报新版本', () => {
    expect(compareVersions('', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.0.0', '1.0.0')).toBe(-1);
  });
});

describe('tag 归一化', () => {
  it('去掉 v 前缀，空值兜底 0.0.0', () => {
    expect(normalizeTagVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeTagVersion(' 1.2.3 ')).toBe('1.2.3');
    expect(normalizeTagVersion('')).toBe('0.0.0');
  });
});
