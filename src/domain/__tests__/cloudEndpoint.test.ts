import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_SHARECODE,
  cloudHostLabel,
  isDefaultCloud,
  maskSharecode,
  normalizeCloudTarget,
} from '../cloudEndpoint';

function ok(endpoint: string, sharecode?: string) {
  const result = normalizeCloudTarget({ endpoint, sharecode });
  if (!result.ok) throw new Error(`应当通过校验：${result.error}`);
  return result.target;
}

describe('云端地址归一化', () => {
  it('官方地址原样通过', () => {
    expect(ok(DEFAULT_CLOUD_ENDPOINT, DEFAULT_CLOUD_SHARECODE)).toEqual({
      endpoint: DEFAULT_CLOUD_ENDPOINT,
      sharecode: DEFAULT_CLOUD_SHARECODE,
    });
  });

  it('接受 WorkBuddy 应用分配的域名', () => {
    expect(ok('https://friend-demo.app.workbuddy.host')).toEqual({
      endpoint: 'https://friend-demo.app.workbuddy.host',
      sharecode: '',
    });
  });

  it('去掉结尾斜杠、路径，主机名统一小写', () => {
    expect(ok('HTTPS://Friend.app.workbuddy.host/PATH/?x=1').endpoint)
      .toBe('https://friend.app.workbuddy.host');
  });

  it('从粘贴的完整链接里带出访问码', () => {
    expect(ok('https://shotflow.app.workbuddy.host/?sharecode=3ZR6HXGIGI').sharecode).toBe('3ZR6HXGIGI');
  });

  it('手填的访问码优先于链接里的', () => {
    expect(ok('https://shotflow.app.workbuddy.host/?sharecode=AAA111', 'BBB222').sharecode).toBe('BBB222');
  });

  it('拒绝 http 与任意域名', () => {
    expect(normalizeCloudTarget({ endpoint: 'http://shotflow.app.workbuddy.host' })).toMatchObject({
      ok: false, error: expect.stringContaining('https'),
    });
    expect(normalizeCloudTarget({ endpoint: 'https://evil.example.com' })).toMatchObject({
      ok: false, error: expect.stringContaining('WorkBuddy'),
    });
    expect(normalizeCloudTarget({ endpoint: 'https://workbuddy.host.evil.com' }).ok).toBe(false);
  });

  it('空地址与乱码都给出可读提示', () => {
    expect(normalizeCloudTarget({ endpoint: '   ' })).toMatchObject({ ok: false });
    expect(normalizeCloudTarget({ endpoint: 'shotflow.app.workbuddy.host' })).toMatchObject({
      ok: false, error: expect.stringContaining('https://'),
    });
  });

  it('非法访问码被拦下', () => {
    const result = normalizeCloudTarget({ endpoint: DEFAULT_CLOUD_ENDPOINT, sharecode: '有中文' });
    expect(result.ok).toBe(false);
  });
});

describe('展示辅助', () => {
  it('只显示主机名', () => {
    expect(cloudHostLabel('https://shotflow.app.workbuddy.host')).toBe('shotflow.app.workbuddy.host');
    expect(cloudHostLabel(null)).toBe('shotflow.app.workbuddy.host');
  });

  it('官方云判定', () => {
    expect(isDefaultCloud(DEFAULT_CLOUD_ENDPOINT)).toBe(true);
    expect(isDefaultCloud('https://shotflow.app.workbuddy.host/')).toBe(true);
    expect(isDefaultCloud('https://friend.app.workbuddy.host')).toBe(false);
    expect(isDefaultCloud(null)).toBe(true);
  });

  it('访问码打码，不整串外露', () => {
    expect(maskSharecode('3ZR6HXGIGI')).toBe('3ZR****GI');
    expect(maskSharecode('')).toBe('未设置');
    expect(maskSharecode('abc')).toBe('ab****');
  });
});
