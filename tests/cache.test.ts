import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCacheHelpers } from '../lib/app-context/cache.js';

// ─── Mock Stores ─────────────────────────────────────────────────────────────

function makeStores(data: any = {}) {
  const users = data.users || [
    { id: 'u1', username: 'Alice' },
    { id: 'u2', username: 'Bob' },
  ];
  const festivals = data.festivals || [
    { id: 'f1', name: 'Bonnaroo' },
    { id: 'f2', name: 'Coachella' },
  ];
  const profiles = data.profiles || [
    { id: 'p1', userId: 'u1', festivalId: 'f1' },
    { id: 'p2', userId: 'u2', festivalId: 'f1' },
  ];

  return {
    users: {
      readAll: async () => [...users],
      getById: async (id: string) => users.find((u: any) => u.id === id && !u.deletedAt) || null,
    },
    festivals: {
      readAll: async () => [...festivals],
    },
    profiles: {
      readAll: async () => [...profiles],
      getById: async (id: string) => profiles.find((p: any) => p.id === id) || null,
      readByUserAndFestival: async (userId: string, festivalId: string) =>
        profiles.find((p: any) => p.userId === userId && p.festivalId === festivalId) || null,
    },
  };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

// ─── Data access helpers ─────────────────────────────────────────────────────

describe('cache: data access helpers', () => {
  it('getFestivals returns festivals from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festivals = await cache.getFestivals();
    assert.equal(festivals.length, 2);
    assert.equal(festivals[0].name, 'Bonnaroo');
  });

  it('getUsers returns users from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const users = await cache.getUsers();
    assert.equal(users.length, 2);
  });

  it('getProfiles returns profiles from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profiles = await cache.getProfiles();
    assert.equal(profiles.length, 2);
  });

  it('getProfileById returns a specific profile', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getProfileById('p1');
    assert.equal(profile.userId, 'u1');
  });

  it('getProfileById returns null for missing id', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getProfileById('missing');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns profile for user+festival pair', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f1');
    assert.equal(profile.id, 'p1');
  });

  it('getUserFestivalProfile returns null for missing pair', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f999');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns null for null userId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile(null, 'f1');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns null for null festivalId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', null);
    assert.equal(profile, null);
  });
});

// ─── User cache ──────────────────────────────────────────────────────────────

describe('cache: user cache', () => {
  it('getUserMap returns a Map keyed by userId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const map = await cache.getUserMap();
    assert.ok(map instanceof Map);
    assert.equal(map.size, 2);
    assert.equal(map.get('u1').username, 'Alice');
  });

  it('getUserById returns a user by ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const user = await cache.getUserById('u2');
    assert.equal(user.username, 'Bob');
  });

  it('getUserById returns null for unknown ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const user = await cache.getUserById('unknown');
    assert.equal(user, null);
  });

  it('invalidateUserCache causes next getUserMap to re-fetch', async () => {
    let fetchCount = 0;
    const stores = makeStores();
    const origReadAll = stores.users.readAll;
    stores.users.readAll = async () => { fetchCount++; return origReadAll(); };
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    await cache.getUserMap();
    assert.equal(fetchCount, 1);
    cache.invalidateUserCache();
    await cache.getUserMap();
    assert.equal(fetchCount, 2);
  });
});

describe('cache: getUserById per-id cache', () => {
  function countingStores(data: any = {}) {
    const stores = makeStores(data);
    const calls = { readAll: 0, getById: 0 };
    const { readAll, getById } = stores.users;
    stores.users.readAll = async () => { calls.readAll++; return readAll(); };
    stores.users.getById = async (id: string) => { calls.getById++; return getById(id); };
    return { stores, calls };
  }

  it('reads one row by primary key after invalidation, then serves it from cache', async () => {
    const { stores, calls } = countingStores();
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    cache.invalidateUserCache();
    const first = await cache.getUserById('u1');
    assert.equal(first.username, 'Alice');
    assert.equal(calls.readAll, 0);
    assert.equal(calls.getById, 1);
    await cache.getUserById('u1');
    assert.equal(calls.readAll, 0);
    assert.equal(calls.getById, 1);
  });

  it('reads the new row after invalidateUserCache', async () => {
    const users = [{ id: 'u1', username: 'Alice' }];
    const { stores, calls } = countingStores({ users });
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    await cache.getUserById('u1');
    users[0] = { id: 'u1', username: 'Alicia' };
    cache.invalidateUserCache();
    assert.equal((await cache.getUserById('u1')).username, 'Alicia');
    assert.equal(calls.getById, 2);
  });

  it('returns null for a soft-deleted id and does not cache null', async () => {
    const users = [{ id: 'gone', username: 'Gone', deletedAt: '2026-01-01' }];
    const { stores, calls } = countingStores({ users });
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    assert.equal(await cache.getUserById('gone'), null);
    assert.equal(await cache.getUserById('gone'), null);
    assert.equal(calls.getById, 2);
  });

  it('finds a new account at once after a miss', async () => {
    const users: any[] = [];
    const { stores } = countingStores({ users });
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    assert.equal(await cache.getUserById('new'), null);
    users.push({ id: 'new', username: 'Newbie' });
    assert.equal((await cache.getUserById('new')).username, 'Newbie');
  });

  it('never holds more than 5000 entries', async () => {
    const stores = makeStores();
    let getByIdCalls = 0;
    stores.users.getById = async (id: string) => { getByIdCalls++; return { id, username: id }; };
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    for (let i = 0; i < 5001; i++) await cache.getUserById(`id-${i}`);
    // id-5000 cleared the full map, so id-0 is a miss again; id-5000 is still cached.
    await cache.getUserById('id-5000');
    assert.equal(getByIdCalls, 5001);
    await cache.getUserById('id-0');
    assert.equal(getByIdCalls, 5002);
  });
});

// ─── Festival cache ──────────────────────────────────────────────────────────

describe('cache: festival cache', () => {
  it('getFestivalMap returns a Map keyed by festivalId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const map = await cache.getFestivalMap();
    assert.ok(map instanceof Map);
    assert.equal(map.size, 2);
    assert.equal(map.get('f1').name, 'Bonnaroo');
  });

  it('getFestivalById returns a festival by ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festival = await cache.getFestivalById('f2');
    assert.equal(festival.name, 'Coachella');
  });

  it('getFestivalById returns null for unknown ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festival = await cache.getFestivalById('unknown');
    assert.equal(festival, null);
  });

  it('invalidateFestivalCache causes next getFestivalMap to re-fetch', async () => {
    let fetchCount = 0;
    const stores = makeStores();
    const origReadAll = stores.festivals.readAll;
    stores.festivals.readAll = async () => { fetchCount++; return origReadAll(); };
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    await cache.getFestivalMap();
    assert.equal(fetchCount, 1);
    cache.invalidateFestivalCache();
    await cache.getFestivalMap();
    assert.equal(fetchCount, 2);
  });
});

// ─── cacheBus ────────────────────────────────────────────────────────────────

describe('cache: cacheBus', () => {
  it('cacheBus is null when redis is null', () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    assert.equal(cache.cacheBus, null);
  });
});

// ─── getUserFestivalProfile fallback path (no readByUserAndFestival) ────────

describe('cache: getUserFestivalProfile fallback', () => {
  it('falls back to scanning all profiles when store lacks readByUserAndFestival', async () => {
    const stores = makeStores();
    delete (stores.profiles as any).readByUserAndFestival;
    delete (stores.profiles as any).getById;
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f1');
    assert.equal(profile.id, 'p1');
  });
});
