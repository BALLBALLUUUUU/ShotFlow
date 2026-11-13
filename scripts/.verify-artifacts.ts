/* 一次性校验脚本：生成真实 .xlsx 与打印 HTML 供外部工具检查，不属于交付代码 */
import { writeFileSync } from 'node:fs';
import { createSampleProject } from '../src/domain/project';
import { defaultExportOptions } from '../src/domain/exportInfo';
import { buildExportDocument, buildStoryboardHtml, RECOMMENDED_COLUMN_IDS } from '../src/domain/exportDocument';
import { buildWorkbook, documentToSheets } from '../src/domain/xlsx';

const project = createSampleProject();
project.name = '咖啡馆短片 · 分镜表';
project.exportInfo.director = '张导';
project.exportInfo.cinematographer = '李摄影';
project.exportInfo.custom = [{ id: 'x', label: '灯光', value: '老王' }];
const options = { ...defaultExportOptions(), columnIds: [...RECOMMENDED_COLUMN_IDS], includeRundown: true };
const doc = buildExportDocument(project, options);
const xlsx = buildWorkbook(documentToSheets(doc));
writeFileSync('/tmp/shotflow-verify.xlsx', xlsx);
writeFileSync('/tmp/shotflow-verify.html', buildStoryboardHtml(doc, options), 'utf8');
console.log('ARTIFACTS_OK', { xlsxBytes: xlsx.length, shots: doc.shotTable.rows.length, sheets: documentToSheets(doc).length });
