import { useMemo, useState } from 'react';
import { CheckSquare, Hash, ListFilter, Plus, Settings2, Trash2 } from 'lucide-react';
import VirtualShotGrid from '@/components/VirtualShotGrid';
import ColumnSettingsPanel from '@/components/ColumnSettingsPanel';
import ImageEditor from '@/components/ImageEditor';
import { visibleColumns } from '@/domain/schema';
import { useProjectStore } from '@/store/useProjectStore';
import type { PresetId } from '@/domain/types';

interface ImageTarget {
  shotId: string;
  which: 'frame' | 'reference';
}

export default function ShotTablePage() {
  const project = useProjectStore((state) => state.project);
  const dirty = useProjectStore((state) => state.dirty);
  const addShots = useProjectStore((state) => state.addShots);
  const insertShotAfter = useProjectStore((state) => state.insertShotAfter);
  const deleteShots = useProjectStore((state) => state.deleteShots);
  const moveShot = useProjectStore((state) => state.moveShot);
  const renumberShots = useProjectStore((state) => state.renumberShots);
  const updateCell = useProjectStore((state) => state.updateCell);
  const setPresetById = useProjectStore((state) => state.setPresetById);

  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);
  const [bulkCount, setBulkCount] = useState(10);
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null);

  const columns = useMemo(() => visibleColumns(project.columnSchema), [project.columnSchema]);
  const shots = useMemo(() => [...project.shots].sort((a, b) => a.sortIndex - b.sortIndex), [project.shots]);

  function toggleSelect(shotId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    deleteShots([...selected]);
    setSelected(new Set());
  }

  const target = imageTarget;

  return (
    <section className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>制作分镜</h1>
          <span className="help-dot" title="行列数量均无上限，可批量添加；单元格点击即可编辑">?</span>
          <button className="btn primary" type="button" onClick={() => addShots(1)}><Plus size={15} />新建</button>
          <div className="bulk-add">
            <input
              className="count-input"
              type="number"
              min={1}
              value={bulkCount}
              title="一次添加的行数"
              onChange={(event) => setBulkCount(Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)))}
            />
            <button className="btn ghost" type="button" onClick={() => addShots(bulkCount)}>批量添加行</button>
          </div>
        </div>

        <div className="tool-row">
          <button
            className={batchMode ? 'btn ghost active' : 'btn ghost'}
            type="button"
            onClick={() => { setBatchMode((value) => !value); setSelected(new Set()); }}
          ><CheckSquare size={15} />批量模式</button>

          {batchMode ? (
            <>
              <button className="btn ghost" type="button" onClick={() => setSelected(new Set(shots.map((shot) => shot.id)))}>
                <ListFilter size={15} />全选
              </button>
              <button className="btn ghost" type="button" onClick={() => setSelected(new Set())}>取消选择</button>
              <button className="btn ghost danger" type="button" disabled={selected.size === 0} onClick={deleteSelected}>
                <Trash2 size={15} />删除选中（{selected.size}）
              </button>
            </>
          ) : null}

          <span className="tool-divider" />
          <select
            className="select-input compact"
            title="分镜设置：字段预设"
            value={project.columnSchema.preset}
            onChange={(event) => setPresetById(event.currentTarget.value as PresetId)}
          >
            <option value="professional">专业预设</option>
            <option value="simple">简洁预设</option>
            <option value="custom">自定义</option>
          </select>
          <button className="btn ghost" type="button" onClick={() => setShowColumns(true)}><Settings2 size={15} />列设置</button>
          <button className="btn ghost" type="button" onClick={renumberShots} title="按当前顺序把镜号重置为 1..n"><Hash size={15} />重编号</button>

          <span className="grid-stat">{shots.length} 行 × {columns.length} 列{dirty ? ' · 未保存' : ''}</span>
        </div>
      </div>

      <VirtualShotGrid
        shots={shots}
        columns={columns}
        scenes={project.scenes}
        batchMode={batchMode}
        selectedIds={selected}
        onToggleSelect={toggleSelect}
        onUpdateCell={updateCell}
        onInsertAfter={insertShotAfter}
        onMoveShot={moveShot}
        onOpenImageEditor={(shotId, which) => setImageTarget({ shotId, which })}
        onAddColumn={() => setShowColumns(true)}
      />

      {showColumns ? <ColumnSettingsPanel onClose={() => setShowColumns(false)} /> : null}
      {target ? (
        <ImageEditor
          title={target.which === 'frame' ? '分镜画面' : '参考图'}
          onClose={() => setImageTarget(null)}
          onSave={(asset) => {
            updateCell(target.shotId, target.which, asset);
            setImageTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}
