/**
 * 启动更新闸门的状态机。
 *
 * 规则：
 *   1. 确认「有新版 + 强制 + 当前平台能下载」才算锁；缺安装包时只提示不锁，
 *      否则一次配置失误会把所有人挡在无法更新的页面上；
 *   2. 检查失败一律放行（断网等于软件报废更糟），但一旦锁过就写本地记录，
 *      下次断网也照样挡——否则断网就是绕过强制更新的后门；
 *   3. 版本判定全部走 domain/update 的纯函数。
 */
import { create } from 'zustand';
import {
  compareVersions,
  decideUpdate,
  DEFAULT_UPDATE_REPO,
  normalizeTagVersion,
  pickManifest,
  platformFrom,
  type UpdateDecision,
} from '@/domain/update';

const REPO_KEY = 'shotflow.update.repo.v1';
const LOCK_KEY = 'shotflow.update.lock.v1';
const CHECK_DEADLINE = 14000;
/** 启动页最多等这么久，超时先放行进界面；检查在后台继续，结论出来再补锁 */
const SPLASH_BUDGET = 3500;
/** 太快的检查会让启动页闪一下，给个最短展示时间 */
const SPLASH_MIN = 450;

export type UpdatePhase = 'checking' | 'ready' | 'blocked';

interface LockedUpdate {
  latest: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
  downloadName: string;
  publishedAt: string;
  at: number;
}

export interface UpdateProgress {
  received: number;
  total: number;
  percent: number;
}

interface UpdateState {
  phase: UpdatePhase;
  decision: UpdateDecision | null;
  checkError: string | null;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  progress: UpdateProgress | null;
  /** 远端安装包体积（HEAD 探测得到），下载前就能告诉用户多大 */
  remoteSize: number;
  saved: { filePath: string; size: number } | null;
  actionError: string | null;
  bootstrap: () => Promise<void>;
  recheck: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openPage: () => Promise<void>;
  restart: () => Promise<void>;
}

export function readUpdateRepo(): string {
  try {
    return window.localStorage.getItem(REPO_KEY)?.trim() || DEFAULT_UPDATE_REPO;
  } catch {
    return DEFAULT_UPDATE_REPO;
  }
}

export function writeUpdateRepo(value: string): void {
  try {
    const text = value.trim();
    if (text) window.localStorage.setItem(REPO_KEY, text);
    else window.localStorage.removeItem(REPO_KEY);
  } catch {
    // 存储不可用只影响「记住仓库地址」
  }
}

function readLock(): LockedUpdate | null {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LockedUpdate>;
    if (typeof value.latest !== 'string' || !value.latest) return null;
    return {
      latest: value.latest,
      notes: typeof value.notes === 'string' ? value.notes : '',
      pageUrl: typeof value.pageUrl === 'string' ? value.pageUrl : '',
      downloadUrl: typeof value.downloadUrl === 'string' ? value.downloadUrl : '',
      downloadName: typeof value.downloadName === 'string' ? value.downloadName : '',
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : '',
      at: typeof value.at === 'number' ? value.at : 0,
    };
  } catch {
    return null;
  }
}

function writeLock(decision: UpdateDecision): void {
  const payload: LockedUpdate = {
    latest: decision.latest,
    notes: decision.notes,
    pageUrl: decision.pageUrl,
    downloadUrl: decision.downloadUrl ?? '',
    downloadName: decision.downloadName,
    publishedAt: decision.publishedAt,
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(LOCK_KEY, JSON.stringify(payload));
  } catch {
    // 写不进 localStorage 时本次仍然锁，只是断网后挡不住
  }
}

function clearLock(): void {
  try {
    window.localStorage.removeItem(LOCK_KEY);
  } catch {
    // 清不掉也不影响本次放行
  }
}

function decisionFromLock(lock: LockedUpdate, current: string): UpdateDecision | null {
  if (compareVersions(lock.latest, current) <= 0) return null;
  return {
    current,
    latest: lock.latest,
    hasUpdate: true,
    mandatory: true,
    notes: lock.notes,
    publishedAt: lock.publishedAt,
    pageUrl: lock.pageUrl,
    downloadUrl: lock.downloadUrl || null,
    downloadName: lock.downloadName,
    downloadSize: 0,
    canDownload: Boolean(lock.downloadUrl && lock.downloadName),
  };
}

function withDeadline<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let started = false;

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: 'checking',
  decision: null,
  checkError: null,
  checking: false,
  downloading: false,
  installing: false,
  progress: null,
  remoteSize: 0,
  saved: null,
  actionError: null,

  bootstrap: async () => {
    if (started) return;
    started = true;
    const api = window.electronAPI;
    // 浏览器预览没有桌面桥：不拦
    if (!api?.getVersion || !api.checkUpdate) {
      set({ phase: 'ready' });
      return;
    }

    let current = '0.0.0';
    try {
      current = await api.getVersion();
    } catch {
      // 读不到版本时按 0.0.0 处理，远端清单不会因此误判成需要更新
    }

    const lock = readLock();
    const locked = lock ? decisionFromLock(lock, normalizeTagVersion(current)) : null;
    if (locked) {
      set({ phase: 'blocked', decision: locked });
      void get().recheck();
      return;
    }
    if (lock) clearLock();

    set({ phase: 'checking' });
    const startedAt = Date.now();
    const task = get().recheck();
    await Promise.race([task, new Promise((resolve) => setTimeout(resolve, SPLASH_BUDGET))]);
    const elapsed = Date.now() - startedAt;
    if (elapsed < SPLASH_MIN) await new Promise((resolve) => setTimeout(resolve, SPLASH_MIN - elapsed));
    // 还没出结论就先让用户进去；recheck 结束后若是强制更新会自己把界面锁上
    if (get().phase === 'checking') set({ phase: 'ready' });
  },

  recheck: async () => {
    const api = window.electronAPI;
    if (!api?.checkUpdate) {
      set({ phase: 'ready', checking: false });
      return;
    }
    set({ checking: true, checkError: null, actionError: null });
    try {
      const result = await withDeadline(api.checkUpdate({ repo: readUpdateRepo() }), CHECK_DEADLINE);
      if (!result.ok) {
        set({ checking: false, checkError: result.error });
        // 检查失败：已经锁住的继续锁，没锁的放行
        if (!get().decision?.mandatory) set({ phase: 'ready' });
        return;
      }

      const picked = pickManifest(result.candidates ?? []);
      const current = normalizeTagVersion(result.current || '0.0.0');
      const decision = decideUpdate(current, picked?.manifest ?? null, platformFrom(result.platform));

      if (!decision) {
        clearLock();
        set({ phase: 'ready', decision: null, checking: false });
        return;
      }

      if (!decision.hasUpdate) {
        clearLock();
        set({ phase: 'ready', decision, checking: false });
        return;
      }

      if (decision.mandatory && decision.canDownload) {
        // 清单写了地址但包还没上传时不能锁，否则用户卡在没有安装包的页面
        if (decision.downloadUrl && api.probeUpdate) {
          const probe = await api.probeUpdate(decision.downloadUrl);
          if (probe.ok && (probe.size ?? 0) > 0) set({ remoteSize: probe.size ?? 0 });
          if (!probe.ok) {
            clearLock();
            set({
              phase: 'ready',
              decision,
              checking: false,
              checkError: '新版本的安装包暂时下载不到，已跳过本次强制校验',
            });
            return;
          }
        }
        writeLock(decision);
        set({ phase: 'blocked', decision, checking: false });
        return;
      }

      // 有新版但当前平台拿不到安装包：只提示，不把人锁在死页面
      clearLock();
      set({ phase: 'ready', decision, checking: false });
    } catch (error) {
      const message = error instanceof Error && error.message === 'timeout'
        ? '检查更新超时，已跳过校验'
        : '无法连接更新服务器，已跳过校验';
      set({ checking: false, checkError: message });
      if (!get().decision?.mandatory) set({ phase: 'ready' });
    }
  },

  download: async () => {
    const api = window.electronAPI;
    const decision = get().decision;
    if (!api?.downloadUpdate || !decision?.downloadUrl) return;

    const unsubscribe = api.onUpdateProgress?.((progress) => set({ progress }));
    set({
      downloading: true,
      actionError: null,
      progress: { received: 0, total: 0, percent: 0 },
    });
    try {
      const result = await api.downloadUpdate({ url: decision.downloadUrl, name: decision.downloadName });
      if (!result.ok) {
        set({ downloading: false, progress: null, actionError: result.error });
        return;
      }
      set({
        downloading: false,
        progress: { received: result.size, total: result.size, percent: 100 },
        saved: { filePath: result.filePath, size: result.size },
      });
    } catch {
      set({ downloading: false, progress: null, actionError: '下载失败，请稍后重试' });
    } finally {
      unsubscribe?.();
    }
  },

  install: async () => {
    const api = window.electronAPI;
    const saved = get().saved;
    if (!api?.installUpdate || !saved) return;
    set({ installing: true, actionError: null });
    try {
      const result = await api.installUpdate({ filePath: saved.filePath });
      if (!result.ok) {
        set({ installing: false, actionError: result.error });
        return;
      }
      set({ installing: true });
    } catch {
      set({ installing: false, actionError: '无法启动安装程序' });
    }
  },

  openPage: async () => {
    const api = window.electronAPI;
    const decision = get().decision;
    const url = decision?.pageUrl || `https://github.com/${DEFAULT_UPDATE_REPO}/releases`;
    if (!api?.openUpdatePage) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const result = await api.openUpdatePage(url);
    if (!result.ok) set({ actionError: result.error });
  },

  restart: async () => {
    await window.electronAPI?.relaunchApp?.();
  },
}));

/** 供 App 在启动时调用；模块内做幂等，React 严格模式双执行也不会重复请求 */
export function bootstrapUpdateGate(): void {
  void useUpdate.getState().bootstrap();
}
