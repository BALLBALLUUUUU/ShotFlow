/**
 * 最小 ZIP（store 模式，不压缩）读写，纯 TypeScript、零依赖。
 *
 * 为什么不用压缩：项目包里的 PNG/JPEG 本身已压缩，deflate 几乎不再省空间；
 * store 模式让实现可控、无原生依赖、Electron / 浏览器 / Node 单测行为一致。
 * 产生的 zip 可用系统 unzip、macOS 归档实用工具、Windows 资源管理器直接打开。
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 稳定的 DOS 时间：用固定值避免同一内容每次导出产生不同字节（便于内容校验） */
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

export interface ZipEntryOutput {
  name: string;
  data: Uint8Array;
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  u16(value: number): void {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    this.push(buf);
  }

  u32(value: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value >>> 0, true);
    this.push(buf);
  }

  raw(data: Uint8Array): void {
    this.push(data);
  }

  private push(data: Uint8Array): void {
    this.chunks.push(data);
    this.length += data.length;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function assertSafeName(name: string): void {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error(`ZIP 条目路径不合法：${name}`);
  }
}

/** 打包；同名条目会直接报错，避免静默覆盖 */
export function createZip(entries: ZipEntryInput[]): Uint8Array {
  const seen = new Set<string>();
  const w = new Writer();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (seen.has(entry.name)) throw new Error(`ZIP 条目重复：${entry.name}`);
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = w.length;

    w.u32(SIG_LOCAL);
    w.u16(20); // version needed
    w.u16(0x0800); // UTF-8 文件名
    w.u16(0); // store
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(crc);
    w.u32(entry.data.length);
    w.u32(entry.data.length);
    w.u16(name.length);
    w.u16(0);
    w.raw(name);
    w.raw(entry.data);

    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralStart = w.length;
  for (const item of central) {
    w.u32(SIG_CENTRAL);
    w.u16(20); // version made by
    w.u16(20); // version needed
    w.u16(0x0800);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(item.crc);
    w.u32(item.size);
    w.u32(item.size);
    w.u16(item.name.length);
    w.u16(0);
    w.u16(0); // comment
    w.u16(0); // disk number
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(item.offset);
    w.raw(item.name);
  }
  const centralSize = w.length - centralStart;

  w.u32(SIG_EOCD);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(centralSize);
  w.u32(centralStart);
  w.u16(0);

  return w.finish();
}

/** 解包；校验 CRC、拒绝路径穿越、限制条目数量与总大小 */
export function readZip(bytes: Uint8Array, limits: { maxEntries?: number; maxTotalBytes?: number } = {}): ZipEntryOutput[] {
  const maxEntries = limits.maxEntries ?? 20000;
  const maxTotalBytes = limits.maxTotalBytes ?? 256 * 1024 * 1024;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('项目包不是有效的 ZIP 文件');

  // 从尾部倒着找 EOCD（末尾可能有注释，最多 64KB）
  let eocd = -1;
  const lowerBound = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowerBound; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('项目包缺少 ZIP 结束标记，文件可能被截断');

  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  let ptr = view.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new Error(`项目包条目过多（${count}），已拒绝导入`);
  if (ptr + centralSize > bytes.length) throw new Error('项目包目录越界，文件已损坏');

  const result: ZipEntryOutput[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(ptr, true) !== SIG_CENTRAL) throw new Error('项目包目录损坏');
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const crc = view.getUint32(ptr + 16, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    assertSafeName(name);
    if (flags & 0x0001) throw new Error('项目包被加密，无法导入');
    if (method !== 0) throw new Error(`项目包使用了不支持的压缩方式（${method}）`);
    if (compressedSize !== size) throw new Error(`项目包条目 ${name} 长度异常`);

    total += size;
    if (total > maxTotalBytes) throw new Error('项目包解压后体积超过 256MB，已拒绝导入');

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`项目包条目 ${name} 数据头损坏`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + size > bytes.length) throw new Error(`项目包条目 ${name} 数据越界`);
    const data = bytes.slice(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error(`项目包条目 ${name} 校验失败，文件已损坏`);
    result.push({ name, data });
  }
  return result;
}

/** 供领域层读取文本文件条目 */
export function readTextEntry(entries: ZipEntryOutput[], name: string): string | null {
  const hit = entries.find((entry) => entry.name === name);
  return hit ? decoder.decode(hit.data) : null;
}
