import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eraser, Trash2, Undo2, Upload, X } from 'lucide-react';
import { fileToCompressedDataUrl } from '@/utils/image';
import type { ImageAsset } from '@/domain/types';

interface Props {
  title: string;
  onSave: (asset: ImageAsset) => void;
  onClose: () => void;
}

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;

function newAsset(path: string, kind: ImageAsset['kind']): ImageAsset {
  return { id: `img_${crypto.randomUUID()}`, path, kind, updatedAt: new Date().toISOString() };
}

function fillBackground(context: CanvasRenderingContext2D) {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

export default function ImageEditor({ title, onSave, onClose }: Props) {
  const [tab, setTab] = useState<'upload' | 'draw'>('upload');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState('#23262b');
  const [lineWidth, setLineWidth] = useState(3);
  const [erasing, setErasing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const undoRef = useRef<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (context) fillBackground(context);
  }, [tab]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      setPreview(await fileToCompressedDataUrl(file));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片读取失败');
    }
  }

  function snapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    undoRef.current.push(canvas.toDataURL('image/png'));
    if (undoRef.current.length > 20) undoRef.current.shift();
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    snapshot();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = erasing ? '#ffffff' : color;
    context.lineWidth = erasing ? lineWidth * 4 : lineWidth;
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function handlePointerUp() {
    drawingRef.current = false;
  }

  function handleUndo() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const previous = undoRef.current.pop();
    if (!canvas || !context || !previous) return;
    const image = new Image();
    image.onload = () => {
      fillBackground(context);
      context.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    };
    image.src = previous;
  }

  function handleSave() {
    if (tab === 'upload') {
      if (!preview) return;
      onSave(newAsset(preview, 'upload'));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(newAsset(canvas.toDataURL('image/png'), 'draw'));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="modal-tabs">
          <button className={tab === 'upload' ? 'modal-tab active' : 'modal-tab'} type="button" onClick={() => setTab('upload')}>
            <Upload size={14} />上传图片
          </button>
          <button className={tab === 'draw' ? 'modal-tab active' : 'modal-tab'} type="button" onClick={() => setTab('draw')}>
            手绘分镜
          </button>
        </div>

        {tab === 'upload' ? (
          <div className="upload-area">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => { void handleFile(event.target.files?.[0]); }}
            />
            {preview ? <img src={preview} alt="预览" /> : <p>选择一张参考图或分镜图，自动压缩后存入项目</p>}
            {error ? <p className="form-error">{error}</p> : null}
          </div>
        ) : (
          <div className="draw-area">
            <div className="draw-tools">
              <label>颜色 <input type="color" value={color} onChange={(event) => { setColor(event.target.value); setErasing(false); }} /></label>
              <label>粗细
                <input type="range" min={1} max={20} value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} />
              </label>
              <button className={erasing ? 'btn ghost active' : 'btn ghost'} type="button" onClick={() => setErasing((value) => !value)}><Eraser size={14} />橡皮</button>
              <button className="btn ghost" type="button" onClick={handleUndo}><Undo2 size={14} />撤销</button>
              <button className="btn ghost" type="button" onClick={() => { snapshot(); const context = canvasRef.current?.getContext('2d'); if (context) fillBackground(context); }}><Trash2 size={14} />清空</button>
            </div>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="draw-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
        )}

        <footer className="modal-foot">
          <button className="btn ghost" type="button" onClick={onClose}>取消</button>
          <button className="btn primary" type="button" disabled={tab === 'upload' && !preview} onClick={handleSave}>保存画面</button>
        </footer>
      </div>
    </div>
  );
}
