import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import { useProjectStore } from '@/store/useProjectStore';
import type { FieldKind, PresetId } from '@/domain/types';

const KINDS: Array<{ id: FieldKind; label: string }> = [
  { id: 'text', label: '单行文本' },
  { id: 'textarea', label: '多行文本' },
  { id: 'number', label: '数字' },
  { id: 'duration', label: '时长' },
  { id: 'select', label: '下拉选项' },
];

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'professional', label: '专业' },
  { id: 'simple', label: '简洁' },
  { id: 'custom', label: '自定义' },
];

export default function ColumnSettingsPanel({ onClose }: { onClose: () => void }) {
  const schema = useProjectStore((state) => state.project.columnSchema);
  const store = useProjectStore();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');

  const columns = [...schema.columns].sort((a, b) => a.order - b.order);
  const visibleCount = columns.filter((column) => column.visible).length;

  function handleAdd() {
    if (!label.trim()) return;
    store.addColumn(label, kind);
    setLabel('');
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>列设置</h2>
          <button className="icon-btn" type="button" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="drawer-section">
          <div className="section-label">字段预设</div>
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={schema.preset === preset.id ? 'preset-btn active' : 'preset-btn'}
                type="button"
                onClick={() => store.setPresetById(preset.id)}
              >{preset.label}</button>
            ))}
          </div>
          <p className="drawer-hint">共 {columns.length} 列，当前显示 {visibleCount} 列。预设只调整内置列的显隐。</p>
        </div>

        <div className="drawer-section">
          <div className="section-label">添加自定义列（数量不限）</div>
          <div className="add-col-row">
            <input
              className="text-input"
              placeholder="列名称，如「道具清单」"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleAdd(); }}
            />
            <select className="select-input" value={kind} onChange={(event) => setKind(event.target.value as FieldKind)}>
              {KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <button className="btn primary" type="button" onClick={handleAdd}><Plus size={14} />添加</button>
          </div>
        </div>

        <div className="drawer-section grow">
          <div className="section-label">列顺序与显隐</div>
          <div className="column-list">
            {columns.map((column, index) => (
              <div className="column-row" key={column.id}>
                <button
                  className="icon-btn small"
                  type="button"
                  title={column.visible ? '隐藏此列' : '显示此列'}
                  onClick={() => store.toggleColumnById(column.id)}
                >{column.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                <input
                  className="text-input col-name"
                  defaultValue={column.label}
                  key={`name-${column.id}-${column.label}`}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (next && next !== column.label) store.renameColumnById(column.id, next);
                    else event.currentTarget.value = column.label;
                  }}
                />
                <span className="kind-tag">{column.builtin ? '内置' : KINDS.find((item) => item.id === column.kind)?.label}</span>
                <input
                  className="width-input"
                  type="number"
                  min={56}
                  max={800}
                  defaultValue={column.width}
                  key={`width-${column.id}-${column.width}`}
                  title="列宽（px）"
                  onBlur={(event) => store.setColumnWidthById(column.id, Number(event.currentTarget.value))}
                />
                <button className="icon-btn small" type="button" disabled={index === 0} onClick={() => store.moveColumnById(column.id, -1)}><ArrowUp size={14} /></button>
                <button className="icon-btn small" type="button" disabled={index === columns.length - 1} onClick={() => store.moveColumnById(column.id, 1)}><ArrowDown size={14} /></button>
                <button
                  className="icon-btn small danger"
                  type="button"
                  disabled={column.builtin}
                  title={column.builtin ? '内置列不可删除' : '删除此列'}
                  onClick={() => store.removeColumnById(column.id)}
                ><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
