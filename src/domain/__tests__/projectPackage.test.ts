import { describe, expect, it } from 'vitest';
import { createEmptyProject, createShot, serializeProject } from '../project';
import {
  base64ToBytes,
  buildProjectPackage,
  bytesToBase64,
  contentHash,
  detectImportConflict,
  detectImportSource,
  readAnyProjectFile,
  readProjectPackage,
  safeFileName,
} from '../projectPackage';
import { crc32, createZip, readZip } from '../zip';

const encoder = new TextEncoder();

function projectWithImages() {
  const project = createEmptyProject('测试项目');
  const a = createShot(1);
  const b = createShot(2);
  a.frame = { id: 'img_a', path: 'data:image/png;base64,iVBORw0KGgo=', kind: 'upload', updatedAt: '2026-01-01T00:00:00.000Z' };
  a.reference = { id: 'img_b', path: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', kind: 'draw', updatedAt: '2026-01-01T00:00:00.000Z' };
  b.frame = { id: 'img_c', path: 'data:image/png;base64,iVBORw0KGgo=', kind: 'upload', updatedAt: '2026-01-01T00:00:00.000Z' };
  project.shots = [a, b];
  return project;
}

describe('ZIP 基础', () => {
  it('往返保留中文文件名与二进制内容', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 0]);
    const zip = createZip([{ name: 'assets/中文 图片.png', data: bytes }]);
    expect(readZip(zip)).toEqual([{ name: 'assets/中文 图片.png', data: bytes }]);
  });

  it('CRC 校验能发现被篡改的数据', () => {
    const zip = createZip([{ name: 'a.txt', data: encoder.encode('hello') }]);
    const broken = zip.slice();
    const at = broken.indexOf(104); // 'h'
    broken[at] = 105;
    expect(() => readZip(broken)).toThrow(/校验失败/);
  });

  it('拒绝路径穿越与重复条目', () => {
    expect(() => createZip([{ name: '../evil.txt', data: new Uint8Array() }])).toThrow(/不合法/);
    expect(() => createZip([
      { name: 'a.txt', data: new Uint8Array() },
      { name: 'a.txt', data: new Uint8Array() },
    ])).toThrow(/重复/);
  });

  it('crc32 与标准值一致', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('base64', () => {
  it('任意字节往返一致', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 100, 1024]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('统一项目包', () => {
  it('导出→导入后字段、顺序、图片完全一致，且图片已抽成独立资源', () => {
    const project = projectWithImages();
    const { bytes, manifest, fileName } = buildProjectPackage(project, '球球');

    expect(fileName).toBe('测试项目.shotflow');
    expect(manifest.assetCount).toBe(3);
    expect(manifest.author).toBe('球球');
    expect(manifest.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(manifest.contentHash).not.toBe(contentHash(serializeProject(project))); // 指纹基于「资源已分离」的正文

    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toContain('manifest.json');
    expect(entries.map((e) => e.name)).toContain('project.json');
    expect(entries.filter((e) => e.name.startsWith('assets/'))).toHaveLength(3);
    expect(entries.find((e) => e.name === 'project.json')!.data.length).toBeGreaterThan(0);
    // 资源分离后 project.json 不再包含 base64 图片体
    expect(new TextDecoder().decode(entries.find((e) => e.name === 'project.json')!.data)).not.toContain('base64,');

    const parsed = readProjectPackage(bytes);
    expect(parsed.manifest?.author).toBe('球球');
    expect(parsed.project.shots.map((shot) => shot.shotNo)).toEqual([1, 2]);
    const [importedA, importedB] = parsed.project.shots;
    const [originalA, originalB] = project.shots;
    expect(importedA?.frame?.path).toBe(originalA?.frame?.path);
    expect(importedA?.reference?.path).toBe(originalA?.reference?.path);
    expect(importedB?.frame?.path).toBe(originalB?.frame?.path);
    expect(importedB?.reference).toBeNull();
    expect(parsed.project.name).toBe('测试项目');
  });

  it('0 镜头的空白项目导出后仍是空白（不会被塞入示例）', () => {
    const blank = createEmptyProject('空白项目');
    const { bytes, manifest } = buildProjectPackage(blank);
    expect(manifest.shotCount).toBe(0);
    expect(manifest.assetCount).toBe(0);
    const parsed = readAnyProjectFile(bytes);
    expect(parsed.project.shots).toHaveLength(0);
    expect(parsed.project.scenes).toHaveLength(0);
    expect(parsed.project.days).toHaveLength(0);
    expect(parsed.project.rundown).toHaveLength(0);
  });

  it('仍可直接导入旧版纯 JSON 项目文件', () => {
    const project = projectWithImages();
    const jsonBytes = encoder.encode(serializeProject(project));
    expect(detectImportSource(jsonBytes)).toBe('legacy-json');
    const parsed = readAnyProjectFile(jsonBytes);
    expect(parsed.manifest).toBeNull();
    expect(parsed.project.shots[0]?.frame?.path).toBe(project.shots[0]?.frame?.path);
  });

  it('识别项目包 / 拒绝无法识别的文件', () => {
    const { bytes } = buildProjectPackage(createEmptyProject('X'));
    expect(detectImportSource(bytes)).toBe('package');
    expect(detectImportSource(encoder.encode('not a project'))).toBe('unknown');
    expect(() => readAnyProjectFile(encoder.encode('garbage'))).toThrow(/无法识别/);
  });

  it('缺少图片资源时明确报错，不静默丢图', () => {
    const { bytes } = buildProjectPackage(projectWithImages());
    const entries = readZip(bytes).filter((entry) => entry.name !== 'assets/img_a.png');
    // 用剩余条目重新组包（project.json 仍引用 img_a）
    const rebuilt = createZip(entries.map((entry) => ({ name: entry.name, data: entry.data })));
    expect(() => readProjectPackage(rebuilt)).toThrow(/缺少图片资源/);
  });

  it('拒绝更高版本的项目包', () => {
    const { bytes } = buildProjectPackage(createEmptyProject('X'));
    const entries = readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'manifest.json')!.data));
    manifest.formatVersion = 99;
    const rebuilt = createZip(entries.map((e) => ({
      name: e.name,
      data: e.name === 'manifest.json' ? encoder.encode(JSON.stringify(manifest)) : e.data,
    })));
    expect(() => readProjectPackage(rebuilt)).toThrow(/高于当前程序支持/);
  });

  it('文件名过滤掉 Windows 非法字符', () => {
    expect(safeFileName('a/b:c*d?')).toBe('a_b_c_d_');
    expect(safeFileName('')).toBe('未命名项目');
  });
});

describe('导入冲突判定', () => {
  const base = createEmptyProject('同 id 项目');
  base.updatedAt = '2026-11-11T10:00:00.000Z';
  const newer: typeof base = { ...base, updatedAt: '2026-11-11T12:00:00.000Z', client: '已改' };
  const older: typeof base = { ...base, updatedAt: '2026-11-11T08:00:00.000Z', client: '旧版' };

  it('本地无同 id 项目 → 全新导入', () => {
    expect(detectImportConflict(null, newer, null)).toBe('new');
  });

  it('内容指纹一致 → 无冲突', () => {
    expect(detectImportConflict(base, base, contentHash(serializeProject(base)))).toBe('identical');
  });

  it('按 updatedAt 判出谁更新', () => {
    expect(detectImportConflict(base, newer, contentHash(serializeProject(newer)))).toBe('incoming-newer');
    expect(detectImportConflict(base, older, contentHash(serializeProject(older)))).toBe('local-newer');
  });

  it('时间相同但内容不同 → 明确标为需人工决定', () => {
    expect(detectImportConflict(base, { ...base, client: '另一人改的' }, contentHash('other'))).toBe('same-time-different');
  });

  it('旧 JSON 无指纹时按内容字符串比较', () => {
    expect(detectImportConflict(base, base, null)).toBe('identical');
  });
});
