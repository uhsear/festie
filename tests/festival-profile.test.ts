import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { ensureFestivalProfile } from '../lib/festival-profile';

const REQ_USER = { userId: 'user-1', username: 'testuser' };
const USER = { id: 'user-1', username: 'testuser' };

function makeDeps(opts: { existing?: any; orphan?: any; count?: number; max?: number; user?: any } = {}) {
  const profileCreated = mock.fn();
  const create = mock.fn(async (p: any) => p);
  const claimOrphan = mock.fn(async () => opts.orphan ?? null);
  const countByFestival = mock.fn(async () => opts.count ?? 0);
  const deps = {
    config: { MAX_PROFILES_PER_FESTIVAL: opts.max ?? 100 },
    log: { info: mock.fn(), warn: mock.fn(), error: mock.fn() },
    getUserFestivalProfile: mock.fn(async () => opts.existing ?? null),
    getUserById: mock.fn(async () => (opts.user === undefined ? USER : opts.user)),
    getProfiles: mock.fn(async () => []),
    createOpaqueId: (prefix: string) => `${prefix}-new`,
    emitter: { profileCreated },
    stores: { profiles: { claimOrphan, countByFestival, create } },
  };
  return { deps, profileCreated, create, claimOrphan };
}

describe('ensureFestivalProfile', () => {
  it('returns the existing profile without creating one', async () => {
    const existing = { id: 'prof-1', userId: 'user-1', festivalId: 'fest-1' };
    const { deps, create, claimOrphan, profileCreated } = makeDeps({ existing });
    const result = await ensureFestivalProfile(deps, REQ_USER, 'fest-1');
    assert.deepEqual(result, { profile: existing, user: USER });
    assert.equal(create.mock.callCount(), 0);
    assert.equal(claimOrphan.mock.callCount(), 0);
    assert.equal(profileCreated.mock.callCount(), 1);
  });

  it('claims an orphan profile matching the username', async () => {
    const orphan = { id: 'prof-orphan', userId: 'user-1', festivalId: 'fest-1' };
    const { deps, create, claimOrphan } = makeDeps({ orphan });
    const result = await ensureFestivalProfile(deps, REQ_USER, 'fest-1');
    assert.deepEqual(result, { profile: orphan, user: USER });
    assert.deepEqual((claimOrphan.mock.calls[0] as any).arguments, ['fest-1', 'user-1', 'testuser']);
    assert.equal(create.mock.callCount(), 0);
  });

  it('returns limit when the festival is at its profile cap', async () => {
    const { deps, create } = makeDeps({ count: 5, max: 5 });
    assert.deepEqual(await ensureFestivalProfile(deps, REQ_USER, 'fest-1'), { error: 'limit' });
    assert.equal(create.mock.callCount(), 0);
  });

  it('creates a new profile and emits profileCreated', async () => {
    const { deps, create, profileCreated } = makeDeps();
    const result = await ensureFestivalProfile(deps, REQ_USER, 'fest-1');
    assert.equal(create.mock.callCount(), 1);
    const created = (create.mock.calls[0] as any).arguments[0];
    assert.equal(created.id, 'prof-new');
    assert.equal(created.festivalId, 'fest-1');
    assert.equal(created.userId, 'user-1');
    assert.equal(created.name, 'testuser');
    assert.ok(!('error' in result) || result.error === undefined);
    assert.equal(profileCreated.mock.callCount(), 1);
    assert.deepEqual((profileCreated.mock.calls[0] as any).arguments[0], { festivalId: 'fest-1', profile: created, user: USER });
  });

  it('returns user-missing when the user row is gone', async () => {
    const { deps } = makeDeps({ user: null });
    assert.deepEqual(await ensureFestivalProfile(deps, REQ_USER, 'fest-1'), { error: 'user-missing' });
  });
});
