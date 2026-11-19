import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from '@festie/shared/services';

// useLiveSocket hands subscribe/getSnapshot to useSyncExternalStore. There is no
// React renderer in this node harness, so the stub captures them and the test
// drives them directly, as React would.
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: unknown, getSnapshot: () => unknown) => ({ subscribe, getSnapshot }),
}));

const { setLiveSocket, useLiveSocket } = await import('./liveSocket');

const readHook: () => unknown = useLiveSocket;
const store = () =>
  readHook() as { subscribe: (cb: () => void) => () => void; getSnapshot: () => Socket | null };
const fakeSocket = (name: string) => ({ name }) as unknown as Socket;

beforeEach(() => setLiveSocket(null));

describe('liveSocket holder', () => {
  it('starts empty and returns the published socket', () => {
    expect(store().getSnapshot()).toBeNull();
    const s = fakeSocket('a');
    setLiveSocket(s);
    expect(store().getSnapshot()).toBe(s);
  });

  it('notifies subscribers on change and on teardown to null', () => {
    const cb = vi.fn();
    store().subscribe(cb);
    setLiveSocket(fakeSocket('a'));
    setLiveSocket(null);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not notify when the same socket is published again', () => {
    const s = fakeSocket('a');
    setLiveSocket(s);
    const cb = vi.fn();
    store().subscribe(cb);
    setLiveSocket(s);
    expect(cb).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const cb = vi.fn();
    const unsubscribe = store().subscribe(cb);
    unsubscribe();
    setLiveSocket(fakeSocket('a'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('notifies every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    store().subscribe(a);
    store().subscribe(b);
    setLiveSocket(fakeSocket('a'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
