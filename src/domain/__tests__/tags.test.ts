import { describe, expect, it } from 'vitest';
import {
  PROJECT_TAGS,
  filterByTags,
  groupByTags,
  normalizeTag,
  tagColor,
  tagCounts,
  tagMeta,
} from '../tags';
import { createEmptyProject, createSampleProject, deserializeProject, serializeProject } from '../project';
import { metaFromProject, normalizeIndex } from '../library';
import { upgradedSample } from '../sampleUpgrade';
import type { ProjectTag } from '../types';
interface Item {
  id: string;
  tag: ProjectTag | null;
}

const item = (id: string, tag: ProjectTag | null): Item => ({ id, tag });

const sample: Item[] = [
  item('a', 'blue'),
  item('b', null),
  item('c', 'red'),
  item('d', 'red'),
  item('e', 'gray'),
];

describe('颜色标签基础', () => {
  it('七个颜色 id 唯一，且都带有色值与语义提示', () => {
    expect(PROJECT_TAGS).toHaveLength(7);
    expect(new Set(PROJECT_TAGS.map((tag) => tag.id)).size).toBe(7);
    for (const tag of PROJECT_TAGS) {
      expect(tag.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tag.hint).toContain(tag.name);
    }
  });

  it('normalizeTag 只放行已知颜色，其余一律归为无标签', () => {
    expect(normalizeTag('red')).toBe('red');
    expect(normalizeTag('purple')).toBe('purple');
    expect(normalizeTag('#ff0000')).toBeNull();
    expect(normalizeTag('RED')).toBeNull();
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag(3)).toBeNull();
    expect(normalizeTag({ id: 'red' })).toBeNull();
  });

  it('tagMeta / tagColor 对无标签返回空值，不抛错', () => {
    expect(tagMeta('green')?.name).toBe('绿');
    expect(tagMeta(null)).toBeNull();
    expect(tagColor('green')).toBe(tagMeta('green')?.color);
    expect(tagColor(null)).toBeNull();
  });
});

describe('筛选与分区', () => {
  it('未选择任何颜色时不筛选，返回原数组', () => {
    expect(filterByTags(sample, [])).toBe(sample);
  });

  it('单选、多选、仅未标注都按预期过滤', () => {
    expect(filterByTags(sample, ['red']).map((entry) => entry.id)).toEqual(['c', 'd']);
    expect(filterByTags(sample, ['red', 'blue']).map((entry) => entry.id)).toEqual(['a', 'c', 'd']);
    expect(filterByTags(sample, [null]).map((entry) => entry.id)).toEqual(['b']);
    expect(filterByTags(sample, ['gray', null]).map((entry) => entry.id)).toEqual(['b', 'e']);
  });

  it('不存在的颜色组合返回空列表，而不是全量', () => {
    expect(filterByTags(sample, ['orange'])).toEqual([]);
  });

  it('分区按红→橙→黄→绿→蓝→紫→灰→未标注固定排序，空分区不出现', () => {
    const sections = groupByTags(sample);
    expect(sections.map((section) => section.tag)).toEqual(['red', 'blue', 'gray', null]);
    expect(sections.map((section) => section.items.length)).toEqual([2, 1, 1, 1]);
    expect(sections[3]!.name).toBe('未标注');
    expect(sections[3]!.color).toBeNull();
  });

  it('全部未标注时不产生彩色分区', () => {
    const sections = groupByTags([item('x', null), item('y', null)]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.tag).toBeNull();
  });

  it('计数只统计传入列表，并与筛选结果一致', () => {
    const counts = tagCounts(sample);
    expect(counts.counts.red).toBe(2);
    expect(counts.counts.blue).toBe(1);
    expect(counts.counts.orange).toBe(0);
    expect(counts.untagged).toBe(1);
    expect(counts.tagged).toBe(4);
    const total = Object.values(counts.counts).reduce((sum, value) => sum + value, 0) + counts.untagged;
    expect(total).toBe(sample.length);
  });
});

describe('标签落盘与兼容', () => {
  it('新项目默认无标签，序列化往返后仍保留标签', () => {
    const project = createEmptyProject('标签测试');
    expect(project.tag).toBeNull();
    const tagged = { ...project, tag: 'orange' as ProjectTag };
    expect(deserializeProject(serializeProject(tagged)).tag).toBe('orange');
  });

  it('旧项目文件没有 tag 字段时降级为 null', () => {
    const legacy = JSON.stringify({ schemaVersion: 1, id: 'proj_old', name: '旧项目', shots: [] });
    expect(deserializeProject(legacy).tag).toBeNull();
  });

  it('项目文件里的非法标签被忽略', () => {
    const project = createEmptyProject('坏标签');
    const broken = JSON.stringify({ ...project, tag: 'neon' });
    expect(deserializeProject(broken).tag).toBeNull();
  });

  it('索引副本同步标签，坏值与缺字段都降级', () => {
    const project = { ...createEmptyProject('索引标签'), tag: 'purple' as ProjectTag };
    expect(metaFromProject(project).tag).toBe('purple');
    const index = normalizeIndex({
      projects: [
        { id: 'a', name: '带标签', tag: 'green' },
        { id: 'b', name: '旧记录' },
        { id: 'c', name: '坏标签', tag: 'neon' },
      ],
    });
    expect(index.projects.map((meta) => meta.tag)).toEqual(['green', null, null]);
  });

  it('示例项目升级内容时保留用户打的颜色标签', () => {
    const sample = { ...createSampleProject(), tag: 'red' as ProjectTag, sampleRevision: 1 };
    const upgraded = upgradedSample(sample, '2026-11-12T00:00:00.000Z');
    expect(upgraded.tag).toBe('red');
    expect(upgraded.id).toBe(sample.id);
    expect(upgraded.name).toBe(sample.name);
  });
});
