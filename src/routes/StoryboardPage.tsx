import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Play,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import ShotCardEditor from '@/components/ShotCardEditor';
import { useProjectStore } from '@/store/useProjectStore';
import type { Shot } from '@/domain/types';

const FIELD_LABELS: Record<string, string> = {
  shotSize: '景别',
  durationSec: '时长',
  content: '画面内容',
  notes: '备注',
  sceneExpectation: '场景预期',
  sound: '声音',
  cameraAngle: '角度',
  cameraMove: '运镜',
  cameraBody: '设备',
  focalLength: '焦段',
};

const FIELD_KEYS = Object.keys(FIELD_LABELS);
const COLUMN_CHOICES = [2, 3, 4, 5, 6, 8];
const SHOWCASE_FIELDS = ['notes', 'sound'] as const;

function fieldValue(shot: Shot, key: string): string {
  if (key === 'durationSec') return shot.durationSec > 0 ? `${shot.durationSec}s` : '';
  const value = shot[key as keyof Shot];
  return typeof value === 'string' ? value.trim() : '';
}

export default function StoryboardPage() {
  const project = useProjectStore((state) => state.project);
  const addShots = useProjectStore((state) => state.addShots);
  const deleteShots = useProjectStore((state) => state.deleteShots);
  const moveShot = useProjectStore((state) => state.moveShot);
  const setStoryboardColumns = useProjectStore((state) => state.setStoryboardColumns);
  const toggleStoryboardField = useProjectStore((state) => state.toggleStoryboardField);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sceneFilter, setSceneFilter] = useState('all');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showcase, setShowcase] = useState<number | null>(null);

  const ordered = useMemo(
    () => [...project.shots].sort((a, b) => a.sortIndex - b.sortIndex),
    [project.shots],
  );
  const shots = useMemo(
    () => (sceneFilter === 'all' ? ordered : ordered.filter((shot) => shot.sceneId === sceneFilter)),
    [ordered, sceneFilter],
  );

  const columns = Math.min(10, Math.max(1, project.settings.storyboardColumns));
  const fields = project.settings.storyboardFields.filter((key) => key in FIELD_LABELS);

  useEffect(() => {
    if (showcase === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowcase(null);
      if (event.key === 'ArrowRight') setShowcase((index) => (index === null ? null : Math.min(shots.length - 1, index + 1)));
      if (event.key === 'ArrowLeft') setShowcase((index) => (index === null ? null : Math.max(0, index - 1)));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showcase, shots.length]);

  function handleDrop(targetId: string, sourceId: string | null) {
    const activeId = sourceId ?? dragId;
    if (!activeId || activeId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = ordered.findIndex((shot) => shot.id === activeId);
    const to = ordered.findIndex((shot) => shot.id === targetId);
    if (from >= 0 && to >= 0) moveShot(from, to);
    setDragId(null);
    setOverId(null);
  }

  const current = showcase === null ? null : shots[showcase] ?? null;

  function sceneLabel(shot: Shot): string {
    if (!shot.sceneId) return '未分场';
    const scene = project.scenes.find((entry) => entry.id === shot.sceneId);
    return scene ? `第 ${scene.sceneNo} 场` : '未分场';
  }

  return (
    <section className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>预览故事版</h1>
          <span className="help-dot" title="拖动卡片可调整镜头顺序；点击卡片编辑镜头内容">?</span>
          <button className="btn primary" type="button" onClick={() => addShots(1)}><Plus size={15} />新建镜头</button>
        </div>
        <div className="tool-row">
          <select
            className="select-input compact"
            title="按场次筛选"
            value={sceneFilter}
            onChange={(event) => setSceneFilter(event.currentTarget.value)}
          >
            <option value="all">全部场次</option>
            {project.scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>第 {scene.sceneNo} 场</option>
            ))}
          </select>
          <button className="btn ghost" type="button" onClick={() => setShowSettings(true)}>
            <Settings2 size={15} />显示设置
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={shots.length === 0}
            title="全屏逐镜预览，方向键翻页，Esc 退出"
            onClick={() => setShowcase(0)}
          ><Play size={15} />放映模式</button>
          <span className="grid-stat">{shots.length} 个镜头 · 每行 {columns} 个{sceneFilter === 'all' ? '' : ' · 已筛选'}</span>
        </div>
      </div>

      {shots.length === 0 ? (
        <p className="empty">还没有镜头，先点「新建镜头」或用批量添加。</p>
      ) : (
        <div className="story-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(140px, 1fr))` }}>
          {shots.map((shot) => (
            <article
              key={shot.id}
              className={[
                'story-card',
                'editable',
                dragId === shot.id ? 'dragging' : '',
                overId === shot.id && dragId && dragId !== shot.id ? 'drop-target' : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={(event) => {
                setDragId(shot.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', shot.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (overId !== shot.id) setOverId(shot.id);
              }}
              onDragLeave={() => setOverId((currentId) => (currentId === shot.id ? null : currentId))}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(shot.id, event.dataTransfer.getData('text/plain') || dragId);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onClick={() => setEditingId(shot.id)}
            >
              <div className="story-image">
                {shot.frame ? <img src={shot.frame.path} alt={`镜头 ${shot.shotNo}`} /> : <span>未添加图片</span>}
                <span className="story-no">{String(shot.shotNo).padStart(2, '0')}</span>
              </div>
              <div className="story-body">
                {fields.length === 0 ? <p className="story-content">（未选择显示字段）</p> : null}
                {fields.map((key) => (
                  <p className={`story-field story-field-${key}`} key={key} title={`${FIELD_LABELS[key]}：${fieldValue(shot, key) || '—'}`}>
                    <span className="story-field-label">{FIELD_LABELS[key]}</span>
                    <span className="story-field-value">{fieldValue(shot, key) || '—'}</span>
                  </p>
                ))}
                <div className="story-foot">
                  <span>{sceneLabel(shot)}</span>
                  <span className="story-actions">
                    <button
                      className="icon-btn small"
                      type="button"
                      title="编辑"
                      onClick={(event) => { event.stopPropagation(); setEditingId(shot.id); }}
                    ><Pencil size={14} /></button>
                    <button
                      className="icon-btn small danger"
                      type="button"
                      title="删除这个镜头"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (window.confirm(`删除镜头 ${shot.shotNo}？该镜头在拍摄计划和流程里的引用会一起移除。`)) {
                          deleteShots([shot.id]);
                        }
                      }}
                    ><Trash2 size={14} /></button>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showSettings ? (
        <div className="drawer-backdrop" onClick={() => setShowSettings(false)}>
          <aside className="drawer drawer-narrow" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-head">
              <h2>显示设置</h2>
              <button className="icon-btn" type="button" onClick={() => setShowSettings(false)} aria-label="关闭"><X size={17} /></button>
            </header>
            <div className="drawer-section">
              <div className="section-label">每行卡片数</div>
              <div className="preset-row">
                {COLUMN_CHOICES.map((count) => (
                  <button
                    key={count}
                    className={columns === count ? 'preset-btn active' : 'preset-btn'}
                    type="button"
                    onClick={() => setStoryboardColumns(count)}
                  >{count}</button>
                ))}
              </div>
              <p className="drawer-hint">窄窗口下会自动缩小到能容纳的列数。</p>
            </div>
            <div className="drawer-section grow">
              <div className="section-label">卡片上显示的字段</div>
              <div className="field-checklist">
                {FIELD_KEYS.map((key) => (
                  <label className="check-row" key={key}>
                    <input
                      type="checkbox"
                      checked={project.settings.storyboardFields.includes(key)}
                      onChange={() => toggleStoryboardField(key)}
                    />
                    <span>{FIELD_LABELS[key]}</span>
                  </label>
                ))}
              </div>
              <p className="drawer-hint">默认显示景别、内容与时长；字段多时卡片会变高。</p>
            </div>
          </aside>
        </div>
      ) : null}

      {current ? (
        <div className="showcase" onClick={() => setShowcase(null)}>
          <div className="showcase-stage" onClick={(event) => event.stopPropagation()}>
            <button
              className="showcase-nav left"
              type="button"
              disabled={showcase === 0}
              onClick={() => setShowcase((index) => (index === null ? null : Math.max(0, index - 1)))}
            ><ChevronLeft size={26} /></button>
            <div className="showcase-frame">
              {current.frame ? <img src={current.frame.path} alt={`镜头 ${current.shotNo}`} /> : <div className="showcase-empty">未添加画面</div>}
            </div>
            <button
              className="showcase-nav right"
              type="button"
              disabled={showcase === shots.length - 1}
              onClick={() => setShowcase((index) => (index === null ? null : Math.min(shots.length - 1, index + 1)))}
            ><ChevronRight size={26} /></button>

            <div className="showcase-meta">
              <div className="showcase-head">
                <strong>镜头 {String(current.shotNo).padStart(2, '0')}</strong>
                <span>{current.shotSize || '景别未填'} · {current.durationSec > 0 ? `${current.durationSec}s` : '时长未填'}</span>
                <span className="showcase-count">{(showcase ?? 0) + 1} / {shots.length}</span>
              </div>
              <p className="showcase-content">{current.content || '（没有画面描述）'}</p>
              {SHOWCASE_FIELDS.map((key) => {
                const value = fieldValue(current, key);
                if (!value) return null;
                return (
                  <p className="showcase-note" key={key}>
                    <span>{FIELD_LABELS[key]}</span>{value}
                  </p>
                );
              })}
            </div>
          </div>
          <button className="showcase-close" type="button" onClick={() => setShowcase(null)} aria-label="退出放映"><X size={20} /></button>
        </div>
      ) : null}

      {editingId ? <ShotCardEditor shotId={editingId} onClose={() => setEditingId(null)} /> : null}
    </section>
  );
}
