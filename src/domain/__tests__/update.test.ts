import { describe, expect, it } from 'vitest';
import {
  assetNameFromUrl,
  compareVersions,
  decideUpdate,
  formatBytes,
  normalizeTagVersion,
  parseRepoRef,
  parseUpdateManifest,
  platformFrom,
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

describe('远端清单解析', () => {
  it('接受标准清单，缺省 mandatory 视为强制', () => {
    const manifest = parseUpdateManifest({
      version: 'v1.1.0',
      notes: '修好了导出',
      page: 'https://github.com/a/b/releases',
      assets: {
        mac: 'https://github.com/a/b/releases/download/v1.1.0/ShotFlow-mac.dmg',
      },
    });
    expect(manifest?.version).toBe('1.1.0');
    expect(manifest?.mandatory).toBe(true);
    expect(manifest?.assets.mac?.name).toBe('ShotFlow-mac.dmg');
    expect(manifest?.assets.win).toBeNull();
  });

  it('显式 false 才允许不强制', () => {
    expect(parseUpdateManifest({ version: '1.1.0', mandatory: false })?.mandatory).toBe(false);
  });

  it('拒绝坏版本号、非对象与空版本', () => {
    expect(parseUpdateManifest(null)).toBeNull();
    expect(parseUpdateManifest('1.1.0')).toBeNull();
    expect(parseUpdateManifest({ version: 'latest' })).toBeNull();
    expect(parseUpdateManifest({ version: '' })).toBeNull();
  });

  it('只接受 https 的安装包地址与非可执行扩展名', () => {
    const manifest = parseUpdateManifest({
      version: '1.1.0',
      assets: {
        mac: 'http://github.com/a/b/ShotFlow-mac.dmg',
        win: 'https://github.com/a/b/setup.sh',
      },
    });
    expect(manifest?.assets.mac).toBeNull();
    expect(manifest?.assets.win).toBeNull();
  });

  it('notes 超长时截断，避免清单撑爆界面', () => {
    const manifest = parseUpdateManifest({ version: '1.1.0', notes: 'x'.repeat(9000) });
    expect(manifest?.notes.length).toBe(6000);
  });
});

describe('启动版本判定', () => {
  const manifest = parseUpdateManifest({
    version: '1.1.0',
    mandatory: true,
    assets: { mac: 'https://github.com/a/b/releases/download/v1.1.0/ShotFlow-mac.dmg' },
  });

  it('低于远端版本时可下载、强制更新', () => {
    const decision = decideUpdate('1.0.0', manifest, 'mac');
    expect(decision).toMatchObject({ hasUpdate: true, mandatory: true, canDownload: true });
    expect(decision?.downloadName).toBe('ShotFlow-mac.dmg');
  });

  it('同版本或本地更高时放行', () => {
    expect(decideUpdate('1.1.0', manifest, 'mac')?.hasUpdate).toBe(false);
    expect(decideUpdate('1.2.0', manifest, 'mac')?.hasUpdate).toBe(false);
  });

  it('没有远端清单时返回 null，调用方必须放行', () => {
    expect(decideUpdate('1.0.0', null, 'mac')).toBeNull();
  });

  it('平台没有对应安装包时不强制，避免把人锁在无法下载的页面', () => {
    const decision = decideUpdate('1.0.0', manifest, 'win');
    expect(decision?.hasUpdate).toBe(true);
    expect(decision?.canDownload).toBe(false);
    expect(decision?.downloadUrl).toBeNull();
  });

  it('清单写 mandatory:false 时不锁', () => {
    const soft = parseUpdateManifest({ version: '1.1.0', mandatory: false });
    expect(decideUpdate('1.0.0', soft, 'mac')?.mandatory).toBe(false);
  });
});

describe('平台与文件名校验', () => {
  it('把进程平台映射成三档', () => {
    expect(platformFrom('darwin')).toBe('mac');
    expect(platformFrom('win32')).toBe('win');
    expect(platformFrom('linux')).toBe('other');
  });

  it('只从 https 地址里取白名单扩展名', () => {
    expect(assetNameFromUrl('https://x.com/a/ShotFlow-mac.dmg')).toBe('ShotFlow-mac.dmg');
    expect(assetNameFromUrl('https://x.com/a/run.sh')).toBeNull();
    expect(assetNameFromUrl('http://x.com/a/ShotFlow.dmg')).toBeNull();
  });

  it('大小文案不出现 NaN', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(88 * 1024 * 1024)).toBe('88.0 MB');
    expect(formatBytes(1024)).toBe('1 KB');
  });
});
