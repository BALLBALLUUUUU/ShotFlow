/**
 * 共享目录 IO 适配层。
 * 桌面端：Electron IPC 读写用户显式选择的网络共享盘目录。
 * 浏览器端：File System Access API（Chrome / Edge / Chromium 内核），句柄存 IndexedDB。
 * 两者对上层暴露同一组方法，UI 不感知平台。
 */
import { SHARE_INDEX_FILE, SAFE_PACKAGE_FILE } from '@/domain/sharedFolder';
import { base64ToBytes, bytesToBase64 } from '@/domain/projectPackage';

interface FileSystemHandleLike {
  name: string;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    getFile: () => Promise<File>;
    createWritable: () => Promise<{ write: (data: Blob | Uint8Array) => Promise<void>; close: () => Promise<void> }>;
  }>;
  queryPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemHandleLike>;
}

const DB_NAME = 'shotflow-share';
const HANDLE_KEY = 'directory';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地句柄存储'));
  });
}

async function saveHandle(handle: FileSystemHandleLike): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('句柄保存失败'));
  });
  db.close();
}

async function loadHandle(): Promise<FileSystemHandleLike | null> {
  const db = await openDb();
  const handle = await new Promise<FileSystemHandleLike | null>((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const request = tx.objectStore('handles').get(HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as FileSystemHandleLike) ?? null);
    request.onerror = () => reject(request.error ?? new Error('句柄读取失败'));
  });
  db.close();
  return handle;
}

async function ensurePermission(handle: FileSystemHandleLike): Promise<boolean> {
  const options = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

export interface ShareTarget {
  kind: 'electron' | 'web';
  label: string;
  dir?: string;
  handle?: FileSystemHandleLike;
  /** 浏览器端重新授权失败时需要用户重新选择目录 */
  needsPicker?: boolean;
}

export async function currentShareTarget(): Promise<ShareTarget | null> {
  const api = window.electronAPI;
  if (api?.shareReadIndex) {
    const label = window.localStorage.getItem('shotflow.shareDir');
    if (!label) return null;
    return { kind: 'electron', label, dir: label };
  }
  const handle = await loadHandle().catch(() => null);
  if (!handle) return null;
  if (!(await ensurePermission(handle))) return { kind: 'web', label: handle.name, handle, needsPicker: true };
  return { kind: 'web', label: handle.name, handle };
}

export async function chooseShareTarget(): Promise<ShareTarget | null> {
  const api = window.electronAPI;
  if (api?.shareChooseDir) {
    const result = await api.shareChooseDir();
    if (result.canceled || !result.dir) return null;
    window.localStorage.setItem('shotflow.shareDir', result.dir);
    return { kind: 'electron', label: result.dir, dir: result.dir };
  }
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持选择共享目录，请改用「导入 / 导出项目包」，或使用桌面版');
  const handle = await picker({ mode: 'readwrite' });
  await saveHandle(handle);
  return { kind: 'web', label: handle.name, handle };
}

export function clearShareTarget(): void {
  window.localStorage.removeItem('shotflow.shareDir');
  void (async () => {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  })();
}

async function assertReady(target: ShareTarget): Promise<void> {
  if (target.kind === 'electron' && !target.dir) throw new Error('共享目录未设置');
  if (target.kind === 'web') {
    if (!target.handle || target.needsPicker) throw new Error('共享目录授权已失效，请重新选择目录');
    if (!(await ensurePermission(target.handle))) throw new Error('没有共享目录的读写权限');
  }
}

export async function readSharedIndex(target: ShareTarget): Promise<string | null> {
  await assertReady(target);
  if (target.kind === 'electron') return window.electronAPI!.shareReadIndex(target.dir!);
  try {
    const file = await (await target.handle!.getFileHandle(SHARE_INDEX_FILE)).getFile();
    return await file.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function writeSharedIndex(target: ShareTarget, text: string): Promise<void> {
  await assertReady(target);
  if (target.kind === 'electron') {
    await window.electronAPI!.shareWriteIndex({ dir: target.dir!, text });
    return;
  }
  const writable = await (await target.handle!.getFileHandle(SHARE_INDEX_FILE, { create: true })).createWritable();
  await writable.write(new Blob([text], { type: 'application/json' }));
  await writable.close();
}

export async function readSharedPackage(target: ShareTarget, fileName: string): Promise<Uint8Array> {
  if (!SAFE_PACKAGE_FILE.test(fileName)) throw new Error('项目包文件名不合法');
  await assertReady(target);
  if (target.kind === 'electron') {
    const base64 = await window.electronAPI!.shareReadPackage({ dir: target.dir!, fileName });
    return base64ToBytes(base64);
  }
  const file = await (await target.handle!.getFileHandle(fileName)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function writeSharedPackage(target: ShareTarget, fileName: string, bytes: Uint8Array): Promise<void> {
  if (!SAFE_PACKAGE_FILE.test(fileName)) throw new Error('项目包文件名不合法');
  await assertReady(target);
  if (target.kind === 'electron') {
    await window.electronAPI!.shareWritePackage({ dir: target.dir!, fileName, base64: bytesToBase64(bytes) });
    return;
  }
  const writable = await (await target.handle!.getFileHandle(fileName, { create: true })).createWritable();
  await writable.write(new Blob([bytes.slice().buffer as ArrayBuffer]));
  await writable.close();
}
