import { describe, expect, it } from 'vitest';
import { createEmptyProject, createSampleProject, deserializeProject, serializeProject } from '@/domain/project';

/**
 * 同步靠内容哈希判断「有没有变」，所以序列化必须稳定：
 * 第一轮可能把旧文件规范化（补默认字段 / 统一键顺序），从第二轮起必须一模一样，
 * 否则每次同步都会认为内容变了，导致反复上传。
 */
describe('序列化稳定性', () => {
  it('规范化一轮之后不再变化', () => {
    const first = serializeProject(deserializeProject(serializeProject(createSampleProject())));
    const second = serializeProject(deserializeProject(first));
    expect(second).toBe(first);
  });

  it('空项目第一轮就稳定', () => {
    const once = serializeProject(createEmptyProject('空项目'));
    expect(serializeProject(deserializeProject(once))).toBe(once);
  });
});
