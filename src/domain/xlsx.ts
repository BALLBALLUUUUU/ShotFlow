/**
 * 零依赖 XLSX 生成：直接写 OOXML（SpreadsheetML），复用项目自带的 store 模式 ZIP。
 * 生成的 .xlsx 可被 Excel / Numbers / WPS / LibreOffice 直接打开，中文用 inlineStr 避免共享字符串表。
 */
import { createZip } from './zip';
import { exportCellToXlsx, type ExportDocument, type ExportTable } from './exportDocument';

const encoder = new TextEncoder();

export interface XlsxSheet {
  name: string;
  columns: Array<{ label: string; width: number }>;
  rows: Array<Array<string | number>>;
  /** 首行作为表头冻结 + 自动筛选 */
  header: boolean;
  /** 「项目信息」页：第一列加粗 */
  boldFirstColumn?: boolean;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** 去掉 XML 1.0 不允许的控制字符，再转义实体；换行保留并用 xml:space 保护 */
export function xmlEscape(value: unknown): string {
  const text = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, 32000);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function columnName(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '_').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function xmlCell(ref: string, value: string | number, style: number): string {
  const s = ` s="${style}"`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  const text = xmlEscape(value);
  if (text === '') return `<c r="${ref}"${s}/>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function buildSheetXml(sheet: XlsxSheet): string {
  const columnCount = Math.max(1, sheet.columns.length);
  const lastColumn = columnName(columnCount - 1);
  const lastRow = Math.max(1, sheet.rows.length);
  const cols = sheet.columns.length > 0
    ? `<cols>${sheet.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(80, Math.max(8, Math.round(column.width / 9)))}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = sheet.rows.map((row, rowIndex) => {
    const r = rowIndex + 1;
    const height = rowIndex === 0 && sheet.header ? ' ht="26" customHeight="1"' : '';
    const cells = row.map((value, index) => {
      const style = rowIndex === 0 && sheet.header ? 1 : (sheet.boldFirstColumn && index === 0 ? 2 : 0);
      return xmlCell(`${columnName(index)}${r}`, value, style);
    }).join('');
    return `<row r="${r}"${height}>${cells}</row>`;
  }).join('');
  const filter = sheet.header && sheet.rows.length > 0
    ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>`
    : '';
  return `${XML_HEADER}
<worksheet xmlns="${MAIN_NS}">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0">${sheet.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  ${cols}
  <sheetData>${rows}</sheetData>
  ${filter}
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function buildStylesXml(): string {
  return `${XML_HEADER}
<styleSheet xmlns="${MAIN_NS}">
  <fonts count="3">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2F3A45"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD8DEE5"/></left><right style="thin"><color rgb="FFD8DEE5"/></right>
      <top style="thin"><color rgb="FFD8DEE5"/></top><bottom style="thin"><color rgb="FFD8DEE5"/></bottom><diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

export function buildWorkbook(sheets: XlsxSheet[]): Uint8Array {
  const used = new Set<string>();
  const named = sheets.map((sheet, index) => {
    let name = safeSheetName(sheet.name, index);
    let suffix = 1;
    while (used.has(name)) {
      name = `${safeSheetName(sheet.name, index).slice(0, 27)}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return { ...sheet, name };
  });

  const overrides = named.map((_sheet, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const contentTypes = `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${overrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `${XML_HEADER}
<Relationships xmlns="${PKG_REL_NS}">
  <Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetTags = named.map((sheet, index) =>
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const workbookXml = `${XML_HEADER}
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <sheets>${sheetTags}</sheets>
</workbook>`;

  const relTags = named.map((_sheet, index) =>
    `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const workbookRels = `${XML_HEADER}
<Relationships xmlns="${PKG_REL_NS}">
  ${relTags}
  <Relationship Id="rId${named.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>
</Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(buildStylesXml()) },
    ...named.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(buildSheetXml(sheet)),
    })),
  ];
  return createZip(entries);
}

function tableToSheet(table: ExportTable): XlsxSheet {
  return {
    name: table.title,
    columns: table.columns.map((column) => ({ label: column.label, width: column.width })),
    rows: [
      table.columns.map((column) => column.label),
      ...table.rows.map((row) => row.map(exportCellToXlsx)),
    ],
    header: true,
  };
}

/** 把导出中间文档编译成工作表：分镜表 / 项目信息 / Rundown */
export function documentToSheets(doc: ExportDocument): XlsxSheet[] {
  const infoRows: Array<Array<string | number>> = [
    ['项目', '内容'],
    ...doc.infoRows.map((row) => [row.label, row.value]),
    ...doc.stats.map((row) => [row.label, row.value]),
    ['生成时间', doc.generatedAt],
    ['预计总时长(秒)', Math.round(doc.totalDurationSec)],
  ];
  const sheets: XlsxSheet[] = [
    tableToSheet(doc.shotTable),
    {
      name: '项目信息',
      columns: [{ label: '项目', width: 150 }, { label: '内容', width: 320 }],
      rows: infoRows,
      header: true,
      boldFirstColumn: true,
    },
  ];
  if (doc.rundownTable) sheets.push(tableToSheet(doc.rundownTable));
  return sheets;
}
