/**
 * 示例项目的版本升级：只做判定与重建，不碰 IO，便于单测。
 * 项目库在启动时用它识别「旧版示例」并按最新内容重建。
 */
import { createSampleProject, SAMPLE_PROJECT_NAME, SAMPLE_PROJECT_TITLE, SAMPLE_REVISION } from './project';
import type { Project } from './types';

/** 旧文件没有版本号时按 0 处理 */
export function sampleRevisionOf(project: Project): number {
  return typeof project.sampleRevision === 'number' && Number.isFinite(project.sampleRevision)
    ? project.sampleRevision
    : 0;
}

/**
 * 是否内置示例项目。
 * 带版本号的记录直接认；没有版本号的老文件靠「固定项目名 + 示例片名」双重匹配，
 * 用户自建或复制出来的项目不会命中，避免误覆盖。
 */
export function isSampleProject(project: Project): boolean {
  if (project.sampleRevision !== undefined) return true;
  return project.name === SAMPLE_PROJECT_NAME && project.title === SAMPLE_PROJECT_TITLE;
}

export function needsSampleUpgrade(project: Project): boolean {
  if (!isSampleProject(project)) return false;
  if (sampleRevisionOf(project) >= SAMPLE_REVISION) return false;
  // 带版本号但落后：就是内建示例本体，直接换成最新内容
  if (project.sampleRevision !== undefined) return true;
  // 没有版本号的老文件（含导入的示例项目包）：只在内容残缺时升级，
  // 已经完整的示例不动，避免覆盖用户后来补过的内容
  return isSampleIncomplete(project);
}

/** 内容是否残缺：旧示例没图片、没备注/声音/场景预期，或镜头数不对 */
export function isSampleIncomplete(project: Project): boolean {
  return project.shots.length !== 10
    || project.shots.some((shot) => (
      !shot.frame || !shot.notes || !shot.sound || !shot.sceneExpectation
    ));
}

/**
 * 用最新示例内容替换旧示例，保留 id / 名称 / 创建时间，
 * 这样项目库里不会多出一条，当前打开的项目指针也不会失效。
 */
export function upgradedSample(previous: Project, timestamp = new Date().toISOString()): Project {
  const fresh = createSampleProject();
  return {
    ...fresh,
    id: previous.id,
    name: previous.name,
    createdAt: previous.createdAt,
    updatedAt: timestamp,
    // 用户给示例打的颜色标签属于他自己的整理，升级内容时保留
    tag: previous.tag,
    sampleRevision: SAMPLE_REVISION,
  };
}
