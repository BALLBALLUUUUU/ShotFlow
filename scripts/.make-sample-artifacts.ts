/** 生成补全后的示例脚本成品：.shotflow 项目包 + 分镜表 HTML（供 printToPDF）+ XLSX */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSampleProject } from '../src/domain/project';
import { buildProjectPackage } from '../src/domain/projectPackage';
import { buildExportDocument, buildStoryboardHtml } from '../src/domain/exportDocument';
import { defaultExportOptions } from '../src/domain/exportInfo';
import { buildWorkbook, documentToSheets } from '../src/domain/xlsx';

const outDir = join(process.cwd(), 'deliverables');
mkdirSync(outDir, { recursive: true });

const project = createSampleProject();
const pkg = buildProjectPackage(project, '球球');
writeFileSync(join(outDir, pkg.fileName), pkg.bytes);

const base = defaultExportOptions();

// Excel：全文字列（图片列会被写成空单元格，故不含画面/参考）
const xlsxOptions = {
  ...base,
  format: 'xlsx' as const,
  includeImages: false,
  includeRundown: true,
  columnIds: [
    'shotNo', 'shotSize', 'durationSec', 'content', 'notes',
    'sceneExpectation', 'sound', 'cameraAngle', 'cameraMove',
    'cameraBody', 'focalLength', 'sceneNo',
  ],
};
const xlsxDoc = buildExportDocument(project, xlsxOptions);
const xlsx = buildWorkbook(documentToSheets(xlsxDoc));
writeFileSync(join(outDir, '示例脚本-分镜表.xlsx'), xlsx);

// PDF：带 10 张画面，A4 横向，只留能看清的主列
const pdfOptions = {
  ...base,
  format: 'pdf' as const,
  includeImages: true,
  includeRundown: true,
  pageSize: 'A4' as const,
  orientation: 'landscape' as const,
  columnIds: [
    'shotNo', 'frame', 'shotSize', 'durationSec', 'content',
    'notes', 'sceneExpectation', 'sound', 'cameraMove', 'sceneNo',
  ],
  footer: 'ShotFlow · 一杯手冲的时间 · 分镜脚本',
};
const doc = buildExportDocument(project, pdfOptions);
const html = buildStoryboardHtml(doc, pdfOptions);
writeFileSync(join(outDir, '示例脚本-分镜表.html'), html, 'utf8');

const emptyCells = doc.shotTable.rows.flatMap((row, rowIndex) => row
  .map((cell, columnIndex) => ({ cell, column: doc.shotTable.columns[columnIndex] }))
  .filter(({ cell, column }) => column && column.kind !== 'image' && String(typeof cell === 'object' ? '' : cell).trim() === '')
  .map(({ column }) => `#${rowIndex + 1}/${column?.label}`));
const missingFrames = doc.shotTable.rows.filter((row) => {
  const cell = row[doc.shotTable.columns.findIndex((column) => column.id === 'frame')];
  return typeof cell !== 'object' || cell === null || !('image' in cell) || !cell.image;
});

console.log(JSON.stringify({
  package: { file: pkg.fileName, bytes: pkg.bytes.length, assets: pkg.manifest.assetCount },
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  xlsxBytes: xlsx.length,
  shots: doc.shotTable.rows.length,
  infoRows: doc.infoRows.length,
  rundownRows: doc.rundownTable?.rows.length ?? 0,
  totalDurationSec: doc.totalDurationSec,
  emptyCells,
  missingFrames: missingFrames.length,
}, null, 2));
