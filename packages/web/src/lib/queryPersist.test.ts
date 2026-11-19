import { describe, it, expect, afterEach } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { useAuthStore } from '@festie/shared';
import type { User } from '@festie/shared';
import { buildPersistOptions } from './queryPersist';

const shouldPersist = (root: unknown) =>
  buildPersistOptions().dehydrateOptions!.shouldDehydrateQuery!({ queryKey: [root, 'x'] } as unknown as Query);

describe('buildPersistOptions', () => {
  afterEach(() => useAuthStore.setState({ user: null }));

  it.each(['meeting-points', 'polls', 'expenses', 'expense-balances', 'settlement-plan', 'crew-activity'])(
    'persists %s',
    (root) => expect(shouldPersist(root)).toBe(true),
  );

  it.each(['auth', 'lineup', 'ratings'])('does not persist %s', (root) => expect(shouldPersist(root)).toBe(false));

  it('rejects non-string and missing key roots', () => {
    expect(shouldPersist(42)).toBe(false);
    const { shouldDehydrateQuery } = buildPersistOptions().dehydrateOptions!;
    expect(shouldDehydrateQuery!({ queryKey: [] } as unknown as Query)).toBe(false);
  });

  it('keys the buster to the current user id', () => {
    expect(buildPersistOptions().buster).toBe('');
    useAuthStore.setState({ user: { id: 'u1' } as User });
    expect(buildPersistOptions().buster).toBe('u1');
  });

  it('caps maxAge at 24h', () => {
    expect(buildPersistOptions().maxAge).toBe(24 * 60 * 60 * 1000);
  });
});
