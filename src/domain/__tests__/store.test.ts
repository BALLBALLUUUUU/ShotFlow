import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../store/useProjectStore';
import { createEmptyProject, serializeProject, deserializeProject } from '../project';

function reset(): void {
  useProjectStore.setState({
    project: createEmptyProject('测试项目'),
    filePath: null,
    dirty: false,
    toast: null,
    past: [],
    future: [],
    lastCommitKey: null,
    lastCommitAt: 0,
  });
}

describe('Zustand 编辑 actions', () => {
  beforeEach(reset);

  it('批量加行无上限并标记 dirty', () => {
    const store = useProjectStore.getState();
    store.addShots(5000);
    expect(useProjectStore.getState().project.shots).toHaveLength(5000);
    expect(useProjectStore.getState().dirty).toBe(true);
    useProjectStore.getState().addShots(5000);
    expect(useProjectStore.getState().project.shots).toHaveLength(10000);
  });

  it('批量加列无上限并与单元格写入联动', () => {
    for (let i = 0; i < 200; i += 1) {
      useProjectStore.getState().addColumn(`列 ${i + 1}`, 'text');
    }
    const state = useProjectStore.getState();
    expect(state.project.columnSchema.columns).toHaveLength(215);
    expect(state.project.columnSchema.preset).toBe('custom');
    const customId = state.project.columnSchema.columns.at(-1)?.id ?? '';
    state.addShots(1);
    const shotId = useProjectStore.getState().project.shots[0]?.id ?? '';
    useProjectStore.getState().updateCell(shotId, customId, '写入自定义列');
    expect(useProjectStore.getState().project.shots[0]?.custom[customId]).toBe('写入自定义列');
  });

  it('重名列被拒绝且不破坏现有 schema', () => {
    const store = useProjectStore.getState();
    store.addColumn('道具', 'text');
    const before = useProjectStore.getState().project.columnSchema.columns.length;
    useProjectStore.getState().addColumn('道具', 'text');
    expect(useProjectStore.getState().project.columnSchema.columns).toHaveLength(before);
    expect(useProjectStore.getState().toast).toContain('已存在');
  });

  it('插入、移动、删除、重编号后顺序保持连续', () => {
    const store = useProjectStore.getState();
    store.addShots(10);
    useProjectStore.getState().insertShotAfter(4);
    expect(useProjectStore.getState().project.shots).toHaveLength(11);
    useProjectStore.getState().moveShot(0, 10);
    useProjectStore.getState().deleteShots([
      useProjectStore.getState().project.shots[0]!.id,
    ]);
    useProjectStore.getState().renumberShots();
    const shots = useProjectStore.getState().project.shots;
    expect(shots.map((shot) => shot.sortIndex)).toEqual(shots.map((_, i) => i));
    expect(shots.map((shot) => shot.shotNo)).toEqual(shots.map((_, i) => i + 1));
  });

  it('简洁预设只隐藏内置列，自定义列保持可见', () => {
    const store = useProjectStore.getState();
    store.addColumn('道具', 'text');
    useProjectStore.getState().setPresetById('simple');
    const columns = useProjectStore.getState().project.columnSchema.columns;
    expect(columns.filter((column) => column.builtin && column.visible)).toHaveLength(7);
    expect(columns.at(-1)?.visible).toBe(true);
  });

  it('10000 行项目序列化后往返一致', () => {
    useProjectStore.getState().addShots(10000);
    const text = serializeProject(useProjectStore.getState().project);
    const restored = deserializeProject(text);
    expect(restored.shots).toHaveLength(10000);
    expect(restored).toEqual(useProjectStore.getState().project);
  });
});
