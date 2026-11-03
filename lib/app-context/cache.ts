/**
 * Cache management — user/festival in-memory caches + invalidation bus.
 *
 * Extracted from `lib/app-context/index.js`. These functions close over
 * the version counters (`_userDataVersion`, `_festivalDataVersion`) and
 * the data-access stores. The cache invalidation bus (Redis pub/sub) is
 * also wired here because its callbacks mutate the same counters.
 *
 * Data-access helpers (`getFestivals`, `getProfiles`, `getUsers`,
 * `getProfileById`, `getUserFestivalProfile`) are included because they
 * are the building blocks of the cache population logic and the map
 * lookups that consume it.
 */

import { createCacheInvalidationBus } from '../redis';

const CACHE_TTL_MS = 60_000;
// MAX_USERS defaults to 2000; clearing at this cap bounds memory.
const MAX_USER_BY_ID_ENTRIES = 5000;

/**
 * Build cache helpers + data-access helpers bound to the supplied deps.
 */
export function createCacheHelpers({ stores, redis, log }: { stores: any; redis: any; log: any }) {
  // ── Version counters ───────────────────────────────────────────────
  let _userDataVersion = 0;
  let _festivalDataVersion = 0;

  // ── Cache invalidation bus ─────────────────────────────────────────
  let _festivalMapCache: Map<any, any> | null = null;

  const cacheBus = redis ? createCacheInvalidationBus(redis, {
    log,
    onInvalidateUsers() {
      _userDataVersion += 1;
      log.debug('cache-bus: user cache invalidated by peer worker');
    },
    onInvalidateFestivals() {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
      log.debug('cache-bus: festival cache invalidated by peer worker');
    },
  }) : null;

  // ── Data access helpers ────────────────────────────────────────────
  async function getFestivals() {
    return (await stores.festivals.readAll()) || [];
  }

  async function getProfiles() {
    return (await stores.profiles.readAll()) || [];
  }

  async function getUsers() {
    return (await stores.users.readAll()) || [];
  }

  async function getProfileById(id: any) {
    if (stores.profiles.getById) return stores.profiles.getById(id);
    const profiles = await getProfiles();
    return profiles.find((profile: any) => profile.id === id) || null;
  }

  async function getUserFestivalProfile(userId: any, festivalId: any) {
    if (!userId || !festivalId) return null;
    if (stores.profiles.readByUserAndFestival) {
      const row = await stores.profiles.readByUserAndFestival(userId, festivalId);
      if (!row) return null;
      return stores.profiles.getById(row.id);
    }
    const profiles = await getProfiles();
    return profiles.find((profile: any) => profile.userId === userId && profile.festivalId === festivalId) || null;
  }

  // ── User cache ─────────────────────────────────────────────────────
  let _userMapCache: Map<any, any> | null = null;
  let _userMapCacheVersion = 0;
  let _userMapCacheAt = 0;

  async function getUserMap() {
    if (_userMapCache && (Date.now() - _userMapCacheAt > CACHE_TTL_MS)) {
      _userDataVersion += 1;
    }
    if (_userMapCache && _userMapCacheVersion === _userDataVersion) return _userMapCache;
    const users = await getUsers();
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _userMapCache = new Map(users.map((user: any) => [user.id, user]));
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _userMapCacheVersion = _userDataVersion;
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _userMapCacheAt = Date.now();
    return _userMapCache;
  }

  // Per-id cache: a sign-in bumps the version on every worker, so a full
  // users.readAll() here would rescan the table after each sign-in.
  const _userById = new Map<any, any>();
  let _userByIdVersion = 0;
  let _userByIdAt = 0;

  async function getUserById(userId: any) {
    if (Date.now() - _userByIdAt > CACHE_TTL_MS || _userByIdVersion !== _userDataVersion) {
      _userById.clear();
      _userByIdVersion = _userDataVersion;
      _userByIdAt = Date.now();
    }
    const cached = _userById.get(userId);
    if (cached) return cached;
    const version = _userDataVersion;
    const user = await stores.users.getById(userId);
    // Null is not cached, so a new account is found at once. A read that
    // raced an invalidation is dropped, so it cannot pin a stale row.
    if (!user || version !== _userDataVersion) return user || null;
    if (_userById.size >= MAX_USER_BY_ID_ENTRIES) _userById.clear();
    _userById.set(userId, user);
    return user;
  }

  function invalidateUserCache() {
    _userDataVersion += 1;
    if (cacheBus) cacheBus.publishUserInvalidation();
  }

  // ── Festival cache ─────────────────────────────────────────────────
  let _festivalMapCacheVersion = 0;
  let _festivalMapCacheAt = 0;

  async function getFestivalMap() {
    if (_festivalMapCache && (Date.now() - _festivalMapCacheAt > CACHE_TTL_MS)) {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
    }
    if (_festivalMapCache && _festivalMapCacheVersion === _festivalDataVersion) return _festivalMapCache;
    const festivals = await getFestivals();
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _festivalMapCache = new Map(festivals.map((festival: any) => [festival.id, festival]));
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _festivalMapCacheVersion = _festivalDataVersion;
    // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
    _festivalMapCacheAt = Date.now();
    return _festivalMapCache;
  }

  async function getFestivalById(id: any) {
    const festivalMap = await getFestivalMap();
    return festivalMap.get(id) || null;
  }

  function invalidateFestivalCache() {
    _festivalDataVersion += 1;
    _festivalMapCache = null;
    if (cacheBus) cacheBus.publishFestivalInvalidation();
  }

  return {
    cacheBus,
    getUserMap,
    getUserById,
    invalidateUserCache,
    getFestivalMap,
    getFestivalById,
    invalidateFestivalCache,
    getFestivals,
    getProfiles,
    getUsers,
    getProfileById,
    getUserFestivalProfile,
  };
}
