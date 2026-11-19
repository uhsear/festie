import { describe, it, expect, vi } from 'vitest';
import { registerOfflineQueue, getOfflineQueue } from './offlineQueueRegistry';

const make = () => ({ queueMutation: vi.fn(async () => {}), processQueue: vi.fn(async () => {}) });

describe('offlineQueueRegistry', () => {
  it('is empty until a bridge registers', () => {
    expect(getOfflineQueue()).toBeNull();
  });

  it('returns the registered bridge and clears it on unregister', () => {
    const bridge = make();
    const unregister = registerOfflineQueue(bridge);
    expect(getOfflineQueue()).toBe(bridge);
    unregister();
    expect(getOfflineQueue()).toBeNull();
  });

  it('a stale unregister does not clear a newer bridge', () => {
    const first = make();
    const second = make();
    const unregisterFirst = registerOfflineQueue(first);
    const unregisterSecond = registerOfflineQueue(second);
    unregisterFirst();
    expect(getOfflineQueue()).toBe(second);
    unregisterSecond();
  });
});
