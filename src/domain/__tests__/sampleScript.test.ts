import { describe, expect, it } from 'vitest';
import { createSampleProject, deserializeProject, serializeProject } from '../project';
import { buildExportDocument } from '../exportDocument';
import { defaultExportOptions, EXPORT_INFO_FIELDS } from '../exportInfo';
import { computeSchedule } from '../rundown';
import { buildProjectPackage, readProjectPackage } from '../projectPackage';
import type { Shot } from '../types';

/** 示例项目要能当真实拍摄脚本用：15 列里除图片位外不留空白，Rundown / 通告 / 片头信息同样完整 */
const shotTextFields: Array<keyof Pick<Shot,
  'shotSize' | 'content' | 'notes' | 'sceneExpectation' | 'sound' |
  'cameraAngle' | 'cameraMove' | 'cameraBody' | 'focalLength'>> = [
  'shotSize', 'content', 'notes', 'sceneExpectation', 'sound',
  'cameraAngle', 'cameraMove', 'cameraBody', 'focalLength',
];

describe('示例项目 = 可执行的拍摄脚本', () => {
  const project = createSampleProject();

  it('每个镜头除图片位外没有空字段', () => {
    expect(project.shots).toHaveLength(10);
    for (const shot of project.shots) {
      for (const field of shotTextFields) {
        const value = shot[field];
        expect(typeof value, `镜 ${shot.shotNo} 的 ${field} 类型`).toBe('string');
        expect(String(value).trim().length, `镜 ${shot.shotNo} 的 ${field} 不能为空`).toBeGreaterThan(1);
      }
      expect(shot.durationSec, `镜 ${shot.shotNo} 时长`).toBeGreaterThanOrEqual(4);
      expect(shot.durationSec, `镜 ${shot.shotNo} 时长`).toBeLessThanOrEqual(10);
    }
  });

  it('十个镜头都带暖色插画画面，且为内嵌 data URL', () => {
    expect(project.shots.map((shot) => shot.frame !== null)).toEqual(Array(10).fill(true));
    for (const shot of project.shots) {
      const path = shot.frame?.path ?? '';
      expect(path.startsWith('data:image/jpeg;base64,'), `镜 ${shot.shotNo} 画面格式`).toBe(true);
      expect(path.length, `镜 ${shot.shotNo} 画面不能是空图`).toBeGreaterThan(2000);
      expect(shot.frame?.kind).toBe('upload');
    }
    // 镜序映射固定，避免再出现「重画一张排到最后」的错位
    expect(project.shots.map((shot) => shot.frame?.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `img_sample_${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('备注 / 场景预期 / 声音写到可执行细节，不是占位词', () => {
    for (const shot of project.shots) {
      expect(shot.notes.length, `镜 ${shot.shotNo} 备注`).toBeGreaterThan(10);
      expect(shot.sceneExpectation.length, `镜 ${shot.shotNo} 场景预期`).toBeGreaterThan(8);
      expect(shot.sound.length, `镜 ${shot.shotNo} 声音`).toBeGreaterThan(8);
      for (const field of ['notes', 'sceneExpectation', 'sound'] as const) {
        expect(shot[field]).not.toContain('输入内容');
        expect(shot[field]).not.toBe('待补');
      }
    }
  });

  it('场号全部落在两个场次上，镜头数与场次描述一致', () => {
    const sceneIds = new Set(project.scenes.map((scene) => scene.id));
    for (const shot of project.shots) {
      expect(shot.sceneId).not.toBeNull();
      expect(sceneIds.has(shot.sceneId as string)).toBe(true);
    }
    const perScene = project.scenes.map((scene) => project.shots.filter((shot) => shot.sceneId === scene.id).length);
    expect(perScene).toEqual([6, 4]);
    for (const scene of project.scenes) {
      expect(scene.synopsis.length).toBeGreaterThan(6);
      expect(scene.location.trim().length).toBeGreaterThan(1);
    }
  });

  it('时长合计 58 秒，与片头信息里的片长对得上', () => {
    const total = project.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
    expect(total).toBe(58);
    expect(project.exportInfo.custom.find((field) => field.label === '片长')?.value).toContain('58 秒');
  });

  it('拍摄日关联全部镜头，且一个镜头只归属一个拍摄日', () => {
    expect(project.days).toHaveLength(1);
    const day = project.days[0]!;
    const shotIds = project.shots.map((shot) => shot.id);
    expect([...day.shotIds].sort()).toEqual([...shotIds].sort());
    expect(new Set(day.shotIds).size).toBe(day.shotIds.length);
    expect(day.crew.length).toBeGreaterThanOrEqual(3);
    expect(day.equipment.length).toBeGreaterThanOrEqual(4);
    expect(day.note.length).toBeGreaterThan(6);
  });

  it('Rundown 每个环节字段齐全，时间轴无冲突无超时', () => {
    for (const item of project.rundown) {
      expect(item.title.trim().length, '环节名称').toBeGreaterThan(1);
      expect(item.owner.trim().length, `${item.title} 负责人`).toBeGreaterThan(1);
      expect(item.camera.trim().length, `${item.title} 机位`).toBeGreaterThan(0);
      expect(item.content.trim().length, `${item.title} 内容`).toBeGreaterThan(4);
      expect(item.note.trim().length, `${item.title} 备注`).toBeGreaterThan(4);
      expect(item.durationMin).toBeGreaterThan(0);
    }
    const shootItems = project.rundown.filter((item) => item.kind === 'shoot');
    expect(shootItems.length).toBeGreaterThanOrEqual(10);
    const linked = shootItems.flatMap((item) => item.shotIds);
    expect(new Set(linked).size).toBe(10);

    const slots = computeSchedule(project.rundown, project.days[0]!.startTime, project.days[0]!.endTime);
    expect(slots.length).toBe(project.rundown.length);
    expect(slots.filter((slot) => slot.conflict)).toHaveLength(0);
    expect(slots.filter((slot) => slot.overrun)).toHaveLength(0);
  });

  it('拍摄通告已填写，可发给组员', () => {
    expect(project.notices).toHaveLength(1);
    const notice = project.notices[0]!;
    expect(notice.status).toBe('pending');
    expect(notice.dayId).toBe(project.days[0]!.id);
    expect(notice.title.length).toBeGreaterThan(6);
    for (const field of ['crew', 'groups', 'actors', 'schedule', 'note'] as const) {
      expect(notice[field].trim().length, `通告 ${field}`).toBeGreaterThan(6);
    }
    expect(notice.publishedAt).not.toBeNull();
  });

  it('导出片头固定字段与自定义字段全部有值', () => {
    for (const field of EXPORT_INFO_FIELDS) {
      expect(project.exportInfo[field.key].trim().length, `片头 ${field.label}`).toBeGreaterThan(0);
    }
    expect(project.exportInfo.custom.length).toBeGreaterThanOrEqual(5);
    for (const field of project.exportInfo.custom) {
      expect(field.label.trim().length, '自定义字段名').toBeGreaterThan(0);
      expect(field.value.trim().length, `自定义字段 ${field.label}`).toBeGreaterThan(0);
    }
  });

  it('序列化往返后脚本内容不丢', () => {
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it('项目包把 10 张画面抽成独立资源，导入后还原成 data URL', () => {
    const pkg = buildProjectPackage(project, '球球');
    expect(pkg.manifest.assetCount).toBe(10);
    const parsed = readProjectPackage(pkg.bytes);
    expect(parsed.project.shots).toHaveLength(10);
    for (const shot of parsed.project.shots) {
      expect(shot.frame?.path.startsWith('data:image/jpeg;base64,')).toBe(true);
    }
  });

  it('导出的分镜文档没有空白单元格（图片列除外）', () => {
    const doc = buildExportDocument(project, defaultExportOptions());
    expect(doc.infoRows.every((row) => row.value.trim().length > 0)).toBe(true);
    expect(doc.shotTable.rows).toHaveLength(10);
    doc.shotTable.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const column = doc.shotTable.columns[columnIndex]!;
        if (column.kind === 'image') return;
        const text = typeof cell === 'object' && cell !== null ? '' : String(cell).trim();
        expect(text.length, `第 ${rowIndex + 1} 行 / ${column.label} 为空`).toBeGreaterThan(0);
      });
    });
    expect(doc.rundownTable).not.toBeNull();
    expect(doc.rundownTable!.rows.length).toBe(project.rundown.length);
    expect(doc.totalDurationSec).toBe(58);
  });
});
