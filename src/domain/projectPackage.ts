/**
 * 统一项目包（.shotflow）：本地库 / 同事互传 / 共享文件夹 / 未来云端共用同一种交换格式。
 *
 * 包结构（ZIP，store 模式）：
 *   manifest.json  —— 版本、项目标识、更新时间、作者、内容指纹（用于冲突检测）
 *   project.json   —— 完整项目 JSON，图片字段写成 assets/xxx 相对引用
 *   assets/xxx.jpg —— 二进制图片，不再内嵌 base64
 *
 * 兼容性：仍可直接导入旧版纯 JSON 项目文件（图片为 data URL 内嵌）。
 */
import { ProjectParseError, deserializeProject, serializeProject } from './project';
import type { ImageAsset, Project } from './types';
import { createZip, readTextEntry, readZip } from './zip';

export const PACKAGE_FORMAT = 'shotflow-package';
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = 'shotflow';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  exportedAt: string;
  /** 导出者署名，本地设置；不联网也能知道这份是谁改的 */
  author: string;
  assetCount: number;
  shotCount: number;
  dayCount: number;
  /** FNV-1a 内容指纹，仅用于变更检测，不作安全用途 */
  contentHash: string;
}

export interface ParsedPackage {
  project: Project;
  manifest: PackageManifest | null;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i += 1) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const n = (a << 16) | (b << 8) | c;
    const at = (index: number) => B64_ALPHABET[index] ?? 'A';
    out += at((n >>> 18) & 63) + at((n >>> 12) & 63);
    out += i + 1 < bytes.length ? at((n >>> 6) & 63) : '=';
    out += i + 2 < bytes.length ? at(n & 63) : '=';
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s/g, '');
  const length = clean.endsWith('==') ? clean.length - 2 : clean.endsWith('=') ? clean.length - 1 : clean.length;
  if (length <= 0) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let cursor = 0;
  for (let i = 0; i < length; i += 1) {
    const value = B64_LOOKUP[clean.charCodeAt(i)] ?? -1;
    if (value < 0) throw new Error('图片数据不是合法的 base64');
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[cursor] = (acc >>> bits) & 0xff;
      cursor += 1;
    }
  }
  return out.subarray(0, cursor);
}

const DATA_URL = /^data:([a-zA-Z0-9.+/-]+);base64,(.*)$/s;

function extensionForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  return 'jpg';
}

function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const match = DATA_URL.exec(url);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  try {
    return { bytes: base64ToBytes(match[2]), mime: match[1] };
  } catch {
    return null;
  }
}

/** FNV-1a 32 位，稳定且无依赖；仅用于判断「内容是否变过」 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  const bytes = encoder.encode(text);
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 80) || '未命名项目';
}

interface AssetFile {
  name: string;
  data: Uint8Array;
}

/**
 * 生成「可移植正文」：把 data URL 图片替换为 assets/ 相对引用，并返回抽出的二进制。
 * 抽成独立函数，便于只算内容指纹时不必真的组装 ZIP。
 */
export function portableProject(project: Project): { text: string; assets: AssetFile[] } {
  const assets: AssetFile[] = [];
  const used = new Set<string>();

  const rewrite = (asset: ImageAsset | null): ImageAsset | null => {
    if (!asset) return asset;
    if (!asset.path.startsWith('data:')) return asset; // 已是相对引用或外部地址，保持原样
    const decoded = decodeDataUrl(asset.path);
    if (!decoded) return asset;
    let fileName = `assets/${asset.id.replace(/[^A-Za-z0-9_-]/g, '_')}.${extensionForMime(decoded.mime)}`;
    let suffix = 1;
    while (used.has(fileName)) {
      fileName = `assets/${asset.id.replace(/[^A-Za-z0-9_-]/g, '_')}_${suffix}.${extensionForMime(decoded.mime)}`;
      suffix += 1;
    }
    used.add(fileName);
    assets.push({ name: fileName, data: decoded.bytes });
    return { ...asset, path: fileName };
  };

  const portable: Project = {
    ...project,
    shots: project.shots.map((shot) => ({
      ...shot,
      frame: rewrite(shot.frame),
      reference: rewrite(shot.reference),
    })),
  };
  return { text: serializeProject(portable), assets };
}

/** 内容指纹：基于可移植正文，导出与共享目录版本检测使用同一口径 */
export function portableHash(project: Project): string {
  return contentHash(portableProject(project).text);
}

/** 把一个项目打包；图片从 data URL 抽到独立二进制，项目 JSON 里只留相对引用 */
export function buildProjectPackage(project: Project, author = ''): { bytes: Uint8Array; manifest: PackageManifest; fileName: string } {
  const { text: projectText, assets } = portableProject(project);
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    projectId: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    exportedAt: new Date().toISOString(),
    author,
    assetCount: assets.length,
    shotCount: project.shots.length,
    dayCount: project.days.length,
    contentHash: contentHash(projectText),
  };

  const entries = [
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'project.json', data: encoder.encode(projectText) },
    ...assets,
  ];
  return {
    bytes: createZip(entries),
    manifest,
    fileName: `${safeFileName(project.name)}.${PACKAGE_EXTENSION}`,
  };
}

/** 把包内 assets/xxx 引用还原成 data URL，导入后现有 UI 与本地库无需改动 */
export function readProjectPackage(bytes: Uint8Array): ParsedPackage {
  const entries = readZip(bytes);
  const manifestText = readTextEntry(entries, 'manifest.json');
  const projectText = readTextEntry(entries, 'project.json');
  if (!projectText) throw new ProjectParseError('项目包缺少 project.json');

  let manifest: PackageManifest | null = null;
  if (manifestText) {
    try {
      const raw: unknown = JSON.parse(manifestText);
      if (raw && typeof raw === 'object' && (raw as { format?: unknown }).format === PACKAGE_FORMAT) {
        manifest = raw as PackageManifest;
      }
    } catch {
      // manifest 损坏不阻断导入，按无元数据处理
    }
  }
  if (manifest && manifest.formatVersion > PACKAGE_VERSION) {
    throw new ProjectParseError(`项目包版本 v${manifest.formatVersion} 高于当前程序支持的 v${PACKAGE_VERSION}，请升级软件`);
  }

  const assetMap = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.name.startsWith('assets/')) assetMap.set(entry.name, entry.data);
  }

  const rawProject: unknown = JSON.parse(projectText);
  if (!rawProject || typeof rawProject !== 'object') throw new ProjectParseError('project.json 格式不正确');
  const record = rawProject as { shots?: unknown };
  if (Array.isArray(record.shots)) {
    for (const shot of record.shots) {
      if (!shot || typeof shot !== 'object') continue;
      const fields = shot as { frame?: ImageAsset | null; reference?: ImageAsset | null };
      for (const key of ['frame', 'reference'] as const) {
        const asset = fields[key];
        if (!asset || typeof asset.path !== 'string' || !asset.path.startsWith('assets/')) continue;
        const data = assetMap.get(asset.path);
        if (!data) throw new ProjectParseError(`项目包缺少图片资源：${asset.path}`);
        const mime = asset.path.endsWith('.png') ? 'image/png'
          : asset.path.endsWith('.webp') ? 'image/webp'
            : asset.path.endsWith('.gif') ? 'image/gif'
              : asset.path.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
        fields[key] = { ...asset, path: `data:${mime};base64,${bytesToBase64(data)}` };
      }
    }
  }
  const project = deserializeProject(JSON.stringify(rawProject));
  return { project, manifest };
}

export type ImportSource = 'package' | 'legacy-json' | 'unknown';

export function detectImportSource(bytes: Uint8Array): ImportSource {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return 'package';
  }
  const text = decoder.decode(bytes).trimStart();
  if (text.startsWith('{')) return 'legacy-json';
  return 'unknown';
}

/** 统一导入入口：项目包或旧版 JSON 都能读 */
export function readAnyProjectFile(bytes: Uint8Array): ParsedPackage {
  const source = detectImportSource(bytes);
  if (source === 'package') return readProjectPackage(bytes);
  if (source === 'legacy-json') return { project: deserializeProject(decoder.decode(bytes)), manifest: null };
  throw new ProjectParseError('无法识别的文件：请选择 .shotflow 项目包或 .json 项目文件');
}

export type ImportConflict = 'new' | 'identical' | 'local-newer' | 'incoming-newer' | 'same-time-different';

/** 导入前判定冲突，供 UI 明确提示，绝不静默覆盖 */
export function detectImportConflict(
  local: Project | null,
  incoming: Project,
  incomingHash: string | null,
): ImportConflict {
  if (!local) return 'new';
  const localHash = contentHash(serializeProject(local));
  if (incomingHash !== null && incomingHash === localHash) return 'identical';
  if (incomingHash === null && serializeProject(incoming) === serializeProject(local)) return 'identical';
  const localTime = new Date(local.updatedAt).getTime();
  const incomingTime = new Date(incoming.updatedAt).getTime();
  if (Number.isNaN(localTime) || Number.isNaN(incomingTime) || localTime === incomingTime) return 'same-time-different';
  return incomingTime > localTime ? 'incoming-newer' : 'local-newer';
}
