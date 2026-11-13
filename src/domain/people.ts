// 人员库：项目内统一维护主创与演员，拍摄计划、通告按需调用
import type { Person, PersonRole } from './types';

export const PERSON_ROLES: PersonRole[] = [
  'director',
  'camera',
  'lighting',
  'sound',
  'art',
  'producer',
  'actor',
  'other',
];

export const PERSON_ROLE_LABELS: Record<PersonRole, string> = {
  director: '导演组',
  camera: '摄影组',
  lighting: '灯光组',
  sound: '录音组',
  art: '美术组',
  producer: '制片组',
  actor: '演员',
  other: '其他',
};

/** 写进拍摄日 / 通告时的前缀，未分组的人只写姓名 */
const ROLE_PREFIX: Record<PersonRole, string> = {
  director: '导演',
  camera: '摄影',
  lighting: '灯光',
  sound: '录音',
  art: '美术',
  producer: '制片',
  actor: '演员',
  other: '',
};

const ROLE_ORDER = new Map<PersonRole, number>(PERSON_ROLES.map((role, index) => [role, index]));

export function createPerson(patch: Partial<Omit<Person, 'id'>> = {}): Person {
  return {
    id: `pp_${crypto.randomUUID()}`,
    name: '',
    role: 'other',
    title: '',
    phone: '',
    note: '',
    active: true,
    ...patch,
  };
}

/** 「导演 球球」：拍摄日里沿用这种写法，通告与导出不用再改 */
export function personLabel(person: Person): string {
  const prefix = ROLE_PREFIX[person.role];
  const name = person.name.trim();
  return prefix && name ? `${prefix} ${name}` : name;
}

export function personInitials(name: string): string {
  const text = name.trim();
  if (!text) return '?';
  // 中文取姓，英文取首字母
  if (/[\u4e00-\u9fa5]/.test(text)) return text.slice(0, 1);
  return text.slice(0, 1).toUpperCase();
}

/** 某条字符串（如「导演 球球」）是否属于这个人 */
export function tokenBelongsTo(token: string, person: Person): boolean {
  const name = person.name.trim();
  if (!name) return false;
  const text = token.trim();
  if (text === name || text === personLabel(person)) return true;
  // 允许「主演 阿岚」这类自定义前缀
  return text.endsWith(` ${name}`);
}

export function ownerOfToken(token: string, people: Person[]): Person | null {
  return people.find((person) => tokenBelongsTo(token, person)) ?? null;
}

export function selectedPersonIds(tokens: string[], people: Person[]): string[] {
  const ids: string[] = [];
  for (const token of tokens) {
    const owner = ownerOfToken(token, people);
    if (owner && !ids.includes(owner.id)) ids.push(owner.id);
  }
  return ids;
}

/**
 * 按勾选结果重写列表：已选的人统一写成「部门 姓名」，
 * 取消勾选的人从列表移除，不认识的手写条目原样保留。
 */
export function applyPersonSelection(
  current: string[],
  people: Person[],
  selectedIds: Iterable<string>,
): string[] {
  const ids = new Set(selectedIds);
  const next: string[] = [];
  const used = new Set<string>();

  for (const token of current) {
    const owner = ownerOfToken(token, people);
    if (!owner) {
      if (token.trim()) next.push(token.trim());
      continue;
    }
    if (!ids.has(owner.id) || used.has(owner.id)) continue;
    used.add(owner.id);
    next.push(personLabel(owner));
  }

  for (const person of people) {
    if (!ids.has(person.id) || used.has(person.id) || !person.name.trim()) continue;
    next.push(personLabel(person));
    used.add(person.id);
  }

  return next;
}

/** 删除人员时把他从名单里摘掉，不留空串 */
export function stripPerson(tokens: string[], person: Person): string[] {
  return tokens.filter((token) => !tokenBelongsTo(token, person));
}

export interface PersonGroup {
  role: PersonRole;
  label: string;
  people: Person[];
}

/** 按部门分组，组序固定；组内保持录入顺序 */
export function groupPeople(people: Person[]): PersonGroup[] {
  const groups: PersonGroup[] = [];
  for (const role of PERSON_ROLES) {
    const members = people.filter((person) => person.role === role);
    if (members.length > 0) groups.push({ role, label: PERSON_ROLE_LABELS[role], people: members });
  }
  return groups;
}

export function sortPeople(people: Person[]): Person[] {
  return [...people].sort((a, b) => (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99));
}

/** 项目内不允许重名，否则「导演 球球」这样的字符串无法判断归属 */
export function findDuplicateName(people: Person[], name: string, exceptId?: string): Person | null {
  const target = name.trim();
  if (!target) return null;
  return people.find((person) => person.id !== exceptId && person.name.trim() === target) ?? null;
}
