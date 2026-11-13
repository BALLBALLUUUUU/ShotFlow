/**
 * 项目颜色标签：只存颜色 id（写入项目文件 + 项目库索引），
 * 具体色值与语义集中在这里，避免 UI 里散落硬编码。
 * 颜色值对浅色/深色主题都做过对比度校验，卡片色条、筛选点、分区标题共用同一份。
 */
import type { ProjectTag } from './types';

export interface TagMeta {
  id: ProjectTag;
  /** 颜色名，用于筛选条与分区标题 */
  name: string;
  /** 语义提示（tooltip），帮用户建立「颜色 = 优先级」的固定用法 */
  hint: string;
  color: string;
}

export const PROJECT_TAGS: readonly TagMeta[] = [
  { id: 'red', name: '红', hint: '红 · 紧急 / 最高优先级', color: '#de5a4e' },
  { id: 'orange', name: '橙', hint: '橙 · 重要 / 优先处理', color: '#e0913c' },
  { id: 'yellow', name: '黄', hint: '黄 · 常规 / 进行中', color: '#d3a72c' },
  { id: 'green', name: '绿', hint: '绿 · 已完成 / 可归档', color: '#4fa268' },
  { id: 'blue', name: '蓝', hint: '蓝 · 待定 / 待确认', color: '#4a8ed4' },
  { id: 'purple', name: '紫', hint: '紫 · 参考 / 备选', color: '#9375cd' },
  { id: 'gray', name: '灰', hint: '灰 · 搁置 / 归档', color: '#8e949c' },
];

const TAG_IDS = new Set<string>(PROJECT_TAGS.map((tag) => tag.id));

/** 防御性归一化：未知颜色、旧文件缺字段一律降级为「无标签」 */
export function normalizeTag(value: unknown): ProjectTag | null {
  return typeof value === 'string' && TAG_IDS.has(value) ? (value as ProjectTag) : null;
}

export function tagMeta(tag: ProjectTag | null | undefined): TagMeta | null {
  if (!tag) return null;
  return PROJECT_TAGS.find((item) => item.id === tag) ?? null;
}

export function tagColor(tag: ProjectTag | null | undefined): string | null {
  return tagMeta(tag)?.color ?? null;
}

export interface TagSection<T> {
  tag: ProjectTag | null;
  name: string;
  color: string | null;
  items: T[];
}

/** 空数组 = 不筛选；可多选，null 代表「未标注」 */
export function filterByTags<T extends { tag: ProjectTag | null }>(
  list: T[],
  selected: ReadonlyArray<ProjectTag | null>,
): T[] {
  if (selected.length === 0) return list;
  return list.filter((item) => selected.includes(item.tag));
}

/** 按固定色序分区（红→橙→黄→绿→蓝→紫→灰→未标注），空分区不输出 */
export function groupByTags<T extends { tag: ProjectTag | null }>(list: T[]): Array<TagSection<T>> {
  const sections: Array<TagSection<T>> = [];
  for (const meta of PROJECT_TAGS) {
    const items = list.filter((item) => item.tag === meta.id);
    if (items.length > 0) sections.push({ tag: meta.id, name: meta.name, color: meta.color, items });
  }
  const untagged = list.filter((item) => item.tag === null);
  if (untagged.length > 0) sections.push({ tag: null, name: '未标注', color: null, items: untagged });
  return sections;
}

export interface TagCounts {
  counts: Record<ProjectTag, number>;
  untagged: number;
  tagged: number;
}

/** 筛选条上的计数：只统计当前搜索结果，避免显示与实际列表不符 */
export function tagCounts<T extends { tag: ProjectTag | null }>(list: T[]): TagCounts {
  const counts = Object.fromEntries(PROJECT_TAGS.map((tag) => [tag.id, 0])) as Record<ProjectTag, number>;
  let untagged = 0;
  for (const item of list) {
    if (item.tag) counts[item.tag] += 1;
    else untagged += 1;
  }
  const tagged = list.length - untagged;
  return { counts, untagged, tagged };
}
