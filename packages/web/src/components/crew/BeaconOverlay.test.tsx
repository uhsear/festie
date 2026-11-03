import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BEACON_COPY } from '@festie/shared/constants';
import { BEACON_FLASH_MS } from '@festie/shared/utils';
import { useAuthStore } from '@festie/shared/stores';
import type { User } from '@festie/shared/types';

import { BeaconButton } from './BeaconOverlay';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

describe('BeaconButton', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
    useAuthStore.setState({ user: { id: 'u1', username: 'dani', name: 'Dani Lee' } as User });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  function open() {
    render(<BeaconButton />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(BEACON_COPY.button) }));
    return screen.getByRole('dialog', { name: BEACON_COPY.a11y });
  }

  it('opens a dialog with the user initials, even without fullscreen or wake lock', () => {
    expect(open()).toHaveTextContent('DL');
  });

  it('swaps colour every flash interval', () => {
    const dialog = open();
    const first = dialog.style.backgroundColor;
    act(() => {
      vi.advanceTimersByTime(BEACON_FLASH_MS);
    });
    expect(dialog.style.backgroundColor).not.toBe(first);
  });

  it('stays steady under reduced motion', () => {
    setReducedMotion(true);
    const dialog = open();
    const first = dialog.style.backgroundColor;
    act(() => {
      vi.advanceTimersByTime(BEACON_FLASH_MS * 3);
    });
    expect(dialog.style.backgroundColor).toBe(first);
  });

  it('closes on Done', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: BEACON_COPY.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
