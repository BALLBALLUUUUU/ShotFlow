import { AlertTriangle, X } from 'lucide-react';

export interface ConflictChoice {
  label: string;
  description: string;
  value: 'replace' | 'copy' | 'cancel';
  danger?: boolean;
}

interface Props {
  title: string;
  detail: string;
  choices: ConflictChoice[];
  onChoose: (value: ConflictChoice['value']) => void;
  onClose: () => void;
}

/** 任何可能覆盖他人/本地修改的操作都必须先走这里，绝不静默覆盖 */
export default function ConflictDialog({ title, detail, choices, onChoose, onClose }: Props) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal conflict-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2><AlertTriangle size={17} />{title}</h2>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="conflict-detail">{detail}</p>
          <div className="conflict-choices">
            {choices.map((choice) => (
              <button
                key={choice.value}
                className={choice.danger ? 'conflict-choice danger' : 'conflict-choice'}
                type="button"
                onClick={() => onChoose(choice.value)}
              >
                <strong>{choice.label}</strong>
                <span>{choice.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
