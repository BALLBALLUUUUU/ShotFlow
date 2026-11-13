import { describe, expect, it } from 'vitest';
import {
  applyPersonSelection,
  createPerson,
  findDuplicateName,
  groupPeople,
  personInitials,
  personLabel,
  selectedPersonIds,
  stripPerson,
  tokenBelongsTo,
} from '@/domain/people';
import { createEmptyProject, createSampleProject, deserializeProject, serializeProject } from '@/domain/project';
import type { Person } from '@/domain/types';

function person(name: string, extra: Partial<Person> = {}): Person {
  return {
    id: `pp_${name}`,
    name,
    role: 'camera',
    title: '',
    phone: '',
    note: '',
    active: true,
    ...extra,
  };
}

const crew: Person[] = [
  person('球球', { role: 'director' }),
  person('陈默', { role: 'camera', title: 'DP' }),
  person('李工', { role: 'lighting' }),
  person('阿岚', { role: 'actor' }),
];

describe('人员库', () => {
  it('按部门拼出「部门 姓名」，未分组只写姓名', () => {
    expect(personLabel(crew[0]!)).toBe('导演 球球');
    expect(personLabel(crew[1]!)).toBe('摄影 陈默');
    expect(personLabel(person('小周', { role: 'other' }))).toBe('小周');
  });

  it('识别已有称呼，包含自定义前缀', () => {
    expect(tokenBelongsTo('导演 球球', crew[0]!)).toBe(true);
    expect(tokenBelongsTo('球球', crew[0]!)).toBe(true);
    expect(tokenBelongsTo('主演 阿岚', crew[3]!)).toBe(true);
    expect(tokenBelongsTo('导演 陈默', crew[3]!)).toBe(false);
    expect(tokenBelongsTo('临时演员', crew[3]!)).toBe(false);
  });

  it('勾选后写入名单，取消后移除，手写条目保留', () => {
    const base = ['导演 球球', '场务 小赵'];
    const next = applyPersonSelection(base, crew, ['pp_球球', 'pp_陈默', 'pp_李工']);
    expect(next).toEqual(['导演 球球', '场务 小赵', '摄影 陈默', '灯光 李工']);

    const removed = applyPersonSelection(next, crew, ['pp_球球', 'pp_陈默']);
    expect(removed).toEqual(['导演 球球', '场务 小赵', '摄影 陈默']);
  });

  it('取消勾选时按人名匹配，改名前的旧称呼也能删掉', () => {
    const tokens = ['导演 球球', '摄影 陈默', '球球', '场务 小赵'];
    expect(applyPersonSelection(tokens, crew, [])).toEqual(['场务 小赵']);
    // 同一个人出现两次时只保留一条
    expect(applyPersonSelection(tokens, crew, ['pp_球球'])).toEqual(['导演 球球', '场务 小赵']);
  });

  it('选中状态取自名单', () => {
    expect(selectedPersonIds(['导演 球球', '主演 阿岚', '场务 小赵'], crew)).toEqual(['pp_球球', 'pp_阿岚']);
  });

  it('删除人员时从名单里摘干净', () => {
    expect(stripPerson(['导演 球球', '球球', '摄影 陈默'], crew[0]!)).toEqual(['摄影 陈默']);
  });

  it('按固定部门顺序分组，空组不出现', () => {
    const groups = groupPeople(crew);
    expect(groups.map((group) => group.label)).toEqual(['导演组', '摄影组', '灯光组', '演员']);
    expect(groups[1]?.people.map((entry) => entry.name)).toEqual(['陈默']);
  });

  it('重名检测忽略自己', () => {
    expect(findDuplicateName(crew, '陈默')?.id).toBe('pp_陈默');
    expect(findDuplicateName(crew, '陈默', 'pp_陈默')).toBeNull();
    expect(findDuplicateName(crew, '王工')).toBeNull();
  });

  it('新建人员默认参与本项目', () => {
    const created = createPerson({ name: '王工', role: 'sound' });
    expect(created.active).toBe(true);
    expect(created.id.startsWith('pp_')).toBe(true);
  });

  it('中文取姓、英文取首字母，空名兜底', () => {
    expect(personInitials('球球')).toBe('球');
    expect(personInitials('mike')).toBe('M');
    expect(personInitials('   ')).toBe('?');
  });
});

describe('项目里的人员库', () => {
  it('新项目默认没有人员', () => {
    expect(createEmptyProject().people).toEqual([]);
  });

  it('示例项目带 6 个人，名单与人员库对得上', () => {
    const project = createSampleProject();
    expect(project.people).toHaveLength(6);
    const labels = project.people.map(personLabel);
    expect(labels).toEqual(['导演 球球', '摄影 陈默', '灯光 李工', '录音 王工', '制片 周周', '演员 阿岚']);
    const day = project.days[0]!;
    expect(day.crew.every((token) => labels.includes(token))).toBe(true);
    expect(day.actors.every((token) => labels.includes(token))).toBe(true);
  });

  it('保存再打开，人员不丢默认值', () => {
    const project = createSampleProject();
    project.people.push({ id: 'pp_x', name: '临时', role: 'other', title: '', phone: '', note: '', active: false });
    const restored = deserializeProject(serializeProject(project));
    expect(restored.people).toHaveLength(7);
    expect(restored.people.at(-1)?.active).toBe(false);
  });

  it('旧项目没有 people 字段时补空数组', () => {
    const raw = JSON.parse(serializeProject(createSampleProject()));
    delete raw.people;
    const restored = deserializeProject(JSON.stringify(raw));
    expect(restored.people).toEqual([]);
  });
});
