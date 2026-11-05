// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalStore } from '../stores/festivalStore';

const createSocket = vi.fn();
vi.mock('../services/socket', () => ({ createSocket: (...args: unknown[]) => createSocket(...args) }));

import { useSocket } from './useSocket';

const fakeSocket = () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: false });

describe('useSocket', () => {
  beforeEach(() => {
    createSocket.mockReset();
    createSocket.mockImplementation(fakeSocket);
    useFestivalStore.setState({ currentFestivalId: null } as never);
  });

  it('does not open a socket without a festival to join (FND-068)', () => {
    renderHook(() => useSocket());
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('opens a socket once a festival is known', () => {
    renderHook(() => useSocket('fest-1'));
    expect(createSocket).toHaveBeenCalledTimes(1);
  });
});
