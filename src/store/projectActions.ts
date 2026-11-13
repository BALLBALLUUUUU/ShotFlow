/**
 * 项目级动作：导出项目包、导入项目包、发布到共享目录、从共享目录取回。
 * 全部基于统一项目包格式，任何覆盖操作都必须由调用方显式传 force。
 */
import {
  buildProjectPackage,
  portableHash,
  readAnyProjectFile,
  safeFileName,
  type PackageManifest,
} from '@/domain/projectPackage';
import { serializeProject } from '@/domain/project';
import { metaFromProject, upsertMeta } from '@/domain/library';
import {
  canPublish,
  compareVersions,
  normalizeSharedIndex,
  sharedFileName,
  upsertSharedEntry,
  type SharedEntry,
  type SharedIndex,
  type VersionRelation,
} from '@/domain/sharedFolder';
import type { Project } from '@/domain/types';
import { loadLibrary as loadIndex, saveIndex, writeProjectFile } from './projectLibrary';
import * as shareIO from './shareIO';
import { exportProjectPackage } from './packageIO';

export interface ImportDecision {
  /** 'replace' 覆盖本地同 id 项目；'copy' 生成新 id 另存副本 */
  mode: 'replace' | 'copy';
}

/** 导出为 .shotflow 项目包（含独立图片资源） */
export async function exportPackage(project: Project, author: string): Promise<{ fileName: string; assetCount: number }> {
  const { bytes, manifest, fileName } = buildProjectPackage(project, author);
  const saved = await exportProjectPackage(bytes, fileName, project);
  if (!saved) throw new Error('已取消导出');
  return { fileName, assetCount: manifest.assetCount };
}

/**
 * 导入项目包或旧版 JSON。同 id 项目已存在时，由调用方给出决定；
 * 这里绝不静默覆盖。
 */
export async function importPackage(
  bytes: Uint8Array,
  decision: ImportDecision | null,
): Promise<{ project: Project; manifest: PackageManifest | null; fileName: string }> {
  const parsed = readAnyProjectFile(bytes);
  const existing = await loadIndex();
  const sameId = existing.projects.find((meta) => meta.id === parsed.project.id) ?? null;

  let project = parsed.project;
  if (sameId && decision?.mode === 'copy') {
    project = { ...project, id: `${project.id}_import_${Date.now().toString(36)}`, name: `${project.name}（导入副本）` };
  }
  if (sameId && !decision) {
    throw new Error('本地已存在同 ID 项目，需要先确认覆盖或另存副本');
  }

  await writeProjectFile(project.id, serializeProject(project));
  const previous = existing.projects.find((meta) => meta.id === project.id) ?? null;
  await saveIndex(upsertMeta(existing, metaFromProject(project, previous)));
  return { project, manifest: parsed.manifest, fileName: safeFileName(project.name) };
}

export interface ShareState {
  index: SharedIndex;
  target: shareIO.ShareTarget;
}

export async function loadShareState(target: shareIO.ShareTarget): Promise<ShareState> {
  const text = await shareIO.readSharedIndex(target);
  let raw: unknown = null;
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('共享目录里的 shotflow-index.json 已损坏，请让同事重新发布一次');
    }
  }
  return { index: normalizeSharedIndex(raw), target };
}

function localVersion(project: Project) {
  return { updatedAt: project.updatedAt, contentHash: portableHash(project) };
}

/** 返回发布前的版本关系；UI 据此决定是否要弹确认 */
export function publishRelation(project: Project, index: SharedIndex): VersionRelation {
  const remote = index.projects.find((entry) => entry.projectId === project.id) ?? null;
  return compareVersions(localVersion(project), remote);
}

export async function publishToShare(
  project: Project,
  state: ShareState,
  author: string,
  force = false,
): Promise<SharedIndex> {
  const relation = publishRelation(project, state.index);
  if (!canPublish(relation) && !force) {
    throw new Error('共享目录里有更新的版本（可能是同事刚改过），请先取回或明确选择覆盖');
  }
  const { bytes, manifest } = buildProjectPackage(project, author);
  const fileName = sharedFileName(project.id);
  await shareIO.writeSharedPackage(state.target, fileName, bytes);

  const entry: SharedEntry = {
    projectId: project.id,
    name: project.name,
    fileName,
    updatedAt: project.updatedAt,
    exportedAt: manifest.exportedAt,
    author,
    contentHash: manifest.contentHash,
    shotCount: manifest.shotCount,
    dayCount: manifest.dayCount,
  };
  // 重新读一次索引，尽量减少两人同时发布时互相抹掉条目
  const fresh = await loadShareState(state.target);
  const next = upsertSharedEntry(fresh.index, entry);
  await shareIO.writeSharedIndex(state.target, JSON.stringify(next, null, 2));
  return next;
}

/** 从共享目录取回一份项目包并导入；同样要求显式决定冲突 */
export async function fetchFromShare(
  entry: SharedEntry,
  state: ShareState,
  decision: ImportDecision | null,
): Promise<Project> {
  const bytes = await shareIO.readSharedPackage(state.target, entry.fileName);
  const result = await importPackage(bytes, decision);
  return result.project;
}

/** 导入前先看版本关系，供 UI 显示「谁更新、谁改的」 */
export function remoteRelation(
  local: Project | null,
  entry: SharedEntry,
): VersionRelation {
  if (!local) return 'new';
  return compareVersions(localVersion(local), { updatedAt: entry.updatedAt, contentHash: entry.contentHash });
}

export function authorKey(): string {
  return window.localStorage.getItem('shotflow.author') ?? '';
}

export function setAuthor(name: string): void {
  window.localStorage.setItem('shotflow.author', name.trim().slice(0, 40));
}

/** 与项目包 manifest 同口径的内容指纹，用于导入前判断两份是否真的一样 */
export function portableFingerprint(project: Project): string {
  return portableHash(project);
}
