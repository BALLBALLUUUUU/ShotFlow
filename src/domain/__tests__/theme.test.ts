import { describe, expect, it } from 'vitest';
import { readInitialTheme, useTheme } from '@/store/themeStore';

describe('明暗主题状态', () => {
  it('没有 localStorage 时默认浅色', () => {
    expect(readInitialTheme()).toBe(false);
    expect(useTheme.getState().dark).toBe(false);
  });

  it('切换、再切回', () => {
    useTheme.getState().toggle();
    expect(useTheme.getState().dark).toBe(true);
    useTheme.getState().toggle();
    expect(useTheme.getState().dark).toBe(false);
  });

  it('setDark 幂等，重复设置同一个值不会抖动', () => {
    useTheme.getState().setDark(true);
    const first = useTheme.getState().dark;
    useTheme.getState().setDark(true);
    expect(first).toBe(true);
    expect(useTheme.getState().dark).toBe(true);
    useTheme.getState().setDark(false);
  });
});
