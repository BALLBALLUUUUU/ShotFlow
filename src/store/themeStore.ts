/**
 * 明暗主题。
 *
 * 原来只有项目页工具条里有一颗开关，状态放在 App 的 useState 里；
 * 现在项目库顶栏也要一颗，所以提升到 store，两个入口共用同一份状态。
 *
 * 真正的副作用（写入 <html data-theme>、同步 Electron 原生主题、落盘）留在 App 的 effect 里，
 * 这样无论是从哪个入口切换，都会走同一条路径。
 */
import { create } from 'zustand';

const STORAGE_KEY = 'shotflow-theme';

/** 首屏读取上次选择；读不到就跟随系统（prefers-color-scheme） */
export function readInitialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
  } catch {
    /* localStorage 不可用时按系统走 */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

interface ThemeState {
  dark: boolean;
  setDark: (dark: boolean) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set) => ({
  dark: readInitialTheme(),
  setDark: (dark) => set((state) => (state.dark === dark ? state : { dark })),
  toggle: () => set((state) => ({ dark: !state.dark })),
}));

export function toggleTheme(): void {
  useTheme.getState().toggle();
}
