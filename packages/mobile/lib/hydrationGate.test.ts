import { onHydrated, type PersistLike } from './hydrationGate';

function fakePersist(hydrated: boolean) {
  const listeners = new Set<() => void>();
  const persist: PersistLike = {
    hasHydrated: () => hydrated,
    onFinishHydration: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    persist,
    finish() {
      hydrated = true;
      listeners.forEach((l) => l());
    },
    listeners,
  };
}

describe('onHydrated', () => {
  it('waits for hydration to finish before calling back', () => {
    const f = fakePersist(false);
    const done = vi.fn();
    onHydrated(f.persist, done);
    expect(done).not.toHaveBeenCalled();
    f.finish();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('calls back at once when the store already hydrated, and never subscribes', () => {
    const f = fakePersist(true);
    const done = vi.fn();
    onHydrated(f.persist, done);
    expect(done).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
  });

  it('stops listening after unsubscribe', () => {
    const f = fakePersist(false);
    const done = vi.fn();
    onHydrated(f.persist, done)();
    f.finish();
    expect(done).not.toHaveBeenCalled();
  });
});
