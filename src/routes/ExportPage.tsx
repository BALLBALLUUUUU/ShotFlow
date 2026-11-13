import { useEffect, useMemo, useState } from 'react';
import { Check, FileDown, FileSpreadsheet, FileText, Package, Plus, Trash2, UserRound } from 'lucide-react';
import { EXPORT_INFO_FIELDS, addCustomInfoField, defaultExportOptions, removeCustomInfoField, updateCustomInfoField } from '@/domain/exportInfo';
import { applyProfileToExportInfo, profileSignature } from '@/domain/profile';
import ProfileAvatar from '@/components/ProfileAvatar';
import ProfileSettings from '@/components/ProfileSettings';
import { useProfile } from '@/store/profileStore';
import {
  RECOMMENDED_COLUMN_IDS,
  buildExportDocument,
  buildStoryboardHtml,
  exportFileName,
} from '@/domain/exportDocument';
import { buildWorkbook, documentToSheets } from '@/domain/xlsx';
import { visibleColumns } from '@/domain/schema';
import { exportPackage, authorKey } from '@/store/projectActions';
import { writeExportPdf, writeExportXlsx } from '@/store/exportIO';
import { useProjectStore } from '@/store/useProjectStore';
import type { ExportFormat, ExportOptions } from '@/domain/types';

const OPTIONS_KEY = 'shotflow.export.options';

function readInitialOptions(): ExportOptions {
  const defaults = defaultExportOptions();
  try {
    const raw = window.localStorage.getItem(OPTIONS_KEY);
    if (!raw) return { ...defaults, columnIds: [...RECOMMENDED_COLUMN_IDS] };
    const parsed = JSON.parse(raw) as Partial<ExportOptions>;
    return {
      ...defaults,
      format: parsed.format === 'xlsx' || parsed.format === 'package' ? parsed.format : 'pdf',
      columnIds: Array.isArray(parsed.columnIds) ? parsed.columnIds.filter((id): id is string => typeof id === 'string') : [...RECOMMENDED_COLUMN_IDS],
      includeImages: typeof parsed.includeImages === 'boolean' ? parsed.includeImages : defaults.includeImages,
      includeRundown: typeof parsed.includeRundown === 'boolean' ? parsed.includeRundown : defaults.includeRundown,
      sceneFilter: typeof parsed.sceneFilter === 'string' ? parsed.sceneFilter : 'all',
      pageSize: parsed.pageSize === 'A3' ? 'A3' : 'A4',
      orientation: parsed.orientation === 'portrait' ? 'portrait' : 'landscape',
      footer: typeof parsed.footer === 'string' ? parsed.footer.slice(0, 80) : defaults.footer,
    };
  } catch {
    return { ...defaults, columnIds: [...RECOMMENDED_COLUMN_IDS] };
  }
}

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string; icon: typeof FileText }> = [
  { id: 'pdf', label: 'PDF 分镜表', hint: '带片头信息、画面缩略图、页码，适合打印与发给剧组', icon: FileText },
  { id: 'xlsx', label: 'Excel 工作簿', hint: '.xlsx 三张表：分镜表 / 项目信息 / Rundown，可继续编辑', icon: FileSpreadsheet },
  { id: 'package', label: '项目包 .shotflow', hint: '完整备份，同事导入后可继续编辑（含图片资源）', icon: Package },
];

export default function ExportPage() {
  const project = useProjectStore((state) => state.project);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const renameProject = useProjectStore((state) => state.renameProject);
  const updateExportInfo = useProjectStore((state) => state.updateExportInfo);
  const setExportCustomFields = useProjectStore((state) => state.setExportCustomFields);
  const setToast = useProjectStore((state) => state.setToast);

  const [options, setOptions] = useState<ExportOptions>(readInitialOptions);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const profile = useProfile();

  useEffect(() => {
    try {
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // localStorage 不可用时仅影响选项记忆，不影响导出
    }
  }, [options]);

  const columns = useMemo(() => visibleColumns(project.columnSchema), [project.columnSchema]);
  const doc = useMemo(() => buildExportDocument(project, options, profile), [project, options, profile]);
  const previewHtml = useMemo(() => buildStoryboardHtml(doc, options), [doc, options]);
  const selectedCount = columns.filter((column) => options.columnIds.includes(column.id)).length;

  // 个人设置只补空位，项目里已填的署名优先
  const effectiveInfo = useMemo(() => applyProfileToExportInfo(project.exportInfo, profile), [project.exportInfo, profile]);
  const autoFilledFields = profile.name.trim()
    ? EXPORT_INFO_FIELDS.filter((field) => !project.exportInfo[field.key].trim() && effectiveInfo[field.key].trim() !== '')
    : [];
  const autoFilledCustom = effectiveInfo.custom.length > project.exportInfo.custom.length;

  function patch(next: Partial<ExportOptions>) {
    setOptions((previous) => ({ ...previous, ...next }));
  }

  function toggleColumn(id: string) {
    setOptions((previous) => ({
      ...previous,
      columnIds: previous.columnIds.includes(id)
        ? previous.columnIds.filter((item) => item !== id)
        : [...previous.columnIds, id],
    }));
  }

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const fileName = exportFileName(project, options);
      if (options.format === 'pdf') {
        const html = buildStoryboardHtml(buildExportDocument(project, options, profile), options);
        const result = await writeExportPdf(html, fileName, options);
        if (result.canceled) return setToast('已取消导出');
        if (result.method === 'native') setToast(`PDF 已导出：${result.filePath ?? fileName}`);
        else if (result.method === 'print') setToast('已打开打印窗口，请选择「另存为 PDF」');
        else setToast('打印窗口被拦截，已下载可打印的 HTML 文件');
      } else if (options.format === 'xlsx') {
        const bytes = buildWorkbook(documentToSheets(buildExportDocument(project, options, profile)));
        const result = await writeExportXlsx(bytes, fileName);
        if (result.canceled) return setToast('已取消导出');
        setToast(result.method === 'native' ? `Excel 已导出：${result.filePath ?? fileName}` : `已下载 ${fileName}`);
      } else {
        const result = await exportPackage(project, authorKey());
        setToast(`已导出 ${result.fileName}（含 ${result.assetCount} 张图片资源）`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败';
      if (message !== '已取消导出') setToast(message);
    } finally {
      setBusy(false);
    }
  }

  const format = FORMATS.find((item) => item.id === options.format) ?? FORMATS[0];

  return (
    <section className="page export-page">
      <div className="page-head export-head">
        <div className="page-title-row">
          <h1>导出分镜</h1>
          <span className="help-dot" title="片头信息保存在项目里，会随项目自动保存、随项目包一起发给同事">?</span>
          <span className="export-subtitle">填写制作信息 · 选择格式 · 实时预览</span>
        </div>
      </div>

      {!currentProjectId ? (
        <div className="export-empty">请先在项目库打开或新建一个项目，再导出分镜。</div>
      ) : (
        <div className="export-layout">
          <div className="export-form">
            <section className="export-block">
              <h2>片头信息 <span>会印在首页，也会写进 Excel「项目信息」表</span></h2>
              <div className="export-profile">
                <ProfileAvatar profile={profile} size={34} />
                <div className="export-profile-text">
                  <strong>{profile.name ? profileSignature(profile) : '未设置个人资料'}</strong>
                  <span>
                    {profile.name
                      ? autoFilledFields.length > 0 || autoFilledCustom
                        ? `导出时自动填入：${[...autoFilledFields.map((field) => field.label), ...(autoFilledCustom ? [profile.role.trim() || '署名'] : [])].join(' / ')}`
                        : '项目里已填的署名优先，不会被个人设置覆盖'
                      : '填好姓名与职务后，导出分镜和 Rundown 会自动署名'}
                  </span>
                </div>
                <button className="btn ghost compact" type="button" onClick={() => setSettingsOpen(true)}>
                  <UserRound size={13} />{profile.name ? '修改' : '去设置'}
                </button>
              </div>
              <label className="export-field full">
                <span>项目名称</span>
                <input
                  className="text-input"
                  value={project.name}
                  placeholder="项目名称（同步到项目库）"
                  onChange={(event) => renameProject(event.currentTarget.value)}
                />
              </label>
              <div className="export-fields">
                {EXPORT_INFO_FIELDS.map((field) => (
                  <label className={`export-field ${field.key === 'notes' ? 'full' : ''}`} key={field.key}>
                    <span>{field.label}</span>
                    {field.key === 'notes' ? (
                      <textarea
                        className="text-input"
                        rows={2}
                        value={project.exportInfo[field.key]}
                        placeholder={!project.exportInfo[field.key].trim() && effectiveInfo[field.key] ? `自动填入：${effectiveInfo[field.key]}` : field.placeholder}
                        onChange={(event) => updateExportInfo({ [field.key]: event.currentTarget.value })}
                      />
                    ) : (
                      <input
                        className="text-input"
                        value={project.exportInfo[field.key]}
                        placeholder={!project.exportInfo[field.key].trim() && effectiveInfo[field.key] ? `自动填入：${effectiveInfo[field.key]}` : field.placeholder}
                        onChange={(event) => updateExportInfo({ [field.key]: event.currentTarget.value })}
                      />
                    )}
                  </label>
                ))}
              </div>

              <div className="custom-info">
                <div className="custom-info-head">
                  <span>自定义信息（灯光 / 录音 / 美术 …）</span>
                  <button
                    className="btn ghost compact"
                    type="button"
                    onClick={() => setExportCustomFields(addCustomInfoField(project.exportInfo).custom)}
                  ><Plus size={13} />添加一行</button>
                </div>
                {project.exportInfo.custom.map((field) => (
                  <div className="custom-info-row" key={field.id}>
                    <input
                      className="text-input"
                      value={field.label}
                      placeholder="字段名"
                      aria-label="自定义字段名"
                      onChange={(event) => setExportCustomFields(updateCustomInfoField(project.exportInfo, field.id, { label: event.currentTarget.value }).custom)}
                    />
                    <input
                      className="text-input"
                      value={field.value}
                      placeholder="内容"
                      aria-label="自定义字段内容"
                      onChange={(event) => setExportCustomFields(updateCustomInfoField(project.exportInfo, field.id, { value: event.currentTarget.value }).custom)}
                    />
                    <button
                      className="icon-btn small danger"
                      type="button"
                      aria-label="删除这一行"
                      title="删除"
                      onClick={() => setExportCustomFields(removeCustomInfoField(project.exportInfo, field.id).custom)}
                    ><Trash2 size={14} /></button>
                  </div>
                ))}
                {project.exportInfo.custom.length === 0 ? <p className="export-hint">还没有自定义信息，可继续添加任意字段。</p> : null}
              </div>
            </section>

            <section className="export-block">
              <h2>导出格式</h2>
              <div className="format-grid">
                {FORMATS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`format-card ${options.format === item.id ? 'active' : ''}`}
                      onClick={() => patch({ format: item.id })}
                    >
                      <span className="format-title"><Icon size={16} />{item.label}</span>
                      <span className="format-hint">{item.hint}</span>
                      {options.format === item.id ? <span className="format-check"><Check size={12} /></span> : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="export-block">
              <h2>导出内容</h2>
              <div className="export-fields">
                <label className="export-field">
                  <span>场次范围</span>
                  <select className="select-input" value={options.sceneFilter} onChange={(event) => patch({ sceneFilter: event.currentTarget.value })}>
                    <option value="all">全部镜头</option>
                    {project.scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>场 {scene.sceneNo || '—'} · {scene.location || '未命名'}</option>
                    ))}
                  </select>
                </label>
                <label className="export-field">
                  <span>纸张 / 方向（PDF）</span>
                  <div className="inline-pair">
                    <select className="select-input" value={options.pageSize} onChange={(event) => patch({ pageSize: event.currentTarget.value as ExportOptions['pageSize'] })}>
                      <option value="A4">A4</option>
                      <option value="A3">A3</option>
                    </select>
                    <select className="select-input" value={options.orientation} onChange={(event) => patch({ orientation: event.currentTarget.value as ExportOptions['orientation'] })}>
                      <option value="landscape">横向</option>
                      <option value="portrait">纵向</option>
                    </select>
                  </div>
                </label>
                <label className="export-field full">
                  <span>页脚文字（PDF）</span>
                  <input className="text-input" value={options.footer} onChange={(event) => patch({ footer: event.currentTarget.value })} />
                </label>
              </div>

              <div className="export-checks">
                <label><input type="checkbox" checked={options.includeImages} onChange={(event) => patch({ includeImages: event.currentTarget.checked })} />包含画面 / 参考图（Excel 中标记为「有图」）</label>
                <label><input type="checkbox" checked={options.includeRundown} onChange={(event) => patch({ includeRundown: event.currentTarget.checked })} />附带拍摄日 Rundown</label>
              </div>

              <div className="column-picker-head">
                <span>导出列（{selectedCount}/{columns.length}）</span>
                <div>
                  <button className="btn ghost compact" type="button" onClick={() => patch({ columnIds: RECOMMENDED_COLUMN_IDS.filter((id) => columns.some((column) => column.id === id)) })}>推荐列</button>
                  <button className="btn ghost compact" type="button" onClick={() => patch({ columnIds: columns.map((column) => column.id) })}>全选</button>
                  <button className="btn ghost compact" type="button" onClick={() => patch({ columnIds: [] })}>清空</button>
                </div>
              </div>
              <div className="column-picker">
                {columns.map((column) => (
                  <label key={column.id} className={options.columnIds.includes(column.id) ? 'checked' : ''}>
                    <input type="checkbox" checked={options.columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
                    {column.label}
                  </label>
                ))}
              </div>
            </section>

            <div className="export-actions">
              <div className="export-summary">
                <strong>{doc.shotTable.rows.length} 个镜头 · {doc.shotTable.columns.length} 列</strong>
                <span>{format?.label} · {exportFileName(project, options)}</span>
              </div>
              <button className="btn primary" type="button" disabled={busy} onClick={() => void handleExport()}>
                <FileDown size={15} />{busy ? '正在导出…' : '导出'}
              </button>
            </div>
          </div>

          <div className="export-preview">
            <div className="preview-head">
              <span>预览 · {options.pageSize} {options.orientation === 'landscape' ? '横向' : '纵向'}</span>
              <span>{options.format === 'pdf' ? '与导出 PDF 排版一致' : '预览按 PDF 排版展示，Excel 内容一致'}</span>
            </div>
            <iframe className="preview-frame" title="分镜表预览" srcDoc={previewHtml} />
          </div>
        </div>
      )}

      {settingsOpen ? (
        <ProfileSettings onClose={() => setSettingsOpen(false)} onToast={setToast} />
      ) : null}
    </section>
  );
}
