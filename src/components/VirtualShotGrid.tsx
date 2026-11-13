import {
  useEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type UIEvent,
} from 'react';
import { GripVertical, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { resolveFieldValue } from '@/domain/schema';
import type { CellValue } from '@/domain/shots';
import type { ColumnDef, Scene, Shot } from '@/domain/types';

const ROW_HEIGHT = 108;
const HEADER_HEIGHT = 40;
const SELECT_WIDTH = 52;
const ADD_WIDTH = 44;

interface GridItem {
  id: string;
  width: number;
  column?: ColumnDef;
}

interface Props {
  shots: Shot[];
  columns: ColumnDef[];
  scenes: Scene[];
  batchMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (shotId: string) => void;
  onUpdateCell: (shotId: string, key: string, value: CellValue) => void;
  onInsertAfter: (index: number) => void;
  onMoveShot: (from: number, to: number) => void;
  onOpenImageEditor: (shotId: string, which: 'frame' | 'reference') => void;
  onAddColumn: () => void;
}

interface Editing {
  shotId: string;
  key: string;
}

/** offsets 上二分：返回最后一个 <= target 的索引 */
function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((values[mid] ?? 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export default function VirtualShotGrid({
  shots,
  columns,
  scenes,
  batchMode,
  selectedIds,
  onToggleSelect,
  onUpdateCell,
  onInsertAfter,
  onMoveShot,
  onOpenImageEditor,
  onAddColumn,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const dragFrom = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const [viewport, setViewport] = useState({ width: 1200, height: 600 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const layout = useMemo(() => {
    const items: GridItem[] = [];
    if (batchMode) items.push({ id: '__select__', width: SELECT_WIDTH });
    for (const column of columns) items.push({ id: column.id, width: column.width, column });
    items.push({ id: '__add__', width: ADD_WIDTH });
    const offsets: number[] = [0];
    for (const item of items) offsets.push((offsets[offsets.length - 1] ?? 0) + item.width);
    return { items, offsets, total: offsets[offsets.length - 1] ?? 0 };
  }, [batchMode, columns]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setScroll({ top: element.scrollTop, left: element.scrollLeft });
    });
  }

  const startCol = Math.max(0, lowerBound(layout.offsets, scroll.left) - 1);
  const endCol = Math.min(layout.items.length - 1, lowerBound(layout.offsets, scroll.left + viewport.width) + 1);
  const startRow = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - 2);
  const endRow = Math.min(shots.length - 1, Math.ceil((scroll.top + viewport.height) / ROW_HEIGHT) + 2);

  const colIndexes: number[] = [];
  for (let i = startCol; i <= endCol; i += 1) colIndexes.push(i);
  const rowIndexes: number[] = [];
  for (let i = startRow; i <= endRow; i += 1) rowIndexes.push(i);

  function startEdit(shot: Shot, column: ColumnDef) {
    const key = column.key;
    const value = key === '__sceneNo__' ? (shot.sceneId ?? '') : String(resolveFieldValue(shot, key, scenes) ?? '');
    setEditing({ shotId: shot.id, key });
    setDraft(value);
    cancelledRef.current = false;
  }

  function commitEdit(shot: Shot, column: ColumnDef) {
    if (!editing) return;
    let value: CellValue = draft;
    if (column.kind === 'number' || column.kind === 'duration') {
      const parsed = Number(draft);
      value = Number.isFinite(parsed) ? parsed : 0;
    }
    const targetKey = column.key === '__sceneNo__' ? 'sceneId' : column.key;
    onUpdateCell(shot.id, targetKey, value);
    setEditing(null);
  }

  function handleEditorBlur(shot: Shot, column: ColumnDef) {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditing(null);
      return;
    }
    commitEdit(shot, column);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      cancelledRef.current = true;
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter' && !(event.currentTarget instanceof HTMLTextAreaElement)) {
      event.currentTarget.blur();
    }
  }

  function renderEditor(shot: Shot, column: ColumnDef) {
    const onBlur = () => handleEditorBlur(shot, column);
    const onKeyDown = handleEditorKeyDown;
    const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDraft(event.currentTarget.value);

    if (column.key === '__sceneNo__') {
      return (
        <select autoFocus className="cell-editor" value={draft} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown}>
          <option value="">未分配场次</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.sceneNo} · {scene.location}</option>
          ))}
        </select>
      );
    }
    if (column.kind === 'select') {
      return (
        <select autoFocus className="cell-editor" value={draft} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown}>
          <option value="">—</option>
          {(column.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    if (column.kind === 'textarea') {
      return <textarea autoFocus className="cell-editor" value={draft} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} />;
    }
    return (
      <input
        autoFocus
        className="cell-editor"
        type={column.kind === 'number' || column.kind === 'duration' ? 'number' : 'text'}
        value={draft}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    );
  }

  function renderCell(shot: Shot, item: GridItem, rowIndex: number) {
    const column = item.column;
    if (item.id === '__select__') {
      return (
        <input
          type="checkbox"
          className="row-check"
          checked={selectedIds.has(shot.id)}
          onChange={() => onToggleSelect(shot.id)}
          aria-label={`选择镜头 ${shot.shotNo}`}
        />
      );
    }
    if (!column) return null;

    if (column.kind === 'image') {
      const which = column.key === 'frame' ? 'frame' : 'reference';
      const asset = shot[which];
      return (
        <div className="image-cell-wrap">
          <button className="image-cell" type="button" onClick={() => onOpenImageEditor(shot.id, which)}>
            {asset ? <img src={asset.path} alt={column.label} /> : <ImagePlus size={22} />}
          </button>
          {asset ? (
            <button
              className="image-remove"
              type="button"
              title="移除图片"
              onClick={() => onUpdateCell(shot.id, which, null)}
            ><Trash2 size={12} /></button>
          ) : null}
        </div>
      );
    }

    if (column.key === '__sort__') {
      return (
        <div className="sort-cell">
          <span
            className="drag-handle"
            draggable
            title="拖拽调整顺序"
            onDragStart={(event) => {
              dragFrom.current = rowIndex;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(rowIndex));
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const raw = dragFrom.current ?? Number(event.dataTransfer.getData('text/plain'));
              if (Number.isFinite(raw)) onMoveShot(raw, rowIndex);
              dragFrom.current = null;
            }}
          ><GripVertical size={16} />{shot.shotNo}</span>
          <button className="insert-row" type="button" title="在此行后插入" onClick={() => onInsertAfter(rowIndex)}>
            <Plus size={13} />
          </button>
        </div>
      );
    }

    const isEditing = editing?.shotId === shot.id && editing.key === column.key;
    if (isEditing) return renderEditor(shot, column);

    const value = column.key === '__sceneNo__'
      ? (scenes.find((scene) => scene.id === shot.sceneId)?.sceneNo ?? '')
      : String(resolveFieldValue(shot, column.key, scenes) ?? '');
    return (
      <button
        className="cell-display"
        type="button"
        onClick={() => startEdit(shot, column)}
        title={value ? `${value}\n（点击编辑）` : '点击编辑'}
      >
        {value || <span className="placeholder">输入内容</span>}
      </button>
    );
  }

  return (
    <div className="vgrid-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div
        className="vgrid-inner"
        style={{ width: layout.total, height: HEADER_HEIGHT + shots.length * ROW_HEIGHT }}
      >
        <div className="vgrid-header" style={{ width: layout.total, height: HEADER_HEIGHT }}>
          {colIndexes.map((index) => {
            const item = layout.items[index];
            if (!item) return null;
            return (
              <div
                key={item.id}
                className="vgrid-th"
                style={{ left: layout.offsets[index] ?? 0, width: item.width }}
              >
                {item.id === '__add__' ? (
                  <button className="add-col-btn" type="button" title="添加自定义列" onClick={onAddColumn}>
                    <Plus size={16} />
                  </button>
                ) : item.id === '__select__' ? '选择' : item.column?.label}
              </div>
            );
          })}
        </div>

        {rowIndexes.flatMap((rowIndex) => {
          const shot = shots[rowIndex];
          if (!shot) return [];
          return colIndexes.map((colIndex) => {
            const item = layout.items[colIndex];
            if (!item) return null;
            return (
              <div
                key={`${shot.id}-${item.id}`}
                className={rowIndex % 2 === 0 ? 'vgrid-cell' : 'vgrid-cell even'}
                style={{
                  left: layout.offsets[colIndex] ?? 0,
                  top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                  width: item.width,
                  height: ROW_HEIGHT,
                }}
              >
                {renderCell(shot, item, rowIndex)}
              </div>
            );
          });
        })}
      </div>
      {shots.length === 0 ? <div className="vgrid-empty">还没有镜头，点击「新建」或「批量添加」开始。</div> : null}
    </div>
  );
}
