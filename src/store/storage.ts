/** 存储适配层：Electron 走 IPC 本地文件，浏览器/PWA 走下载与文件选择 */

export interface OpenResult {
  text: string;
  filePath: string | null;
}

export interface SaveResult {
  filePath: string | null;
}

function download(content: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + size)));
  }
  return btoa(chunks.join(''));
}

export async function openProjectFile(): Promise<OpenResult | null> {
  if (window.electronAPI) {
    const result = await window.electronAPI.openProject();
    if (result.canceled || !result.text) return null;
    return { text: result.text, filePath: result.filePath ?? null };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ text: await file.text(), filePath: null });
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export async function saveProjectFile(text: string, filePath: string | null, name: string): Promise<SaveResult | null> {
  if (window.electronAPI) {
    const result = await window.electronAPI.saveProject({ text, filePath });
    if (result.canceled) return null;
    return { filePath: result.filePath ?? filePath };
  }
  download(text, `${name || 'ShotFlow-项目'}.json`, 'application/json;charset=utf-8');
  return { filePath: null };
}

export async function exportProjectFile(text: string, defaultName: string): Promise<string | null> {
  if (window.electronAPI) {
    const result = await window.electronAPI.exportFile({ base64: toBase64(text), defaultName });
    return result.canceled ? null : (result.filePath ?? defaultName);
  }
  download(text, defaultName, 'application/json;charset=utf-8');
  return defaultName;
}
