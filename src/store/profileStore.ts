/**
 * 个人设置的本地存储。
 *
 * 桌面端存 localStorage（Electron 的 userData 目录下），浏览器同样；
 * 用 useSyncExternalStore 让项目库、导出页共享同一份资料，保存后立即刷新。
 */
import { useSyncExternalStore } from 'react';
import { createEmptyProfile, normalizeProfile, type Profile } from '@/domain/profile';

const STORAGE_KEY = 'shotflow.profile.v1';

let cache: Profile | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): Profile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyProfile();
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return createEmptyProfile();
  }
}

/** 稳定快照：只有 saveProfile 会替换引用，避免 useSyncExternalStore 死循环 */
export function getProfile(): Profile {
  if (!cache) cache = readFromStorage();
  return cache;
}

export function saveProfile(next: Profile): Profile {
  const normalized = normalizeProfile({ ...next, updatedAt: new Date().toISOString() });
  cache = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 存储写满时仍更新内存，界面不会卡在旧值
  }
  for (const listener of listeners) listener();
  return normalized;
}

export function subscribeProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribeProfile, getProfile, getProfile);
}

/** 测试用：清掉内存缓存与本地副本 */
export function resetProfileForTest(): void {
  cache = createEmptyProfile();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 非浏览器环境忽略
  }
  for (const listener of listeners) listener();
}
