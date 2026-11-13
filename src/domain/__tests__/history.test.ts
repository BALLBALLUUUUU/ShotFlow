import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '@/store/useProjectStore';
import { createEmptyProject } from '@/domain/project';

function reset(): void {
  useProjectStore.setState({
    project: createEmptyProject('测试项目'),
    currentProjectId: 'proj_test',
    filePath: null,
    dirty: false,
    toast: null,
    past: [],
    future: [],
    lastCommitKey: null,
    lastCommitAt: 0,
  });
}

/** 加一条镜头并返回它的 id，作为后续编辑的对象 */
function seedShot(): string {
  useProjectStore.getState().addShots(1);
  const shots = useProjectStore.getState().project.shots;
  return shots[shots.length - 1]!.id;
}

describe('撤销 / 重做', () => {
  beforeEach(reset);

  it('撤销回到上一步，重做再回来', () => {
    useProjectStore.getState().addShots(3);
    expect(useProjectStore.getState().project.shots).toHaveLength(3);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.shots).toHaveLength(0);
    expect(useProjectStore.getState().dirty).toBe(true);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.shots).toHaveLength(3);
  });

  it('撤销一层后再撤销，能连续回退', () => {
    useProjectStore.getState().addShots(1);
    const id = useProjectStore.getState().project.shots[0]!.id;
    useProjectStore.getState().updateCell(id, 'content', '镜头 A');
    useProjectStore.getState().moveShot(0, 0);

    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.shots[0]?.content ?? '').toBe('');
  });

  it('新的编辑会清空重做栈', () => {
    useProjectStore.getState().addShots(2);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().future).toHaveLength(1);

    useProjectStore.getState().addShots(1);
    expect(useProjectStore.getState().future).toHaveLength(0);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.shots).toHaveLength(1);
  });

  it('同一单元格连续输入合并成一步撤销', () => {
    const id = seedShot();
    const before = useProjectStore.getState().past.length;
    const initial = useProjectStore.getState().project.shots[0]!.content;

    useProjectStore.getState().updateCell(id, 'content', '咖');
    useProjectStore.getState().updateCell(id, 'content', '咖啡');
    useProjectStore.getState().updateCell(id, 'content', '咖啡馆');

    expect(useProjectStore.getState().past.length).toBe(before + 1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.shots[0]!.content).toBe(initial);
  });

  it('不同单元格各自占一步', () => {
    const id = seedShot();
    const before = useProjectStore.getState().past.length;
    const initialNote = useProjectStore.getState().project.shots[0]!.notes;

    useProjectStore.getState().updateCell(id, 'content', '镜头 A');
    useProjectStore.getState().updateCell(id, 'notes', '备注 B');
    expect(useProjectStore.getState().past.length).toBe(before + 2);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.shots[0]!.notes).toBe(initialNote);
    expect(useProjectStore.getState().project.shots[0]!.content).toBe('镜头 A');
  });

  it('打开另一个项目会清空历史，不会撤到上一个项目', () => {
    useProjectStore.getState().addShots(2);
    useProjectStore.getState().setProject(createEmptyProject('另一个项目'));
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useProjectStore.getState().future).toHaveLength(0);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.name).toBe('另一个项目');
  });

  it('没有可撤销的内容时给出提示而不是崩溃', () => {
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().toast).toBe('没有可撤销的操作');
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().toast).toBe('没有可重做的操作');
  });

  it('撤销栈有上限，不会无限增长', () => {
    for (let i = 0; i < 80; i += 1) {
      useProjectStore.getState().addShots(1);
    }
    expect(useProjectStore.getState().past.length).toBeLessThanOrEqual(60);
  });
});
