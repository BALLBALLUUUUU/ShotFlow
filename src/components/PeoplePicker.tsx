import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import {
  PERSON_ROLE_LABELS,
  applyPersonSelection,
  groupPeople,
  personInitials,
  personLabel,
  selectedPersonIds,
} from '@/domain/people';
import type { Person, PersonRole } from '@/domain/types';

interface PeoplePickerProps {
  people: Person[];
  /** 当前名单，如 ['导演 球球', '摄影 陈默']；手写条目会原样保留 */
  tokens: string[];
  /** 可调用的人员分组；不传表示全部 */
  roles?: PersonRole[];
  icon: ReactNode;
  placeholder: string;
  ariaLabel: string;
  onChange: (tokens: string[]) => void;
}

function splitTokens(value: string): string[] {
  return value
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 拍摄计划里的人员输入：可直接手打，也可从项目人员库勾选。
 * 勾选后按「部门 姓名」写回，通告与流程单不用再改格式。
 */
export default function PeoplePicker({
  people,
  tokens,
  roles,
  icon,
  placeholder,
  ariaLabel,
  onChange,
}: PeoplePickerProps) {
  const joined = tokens.join('、');
  const [draft, setDraft] = useState(joined);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [popMax, setPopMax] = useState(330);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(joined);
  }, [joined]);

  /** 靠近窗口底部时向上翻，并按可用高度收紧，避免面板被裁掉 */
  function toggleOpen() {
    if (!open) {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) {
        const below = window.innerHeight - rect.bottom;
        const above = rect.top;
        const up = below < 360 && above > below;
        const space = (up ? above : below) - 14;
        setDropUp(up);
        setPopMax(Math.max(180, Math.min(430, space)));
      }
    }
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const candidates = useMemo(
    () => (roles ? people.filter((person) => roles.includes(person.role)) : people),
    [people, roles],
  );

  const selectedIds = useMemo(() => selectedPersonIds(splitTokens(draft), people), [draft, people]);
  const selectedSet = new Set(selectedIds);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return candidates.filter((person) => {
      // 已选中的人始终显示，方便取消
      if (!person.active && !selectedSet.has(person.id)) return false;
      if (!keyword) return true;
      return [person.name, person.title, PERSON_ROLE_LABELS[person.role]]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
    // selectedSet 由 selectedIds 派生，依赖 selectedIds 即可
  }, [candidates, query, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(value: string) {
    const next = splitTokens(value);
    if (next.join('、') !== joined) onChange(next);
  }

  function toggle(person: Person) {
    const base = splitTokens(draft);
    const ids = new Set(selectedPersonIds(base, people));
    if (ids.has(person.id)) ids.delete(person.id);
    else ids.add(person.id);
    const next = applyPersonSelection(base, people, ids);
    setDraft(next.join('、'));
    onChange(next);
  }

  const groups = groupPeople(visible);

  return (
    <div className="people-field" ref={rootRef}>
      <div className="inline-field">
        {icon}
        <input
          className="text-input"
          value={draft}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
              setOpen(false);
            }
          }}
        />
        <button
          className={open ? 'people-pick active' : 'people-pick'}
          type="button"
          title="从人员库选择"
          onClick={toggleOpen}
        >
          <UserPlus size={13} />
          {selectedIds.length > 0 ? <span>{selectedIds.length}</span> : null}
        </button>
      </div>

      {open ? (
        <div
          className={dropUp ? 'people-pop up' : 'people-pop'}
          style={{ maxHeight: popMax }}
          role="dialog"
          aria-label={ariaLabel}
        >
          <div className="people-pop-head">
            <strong>从人员库选择</strong>
            <button className="icon-btn small" type="button" onClick={() => setOpen(false)} aria-label="关闭">
              <X size={13} />
            </button>
          </div>
          {candidates.length > 6 ? (
            <label className="people-pop-search">
              <Search size={12} />
              <input
                value={query}
                placeholder="搜索姓名或职务"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          ) : null}
          <div className="people-pop-list">
            {groups.length === 0 ? <p className="people-pop-empty">人员库里还没有人，去「人员」页新增。</p> : null}
            {groups.map((group) => (
              <div className="people-pop-group" key={group.role}>
                <div className="people-pop-group-head">{group.label}</div>
                {group.people.map((person) => {
                  const checked = selectedSet.has(person.id);
                  return (
                    <button
                      className={checked ? 'people-pop-item checked' : 'people-pop-item'}
                      type="button"
                      key={person.id}
                      onClick={() => toggle(person)}
                    >
                      <span className={checked ? 'checkbox checked' : 'checkbox'} aria-hidden="true" />
                      <span className="people-pop-avatar">{personInitials(person.name)}</span>
                      <span className="people-pop-name">{personLabel(person)}</span>
                      {person.title ? <span className="people-pop-title">{person.title}</span> : null}
                      {!person.active ? <span className="badge">已停用</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="people-pop-foot">
            <button
              className="link-btn"
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                const kept = splitTokens(draft).filter((token) => !selectedPersonIds([token], people).length);
                setDraft(kept.join('、'));
                onChange(kept);
              }}
            >清空已选</button>
            <button className="btn compact" type="button" onClick={() => setOpen(false)}>完成</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
