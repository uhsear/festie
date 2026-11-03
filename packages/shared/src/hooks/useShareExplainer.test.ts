// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SHARE_EXPLAINER_SEEN_KEY, useShareExplainer } from './useShareExplainer';

describe('useShareExplainer', () => {
  beforeEach(() => localStorage.clear());

  it('is needed on first use and not after Got it, across mounts', async () => {
    const first = renderHook(() => useShareExplainer());
    await waitFor(() => expect(first.result.current.needed).toBe(true));
    act(() => first.result.current.markSeen());
    expect(first.result.current.needed).toBe(false);
    await waitFor(() => expect(localStorage.getItem(SHARE_EXPLAINER_SEEN_KEY)).toBe('1'));

    const again = renderHook(() => useShareExplainer());
    await act(async () => {});
    expect(again.result.current.needed).toBe(false);
  });
});
