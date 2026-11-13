/**
 * 导出片头信息：纯函数，供项目模型、导出页面、PDF / Excel 生成共用。
 * 不依赖 project.ts，避免与反序列化形成循环引用。
 */
import { applyProfileToExportInfo } from './profile';
import type { Profile } from './profile';
import type { ExportCustomField, ExportInfo, ExportOptions, Project } from './types';

export interface InfoRow {
  label: string;
  value: string;
}

/** 固定字段的展示顺序与标签，UI 表单也复用这份定义 */
export const EXPORT_INFO_FIELDS: ReadonlyArray<{ key: keyof Omit<ExportInfo, 'custom'>; label: string; placeholder: string }> = [
  { key: 'director', label: '导演', placeholder: '导演姓名' },
  { key: 'cinematographer', label: '摄影', placeholder: '摄影指导 / DP' },
  { key: 'producer', label: '制片', placeholder: '制片人 / 制片组' },
  { key: 'client', label: '客户 / 出品', placeholder: '客户或出品方' },
  { key: 'shootDate', label: '拍摄日期', placeholder: '如 2026-11-20' },
  { key: 'location', label: '拍摄地点', placeholder: '场地 / 城市' },
  { key: 'version', label: '版本', placeholder: '如 V1.0' },
  { key: 'notes', label: '备注', placeholder: '其他需要印在首页的信息' },
];

export function createEmptyExportInfo(): ExportInfo {
  return {
    director: '',
    cinematographer: '',
    producer: '',
    client: '',
    shootDate: '',
    location: '',
    version: '',
    notes: '',
    custom: [],
  };
}

export function newCustomFieldId(): string {
  return `info_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCustomField(raw: unknown, index: number): ExportCustomField {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `info_${index}`,
    label: typeof record.label === 'string' ? record.label.slice(0, 60) : '',
    value: typeof record.value === 'string' ? record.value.slice(0, 500) : '',
  };
}

/** 防御性反序列化：旧项目没有 exportInfo 时补齐，损坏值降级，不丢内容 */
export function normalizeExportInfo(raw: unknown): ExportInfo {
  const base = createEmptyExportInfo();
  if (!raw || typeof raw !== 'object') return base;
  const record = raw as Record<string, unknown>;
  for (const field of EXPORT_INFO_FIELDS) {
    const value = record[field.key];
    if (typeof value === 'string') base[field.key] = value.slice(0, 500);
  }
  base.notes = record.notes && typeof record.notes === 'string' ? record.notes.slice(0, 2000) : '';
  base.custom = Array.isArray(record.custom)
    ? record.custom.slice(0, 100).map(normalizeCustomField).filter((item) => item.label.trim() !== '')
    : [];
  // 兼容旧项目：Project.client 里可能已经有客户名
  if (!base.client && typeof record.legacyClient === 'string') base.client = record.legacyClient;
  return base;
}

export function addCustomInfoField(info: ExportInfo, label = '', value = ''): ExportInfo {
  return {
    ...info,
    custom: [...info.custom, { id: newCustomFieldId(), label, value }],
  };
}

export function removeCustomInfoField(info: ExportInfo, id: string): ExportInfo {
  return { ...info, custom: info.custom.filter((field) => field.id !== id) };
}

export function updateCustomInfoField(info: ExportInfo, id: string, patch: Partial<Pick<ExportCustomField, 'label' | 'value'>>): ExportInfo {
  return {
    ...info,
    custom: info.custom.map((field) => (field.id === id ? { ...field, ...patch } : field)),
  };
}

/**
 * 片头信息展示行：项目名称永远来自项目库名称，其余按固定顺序 + 自定义字段。
 * 传了个人设置时，把空着的署名栏自动补成「职务 + 姓名」（只填空位，不覆盖已填内容）。
 */
export function exportInfoRows(project: Project, profile?: Profile | null): InfoRow[] {
  const info = profile ? applyProfileToExportInfo(project.exportInfo, profile) : project.exportInfo;
  const rows: InfoRow[] = [{ label: '项目名称', value: project.name }];
  for (const field of EXPORT_INFO_FIELDS) {
    rows.push({ label: field.label, value: info[field.key] });
  }
  for (const field of info.custom) {
    if (field.label.trim()) rows.push({ label: field.label.trim(), value: field.value });
  }
  return rows;
}

export function defaultExportOptions(): ExportOptions {
  return {
    format: 'pdf',
    columnIds: [],
    includeImages: true,
    includeRundown: true,
    sceneFilter: 'all',
    pageSize: 'A4',
    orientation: 'landscape',
    footer: 'ShotFlow · 分镜表',
  };
}
