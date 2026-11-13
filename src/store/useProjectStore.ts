import { create } from 'zustand';
import { createEmptyProject, createSampleProject, deserializeProject } from '@/domain/project';
import {
  addCustomColumn,
  moveColumn,
  removeColumn,
  renameColumn,
  setPreset as applyPreset,
  toggleColumn,
  setColumnWidth,
} from '@/domain/schema';
import {
  appendShots,
  deleteShots,
  insertShotAfter,
  moveShot,
  renumberShots as renumberShotList,
  updateShotField,
} from '@/domain/shots';
import type { CellValue } from '@/domain/shots';
import {
  addDay as appendDay,
  assignShots as assignShotsToDays,
  createShootingDay,
  pruneRemovedShots,
  removeDay as dropDay,
  reorderDayShots as reorderShotsInDay,
  unassignShots as unassignShotsInDay,
  updateDay as patchDay,
} from '@/domain/days';
import {
  addRundownItem as appendRundownItem,
  buildRundownForDay,
  computeSchedule,
  createRundownItem,
  insertRundownItemAt,
  itemsForDay,
  moveRundownItem as shiftRundownItem,
  removeRundownItem as dropRundownItem,
  renameRundownGroup as renameGroup,
  reorderRundownItem as dragRundownItem,
  updateRundownItem as patchRundownItem,
} from '@/domain/rundown';
import {
  completeNotice,
  createNoticeFromDay,
  expireNotice,
  publishNotice,
  removeNotice as dropNotice,
  updateNotice as patchNotice,
} from '@/domain/notices';
import { createPerson, personLabel, stripPerson, tokenBelongsTo } from '@/domain/people';
import type {
  ExportCustomField,
  ExportInfo,
  FieldKind,
  Notice,
  NoticeStatus,
  Person,
  PresetId,
  Project,
  RundownItem,
  ShootingDay,
} from '@/domain/types';

interface ProjectState {
  project: Project;
  /** 当前打开的项目库记录；为 null 表示停留在项目库、没有打开任何项目 */
  currentProjectId: string | null;
  filePath: string | null;
  dirty: boolean;
  toast: string | null;
  /** 撤销栈：存的是不可变快照引用，未改动的部分共享，不会整份复制 */
  past: Project[];
  future: Project[];
  /** 最近一次提交的合并键与时间：连续打字合并成一步撤销 */
  lastCommitKey: string | null;
  lastCommitAt: number;

  undo: () => void;
  redo: () => void;
  setProject: (project: Project) => void;
  clearCurrentProject: () => void;
  loadFromText: (text: string, filePath?: string | null) => void;
  loadSample: () => void;
  newProject: () => void;
  markSaved: (filePath: string | null) => void;
  /** 自动保存到项目库成功后清除「未保存」标记，不弹提示 */
  clearDirty: () => void;
  setToast: (message: string | null) => void;

  addShots: (count: number, sceneId?: string | null) => void;
  insertShotAfter: (index: number, sceneId?: string | null) => void;
  deleteShots: (ids: string[]) => void;
  moveShot: (from: number, to: number) => void;
  renumberShots: () => void;
  updateCell: (shotId: string, key: string, value: CellValue) => void;

  addColumn: (label: string, kind: FieldKind) => void;
  removeColumnById: (id: string) => void;
  renameColumnById: (id: string, label: string) => void;
  toggleColumnById: (id: string) => void;
  moveColumnById: (id: string, delta: number) => void;
  setColumnWidthById: (id: string, width: number) => void;
  setPresetById: (preset: PresetId) => void;

  /** 导出分镜：项目名称与片头信息，编辑后随项目自动保存、随项目包互通 */
  renameProject: (name: string) => void;
  updateExportInfo: (patch: Partial<Omit<ExportInfo, 'custom'>>) => void;
  setExportCustomFields: (fields: ExportCustomField[]) => void;

  /* M2 故事板 */
  setStoryboardColumns: (columns: number) => void;
  toggleStoryboardField: (key: string) => void;

  /* M3 拍摄计划 */
  createDay: (patch?: Partial<ShootingDay>) => string;
  updateDayById: (id: string, patch: Partial<ShootingDay>) => void;
  deleteDayById: (id: string) => void;
  assignShotsToDay: (dayId: string, shotIds: string[]) => void;
  unassignShotsFromDay: (dayId: string, shotIds: string[]) => void;
  reorderDayShot: (dayId: string, from: number, to: number) => void;

  /* 人员库（拍摄计划、通告共用） */
  addPerson: (patch?: Partial<Omit<Person, 'id'>>) => string;
  updatePersonById: (id: string, patch: Partial<Omit<Person, 'id'>>) => void;
  /** 删除人员并从所有拍摄日名单中移除 */
  deletePersonById: (id: string) => void;

  /* M4 Rundown 与通告 */
  setRundownView: (view: 'rundown' | 'notice') => void;
  /** 新增环节，返回新条目 id；indexInDay 省略时追加到当天末尾，否则插到该位置 */
  addRundown: (
    dayId: string,
    patch?: Partial<Omit<RundownItem, 'id' | 'dayId' | 'order'>>,
    indexInDay?: number,
  ) => string;
  updateRundown: (id: string, patch: Partial<Omit<RundownItem, 'id'>>) => void;
  deleteRundown: (id: string) => void;
  moveRundown: (id: string, delta: number) => void;
  dragRundown: (id: string, toIndex: number) => void;
  /** 整组改名（from 传空字符串即把「未分组」并成一组） */
  renameRundownGroup: (dayId: string, from: string, to: string) => void;
  generateRundown: (dayId: string) => void;
  createNotice: (dayId: string) => string | null;
  updateNoticeById: (id: string, patch: Partial<Omit<Notice, 'id'>>) => void;
  deleteNoticeById: (id: string) => void;
  setNoticeStatus: (id: string, status: NoticeStatus) => void;
}

const HISTORY_LIMIT = 60;
/** 同一处连续编辑在这个窗口内合并为一步撤销 */
const COALESCE_MS = 1500;

/**
 * 提交一次项目修改：写入新状态，同时把修改前的快照压入撤销栈。
 *
 * coalesce 相同（同一单元格 / 同一条 Rundown）的连续修改会合并成一步，
 * 否则每敲一个字都会占一格撤销，按 ⌘Z 只能退一个字符。
 */
function committed(
  state: ProjectState,
  project: Project,
  options: { coalesce?: string } = {},
): Partial<ProjectState> {
  const now = Date.now();
  const key = options.coalesce ?? null;
  const merge = key !== null && key === state.lastCommitKey && now - state.lastCommitAt < COALESCE_MS;
  return {
    project: { ...project, updatedAt: new Date().toISOString() },
    dirty: true,
    past: merge ? state.past : [...state.past, state.project].slice(-HISTORY_LIMIT),
    future: [],
    lastCommitKey: key,
    lastCommitAt: now,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

export const useProjectStore = create<ProjectState>((set) => ({
  // 启动时不灌入示例项目；真正的项目由项目库载入或新建
  project: createEmptyProject(),
  currentProjectId: null,
  filePath: null,
  dirty: false,
  toast: null,
  past: [],
  future: [],
  lastCommitKey: null,
  lastCommitAt: 0,

  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return { toast: '没有可撤销的操作' };
    return {
      project: previous,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
      dirty: true,
      lastCommitKey: null,
      lastCommitAt: 0,
    };
  }),

  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return { toast: '没有可重做的操作' };
    return {
      project: next,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      dirty: true,
      lastCommitKey: null,
      lastCommitAt: 0,
    };
  }),

  setProject: (project) => set({
    project,
    currentProjectId: project.id,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    lastCommitKey: null,
    lastCommitAt: 0,
  }),

  clearCurrentProject: () => set({
    currentProjectId: null,
    past: [],
    future: [],
    lastCommitKey: null,
    lastCommitAt: 0,
  }),

  loadFromText: (text, filePath = null) => {
    try {
      const project = deserializeProject(text);
      set({ project, currentProjectId: project.id, filePath, dirty: false, toast: `已打开「${project.name}」`, past: [], future: [], lastCommitKey: null, lastCommitAt: 0 });
    } catch (error) {
      set({ toast: errorMessage(error) });
    }
  },

  loadSample: () => {
    const project = createSampleProject();
    set({ project, currentProjectId: project.id, filePath: null, dirty: false, toast: '已载入示例项目', past: [], future: [], lastCommitKey: null, lastCommitAt: 0 });
  },

  newProject: () => {
    const project = createEmptyProject();
    set({ project, currentProjectId: project.id, filePath: null, dirty: false, toast: '已新建空项目', past: [], future: [], lastCommitKey: null, lastCommitAt: 0 });
  },

  markSaved: (filePath) => set({ filePath, dirty: false, toast: '项目已保存' }),
  clearDirty: () => set({ dirty: false }),
  setToast: (toast) => set({ toast }),

  addShots: (count, sceneId = null) => set((state) => committed(state, {
    ...state.project,
    shots: appendShots(state.project.shots, count, sceneId),
  })),

  insertShotAfter: (index, sceneId = null) => set((state) => committed(state, {
    ...state.project,
    shots: insertShotAfter(state.project.shots, index, sceneId),
  })),

  deleteShots: (ids) => set((state) => {
    const pruned = pruneRemovedShots(state.project.days, state.project.rundown, ids);
    return committed(state, {
      ...state.project,
      shots: deleteShots(state.project.shots, ids),
      days: pruned.days,
      rundown: pruned.rundown,
    });
  }),

  moveShot: (from, to) => set((state) => committed(state, {
    ...state.project,
    shots: moveShot(state.project.shots, from, to),
  })),

  renumberShots: () => set((state) => committed(state, {
    ...state.project,
    shots: renumberShotList(state.project.shots),
  })),

  updateCell: (shotId, key, value) => set((state) => committed(state, {
    ...state.project,
    shots: updateShotField(state.project.shots, shotId, key, value),
  }, { coalesce: `cell:${shotId}:${key}` })),

  addColumn: (label, kind) => {
    try {
      set((state) => committed(state, {
        ...state.project,
        columnSchema: addCustomColumn(state.project.columnSchema, label, kind),
      }));
    } catch (error) {
      set({ toast: errorMessage(error) });
    }
  },

  removeColumnById: (id) => {
    try {
      set((state) => committed(state, {
        ...state.project,
        columnSchema: removeColumn(state.project.columnSchema, id),
      }));
    } catch (error) {
      set({ toast: errorMessage(error) });
    }
  },

  renameColumnById: (id, label) => {
    try {
      set((state) => committed(state, {
        ...state.project,
        columnSchema: renameColumn(state.project.columnSchema, id, label),
      }, { coalesce: `column:${id}` }));
    } catch (error) {
      set({ toast: errorMessage(error) });
    }
  },

  toggleColumnById: (id) => set((state) => committed(state, {
    ...state.project,
    columnSchema: toggleColumn(state.project.columnSchema, id),
  })),

  moveColumnById: (id, delta) => set((state) => committed(state, {
    ...state.project,
    columnSchema: moveColumn(state.project.columnSchema, id, delta),
  })),

  setColumnWidthById: (id, width) => set((state) => committed(state, {
    ...state.project,
    columnSchema: setColumnWidth(state.project.columnSchema, id, width),
  }, { coalesce: `colwidth:${id}` })),

  setPresetById: (preset) => set((state) => committed(state, {
    ...state.project,
    columnSchema: applyPreset(state.project.columnSchema, preset),
  })),

  renameProject: (name) => set((state) => committed(state, {
    ...state.project,
    name: name.slice(0, 120),
  }, { coalesce: 'project-name' })),

  updateExportInfo: (patch) => set((state) => committed(state, {
    ...state.project,
    exportInfo: { ...state.project.exportInfo, ...patch },
  }, { coalesce: `export:${Object.keys(patch).join(',')}` })),

  setExportCustomFields: (fields) => set((state) => committed(state, {
    ...state.project,
    exportInfo: { ...state.project.exportInfo, custom: fields.slice(0, 100) },
  })),

  /* ---- M2 故事板 ---- */

  setStoryboardColumns: (columns) => set((state) => committed(state, {
    ...state.project,
    settings: {
      ...state.project.settings,
      storyboardColumns: Math.min(10, Math.max(1, Math.round(columns))),
    },
  })),

  toggleStoryboardField: (key) => set((state) => {
    const current = state.project.settings.storyboardFields;
    const next = current.includes(key) ? current.filter((field) => field !== key) : [...current, key];
    return committed(state, {
      ...state.project,
      settings: { ...state.project.settings, storyboardFields: next },
    });
  }),

  /* ---- M3 拍摄计划 ---- */

  createDay: (patch = {}) => {
    const day = createShootingDay(patch);
    set((state) => committed(state, { ...state.project, days: appendDay(state.project.days, day) }));
    return day.id;
  },

  updateDayById: (id, patch) => set((state) => committed(state, {
    ...state.project,
    days: patchDay(state.project.days, id, patch),
  }, { coalesce: `day:${id}` })),

  deleteDayById: (id) => set((state) => committed(state, {
    ...state.project,
    days: dropDay(state.project.days, id),
    rundown: state.project.rundown.filter((item) => item.dayId !== id),
    notices: state.project.notices.filter((notice) => notice.dayId !== id),
  })),

  assignShotsToDay: (dayId, shotIds) => set((state) => committed(state, {
    ...state.project,
    days: assignShotsToDays(state.project.days, dayId, shotIds),
  })),

  unassignShotsFromDay: (dayId, shotIds) => set((state) => committed(state, {
    ...state.project,
    days: unassignShotsInDay(state.project.days, dayId, shotIds),
  })),

  reorderDayShot: (dayId, from, to) => set((state) => committed(state, {
    ...state.project,
    days: reorderShotsInDay(state.project.days, dayId, from, to),
  })),

  /* ---- 人员库 ---- */

  addPerson: (patch = {}) => {
    const person = createPerson(patch);
    set((state) => committed(state, { ...state.project, people: [...state.project.people, person] }));
    return person.id;
  },

  updatePersonById: (id, patch) => set((state) => {
    const previous = state.project.people.find((person) => person.id === id);
    if (!previous) return state;
    const next: Person = { ...previous, ...patch, id };
    // 改名或换组后，拍摄日里的「导演 球球」跟着改，避免出现两份称呼
    const renamed = previous.name !== next.name || previous.role !== next.role;
    const rewrite = (tokens: string[]) => tokens.map((token) => (
      tokenBelongsTo(token, previous) ? personLabel(next) : token
    ));
    return committed(state, {
      ...state.project,
      people: state.project.people.map((person) => (person.id === id ? next : person)),
      days: renamed
        ? state.project.days.map((day) => ({ ...day, crew: rewrite(day.crew), actors: rewrite(day.actors) }))
        : state.project.days,
    }, { coalesce: `person:${id}` });
  }),

  deletePersonById: (id) => set((state) => {
    const person = state.project.people.find((entry) => entry.id === id);
    if (!person) return state;
    return committed(state, {
      ...state.project,
      people: state.project.people.filter((entry) => entry.id !== id),
      days: state.project.days.map((day) => ({
        ...day,
        crew: stripPerson(day.crew, person),
        actors: stripPerson(day.actors, person),
      })),
    });
  }),

  /* ---- M4 Rundown 与通告 ---- */

  setRundownView: (view) => set((state) => committed(state, {
    ...state.project,
    settings: { ...state.project.settings, rundownView: view },
  })),

  addRundown: (dayId, patch = {}, indexInDay) => {
    let created = '';
    set((state) => {
      const items = itemsForDay(state.project.rundown, dayId);
      // 新环节默认落在最后一个分组里，避免用户点「新增环节」后莫名掉进「未分组」
      const item = createRundownItem(dayId, items.length, { group: items.at(-1)?.group ?? '', ...patch });
      created = item.id;
      return committed(state, {
        ...state.project,
        rundown: indexInDay === undefined
          ? appendRundownItem(state.project.rundown, item)
          : insertRundownItemAt(state.project.rundown, item, indexInDay),
      });
    });
    return created;
  },

  updateRundown: (id, patch) => set((state) => committed(state, {
    ...state.project,
    rundown: patchRundownItem(state.project.rundown, id, patch),
  }, { coalesce: `rundown:${id}` })),

  deleteRundown: (id) => set((state) => committed(state, {
    ...state.project,
    rundown: dropRundownItem(state.project.rundown, id),
  })),

  moveRundown: (id, delta) => set((state) => committed(state, {
    ...state.project,
    rundown: shiftRundownItem(state.project.rundown, id, delta),
  })),

  dragRundown: (id, toIndex) => set((state) => committed(state, {
    ...state.project,
    rundown: dragRundownItem(state.project.rundown, id, toIndex),
  })),

  renameRundownGroup: (dayId, from, to) => set((state) => committed(state, {
    ...state.project,
    rundown: renameGroup(state.project.rundown, dayId, from, to),
  })),

  generateRundown: (dayId) => {
    let generated = false;
    set((state) => {
      const day = state.project.days.find((entry) => entry.id === dayId);
      if (!day) return {};
      const others = state.project.rundown.filter((item) => item.dayId !== dayId);
      generated = true;
      return committed(state, {
        ...state.project,
        rundown: [...others, ...buildRundownForDay(day, state.project.shots, state.project.scenes)],
      });
    });
    if (!generated) set({ toast: '找不到这个拍摄日，先新建拍摄计划' });
  },

  createNotice: (dayId) => {
    let created: string | null = null;
    set((state) => {
      const day = state.project.days.find((entry) => entry.id === dayId);
      if (!day) return {};
      const slots = computeSchedule(itemsForDay(state.project.rundown, dayId), day.startTime, day.endTime);
      const notice = createNoticeFromDay(day, slots);
      created = notice.id;
      return committed(state, { ...state.project, notices: [...state.project.notices, notice] });
    });
    if (!created) set({ toast: '先创建拍摄日，再生成通告' });
    return created;
  },

  updateNoticeById: (id, patch) => set((state) => committed(state, {
    ...state.project,
    notices: patchNotice(state.project.notices, id, patch),
  }, { coalesce: `notice:${id}` })),

  deleteNoticeById: (id) => set((state) => committed(state, {
    ...state.project,
    notices: dropNotice(state.project.notices, id),
  })),

  setNoticeStatus: (id, status) => set((state) => {
    const map = {
      draft: () => patchNotice(state.project.notices, id, { status: 'draft', publishedAt: null }),
      pending: () => publishNotice(state.project.notices, id),
      done: () => completeNotice(state.project.notices, id),
      expired: () => expireNotice(state.project.notices, id),
    };
    return committed(state, { ...state.project, notices: map[status]() });
  }),
}));
