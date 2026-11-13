import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Pencil, RotateCcw, Tag, Trash2, X } from 'lucide-react';
import { PROJECT_TAGS, tagMeta } from '@/domain/tags';
import type { ProjectMeta } from '@/domain/library';
import type { ProjectTag } from '@/domain/types';

interface ProjectCardMenuProps {
  meta: ProjectMeta;
  /** 触发按钮的屏幕坐标，用来把菜单贴上去并自动上下翻转 */
  anchor: DOMRect;
  trash?: boolean;
  busy?: boolean;
  onClose: () => void;
  onTag: (tag: ProjectTag | null) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRestore: () => void;
}

const GAP = 6;
const EDGE = 10;

/**
 * 卡片操作菜单：默认只露一颗半透明「⋯」，把重命名/复制/删除和颜色标签都收进面板，
 * 不再用三颗按钮长期压住分镜图；面板本身是半透明玻璃层，位置按视口自动翻转。
 */
export default function ProjectCardMenu({
  meta,
  anchor,
  trash = false,
  busy = false,
  onClose,
  onTag,
  onRename,
  onDuplicate,
  onDelete,
  onRestore,
}: ProjectCardMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(
      Math.max(EDGE, anchor.right - width),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    );
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - EDGE) {
      top = anchor.top - height - GAP;
    }
    setPos({ left, top: Math.max(EDGE, top) });
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (panel.current?.contains(event.target as Node)) return;
      // 触发按钮自己负责开关，别让外部点击先关掉再被 click 重新打开
      if (target?.closest?.('.card-menu-btn')) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    // 列表滚动后锚点失效，直接收起比飘在错位置更可预期
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panel}
      className="card-menu"
      role="menu"
      aria-label={`${meta.name} 项目操作`}
      style={{
        left: pos?.left ?? anchor.right - 212,
        top: pos?.top ?? anchor.bottom + GAP,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="card-menu-label">
        <Tag size={11} />颜色标签
        <span className="card-menu-tag-name">{tagMeta(meta.tag)?.name ?? '未标注'}</span>
        <button
          type="button"
          className="card-menu-clear"
          disabled={busy || meta.tag === null}
          onClick={() => onTag(null)}
        >清除</button>
      </div>
      <div className="card-menu-swatches">
        {PROJECT_TAGS.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="tag-swatch"
            style={{ ['--tag' as string]: tag.color }}
            data-on={meta.tag === tag.id}
            role="menuitemradio"
            aria-checked={meta.tag === tag.id}
            title={tag.hint}
            aria-label={tag.hint}
            disabled={busy}
            onClick={() => onTag(tag.id)}
          />
        ))}
      </div>
      <div className="card-menu-sep" />
      {trash ? (
        <>
          <button type="button" className="card-menu-item" role="menuitem" disabled={busy} onClick={onRestore}>
            <RotateCcw size={14} />恢复项目
          </button>
          <button type="button" className="card-menu-item danger" role="menuitem" disabled={busy} onClick={onDelete}>
            <X size={14} />彻底删除
          </button>
        </>
      ) : (
        <>
          <button type="button" className="card-menu-item" role="menuitem" disabled={busy} onClick={onRename}>
            <Pencil size={14} />重命名
          </button>
          <button type="button" className="card-menu-item" role="menuitem" disabled={busy} onClick={onDuplicate}>
            <Copy size={14} />复制项目
          </button>
          <button type="button" className="card-menu-item danger" role="menuitem" disabled={busy} onClick={onDelete}>
            <Trash2 size={14} />移到回收站
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
