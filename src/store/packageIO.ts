/**
 * 项目包 IO 适配层。
 * 桌面端走 Electron IPC 读写真实文件；浏览器/PWA 走下载与文件选择。
 * 上层只拿到 Uint8Array，不感知平台差异。
 */
import { bytesToBase64, base64ToBytes, PACKAGE_EXTENSION } from '@/domain/projectPackage';
import type { Project } from '@/domain/types';

export interface ImportResult {
  bytes: Uint8Array;
  name: string;
  filePath: string | null;
}

async function webOpen(): Promise<ImportResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${PACKAGE_EXTENSION},.json`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, filePath: null });
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

function webDownload(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openProjectPackage(): Promise<ImportResult | null> {
  const api = window.electronAPI;
  if (api?.packageImport) {
    const result = await api.packageImport();
    if (result.canceled || !result.base64) return null;
    return { bytes: base64ToBytes(result.base64), name: result.name ?? '导入的项目', filePath: result.filePath ?? null };
  }
  return webOpen();
}

export async function exportProjectPackage(bytes: Uint8Array, fileName: string, _project?: Project): Promise<string | null> {
  const api = window.electronAPI;
  if (api?.packageExport) {
    const result = await api.packageExport({ base64: bytesToBase64(bytes), defaultName: fileName });
    return result.canceled ? null : (result.filePath ?? fileName);
  }
  webDownload(bytes, fileName);
  return fileName;
}
