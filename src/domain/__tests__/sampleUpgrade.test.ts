import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  createSampleProject,
  createShot,
  deserializeProject,
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_TITLE,
  SAMPLE_REVISION,
  serializeProject,
} from '../project';
import {
  isSampleIncomplete,
  isSampleProject,
  needsSampleUpgrade,
  sampleRevisionOf,
  upgradedSample,
} from '../sampleUpgrade';
import { normalizeIndex } from '../library';
import type { Project } from '../types';

/** 模拟 2026-11-11 那版旧示例：有 10 个镜头但没有图片/备注/声音，还多了 11 个空行 */
function legacySample(): Project {
  const project = createSampleProject();
  delete project.sampleRevision;
  project.shots = project.shots.map((shot) => ({
    ...shot,
    frame: null,
    notes: '',
    sound: '',
    sceneExpectation: '',
  }));
  const missing = 21 - project.shots.length;
  for (let index = 0; index < missing; index += 1) {
    project.shots.push(createShot(project.shots.length + 1));
  }
  return project;
}

describe('示例项目版本升级', () => {
  it('最新示例已经是完整内容，不必升级', () => {
    const project = createSampleProject();
    expect(sampleRevisionOf(project)).toBe(SAMPLE_REVISION);
    expect(needsSampleUpgrade(project)).toBe(false);
    expect(isSampleIncomplete(project)).toBe(false);
  });

  it('旧版示例（无图无备注、多出空行）会被识别为待升级', () => {
    const project = legacySample();
    expect(project.shots).toHaveLength(21);
    expect(isSampleProject(project)).toBe(true);
    expect(needsSampleUpgrade(project)).toBe(true);
    expect(isSampleIncomplete(project)).toBe(true);
  });

  it('升级后保留 id / 名称 / 创建时间，内容换成最新的 10 镜全字段', () => {
    const legacy = legacySample();
    const stamp = '2026-11-12T08:00:00.000Z';
    const upgraded = upgradedSample(legacy, stamp);

    expect(upgraded.id).toBe(legacy.id);
    expect(upgraded.name).toBe(SAMPLE_PROJECT_NAME);
    expect(upgraded.createdAt).toBe(legacy.createdAt);
    expect(upgraded.updatedAt).toBe(stamp);
    expect(upgraded.sampleRevision).toBe(SAMPLE_REVISION);

    expect(upgraded.shots).toHaveLength(10);
    for (const shot of upgraded.shots) {
      expect(shot.frame?.path.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(shot.notes.length).toBeGreaterThan(0);
      expect(shot.sound.length).toBeGreaterThan(0);
      expect(shot.sceneExpectation.length).toBeGreaterThan(0);
      expect(shot.cameraAngle.length).toBeGreaterThan(0);
      expect(shot.focalLength.length).toBeGreaterThan(0);
    }
    expect(needsSampleUpgrade(upgraded)).toBe(false);
  });

  it('导入的示例项目包内容已完整，不会被再次覆盖', () => {
    const imported = createSampleProject();
    delete imported.sampleRevision;
    expect(isSampleProject(imported)).toBe(true);
    expect(isSampleIncomplete(imported)).toBe(false);
    expect(needsSampleUpgrade(imported)).toBe(false);
  });

  it('用户自建项目、示例副本不会被当成示例覆盖', () => {
    const own = createEmptyProject('我的咖啡片');
    own.title = SAMPLE_PROJECT_TITLE;
    expect(isSampleProject(own)).toBe(false);
    expect(needsSampleUpgrade(own)).toBe(false);

    const copy = createEmptyProject(`${SAMPLE_PROJECT_NAME} 副本`);
    copy.title = SAMPLE_PROJECT_TITLE;
    expect(isSampleProject(copy)).toBe(false);

    // 副本即使从示例复制而来，也不再带升级标记
    const duplicated: Project = { ...createSampleProject(), name: `${SAMPLE_PROJECT_NAME} 副本`, sampleRevision: undefined };
    expect(needsSampleUpgrade(duplicated)).toBe(false);
  });

  it('sampleRevision 能随项目文件往返', () => {
    const project = createSampleProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored.sampleRevision).toBe(SAMPLE_REVISION);
  });

  it('项目库索引保留 sampleRevision，供启动时判断', () => {
    const project = createSampleProject();
    const index = normalizeIndex({
      version: 1,
      currentId: project.id,
      projects: [{
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        shotCount: project.shots.length,
        dayCount: project.days.length,
        deletedAt: null,
        sampleRevision: SAMPLE_REVISION,
      }],
    });
    expect(index.projects[0]?.sampleRevision).toBe(SAMPLE_REVISION);
  });
});
