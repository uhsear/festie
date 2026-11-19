import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

beforeEach(() => {
  window.__festieInstallPrompt = null;
});

describe('useInstallPrompt', () => {
  it('starts unavailable when no prompt was captured', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current[0]).toBe(false);
  });

  it('starts available when a prompt was already captured', () => {
    window.__festieInstallPrompt = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current[0]).toBe(true);
  });

  it('captures the event, prevents default, flips availability and calls onCapture', () => {
    const onCapture = vi.fn();
    const { result } = renderHook(() => useInstallPrompt(onCapture));
    const evt = new Event('beforeinstallprompt', { cancelable: true });
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(true);
    expect(window.__festieInstallPrompt).toBe(evt);
    expect(result.current[0]).toBe(true);
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('lets the caller clear availability and stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    unmount();
    const evt = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});
