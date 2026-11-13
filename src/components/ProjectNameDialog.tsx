import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  initialName?: string;
  confirmText?: string;
  hint?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export default function ProjectNameDialog({
  title,
  initialName = '',
  confirmText = '确定',
  hint,
  onConfirm,
  onClose,
}: Props) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal project-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <label className="dialog-label" htmlFor="project-name-input">项目名称</label>
          <input
            id="project-name-input"
            className="text-input"
            autoFocus
            value={name}
            placeholder="例如：咖啡馆短片"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onConfirm(trimmed);
              if (event.key === 'Escape') onClose();
            }}
          />
          {hint ? <p className="drawer-hint">{hint}</p> : null}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={onClose}>取消</button>
          <button className="btn primary" type="button" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
