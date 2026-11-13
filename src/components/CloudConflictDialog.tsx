/**
 * 云端冲突弹窗：同一个项目在本机和云端都改过时，让用户决定保留哪一版。
 *
 * 默认选「两个都留」——它永远不会丢数据；「保留本机」会用本机覆盖云端，
 * 「用云端」会用云端覆盖本机。
 */
import { useEffect, useState } from 'react';
import { Cloud, Copy, HardDrive, TriangleAlert, X } from 'lucide-react';
import { dateTimeLabel } from '@/domain/cloudStatus';
import {
  dismissConflicts,
  resolveConflicts,
  useCloudSync,
  type ConflictChoice,
} from '@/store/cloudSync';

const OPTIONS: { value: ConflictChoice; label: string; hint: string }[] = [
  { value: 'local', label: '保留本机', hint: '用本机版本覆盖云端' },
  { value: 'remote', label: '用云端', hint: '用云端版本覆盖本机' },
  { value: 'both', label: '两个都留', hint: '云端版本另存为副本' },
];

export default function CloudConflictDialog() {
  const conflicts = useCloudSync((state) => state.conflicts);
  const open = useCloudSync((state) => state.conflictsOpen);
  const resolving = useCloudSync((state) => state.resolving);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});

  // 冲突列表变了就回到默认选择，避免上一轮的选择串到新项目上
  useEffect(() => {
    setChoices({});
  }, [conflicts]);

  if (!open || conflicts.length === 0) return null;

  const pick = (id: string): ConflictChoice => choices[id] ?? 'both';
  const apply = () => {
    const payload: Record<string, ConflictChoice> = {};
    for (const item of conflicts) payload[item.id] = pick(item.id);
    void resolveConflicts(payload);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !resolving) dismissConflicts(); }}>
      <div className="modal conflict-modal" role="dialog" aria-modal="true" aria-label="云端冲突">
        <header className="conflict-head">
          <div>
            <h2><TriangleAlert size={17} />这些项目两边都改过</h2>
            <p>为了不覆盖你的内容，这里不会自动选。逐条确认后才会同步。</p>
          </div>
          <button className="icon-btn" type="button" aria-label="稍后处理" disabled={resolving} onClick={dismissConflicts}>
            <X size={17} />
          </button>
        </header>

        <div className="conflict-list">
          {conflicts.map((item) => {
            const choice = pick(item.id);
            return (
              <section className="conflict-item" key={item.id}>
                <div className="conflict-name" title={item.name}>{item.name}</div>
                <div className="conflict-sides">
                  <span className={choice === 'local' ? 'side on' : 'side'}>
                    <HardDrive size={12} />本机 · {dateTimeLabel(item.localUpdatedAt)}
                  </span>
                  <span className={choice === 'remote' ? 'side on' : 'side'}>
                    <Cloud size={12} />云端 · {dateTimeLabel(item.remoteUpdatedAt)}
                  </span>
                </div>
                <div className="conflict-options" role="group" aria-label={`${item.name} 的处理方式`}>
                  {OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="conflict-option"
                      data-on={choice === option.value}
                      title={option.hint}
                      disabled={resolving}
                      onClick={() => setChoices((prev) => ({ ...prev, [item.id]: option.value }))}
                    >
                      {option.value === 'both' ? <Copy size={12} /> : null}
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="conflict-foot">
          <span className="conflict-tip">「两个都留」会把云端版本存成「项目名（云端副本）」</span>
          <div className="conflict-actions">
            <button className="btn ghost" type="button" disabled={resolving} onClick={dismissConflicts}>稍后处理</button>
            <button className="btn primary" type="button" disabled={resolving} onClick={apply}>
              {resolving ? '正在处理…' : `应用并同步（${conflicts.length}）`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
