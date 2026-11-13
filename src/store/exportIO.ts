/**
 * 导出 IO 适配层：桌面端生成真实 PDF / xlsx 文件，浏览器 / PWA 降级为打印窗口与下载。
 * 上层只传字节或 HTML，不感知平台差异。
 */
import { bytesToBase64 } from '@/domain/projectPackage';
import type { ExportOptions } from '@/domain/types';

export interface ExportResult {
  canceled: boolean;
  filePath: string | null;
  /** native = 已写入磁盘；print = 已打开系统打印窗口；download = 触发浏览器下载 */
  method: 'native' | 'print' | 'download';
}

function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 浏览器 / PWA：打开独立打印窗口，用户选「另存为 PDF」即可 */
export function openPrintWindow(html: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') window.setTimeout(trigger, 120);
  else win.addEventListener('load', () => window.setTimeout(trigger, 120), { once: true });
  return true;
}

export async function writeExportPdf(html: string, fileName: string, options: ExportOptions): Promise<ExportResult> {
  const api = window.electronAPI;
  if (api?.pdfExport) {
    const result = await api.pdfExport({
      html,
      defaultName: fileName,
      pageSize: options.pageSize,
      landscape: options.orientation === 'landscape',
      footer: `${options.footer} · ${fileName.replace(/\.pdf$/i, '')}`,
    });
    return { canceled: Boolean(result.canceled), filePath: result.filePath ?? null, method: 'native' };
  }
  if (openPrintWindow(html)) return { canceled: false, filePath: null, method: 'print' };
  // 弹窗被拦截时保留可打印的 HTML，不让用户白填一遍
  downloadBytes(new TextEncoder().encode(html), fileName.replace(/\.pdf$/i, '') + '.html', 'text/html;charset=utf-8');
  return { canceled: false, filePath: null, method: 'download' };
}

export async function writeExportXlsx(bytes: Uint8Array, fileName: string): Promise<ExportResult> {
  const api = window.electronAPI;
  if (api?.documentExport) {
    const result = await api.documentExport({
      base64: bytesToBase64(bytes),
      defaultName: fileName,
      extension: 'xlsx',
      label: 'Excel 工作簿',
    });
    return { canceled: Boolean(result.canceled), filePath: result.filePath ?? null, method: 'native' };
  }
  downloadBytes(bytes, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return { canceled: false, filePath: null, method: 'download' };
}
