import { useMemo, useState } from 'react';
import { Check, Pencil, Phone, Plus, Trash2, UserRound, X } from 'lucide-react';
import {
  PERSON_ROLES,
  PERSON_ROLE_LABELS,
  findDuplicateName,
  personInitials,
  sortPeople,
  tokenBelongsTo,
} from '@/domain/people';
import { useProjectStore } from '@/store/useProjectStore';
import type { Person, PersonRole } from '@/domain/types';

const ROLE_COLORS: Record<PersonRole, string> = {
  director: '#d99a2b',
  camera: '#4f96e0',
  lighting: '#e08a45',
  sound: '#7f7ce0',
  art: '#c06bc4',
  producer: '#3fa383',
  actor: '#d96a8a',
  other: '#8b93a1',
};

interface Draft {
  name: string;
  role: PersonRole;
  title: string;
  phone: string;
  note: string;
  active: boolean;
}

function draftOf(person: Person | null): Draft {
  if (!person) return { name: '', role: 'director', title: '', phone: '', note: '', active: true };
  return {
    name: person.name,
    role: person.role,
    title: person.title,
    phone: person.phone,
    note: person.note,
    active: person.active,
  };
}

function PersonDrawer({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const people = useProjectStore((state) => state.project.people);
  const addPerson = useProjectStore((state) => state.addPerson);
  const updatePersonById = useProjectStore((state) => state.updatePersonById);
  const deletePersonById = useProjectStore((state) => state.deletePersonById);
  const [draft, setDraft] = useState<Draft>(() => draftOf(person));
  const [error, setError] = useState('');

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function save() {
    const name = draft.name.trim();
    if (!name) {
      setError('请填写姓名');
      return;
    }
    if (findDuplicateName(people, name, person?.id)) {
      setError(`已有同名人员「${name}」，换个称呼或加个姓氏`);
      return;
    }
    const patch = {
      name,
      role: draft.role,
      title: draft.title.trim(),
      phone: draft.phone.trim(),
      note: draft.note.trim(),
      active: draft.active,
    };
    if (person) updatePersonById(person.id, patch);
    else addPerson(patch);
    onClose();
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>{person ? `编辑 ${person.name}` : '新增人员'}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>

        <div className="drawer-section grow">
          <div className="field-grid">
            <label className="field">
              <span>姓名</span>
              <input
                className="text-input"
                value={draft.name}
                autoFocus
                placeholder="如 球球"
                onChange={(event) => set('name', event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>分组</span>
              <select
                className="select-input"
                value={draft.role}
                onChange={(event) => set('role', event.currentTarget.value as PersonRole)}
              >
                {PERSON_ROLES.map((role) => (
                  <option key={role} value={role}>{PERSON_ROLE_LABELS[role]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>职务</span>
              <input
                className="text-input"
                value={draft.title}
                placeholder="如 DP / 掌机"
                onChange={(event) => set('title', event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>电话</span>
              <input
                className="text-input"
                value={draft.phone}
                placeholder="选填，通告里方便联系"
                onChange={(event) => set('phone', event.currentTarget.value)}
              />
            </label>
          </div>
          <label className="field field-wide">
            <span>备注</span>
            <textarea
              className="text-input"
              rows={3}
              value={draft.note}
              placeholder="如 自备器材 / 档期限制 / 连戏要求"
              onChange={(event) => set('note', event.currentTarget.value)}
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => set('active', event.currentTarget.checked)}
            />
            <span>参与本项目（关闭后不出现在选人面板）</span>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
        </div>

        <footer className="drawer-foot">
          <span className="drawer-foot-hint">姓名会写进拍摄日名单、通告与流程单</span>
          <div>
            {person ? (
              <button
                className="btn ghost danger"
                type="button"
                onClick={() => {
                  if (window.confirm(`删除「${person.name}」？拍摄日名单里也会一并移除。`)) {
                    deletePersonById(person.id);
                    onClose();
                  }
                }}
              ><Trash2 size={14} />删除</button>
            ) : null}
            <button className="btn ghost" type="button" onClick={onClose}>取消</button>
            <button className="btn primary" type="button" onClick={save}><Check size={15} />保存</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export default function PeoplePage() {
  const people = useProjectStore((state) => state.project.people);
  const days = useProjectStore((state) => state.project.days);
  const updatePersonById = useProjectStore((state) => state.updatePersonById);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<PersonRole | 'all'>('all');
  const [editing, setEditing] = useState<{ person: Person | null } | null>(null);

  const searched = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return people;
    return people.filter((person) => (
      [person.name, person.title, person.phone, person.note, PERSON_ROLE_LABELS[person.role]]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    ));
  }, [people, query]);

  const cards = useMemo(
    () => sortPeople(roleFilter === 'all' ? searched : searched.filter((person) => person.role === roleFilter)),
    [searched, roleFilter],
  );
  const activeCount = people.filter((person) => person.active).length;
  const roleCount = new Set(people.map((person) => person.role)).size;

  /** 这个人被排进了几个拍摄日 */
  function usageOf(person: Person): number {
    return days.filter((day) => [...day.crew, ...day.actors].some((token) => tokenBelongsTo(token, person))).length;
  }

  return (
    <section className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>人员</h1>
          <span className="help-dot" title="一次录入全组人员，拍摄计划里直接勾选，通告与流程单自动带出称呼">?</span>
          <button className="btn primary" type="button" onClick={() => setEditing({ person: null })}>
            <Plus size={15} />新增人员
          </button>
        </div>
        <div className="tool-row">
          <span className="grid-stat">
            {people.length} 人 · {roleCount} 个组 · 参与中 {activeCount} 人
          </span>
          <input
            className="text-input people-search"
            value={query}
            placeholder="搜索姓名 / 职务 / 电话"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      </div>

      {people.length === 0 ? (
        <div className="people-empty">
          <UserRound size={26} />
          <p>还没有录人员</p>
          <span>把导演、摄影、灯光、录音、制片和演员录进来，拍摄计划里点一下就排进当天名单。</span>
          <button className="btn primary" type="button" onClick={() => setEditing({ person: null })}>
            <Plus size={15} />新增人员
          </button>
        </div>
      ) : null}

      {people.length > 0 ? (
        <div className="people-filter">
          <button
            className={roleFilter === 'all' ? 'role-chip active' : 'role-chip'}
            type="button"
            onClick={() => setRoleFilter('all')}
          >全部 <i>{searched.length}</i></button>
          {PERSON_ROLES.map((role) => {
            const count = searched.filter((person) => person.role === role).length;
            if (count === 0) return null;
            return (
              <button
                className={roleFilter === role ? 'role-chip active' : 'role-chip'}
                type="button"
                key={role}
                onClick={() => setRoleFilter(role)}
              >
                <span className="role-dot" style={{ background: ROLE_COLORS[role] }} />
                {PERSON_ROLE_LABELS[role]} <i>{count}</i>
              </button>
            );
          })}
        </div>
      ) : null}

      {people.length > 0 && cards.length === 0 ? (
        <p className="people-empty-text">没有匹配的人员，换个关键词或切回「全部」。</p>
      ) : null}

      <div className="people-cards">
        {cards.map((person) => {
          const color = ROLE_COLORS[person.role];
          const used = usageOf(person);
          return (
            <article className={person.active ? 'person-card' : 'person-card inactive'} key={person.id}>
              <div
                className="person-avatar"
                style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
              >{personInitials(person.name)}</div>
              <div className="person-main">
                <div className="person-name-row">
                  <strong>{person.name}</strong>
                  {person.title ? <span className="person-title">{person.title}</span> : null}
                </div>
                <div className="person-meta">
                  <span className="person-role" style={{ color }}>{PERSON_ROLE_LABELS[person.role]}</span>
                  {person.phone ? <span className="person-phone"><Phone size={11} />{person.phone}</span> : null}
                  <span className="badge">{used > 0 ? `已排 ${used} 个拍摄日` : '尚未排期'}</span>
                </div>
                {person.note ? <p className="person-note">{person.note}</p> : null}
              </div>
              <div className="person-ops">
                <button
                  className={person.active ? 'person-state on' : 'person-state'}
                  type="button"
                  title={person.active ? '点击停用：选人面板里不再出现' : '点击启用：可被拍摄计划调用'}
                  onClick={() => updatePersonById(person.id, { active: !person.active })}
                >{person.active ? '参与中' : '已停用'}</button>
                <button
                  className="icon-btn small"
                  type="button"
                  title="编辑"
                  onClick={() => setEditing({ person })}
                ><Pencil size={13} /></button>
              </div>
            </article>
          );
        })}
      </div>

      {editing ? <PersonDrawer person={editing.person} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
