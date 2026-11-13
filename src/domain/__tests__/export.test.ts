import { describe, expect, it } from 'vitest';
import { createEmptyProject, createSampleProject, deserializeProject, serializeProject } from '../project';
import { buildProjectPackage, readProjectPackage } from '../projectPackage';
import {
  EXPORT_INFO_FIELDS,
  addCustomInfoField,
  defaultExportOptions,
  exportInfoRows,
  normalizeExportInfo,
  removeCustomInfoField,
  updateCustomInfoField,
} from '../exportInfo';
import {
  buildExportDocument,
  buildStoryboardHtml,
  escapeHtml,
  exportFileName,
  safeImageSrc,
} from '../exportDocument';
import { buildWorkbook, columnName, documentToSheets, xmlEscape } from '../xlsx';
import { readZip, readTextEntry } from '../zip';
import type { ExportOptions } from '../types';

function options(patch: Partial<ExportOptions> = {}): ExportOptions {
  return { ...defaultExportOptions(), columnIds: ['shotNo', 'frame', 'shotSize', 'durationSec', 'content'], ...patch };
}

describe('导出片头信息', () => {
  it('空白项目不带任何预设片头内容', () => {
    const project = createEmptyProject('新项目');
    expect(project.exportInfo.director).toBe('');
    expect(project.exportInfo.cinematographer).toBe('');
    expect(project.exportInfo.custom).toEqual([]);
    expect(exportInfoRows(project)[0]).toEqual({ label: '项目名称', value: '新项目' });
  });

  it('旧项目（无 exportInfo）反序列化时补齐，并把 client 迁移到客户字段', () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      id: 'proj_legacy',
      name: '旧项目',
      client: '某品牌',
      shots: [],
    });
    const project = deserializeProject(legacy);
    expect(project.exportInfo.director).toBe('');
    expect(project.exportInfo.client).toBe('某品牌');
    expect(project.exportInfo.custom).toEqual([]);
  });

  it('损坏值降级、超长字段截断、空标签自定义字段被丢弃', () => {
    const info = normalizeExportInfo({
      director: 123,
      notes: 'x'.repeat(3000),
      custom: [
        { id: 'a', label: '灯光', value: '阿明' },
        { label: '', value: '无标签' },
        null,
      ],
    });
    expect(info.director).toBe('');
    expect(info.notes).toHaveLength(2000);
    expect(info.custom).toHaveLength(1);
    expect(info.custom[0]).toMatchObject({ label: '灯光', value: '阿明' });
  });

  it('自定义字段可增删改，且片头行顺序稳定', () => {
    let info = addCustomInfoField(createEmptyProject().exportInfo, '灯光', '阿明');
    const id = info.custom[0]?.id ?? '';
    expect(EXPORT_INFO_FIELDS.map((field) => field.label)).toContain('摄影');
    info = updateCustomInfoField(info, id, { value: '阿强' });
    expect(info.custom[0]?.value).toBe('阿强');
    const project = createEmptyProject('片名');
    project.exportInfo = info;
    expect(exportInfoRows(project).at(-1)).toEqual({ label: '灯光', value: '阿强' });
    expect(removeCustomInfoField(info, id).custom).toHaveLength(0);
  });

  it('片头信息随 JSON 与 .shotflow 项目包往返不丢', () => {
    const project = createSampleProject();
    project.exportInfo.director = '张导';
    project.exportInfo.cinematographer = '李摄影';
    project.exportInfo.custom = [{ id: 'x', label: '灯光', value: '老王' }];
    expect(deserializeProject(serializeProject(project)).exportInfo).toEqual(project.exportInfo);

    const { bytes } = buildProjectPackage(project, '球球');
    const parsed = readProjectPackage(bytes);
    expect(parsed.project.exportInfo.director).toBe('张导');
    expect(parsed.project.exportInfo.custom[0]?.value).toBe('老王');
  });
});

describe('导出文档中间层', () => {
  it('按 sortIndex 输出镜头行，统计时长与场次', () => {
    const project = createSampleProject();
    const doc = buildExportDocument(project, options());
    expect(doc.shotTable.rows).toHaveLength(10);
    expect(doc.shotTable.columns.map((column) => column.label)).toEqual(['镜号', '画面', '景别', '时长（秒）', '内容']);
    expect(doc.totalDurationSec).toBe(project.shots.reduce((sum, shot) => sum + shot.durationSec, 0));
    expect(doc.stats.some((row) => row.label === '镜头数' && row.value === '10 个')).toBe(true);
    expect(doc.rundownTable?.rows.length).toBe(project.rundown.length);
  });

  it('场次筛选与「不含图片」开关生效', () => {
    const project = createSampleProject();
    const sceneId = project.scenes[0]?.id ?? '';
    const filtered = buildExportDocument(project, options({ sceneFilter: sceneId }));
    expect(filtered.shotTable.rows).toHaveLength(6);
    const noImages = buildExportDocument(project, options({ includeImages: false }));
    expect(noImages.shotTable.columns.map((column) => column.id)).not.toContain('frame');
  });

  it('自定义列也能被导出', () => {
    const project = createSampleProject();
    project.columnSchema.columns.push({
      id: 'col_extra', key: 'col_extra', label: '灯光备注', kind: 'text', width: 160, visible: true, builtin: false, order: 99,
    });
    project.shots[0]!.custom.col_extra = '逆光';
    const doc = buildExportDocument(project, options({ columnIds: ['shotNo', 'col_extra'] }));
    expect(doc.shotTable.columns[1]?.label).toBe('灯光备注');
    expect(doc.shotTable.rows[0]?.[1]).toBe('逆光');
  });

  it('HTML 转义用户输入、只允许位图 data URL', () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain('<script>');
    expect(safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).not.toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('https://example.com/a.png')).toBeNull();
  });

  it('HTML 包含全部片头信息、纸张设置与 Rundown，且不注入脚本', () => {
    const project = createSampleProject();
    project.name = '<script>alert(1)</script>';
    project.exportInfo.director = '张导 & 李导';
    project.exportInfo.custom = [{ id: 'x', label: '灯光', value: '<img onerror=1>' }];
    const doc = buildExportDocument(project, options({ pageSize: 'A3', orientation: 'portrait', includeRundown: true }));
    const html = buildStoryboardHtml(doc, options({ pageSize: 'A3', orientation: 'portrait', includeRundown: true }));
    expect(html).toContain('@page { size: A3 portrait;');
    expect(html).toContain('张导 &amp; 李导');
    expect(html).toContain('分镜表');
    expect(html).toContain('拍摄日 Rundown');
    expect(html).toContain('&lt;img onerror=1&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('生成于');
  });

  it('关闭 Rundown 后不再输出第二张表', () => {
    const doc = buildExportDocument(createSampleProject(), options({ includeRundown: false }));
    expect(doc.rundownTable).toBeNull();
    expect(buildStoryboardHtml(doc, options({ includeRundown: false }))).not.toContain('拍摄日 Rundown');
  });

  it('文件名安全且按格式切换扩展名', () => {
    const project = createSampleProject();
    project.name = 'A/B:C*?';
    expect(exportFileName(project, options({ format: 'pdf' }))).toBe('A_B_C__-分镜表.pdf');
    expect(exportFileName(project, options({ format: 'xlsx' }))).toMatch(/\.xlsx$/);
    expect(exportFileName(project, options({ format: 'package' }))).toMatch(/\.shotflow$/);
  });
});

describe('XLSX 生成', () => {
  it('列名换算覆盖 AA / ZZ 边界', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
    expect(columnName(701)).toBe('ZZ');
  });

  it('XML 转义移除控制字符并保留换行', () => {
    expect(xmlEscape('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&apos;');
    expect(xmlEscape('a\u0001b')).toBe('ab');
    expect(xmlEscape('第一行\n第二行')).toContain('\n');
  });

  it('生成可被 ZIP 读取的 xlsx，包含标准 OOXML 部件与三个工作表', () => {
    const project = createSampleProject();
    project.exportInfo.director = '张导';
    project.exportInfo.cinematographer = '李摄影';
    const doc = buildExportDocument(project, options({ includeRundown: true }));
    const bytes = buildWorkbook(documentToSheets(doc));
    const entries = readZip(bytes);
    const names = entries.map((entry) => entry.name);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    expect(names).toContain('xl/styles.xml');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/worksheets/sheet2.xml');
    expect(names).toContain('xl/worksheets/sheet3.xml');

    const workbook = readTextEntry(entries, 'xl/workbook.xml') ?? '';
    expect(workbook).toContain('分镜表');
    expect(workbook).toContain('项目信息');
    expect(workbook).toContain('Rundown');
    const shotSheet = readTextEntry(entries, 'xl/worksheets/sheet1.xml') ?? '';
    expect(shotSheet).toContain('t="inlineStr"');
    expect(shotSheet).toContain('磨豆机启动');
    expect(shotSheet).toContain('autoFilter');
    expect(shotSheet).toContain('state="frozen"');
    const infoSheet = readTextEntry(entries, 'xl/worksheets/sheet2.xml') ?? '';
    expect(infoSheet).toContain('张导');
    expect(infoSheet).toContain('李摄影');
  });

  it('xlsx 中图片单元格降级为「有图」且不写入 base64', () => {
    const project = createSampleProject();
    const shot = project.shots[0];
    if (shot) shot.frame = { id: 'img1', path: 'data:image/png;base64,iVBORw0KGgo=', kind: 'upload', updatedAt: '' };
    const bytes = buildWorkbook(documentToSheets(buildExportDocument(project, options())));
    const sheet = readTextEntry(readZip(bytes), 'xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain('有图');
    expect(sheet).not.toContain('iVBORw0KGgo');
  });
});
