/**
 * 导出文档领域层：把项目编译成与格式无关的中间文档，
 * 再分别渲染成 PDF（HTML + 系统打印管线）与 Excel（xlsx OOXML）。
 * 纯函数、零 DOM 依赖，便于单测。
 */
import { visibleColumns, resolveFieldValue } from './schema';
import { exportInfoRows, type InfoRow } from './exportInfo';
import { computeSchedule, minutesToTime } from './rundown';
import { safeFileName } from './projectPackage';
import type { ColumnDef, ExportOptions, ImageAsset, Project, RundownKind, Shot } from './types';
import type { Profile } from './profile';

export interface ExportImageCell {
  image: string | null;
}
export type ExportCell = string | number | ExportImageCell;

export interface ExportColumn {
  id: string;
  label: string;
  kind: ColumnDef['kind'];
  width: number;
}

export interface ExportTable {
  title: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
}

export interface ExportDocument {
  projectName: string;
  infoRows: InfoRow[];
  stats: InfoRow[];
  shotTable: ExportTable;
  rundownTable: ExportTable | null;
  generatedAt: string;
  totalDurationSec: number;
}

/** PDF 默认推荐列：15 列全塞进 A4 会不可读，Excel 可自由全选 */
export const RECOMMENDED_COLUMN_IDS = [
  'shotNo', 'frame', 'shotSize', 'durationSec', 'content', 'notes',
  'cameraMove', 'sceneNo',
];

export function resolveExportColumns(project: Project, options: ExportOptions): ColumnDef[] {
  const visible = visibleColumns(project.columnSchema);
  const requested = options.columnIds.length > 0
    ? visible.filter((column) => options.columnIds.includes(column.id))
    : visible;
  const chosen = requested.length > 0 ? requested : visible;
  return options.includeImages ? chosen : chosen.filter((column) => column.kind !== 'image');
}

function imageCell(asset: ImageAsset | null): ExportImageCell {
  return { image: asset?.path ?? null };
}

function shotCell(shot: Shot, column: ColumnDef, project: Project): ExportCell {
  if (column.kind === 'image') {
    return imageCell(column.key === 'reference' ? shot.reference : shot.frame);
  }
  const value = resolveFieldValue(shot, column.key, project.scenes);
  if (typeof value === 'string' || typeof value === 'number') return value;
  return '';
}

function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(sec / 60);
  return minutes > 0 ? `${minutes} 分 ${sec % 60} 秒` : `${sec} 秒`;
}

const RUNDOWN_KIND_LABELS: Record<RundownKind, string> = {
  setup: '准备',
  shoot: '拍摄',
  move: '转场',
  break: '休息',
  wrap: '收工',
  custom: '自定义',
};

function buildRundownTable(project: Project): ExportTable | null {
  if (project.rundown.length === 0) return null;
  const columns: ExportColumn[] = [
    { id: 'day', label: '拍摄日', kind: 'text', width: 120 },
    { id: 'group', label: '分组', kind: 'text', width: 110 },
    { id: 'start', label: '开始', kind: 'text', width: 70 },
    { id: 'end', label: '结束', kind: 'text', width: 70 },
    { id: 'title', label: '环节', kind: 'text', width: 180 },
    { id: 'kind', label: '类型', kind: 'text', width: 70 },
    { id: 'owner', label: '负责人', kind: 'text', width: 110 },
    { id: 'camera', label: '机位', kind: 'text', width: 80 },
    { id: 'duration', label: '时长(分)', kind: 'number', width: 80 },
    { id: 'content', label: '内容', kind: 'textarea', width: 200 },
    { id: 'shots', label: '关联镜头', kind: 'text', width: 120 },
    { id: 'note', label: '备注', kind: 'textarea', width: 160 },
  ];

  const dayMap = new Map(project.days.map((day) => [day.id, day]));
  const grouped = new Map<string, typeof project.rundown>();
  for (const item of project.rundown) {
    const list = grouped.get(item.dayId) ?? [];
    list.push(item);
    grouped.set(item.dayId, list);
  }
  // 没有对应拍摄日的临时条目也要导出，放到最后
  const dayIds = [...project.days.map((day) => day.id), ...[...grouped.keys()].filter((id) => !dayMap.has(id))];

  const rows: ExportCell[][] = [];
  for (const dayId of dayIds) {
    const items = grouped.get(dayId);
    if (!items || items.length === 0) continue;
    const day = dayMap.get(dayId);
    const slots = computeSchedule(items, day?.startTime || '08:00', day?.endTime || '18:00');
    const dayLabel = day ? `${day.date || '未定日期'} ${day.location || ''}`.trim() : '未分配拍摄日';
    for (const slot of slots) {
      const shotNumbers = slot.shotIds
        .map((id) => project.shots.find((shot) => shot.id === id)?.shotNo)
        .filter((value): value is number => typeof value === 'number');
      const flags = [slot.conflict ? '时间冲突' : '', slot.overrun ? '超时' : ''].filter(Boolean).join(' / ');
      rows.push([
        dayLabel,
        slot.group || '',
        minutesToTime(slot.startMin),
        minutesToTime(slot.endMin),
        slot.title,
        RUNDOWN_KIND_LABELS[slot.kind],
        slot.owner,
        slot.camera,
        slot.durationMin,
        slot.content,
        shotNumbers.length > 0 ? shotNumbers.map((no) => `#${no}`).join(' ') : '',
        [slot.note, flags].filter(Boolean).join('；'),
      ]);
    }
  }
  if (rows.length === 0) return null;
  return { title: '拍摄日 Rundown', columns, rows };
}

export function buildExportDocument(project: Project, options: ExportOptions, profile?: Profile | null): ExportDocument {
  const columns = resolveExportColumns(project, options);
  const shots = [...project.shots]
    .filter((shot) => options.sceneFilter === 'all' || shot.sceneId === options.sceneFilter)
    .sort((a, b) => a.sortIndex - b.sortIndex);

  const shotTable: ExportTable = {
    title: '分镜表',
    columns: columns.map((column) => ({
      id: column.id,
      label: column.label,
      kind: column.kind,
      width: column.width,
    })),
    rows: shots.map((shot) => columns.map((column) => shotCell(shot, column, project))),
  };

  const totalDurationSec = shots.reduce((sum, shot) => sum + (Number.isFinite(shot.durationSec) ? shot.durationSec : 0), 0);
  const infoRows = exportInfoRows(project, profile);
  const stats: InfoRow[] = [
    { label: '镜头数', value: `${shots.length} 个` },
    { label: '预计总时长', value: formatDuration(totalDurationSec) },
    { label: '场次数', value: `${project.scenes.length} 场` },
    { label: '拍摄日', value: `${project.days.length} 天` },
    { label: '导出列数', value: `${columns.length} 列` },
  ];

  return {
    projectName: project.name,
    infoRows,
    stats,
    shotTable,
    rundownTable: options.includeRundown ? buildRundownTable(project) : null,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    totalDurationSec,
  };
}

export function exportFileName(project: Project, options: ExportOptions): string {
  const base = `${safeFileName(project.name)}-分镜表`;
  if (options.format === 'pdf') return `${base}.pdf`;
  if (options.format === 'xlsx') return `${base}.xlsx`;
  return `${safeFileName(project.name)}.shotflow`;
}

/** 只允许内嵌位图 data URL，杜绝 javascript: / 外部地址注入 */
export function safeImageSrc(value: string | null): string | null {
  if (!value) return null;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  return null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cellText(cell: ExportCell): string {
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  return cell.image ? '有图' : '';
}

function colgroup(columns: ExportColumn[]): string {
  // 画面列按「分镜稿」而不是「缩略图」来分配宽度：表格里 150px 够用，纸上太窄
  const weight = (column: ExportColumn) => (column.kind === 'image'
    ? Math.max(220, column.width)
    : Math.max(60, column.width));
  const total = columns.reduce((sum, column) => sum + weight(column), 0);
  return `<colgroup>${columns.map((column) => {
    const percent = Math.max(3, Math.round((weight(column) / total) * 100));
    return `<col style="width:${percent}%">`;
  }).join('')}</colgroup>`;
}

function renderTable(table: ExportTable): string {
  const body = table.rows.map((row, rowIndex) => {
    const cells = row.map((cell, index) => {
      const column = table.columns[index];
      if (!column) return '';
      if (typeof cell === 'object' && cell !== null && 'image' in cell) {
        const src = safeImageSrc(cell.image);
        return `<td class="img">${src ? `<img src="${escapeHtml(src)}" alt="画面">` : '<span class="muted">—</span>'}</td>`;
      }
      const text = cellText(cell);
      const numeric = typeof cell === 'number' ? ' class="num"' : '';
      return `<td${numeric}>${escapeHtml(text).replace(/\n/g, '<br>')}</td>`;
    }).join('');
    return `<tr class="${rowIndex % 2 === 0 ? 'odd' : 'even'}">${cells}</tr>`;
  }).join('');

  const head = table.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  return `
    <section class="table-section">
      <h2>${escapeHtml(table.title)} <span class="count">${table.rows.length} 行</span></h2>
      <table>
        ${colgroup(table.columns)}
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td class="empty" colspan="${table.columns.length}">暂无数据</td></tr>`}</tbody>
      </table>
    </section>`;
}

/** 生成可直接打印 / 供 Electron printToPDF 加载的独立 HTML 文档 */
export function buildStoryboardHtml(doc: ExportDocument, options: ExportOptions): string {
  const page = options.pageSize === 'A3' ? 'A3' : 'A4';
  const orientation = options.orientation === 'portrait' ? 'portrait' : 'landscape';
  const infoGrid = doc.infoRows.map((row) => `
    <div class="info-item"><span class="info-label">${escapeHtml(row.label)}</span><span class="info-value">${escapeHtml(row.value) || '<span class="blank"></span>'}</span></div>`).join('');
  const stats = doc.stats.map((row) => `<span><b>${escapeHtml(row.value)}</b> ${escapeHtml(row.label)}</span>`).join('');
  const rundown = doc.rundownTable ? `<div class="page-break">${renderTable(doc.rundownTable)}</div>` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.projectName)} · 分镜表</title>
<style>
  @page { size: ${page} ${orientation}; margin: 12mm 10mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; color: #1c2430; background: #fff;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
    font-size: 10px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header { border-bottom: 2px solid #f2b632; padding-bottom: 12px; margin-bottom: 14px; }
  .eyebrow { font-size: 9px; letter-spacing: 2px; color: #8a94a3; text-transform: uppercase; }
  h1 { margin: 4px 0 2px; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
  .subtitle { color: #6b7686; font-size: 11px; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 18px; margin: 14px 0 10px; }
  .info-item { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid #eceff3; padding: 4px 0; min-width: 0; }
  .info-label { color: #7b8695; white-space: nowrap; font-size: 9px; min-width: 52px; }
  .info-value { font-weight: 600; word-break: break-word; }
  .blank { display: inline-block; width: 42px; border-bottom: 1px solid #cbd2db; }
  .stats { display: flex; gap: 18px; flex-wrap: wrap; color: #6b7686; font-size: 9px; margin-top: 8px; }
  .stats b { color: #1c2430; font-size: 11px; }
  .table-section { margin-top: 6px; }
  .table-section h2 { font-size: 13px; margin: 0 0 8px; font-weight: 700; }
  .count { font-weight: 400; color: #8a94a3; font-size: 9px; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; word-break: break-word; }
  th, td { border: 1px solid #d7dde5; padding: 5px 6px; vertical-align: top; text-align: left; }
  thead { display: table-header-group; }
  th { background: #2f3a45; color: #fff; font-weight: 600; font-size: 9px; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tr.even td { background: #f7f9fb; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.img { text-align: center; padding: 3px; }
  td.img img { max-width: 100%; max-height: 92px; object-fit: contain; display: block; margin: 0 auto; }
  .muted, .empty { color: #a3acb8; text-align: center; }
  .page-break { break-before: page; page-break-before: always; margin-top: 16px; }
  footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #eceff3; color: #98a2af; font-size: 8px; display: flex; justify-content: space-between; }
  @media print { body { font-size: 9px; } }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">ShotFlow · Shot List</div>
    <h1>${escapeHtml(doc.projectName)}</h1>
    <div class="subtitle">分镜表 / 拍摄执行文档</div>
    <div class="info-grid">${infoGrid}</div>
    <div class="stats">${stats}</div>
  </header>
  ${renderTable(doc.shotTable)}
  ${rundown}
  <footer><span>${escapeHtml(options.footer)}</span><span>生成于 ${escapeHtml(doc.generatedAt)}</span></footer>
</body>
</html>`;
}

/** xlsx 单元格：图片列降级为「有图」，其余保持原文 */
export function exportCellToXlsx(cell: ExportCell): string | number {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : '';
  if (typeof cell === 'string') return cell;
  return cell.image ? '有图' : '';
}
