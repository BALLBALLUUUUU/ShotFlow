import { useState } from 'react';
import { Image as ImageIcon, Trash2, X } from 'lucide-react';
import ImageEditor from '@/components/ImageEditor';
import { useProjectStore } from '@/store/useProjectStore';
import type { CellValue } from '@/domain/shots';

const TEXT_FIELDS: Array<{ key: keyof ShotFieldMap; label: string; kind: 'text' | 'textarea' }> = [
  { key: 'content', label: '画面内容', kind: 'textarea' },
  { key: 'notes', label: '备注', kind: 'textarea' },
  { key: 'sceneExpectation', label: '场景预期', kind: 'textarea' },
  { key: 'sound', label: '声音', kind: 'text' },
  { key: 'cameraAngle', label: '拍摄角度', kind: 'text' },
  { key: 'cameraMove', label: '运镜', kind: 'text' },
  { key: 'cameraBody', label: '设备', kind: 'text' },
  { key: 'focalLength', label: '焦段', kind: 'text' },
];

interface ShotFieldMap {
  content: string;
  notes: string;
  sceneExpectation: string;
  sound: string;
  cameraAngle: string;
  cameraMove: string;
  cameraBody: string;
  focalLength: string;
}

export default function ShotCardEditor({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const shot = useProjectStore((state) => state.project.shots.find((entry) => entry.id === shotId));
  const scenes = useProjectStore((state) => state.project.scenes);
  const updateCell = useProjectStore((state) => state.updateCell);
  const [imageTarget, setImageTarget] = useState<'frame' | 'reference' | null>(null);

  if (!shot) return null;

  function set(key: string, value: CellValue) {
    if (!shot) return;
    updateCell(shot.id, key, value);
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}>
        <aside className="drawer" onClick={(event) => event.stopPropagation()}>
          <header className="drawer-head">
            <h2>镜头 {String(shot.shotNo).padStart(2, '0')}</h2>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
          </header>

          <div className="drawer-body">
            <section className="drawer-section">
              <div className="section-label">分镜画面</div>
              <div className="shot-image-row">
                <div className="shot-image-slot">
                  {shot.frame ? <img src={shot.frame.path} alt="" /> : <span>未添加画面</span>}
                </div>
                <div className="shot-image-actions">
                  <button className="btn compact" type="button" onClick={() => setImageTarget('frame')}>
                    <ImageIcon size={14} />{shot.frame ? '更换画面' : '添加画面'}
                  </button>
                  <button
                    className="btn ghost compact"
                    type="button"
                    onClick={() => setImageTarget('reference')}
                  >{shot.reference ? '更换参考图' : '添加参考图'}</button>
                  {shot.frame ? (
                    <button className="btn ghost compact danger" type="button" onClick={() => set('frame', null)}>
                      <Trash2 size={13} />移除画面
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="drawer-section">
              <div className="section-label">镜头信息</div>
              <div className="field-grid">
                <label className="field">
                  <span>景别</span>
                  <input className="text-input" value={shot.shotSize} onChange={(event) => set('shotSize', event.currentTarget.value)} />
                </label>
                <label className="field">
                  <span>时长（秒）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    value={shot.durationSec}
                    onChange={(event) => set('durationSec', Number(event.currentTarget.value) || 0)}
                  />
                </label>
                <label className="field">
                  <span>场次</span>
                  <select
                    className="select-input"
                    value={shot.sceneId ?? ''}
                    onChange={(event) => set('sceneId', event.currentTarget.value || null)}
                  >
                    <option value="">未分场</option>
                    {scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>第 {scene.sceneNo} 场 {scene.location ? `· ${scene.location}` : ''}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="drawer-section">
              <div className="section-label">文字说明</div>
              {TEXT_FIELDS.map((field) => (
                <label className="field block" key={field.key}>
                  <span>{field.label}</span>
                  {field.kind === 'textarea' ? (
                    <textarea
                      className="text-input"
                      rows={2}
                      value={String(shot[field.key] ?? '')}
                      onChange={(event) => set(field.key, event.currentTarget.value)}
                    />
                  ) : (
                    <input
                      className="text-input"
                      value={String(shot[field.key] ?? '')}
                      onChange={(event) => set(field.key, event.currentTarget.value)}
                    />
                  )}
                </label>
              ))}
            </section>
          </div>
        </aside>
      </div>

      {imageTarget ? (
        <ImageEditor
          title={imageTarget === 'frame' ? '分镜画面' : '参考图'}
          onClose={() => setImageTarget(null)}
          onSave={(asset) => {
            set(imageTarget, asset);
            setImageTarget(null);
          }}
        />
      ) : null}
    </>
  );
}
