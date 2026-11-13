/**
 * 云端账号状态。
 *
 * 数据通路：渲染进程 → 主进程 IPC → 云宿主窗口（正式域名）→ 云端。
 * 渲染进程本身不碰远端，所以 file:// 下也能用。
 *
 * 离线优先：拿不到账号状态时只是把云功能标记为不可用，不影响本地任何操作。
 */
import { create } from 'zustand';

export interface CloudUser {
  id: string | null;
  name: string | null;
  avatar: string | null;
}

export type CloudStatus = 'idle' | 'signed-out' | 'signed-in' | 'unavailable';

interface CloudState {
  status: CloudStatus;
  /** 正在发起登录（不是读取状态），只用来锁按钮文案 */
  busy: boolean;
  user: CloudUser | null;
  error: string | null;
  /** 最近一次同步的时间戳，供 UI 显示 */
  lastSyncAt: string | null;
  refresh: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setLastSyncAt: (value: string | null) => void;
}

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

export const useCloud = create<CloudState>((set) => ({
  status: 'idle',
  busy: false,
  user: null,
  error: null,
  lastSyncAt: null,

  async refresh() {
    const api = bridge();
    if (!api?.cloudSession) {
      set({ status: 'unavailable', user: null, error: null });
      return;
    }
    try {
      const payload = await api.cloudSession();
      if (payload?.signedIn) {
        set({ status: 'signed-in', user: payload.user ?? null, error: null });
      } else {
        set({
          status: payload?.offline ? 'unavailable' : 'signed-out',
          user: null,
          error: payload?.offline ? 'cloud_offline' : null,
        });
      }
    } catch (error) {
      set({ status: 'unavailable', user: null, error: error instanceof Error ? error.message : String(error) });
    }
  },

  async login() {
    const api = bridge();
    if (!api?.cloudLogin) {
      set({ status: 'unavailable', error: 'cloud_unavailable' });
      return;
    }
    set({ busy: true, error: null });
    try {
      const result = await api.cloudLogin();
      if (result?.signedIn) {
        set({ status: 'signed-in', user: result.user ?? null, error: null });
      } else {
        // 窗口已打开，等用户扫码；回调会通过 cloud:event 推送结果
        set({ status: 'signed-out' });
      }
    } catch (error) {
      set({ status: 'signed-out', error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  async logout() {
    const api = bridge();
    if (!api?.cloudLogout) return;
    set({ busy: true });
    try {
      await api.cloudLogout();
    } catch {
      /* 忽略：本地状态照常收尾 */
    }
    set({ status: 'signed-out', user: null, error: null, busy: false });
  },

  setLastSyncAt(value) {
    set({ lastSyncAt: value });
  },
}));

/** 应用启动时挂一次：把云桥推来的登录事件同步进 store */
export function bindCloudEvents(): () => void {
  const api = bridge();
  if (!api?.onCloudEvent) return () => {};
  return api.onCloudEvent((payload) => {
    if (!payload || payload.event !== 'auth') return;
    const data = payload.data as { signedIn?: boolean; user?: CloudUser | null } | undefined;
    if (data?.signedIn) {
      useCloud.setState({ status: 'signed-in', user: data.user ?? null, error: null });
    } else {
      useCloud.setState({ status: 'signed-out', user: null });
    }
  });
}
