/**
 * 云端地址状态。
 *
 * 真正落盘在主进程（userData/cloud.json），这里只是渲染层的镜像与操作入口。
 * 切换地址后：
 *   1. 主进程销毁云宿主窗口，下次调用按新地址重建；
 *   2. 登录态按 Origin 隔离，所以界面会回到未登录，需要重新扫码；
 *   3. 本机项目不受影响：下一次同步会把它们备份到新云端（不会删本地文件）。
 */
import { create } from 'zustand';
import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_SHARECODE,
  normalizeCloudTarget,
} from '@/domain/cloudEndpoint';
import { useCloud } from '@/store/cloudStore';
import { ENDPOINT_CHANGED_EVENT } from '@/store/cloudSync';

export type ProbeState = 'idle' | 'probing' | 'ok' | 'fail';

interface CloudEndpointState {
  endpoint: string;
  sharecode: string;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  probe: ProbeState;
  probeMessage: string | null;
  probeOrigin: string | null;
  load: () => Promise<void>;
  save: (input: { endpoint: string; sharecode: string }) => Promise<boolean>;
  resetToDefault: () => Promise<boolean>;
  runProbe: () => Promise<void>;
  /** 改了输入就清掉上一次的连接结果，避免旧结论误导 */
  clearProbe: () => void;
}

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/** 地址切换后通知同步层收尾（清空旧云端的状态与冲突） */
function announceChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ENDPOINT_CHANGED_EVENT));
}

/**
 * 给「测试连接」加一道本地截止时间。
 *
 * 主进程那边本身有超时，但如果云宿主窗口在切换瞬间被销毁、请求没人接，渲染层可能一直等下去。
 * 这里再兜一层：到点就判定失败，界面永远不会卡在「正在连接…」。
 */
const PROBE_DEADLINE = 18_000;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('probe_deadline')), ms);
    }),
  ]);
}

/** 把底层错误翻成人话，避免把 cloud_offline 这种代码丢给用户 */
export function probeMessageOf(error: string): string {
  if (/cloud_offline|cloud_load_failed|ERR_NAME|ERR_CONNECTION/i.test(error)) {
    return '连不上：页面打不开，检查地址是否已部署、网络是否正常';
  }
  if (/cloud_timeout|probe_deadline/i.test(error)) {
    return '地址能打开，但在超时前没有回应，可能不是 ShotFlow 云桥页';
  }
  if (/cloud_window|cloud_renderer/i.test(error)) {
    return '云端窗口没能启动，重试一次或重启应用';
  }
  return `连接失败：${error}`;
}

export const useCloudEndpoint = create<CloudEndpointState>((set, get) => ({
  endpoint: DEFAULT_CLOUD_ENDPOINT,
  sharecode: DEFAULT_CLOUD_SHARECODE,
  loaded: false,
  saving: false,
  error: null,
  probe: 'idle',
  probeMessage: null,
  probeOrigin: null,

  async load() {
    const api = bridge();
    if (!api?.cloudConfigGet) {
      set({ loaded: true });
      return;
    }
    try {
      const config = await api.cloudConfigGet();
      set({
        endpoint: config?.endpoint || DEFAULT_CLOUD_ENDPOINT,
        sharecode: config?.sharecode ?? '',
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  async save(input) {
    const api = bridge();
    const normalized = normalizeCloudTarget(input);
    if (!normalized.ok) {
      set({ error: normalized.error, probe: 'idle', probeMessage: null });
      return false;
    }
    if (!api?.cloudConfigSet) {
      set({ error: '当前环境不支持切换云端地址（仅桌面端可用）' });
      return false;
    }

    set({ saving: true, error: null, probe: 'idle', probeMessage: null, probeOrigin: null });
    try {
      const result = await api.cloudConfigSet(normalized.target);
      if (!result?.ok) {
        set({
          saving: false,
          error: result?.error === 'endpoint_not_allowed'
            ? '只支持 WorkBuddy 云服务分配的地址（…app.workbuddy.host）'
            : `保存失败：${result?.error || '未知错误'}`,
        });
        return false;
      }
      set({
        saving: false,
        endpoint: result.endpoint || normalized.target.endpoint,
        sharecode: result.sharecode ?? normalized.target.sharecode,
      });
      announceChange();
      await get().runProbe();
      return true;
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  async resetToDefault() {
    return get().save({ endpoint: DEFAULT_CLOUD_ENDPOINT, sharecode: DEFAULT_CLOUD_SHARECODE });
  },

  clearProbe() {
    if (get().probe === 'idle' && !get().probeMessage) return;
    set({ probe: 'idle', probeMessage: null, probeOrigin: null, error: null });
  },

  async runProbe() {
    const api = bridge();
    if (!api?.cloudCall) {
      set({ probe: 'fail', probeMessage: '当前环境不支持云端连接' });
      return;
    }
    set({ probe: 'probing', probeMessage: null, probeOrigin: null });
    try {
      const result = (await withDeadline(
        api.cloudCall('ping', {}, { timeout: 15_000 }) as Promise<{ endpoint?: string } | undefined>,
        PROBE_DEADLINE,
      )) as { endpoint?: string } | undefined;
      set({
        probe: 'ok',
        probeOrigin: result?.endpoint || get().endpoint,
        probeMessage: null,
      });
      await useCloud.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ probe: 'fail', probeMessage: probeMessageOf(message) });
      // 这里不要走 refresh()：它会再发一次请求，遇到打不开的地址要白等 25 秒。
      // 直接标成不可用，界面立刻能说清「连不上」。
      useCloud.setState({ status: 'unavailable', user: null, error: 'cloud_offline' });
    }
  },
}));
