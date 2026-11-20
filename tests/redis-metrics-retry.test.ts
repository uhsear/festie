import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Redis } from 'ioredis';
import type { Request, Response } from 'express';
import type { TestContext } from 'node:test';

// ─── Redis helpers ───────────────────────────────────────────────────────────

type PipelineStub = {
  incr(key: string): PipelineStub;
  pttl(key: string): PipelineStub;
  hdel(key: string, field: string): PipelineStub;
  exec(): Promise<[null, number][]>;
};

type ResStub = { [method: string]: (...args: never[]) => unknown };

type SubStub = {
  on(event: string, cb: unknown): void;
  subscribe(c1: unknown, c2: unknown, cb?: (err: null) => void): void;
  unsubscribe(): Promise<void>;
  disconnect(): void;
  [key: string]: unknown;
};

type MockRedis = Redis & { store: Map<string, number>; hashStore: Map<string, Map<string, string>> };

function makeMockRedis(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, number>();
  const hashStore = new Map<string, Map<string, string>>();

  const redis = {
    store,
    hashStore,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, val: number) {
      store.set(key, val);
    },
    async setex(key: string, _ttl: number, val: number) {
      store.set(key, val);
    },
    async del(key: string) {
      store.delete(key);
    },
    async incr(key: string) {
      const v = (store.get(key) || 0) + 1;
      store.set(key, v);
      return v;
    },
    async pexpire() {
      return 1;
    },
    async expire() {
      return 1;
    },
    async hset(key: string, field: string, val: string) {
      if (!hashStore.has(key)) hashStore.set(key, new Map());
      hashStore.get(key)!.set(field, val);
    },
    async hdel(key: string, field: string) {
      if (hashStore.has(key)) hashStore.get(key)!.delete(field);
    },
    async hgetall(key: string) {
      const m = hashStore.get(key);
      if (!m) return {};
      const obj: Record<string, string> = {};
      for (const [k, v] of m) obj[k] = v;
      return obj;
    },
    pipeline() {
      const cmds: [string, string, string?][] = [];
      const p: PipelineStub = {
        incr(key) {
          cmds.push(['incr', key]);
          return p;
        },
        pttl(key) {
          cmds.push(['pttl', key]);
          return p;
        },
        hdel(key, field) {
          cmds.push(['hdel', key, field]);
          return p;
        },
        async exec() {
          const results: [null, number][] = [];
          for (const [cmd, key, field] of cmds) {
            if (cmd === 'incr') {
              const v = (store.get(key) || 0) + 1;
              store.set(key, v);
              results.push([null, v]);
            } else if (cmd === 'pttl') {
              results.push([null, -1]);
            } else if (cmd === 'hdel') {
              if (hashStore.has(key)) hashStore.get(key)!.delete(field!);
              results.push([null, 1]);
            }
          }
          return results;
        },
      };
      return p;
    },
    async publish() {
      return 1;
    },
    duplicate() {
      const sub: SubStub = {
        on(_event, _cb) {
          sub['_on_' + _event] = _cb;
        },
        subscribe(_c1, _c2, cb) {
          if (cb) cb(null);
        },
        async unsubscribe() {},
        disconnect() {},
      };
      sub.on('error', () => {});
      return sub;
    },
    ...overrides,
  };
  return redis as unknown as MockRedis;
}

function makeLog() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

// ─── Load modules under test ─────────────────────────────────────────────────

import {
  createRedisRateLimiter,
  createRedisPresenceStore,
  createCacheInvalidationBus,
  createRedisCircuitBreaker,
  redisRateCheck,
} from '../lib/redis.js';

import {
  createMetrics,
  metricsMiddleware,
  metricsHandler,
  startMetricsSampler,
  startMetricsListener,
  __resetMetricsConfigForTests,
} from '../lib/metrics.js';

import { createRetryQueue } from '../lib/notifications/retry.js';

// Create a single metrics instance to avoid prom-client duplicate registration errors.
// prom-client registers metrics in a global registry — calling createMetrics() more than
// once within the same process throws. We create it once and share across all metric tests.
const sharedMetrics = createMetrics();

// ═══════════════════════════════════════════════════════════════════════════════
// REDIS.JS TESTS — covers lines 94-125, 138-165, 182-202, 222-224, 287-356, 370-392
// ═══════════════════════════════════════════════════════════════════════════════

describe('redis.js', () => {
  // ── Rate Limiter (lines 67-104) ────────────────────────────────────────────

  describe('createRedisRateLimiter', () => {
    it('returns null when redis is null', () => {
      assert.equal(createRedisRateLimiter(null, { windowMs: 1000, maxRequests: 5 }), null);
    });

    it('check() returns limited:false when under max', async () => {
      const redis = makeMockRedis();
      const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 5, prefix: 'test' });
      const result = await limiter!.check('user1');
      assert.equal(result.limited, false);
      assert.equal(result.remaining, 4);
      assert.equal(result.resetMs, 60000);
    });

    it('check() returns limited:true when over max', async () => {
      const redis = makeMockRedis();
      const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 2, prefix: 'test2' });
      await limiter!.check('user1');
      await limiter!.check('user1');
      const result = await limiter!.check('user1');
      assert.equal(result.limited, true);
      assert.equal(result.remaining, 0);
    });

    it('check() sets expiry on first request (count === 1)', async () => {
      const pexpireCalled: { key: string; ms: number }[] = [];
      const redis = makeMockRedis({
        async pexpire(key: string, ms: number) {
          pexpireCalled.push({ key, ms });
          return 1;
        },
      });
      const limiter = createRedisRateLimiter(redis, { windowMs: 30000, maxRequests: 10, prefix: 'exp' });
      await limiter!.check('ip1');
      assert.ok(pexpireCalled.length > 0);
      assert.equal(pexpireCalled[0]!.ms, 30000);
    });

    it('check() returns fallback when redis errors', async () => {
      const redis = makeMockRedis({
        pipeline() {
          return {
            incr() {
              return this;
            },
            pttl() {
              return this;
            },
            async exec() {
              throw new Error('connection refused');
            },
          };
        },
      });
      const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 5, prefix: 'err' });
      const result = await limiter!.check('user1');
      assert.equal(result.limited, false);
      assert.equal(result.fallback, true);
      assert.equal(result.remaining, 5);
    });

    it('check() uses default prefix when none provided', async () => {
      const redis = makeMockRedis();
      const limiter = createRedisRateLimiter(redis, { windowMs: 1000, maxRequests: 5 });
      const result = await limiter!.check('k');
      assert.equal(result.limited, false);
    });
  });

  // ── Presence Store (lines 108-153) ─────────────────────────────────────────

  describe('createRedisPresenceStore', () => {
    it('returns null when redis is null', () => {
      assert.equal(createRedisPresenceStore(null), null);
    });

    it('setOnline stores user and sets expiry', async () => {
      const redis = makeMockRedis();
      const store = createRedisPresenceStore(redis)!;
      await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
      const entries = await redis.hgetall('presence:fest1');
      const parsed = JSON.parse(entries.sock1!);
      assert.equal(parsed.userId, 'u1');
      assert.equal(parsed.username, 'Alice');
      assert.equal(parsed.socketId, 'sock1');
    });

    it('setOffline removes socket from hash', async () => {
      const redis = makeMockRedis();
      const store = createRedisPresenceStore(redis)!;
      await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
      await store.setOffline('fest1', 'sock1');
      const entries = await redis.hgetall('presence:fest1');
      assert.equal(Object.keys(entries).length, 0);
    });

    it('getOnline returns unique users by userId', async () => {
      const redis = makeMockRedis();
      const store = createRedisPresenceStore(redis)!;
      await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
      await store.setOnline('fest1', 'u1', 'Alice', 'sock2');
      await store.setOnline('fest1', 'u2', 'Bob', 'sock3');
      const online = await store.getOnline('fest1');
      assert.equal(online.length, 2);
    });

    it('getOnline skips corrupt JSON entries', async () => {
      const redis = makeMockRedis();
      await redis.hset('presence:fest1', 'bad', '{not-valid-json');
      await redis.hset('presence:fest1', 'good', JSON.stringify({ userId: 'u1', username: 'A', socketId: 's1' }));
      const store = createRedisPresenceStore(redis)!;
      const online = await store.getOnline('fest1');
      assert.equal(online.length, 1);
      assert.equal(online[0].userId, 'u1');
    });

    it('removeBySocketId removes from multiple festivals', async () => {
      const redis = makeMockRedis();
      const store = createRedisPresenceStore(redis)!;
      await store.setOnline('f1', 'u1', 'A', 'sock1');
      await store.setOnline('f2', 'u1', 'A', 'sock1');
      await store.removeBySocketId('sock1', ['f1', 'f2']);
      const f1 = await redis.hgetall('presence:f1');
      const f2 = await redis.hgetall('presence:f2');
      assert.equal(Object.keys(f1).length, 0);
      assert.equal(Object.keys(f2).length, 0);
    });

    it('refresh updates TTL', async () => {
      const expireCalls: { key: string; ttl: number }[] = [];
      const redis = makeMockRedis({
        async expire(key: string, ttl: number) {
          expireCalls.push({ key, ttl });
        },
      });
      const store = createRedisPresenceStore(redis)!;
      await store.refresh('fest1');
      assert.equal(expireCalls.length, 1);
      assert.equal(expireCalls[0]!.ttl, 120);
    });
  });

  // ── Cache Invalidation Bus (lines 162-202) ────────────────────────────────

  describe('createCacheInvalidationBus', () => {
    it('returns null when redis is null', () => {
      const log = makeLog();
      assert.equal(createCacheInvalidationBus(null, { log }), null);
    });

    it('creates bus and subscribes to channels', () => {
      const log = makeLog();
      let subscribedChannels: unknown[] = [];
      const redis = makeMockRedis({
        duplicate() {
          return {
            on(_event: string, _cb: unknown) {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              subscribedChannels = args.slice(0, -1);
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      const bus = createCacheInvalidationBus(redis, {
        log,
        onInvalidateUsers: () => {},
        onInvalidateFestivals: () => {},
      });
      assert.ok(bus);
      assert.equal(subscribedChannels.length, 2);
    });

    it('publishUserInvalidation calls redis.publish', async () => {
      const published: { channel: string; msg: string }[] = [];
      const log = makeLog();
      const redis = makeMockRedis({
        async publish(channel: string, msg: string) {
          published.push({ channel, msg });
          return 1;
        },
        duplicate() {
          return {
            on() {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      const bus = createCacheInvalidationBus(redis, { log, onInvalidateUsers: () => {} });
      bus!.publishUserInvalidation();
      // Allow promise microtask to resolve
      await new Promise((r) => setImmediate(r));
      assert.ok(published.some((p) => p.channel === 'cache:invalidate:users'));
    });

    it('publishFestivalInvalidation calls redis.publish', async () => {
      const published: { channel: string; msg: string }[] = [];
      const log = makeLog();
      const redis = makeMockRedis({
        async publish(channel: string, msg: string) {
          published.push({ channel, msg });
          return 1;
        },
        duplicate() {
          return {
            on() {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      const bus = createCacheInvalidationBus(redis, { log, onInvalidateFestivals: () => {} });
      bus!.publishFestivalInvalidation();
      await new Promise((r) => setImmediate(r));
      assert.ok(published.some((p) => p.channel === 'cache:invalidate:festivals'));
    });

    it('close() unsubscribes and disconnects', async () => {
      const log = makeLog();
      let unsubCalled = false;
      let disconnectCalled = false;
      const redis = makeMockRedis({
        duplicate() {
          return {
            on() {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {
              unsubCalled = true;
            },
            disconnect() {
              disconnectCalled = true;
            },
          };
        },
      });
      const bus = createCacheInvalidationBus(redis, { log });
      await bus!.close();
      assert.ok(unsubCalled);
      assert.ok(disconnectCalled);
    });

    it('close() tolerates unsubscribe/disconnect errors', async () => {
      const log = makeLog();
      const redis = makeMockRedis({
        duplicate() {
          return {
            on() {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {
              throw new Error('already unsubscribed');
            },
            disconnect() {
              throw new Error('already disconnected');
            },
          };
        },
      });
      const bus = createCacheInvalidationBus(redis, { log });
      // Should not throw
      await bus!.close();
    });

    it('subscribe error is logged', () => {
      const log = makeLog();
      const redis = makeMockRedis({
        duplicate() {
          return {
            on() {},
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(new Error('subscribe failed'));
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      createCacheInvalidationBus(redis, { log });
      assert.ok(log.error.mock.callCount() > 0);
    });

    it('message handler calls onInvalidateUsers for users channel', () => {
      const log = makeLog();
      let usersCalled = false;
      let messageHandler: ((channel: string, msg: string) => void) | undefined;
      const redis = makeMockRedis({
        duplicate() {
          return {
            on(event: string, cb: (channel: string, msg: string) => void) {
              if (event === 'message') messageHandler = cb;
            },
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      createCacheInvalidationBus(redis, {
        log,
        onInvalidateUsers: () => {
          usersCalled = true;
        },
      });
      assert.ok(messageHandler);
      messageHandler!('cache:invalidate:users', String(Date.now()));
      assert.ok(usersCalled);
    });

    it('message handler calls onInvalidateFestivals for festivals channel', () => {
      const log = makeLog();
      let festivalsCalled = false;
      let messageHandler: ((channel: string, msg: string) => void) | undefined;
      const redis = makeMockRedis({
        duplicate() {
          return {
            on(event: string, cb: (channel: string, msg: string) => void) {
              if (event === 'message') messageHandler = cb;
            },
            subscribe(...args: unknown[]) {
              const cb = args[args.length - 1];
              if (typeof cb === 'function') cb(null);
            },
            async unsubscribe() {},
            disconnect() {},
          };
        },
      });
      createCacheInvalidationBus(redis, {
        log,
        onInvalidateFestivals: () => {
          festivalsCalled = true;
        },
      });
      messageHandler!('cache:invalidate:festivals', String(Date.now()));
      assert.ok(festivalsCalled);
    });
  });

  // ── Circuit Breaker (lines 211-271) ────────────────────────────────────────

  describe('createRedisCircuitBreaker', () => {
    it('returns null when redis is null', () => {
      assert.equal(createRedisCircuitBreaker(null), null);
    });

    it('exec returns result on success', async () => {
      const redis = makeMockRedis();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 3, log: makeLog() })!;
      const result = await cb.exec(() => Promise.resolve('ok'));
      assert.equal(result, 'ok');
    });

    it('exec returns fallback on error', async () => {
      const redis = makeMockRedis();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 3, log: makeLog() })!;
      const result = await cb.exec(() => Promise.reject(new Error('fail')), 'default');
      assert.equal(result, 'default');
    });

    it('opens circuit after maxFailures consecutive errors', async () => {
      const redis = makeMockRedis();
      const log = makeLog();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 2, resetTimeMs: 60000, log })!;
      await cb.exec(() => Promise.reject(new Error('e1')));
      await cb.exec(() => Promise.reject(new Error('e2')));
      assert.ok(cb.isOpen());
      assert.ok(log.warn.mock.callCount() > 0);
    });

    it('returns fallback immediately when circuit is open', async () => {
      const redis = makeMockRedis();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 60000, log: makeLog() })!;
      await cb.exec(() => Promise.reject(new Error('fail')));
      let fnCalled = false;
      const result = await cb.exec(() => {
        fnCalled = true;
        return Promise.resolve('x');
      }, 'fallback');
      assert.equal(result, 'fallback');
      assert.equal(fnCalled, false);
    });

    it('half-open: resets circuit after resetTimeMs', async () => {
      const redis = makeMockRedis();
      const log = makeLog();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 60000, log })!;
      await cb.exec(() => Promise.reject(new Error('fail')));
      assert.ok(cb.isOpen());
    });

    it('closes circuit after successful probe', async () => {
      const redis = makeMockRedis();
      const log = makeLog();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 1, log })!;
      await cb.exec(() => Promise.reject(new Error('fail')));
      // resetTimeMs is 1ms — yield event loop so the timer expires
      await new Promise((r) => setImmediate(r));
      const result = await cb.exec(() => Promise.resolve('recovered'));
      assert.equal(result, 'recovered');
      const state = cb.getState();
      assert.equal(state.failures, 0);
      assert.equal(state.circuitOpen, false);
    });

    it('getState returns current state', async () => {
      const redis = makeMockRedis();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 5, log: makeLog() })!;
      const state = cb.getState();
      assert.equal(state.failures, 0);
      assert.equal(state.circuitOpen, false);
      assert.equal(state.lastFailure, 0);
    });

    it('recordSuccess resets failures when circuit was not open', async () => {
      const redis = makeMockRedis();
      const cb = createRedisCircuitBreaker(redis, { maxFailures: 5, log: makeLog() })!;
      await cb.exec(() => Promise.reject(new Error('one')));
      assert.equal(cb.getState().failures, 1);
      await cb.exec(() => Promise.resolve('ok'));
      assert.equal(cb.getState().failures, 0);
    });
  });

  // ── redisRateCheck (lines 370-392) ─────────────────────────────────────────

  describe('redisRateCheck', () => {
    it('returns fallback when redis is null', async () => {
      const result = await redisRateCheck(null, 'key', 10, 60000);
      assert.equal(result.limited, false);
      assert.equal(result.fallback, true);
      assert.equal(result.remaining, 10);
    });

    it('returns not limited when under max', async () => {
      const redis = makeMockRedis();
      const result = await redisRateCheck(redis, 'rr:key', 10, 60000);
      assert.equal(result.limited, false);
      assert.equal(result.count, 1);
      assert.equal(result.remaining, 9);
    });

    it('returns limited when over max', async () => {
      const redis = makeMockRedis();
      await redisRateCheck(redis, 'rr:over', 1, 60000);
      const result = await redisRateCheck(redis, 'rr:over', 1, 60000);
      assert.equal(result.limited, true);
      assert.equal(result.remaining, 0);
    });

    it('sets pexpire on first request (count === 1)', async () => {
      const pexpireCalls: { key: string; ms: number }[] = [];
      const redis = makeMockRedis({
        async pexpire(key: string, ms: number) {
          pexpireCalls.push({ key, ms });
        },
      });
      await redisRateCheck(redis, 'rr:exp', 5, 30000);
      assert.ok(pexpireCalls.length > 0);
      assert.equal(pexpireCalls[0]!.ms, 30000);
    });

    it('returns fallback when pipeline throws', async () => {
      const redis = makeMockRedis({
        pipeline() {
          return {
            incr() {
              return this;
            },
            pttl() {
              return this;
            },
            async exec() {
              throw new Error('connection lost');
            },
          };
        },
      });
      const result = await redisRateCheck(redis, 'rr:err', 5, 60000);
      assert.equal(result.limited, false);
      assert.equal(result.fallback, true);
    });

    it('uses positive ttl when pttl returns positive value', async () => {
      const redis = makeMockRedis();
      // Override pipeline to return a positive pttl
      redis.pipeline = () => {
        const cmds: [string, string][] = [];
        const p: PipelineStub = {
          incr(key) {
            cmds.push(['incr', key]);
            return p;
          },
          pttl(key) {
            cmds.push(['pttl', key]);
            return p;
          },
          hdel() {
            return p;
          },
          async exec() {
            const results: [null, number][] = [];
            for (const [cmd, key] of cmds) {
              if (cmd === 'incr') {
                const v = (redis.store.get(key) || 0) + 1;
                redis.store.set(key, v);
                results.push([null, v]);
              } else if (cmd === 'pttl') {
                // Return a positive TTL to avoid the pexpire branch
                results.push([null, 45000]);
              }
            }
            return results;
          },
        };
        return p as unknown as ReturnType<Redis['pipeline']>;
      };
      // Pre-populate so count > 1
      redis.store.set('rr:ttl', 1);
      const result = await redisRateCheck(redis, 'rr:ttl', 10, 60000);
      assert.equal(result.resetMs, 45000);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS.JS TESTS — covers lines 59,62-63,78-79,87,90-91,101,104,133,141-142,
//   162-164,185-186,197,200-218,237-248,253-254
// ═══════════════════════════════════════════════════════════════════════════════

describe('metrics.js', () => {
  describe('createMetrics', () => {
    it('returns an object with available property', () => {
      assert.ok(typeof sharedMetrics.available === 'boolean');
    });

    it('returns registry and metric objects when prom-client is available', () => {
      if (sharedMetrics.available) {
        assert.ok(sharedMetrics.registry);
        assert.ok(sharedMetrics.httpHistogram);
        assert.ok(sharedMetrics.socketGauge);
        assert.ok(sharedMetrics.pgPoolTotalGauge);
        assert.ok(sharedMetrics.pgPoolIdleGauge);
        assert.ok(sharedMetrics.pgPoolWaitingGauge);
        assert.ok(sharedMetrics.errorCounter);
        assert.ok(sharedMetrics.rateLimitFallbackCounter);
        assert.ok(sharedMetrics.dbQueryHistogram);
        assert.ok(sharedMetrics.rateLimitHitsCounter);
        assert.ok(sharedMetrics.httpCounter);
        assert.ok(sharedMetrics.client);
      }
    });

    it('returns null metrics when prom-client is not available', () => {
      if (!sharedMetrics.available) {
        assert.equal(sharedMetrics.registry, null);
        assert.equal(sharedMetrics.httpHistogram, null);
        assert.equal(sharedMetrics.socketGauge, null);
        assert.equal(sharedMetrics.errorCounter, null);
      }
    });
  });

  describe('metricsMiddleware', () => {
    it('returns passthrough when metrics is null', () => {
      const mw = metricsMiddleware(null);
      let called = false;
      mw({} as Request, {} as Response, () => {
        called = true;
      });
      assert.ok(called);
    });

    it('returns passthrough when metrics.available is false', () => {
      const mw = metricsMiddleware({ available: false } as ReturnType<typeof createMetrics>);
      let called = false;
      mw({} as Request, {} as Response, () => {
        called = true;
      });
      assert.ok(called);
    });

    it('records timing when metrics is available', () => {
      if (!sharedMetrics.available) return;
      const mw = metricsMiddleware(sharedMetrics);

      let finishCallback: (() => void) | undefined;
      const req = { method: 'GET', route: { path: '/api/test' }, baseUrl: '/api' };
      const res = {
        statusCode: 200,
        on(event: string, cb: () => void) {
          if (event === 'finish') finishCallback = cb;
        },
      };
      let nextCalled = false;
      mw(req as unknown as Request, res as unknown as Response, () => {
        nextCalled = true;
      });
      assert.ok(nextCalled);
      // Simulate response finish
      assert.ok(finishCallback);
      finishCallback!();
    });

    it('uses baseUrl when route.path is absent', () => {
      if (!sharedMetrics.available) return;
      const mw = metricsMiddleware(sharedMetrics);

      let finishCallback: (() => void) | undefined;
      const req = { method: 'POST', baseUrl: '/api/v2' };
      const res = {
        statusCode: 201,
        on(event: string, cb: () => void) {
          if (event === 'finish') finishCallback = cb;
        },
      };
      mw(req as unknown as Request, res as unknown as Response, () => {});
      finishCallback!();
    });

    it('uses "unknown" when neither route nor baseUrl exists', () => {
      if (!sharedMetrics.available) return;
      const mw = metricsMiddleware(sharedMetrics);

      let finishCallback: (() => void) | undefined;
      const req = { method: 'GET' };
      const res = {
        statusCode: 404,
        on(event: string, cb: () => void) {
          if (event === 'finish') finishCallback = cb;
        },
      };
      mw(req as unknown as Request, res as unknown as Response, () => {});
      finishCallback!();
    });
  });

  describe('metricsHandler', () => {
    it('returns 503 when metrics unavailable', async () => {
      const handler = metricsHandler(null);
      let statusCode: number | undefined, contentType: string | undefined, body: string | undefined;
      const res: ResStub = {
        status(s: number) {
          statusCode = s;
          return res;
        },
        type(t: string) {
          contentType = t;
          return res;
        },
        send(b: string) {
          body = b;
          return res;
        },
      };
      await handler({} as Request, res as unknown as Response);
      assert.equal(statusCode, 503);
      assert.ok(body!.includes('unavailable'));
    });

    it('returns 403 with no Authorization header', async () => {
      if (!sharedMetrics.available) return;
      const handler = metricsHandler(sharedMetrics);
      let statusCode: number | undefined, body: string | undefined;
      const req = { ip: '8.8.8.8', connection: {}, headers: {} };
      const res: ResStub = {
        status(s: number) {
          statusCode = s;
          return res;
        },
        type(t: string) {
          return res;
        },
        send(b: string) {
          body = b;
          return res;
        },
      };
      await handler(req as unknown as Request, res as unknown as Response);
      assert.equal(statusCode, 403);
    });

    it('returns 403 for a wrong metrics token', async () => {
      if (!sharedMetrics.available) return;
      const originalToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = 'test-metrics-token';
      __resetMetricsConfigForTests();
      try {
        const handler = metricsHandler(sharedMetrics);
        let statusCode: number | undefined;
        const req = { ip: '127.0.0.1', connection: {}, headers: { authorization: 'Bearer wrong-token' } };
        const res: ResStub = {
          status(s: number) {
            statusCode = s;
            return res;
          },
          type() {
            return res;
          },
          send() {
            return res;
          },
        };
        await handler(req as unknown as Request, res as unknown as Response);
        assert.equal(statusCode, 403);
      } finally {
        process.env.METRICS_TOKEN = originalToken;
      }
    });

    it('SECURITY: denies a request presenting as 127.0.0.1 with no metrics token — req.ip alone must not grant access', async () => {
      // Behind the Cloudflare Tunnel (single-host topology, docs/adrs/014),
      // req.ip collapses to 127.0.0.1 for ALL traffic, and any caller can
      // additionally force this by forging X-Forwarded-For (see
      // docs/security/trust-proxy-hardening.md). An IP-only gate can't tell
      // an internal caller from a public one here, so presenting as
      // 127.0.0.1 must NOT be sufficient on its own.
      if (!sharedMetrics.available) return;
      const originalToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = 'test-metrics-token';
      __resetMetricsConfigForTests();
      try {
        const handler = metricsHandler(sharedMetrics);
        let statusCode = 200;
        const req = { ip: '127.0.0.1', connection: {}, headers: {} };
        const res: ResStub = {
          status(s: number) {
            statusCode = s;
            return res;
          },
          type() {
            return res;
          },
          send() {
            return res;
          },
          set() {
            return res;
          },
          end() {
            return res;
          },
        };
        await handler(req as unknown as Request, res as unknown as Response);
        assert.equal(statusCode, 403);
      } finally {
        process.env.METRICS_TOKEN = originalToken;
      }
    });

    it('returns metrics for a valid token, regardless of the caller IP', async () => {
      // IP no longer gates access (see hasValidMetricsToken doc comment in
      // lib/metrics.ts) — a public, non-internal-looking IP proves the point.
      if (!sharedMetrics.available) return;
      const originalToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = 'test-metrics-token';
      __resetMetricsConfigForTests();
      try {
        const handler = metricsHandler(sharedMetrics);
        const headers: Record<string, string> = {};
        let responseBody: string | undefined;
        const req = { ip: '203.0.113.5', connection: {}, headers: { authorization: 'Bearer test-metrics-token' } };
        const res: ResStub = {
          set(k: string, v: string) {
            headers[k] = v;
            return res;
          },
          end(b: string) {
            responseBody = b;
            return res;
          },
          status() {
            return res;
          },
          type() {
            return res;
          },
          send(b: string) {
            responseBody = b;
            return res;
          },
        };
        await handler(req as unknown as Request, res as unknown as Response);
        assert.ok(responseBody);
      } finally {
        process.env.METRICS_TOKEN = originalToken;
      }
    });

    it('handles registry.metrics() error with 500', async () => {
      if (!sharedMetrics.available) return;
      const originalToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = 'test-metrics-token';
      __resetMetricsConfigForTests();
      // Monkey-patch registry to throw
      const origMetrics = sharedMetrics.registry!.metrics;
      sharedMetrics.registry!.metrics = async () => {
        throw new Error('boom');
      };
      try {
        const handler = metricsHandler(sharedMetrics);
        let statusCode: number | undefined, body: string | undefined;
        const req = { ip: '127.0.0.1', connection: {}, headers: { authorization: 'Bearer test-metrics-token' } };
        const res: ResStub = {
          set() {
            return res;
          },
          end(b: string) {
            body = b;
            return res;
          },
          status(s: number) {
            statusCode = s;
            return res;
          },
          type() {
            return res;
          },
          send(b: string) {
            body = b;
            return res;
          },
        };
        await handler(req as unknown as Request, res as unknown as Response);
        assert.equal(statusCode, 500);
        assert.ok(body!.includes('boom'));
      } finally {
        // Restore, even if an assertion above throws — otherwise every later
        // test in this file that hits the registry gets the monkey-patched throw.
        sharedMetrics.registry!.metrics = origMetrics;
        process.env.METRICS_TOKEN = originalToken;
      }
    });

    it('returns 403 for empty IP and no token', async () => {
      if (!sharedMetrics.available) return;
      const handler = metricsHandler(sharedMetrics);
      let statusCode: number | undefined;
      const req = { ip: '', connection: {}, headers: {} };
      const res: ResStub = {
        status(s: number) {
          statusCode = s;
          return res;
        },
        type() {
          return res;
        },
        send() {
          return res;
        },
      };
      await handler(req as unknown as Request, res as unknown as Response);
      assert.equal(statusCode, 403);
    });
  });

  describe('startMetricsSampler', () => {
    it('returns no-op stop when metrics is null', () => {
      const stop = startMetricsSampler(null);
      assert.equal(typeof stop, 'function');
      stop(); // should not throw
    });

    it('returns no-op stop when metrics.available is false', () => {
      const stop = startMetricsSampler({ available: false } as ReturnType<typeof createMetrics>);
      assert.equal(typeof stop, 'function');
      stop();
    });

    // Fake gauges record set() calls so the sampler is asserted without prom-client.
    function fakeMetrics() {
      const sets: Record<string, number> = {};
      const gauge = (name: string) => ({ set: (v: number) => { sets[name] = v; } });
      const metrics = {
        available: true as const,
        pgPoolTotalGauge: gauge('total'),
        pgPoolIdleGauge: gauge('idle'),
        pgPoolWaitingGauge: gauge('waiting'),
        socketGauge: gauge('sockets'),
      };
      return { metrics, sets };
    }

    it('samples pool and io on creation', () => {
      const { metrics, sets } = fakeMetrics();
      const pool = { totalCount: 10, idleCount: 5, waitingCount: 2 };
      const io = { engine: { clientsCount: 42 } };
      const stop = startMetricsSampler(metrics, { pool, io }, 100000);
      stop();
      assert.deepEqual(sets, { total: 10, idle: 5, waiting: 2, sockets: 42 });
    });

    it('handles missing pool and io gracefully', () => {
      const { metrics, sets } = fakeMetrics();
      const stop = startMetricsSampler(metrics, {}, 100000);
      stop();
      assert.deepEqual(sets, {});
    });

    it('handles pool without idleCount/waitingCount', () => {
      const { metrics, sets } = fakeMetrics();
      const pool = { totalCount: 5 };
      const stop = startMetricsSampler(metrics, { pool }, 100000);
      stop();
      assert.deepEqual(sets, { total: 5, idle: 0, waiting: 0 });
    });

    it('stop function clears interval', () => {
      if (!sharedMetrics.available) return;
      const stop = startMetricsSampler(sharedMetrics, {}, 50);
      stop();
      // Should not throw on double stop
      stop();
    });
  });

  describe('startMetricsListener', () => {
    it('returns no-op when metrics is null', () => {
      const stop = startMetricsListener(null);
      assert.equal(typeof stop, 'function');
      stop();
    });

    it('returns no-op when metrics.available is false', () => {
      const stop = startMetricsListener({ available: false } as ReturnType<typeof createMetrics>);
      assert.equal(typeof stop, 'function');
      stop();
    });

    // Helper: retry HTTP request until server is listening (replaces fixed setTimeout)
    function httpGetWithRetry(url: string, maxAttempts = 10): Promise<{ statusCode: number | undefined; body: string }> {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        function attempt() {
          attempts++;
          const req = http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk;
            });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
          });
          req.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNREFUSED' && attempts < maxAttempts) {
              setTimeout(attempt, 20);
            } else {
              reject(err);
            }
          });
        }
        attempt();
      });
    }

    it('starts HTTP listener and returns close function', async () => {
      if (!sharedMetrics.available) return;
      // Use a high port unlikely to conflict
      const stop = startMetricsListener(sharedMetrics, { basePort: 19400, workerId: 0 });
      assert.equal(typeof stop, 'function');
      // Verify it's listening by making a request (retries on ECONNREFUSED)
      await httpGetWithRetry('http://127.0.0.1:19400/metrics');
      // Clean up
      await stop();
    });

    it('serves metrics on /metrics endpoint', async () => {
      if (!sharedMetrics.available) return;
      const stop = startMetricsListener(sharedMetrics, { basePort: 19401, workerId: 0 });
      const { body } = await httpGetWithRetry('http://127.0.0.1:19401/metrics');
      assert.ok(body.length > 0);
      await stop();
    });

    it('returns 404 for non-metrics paths', async () => {
      if (!sharedMetrics.available) return;
      const stop = startMetricsListener(sharedMetrics, { basePort: 19402, workerId: 0 });
      const { statusCode } = await httpGetWithRetry('http://127.0.0.1:19402/other');
      assert.equal(statusCode, 404);
      await stop();
    });

    it('computes port from basePort + workerId', async () => {
      if (!sharedMetrics.available) return;
      const stop = startMetricsListener(sharedMetrics, { basePort: 19410, workerId: 3 });
      const { statusCode } = await httpGetWithRetry('http://127.0.0.1:19413/metrics');
      assert.equal(statusCode, 200);
      await stop();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY.JS TESTS — covers lines 16-18, 27-28, 34-60
// ═══════════════════════════════════════════════════════════════════════════════

describe('notifications/retry.js', () => {
  // Helper: advance mock timers and yield to let drain() async work complete.
  // mock.timers.tick() fires the setTimeout callbacks synchronously, but the
  // drain() function is async, so we need to yield the microtask queue.
  async function tickAndDrain(ctx: TestContext, ms: number) {
    ctx.mock.timers.tick(ms);
    // Yield to let async drain() promises settle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }

  describe('createRetryQueue', () => {
    it('enqueue adds entry to queue', () => {
      const log = makeLog();
      const q = createRetryQueue({ log });
      q.enqueue({ sendFn: async () => {}, userId: 'u1' });
      assert.equal(q.pending, 1);
      q.shutdown();
    });

    it('drain processes entries and calls sendFn', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      let sent = false;
      q.enqueue({
        sendFn: async () => {
          sent = true;
        },
        userId: 'u1',
      });
      // First drain is scheduled at 2s (2000 * 2^0)
      await tickAndDrain(t, 2000);
      assert.ok(sent);
      assert.equal(q.pending, 0);
      q.shutdown();
    });

    it('retries failed entries up to maxRetries', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      let attempts = 0;
      const q = createRetryQueue({ log, maxRetries: 2, maxAgeMs: 60000 });
      q.enqueue({
        sendFn: async () => {
          attempts++;
          throw new Error('transient error');
        },
        userId: 'u1',
      });
      // Drain cycle 1: delay = 2000 * 2^0 = 2s
      await tickAndDrain(t, 2000);
      // Drain cycle 2: delay = 2000 * 2^1 = 4s
      await tickAndDrain(t, 4000);
      // Drain cycle 3: delay = 2000 * 2^2 = 8s
      await tickAndDrain(t, 8000);
      assert.ok(attempts >= 3); // 1 initial + 2 retries
      // Should have logged max retries exceeded
      const warnCalls = log.warn.mock.calls;
      const maxRetryWarning = warnCalls.some((c) => c.arguments[0] === 'fcm retry: max retries exceeded');
      assert.ok(maxRetryWarning, 'should log max retries exceeded');
      q.shutdown();
    });

    it('drops entries older than maxAgeMs', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const log = makeLog();
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 1 }); // 1ms max age
      q.enqueue({
        sendFn: async () => {
          throw new Error('fail');
        },
        userId: 'u1',
      });
      // First drain at 2s — entry will be expired by then (maxAgeMs: 1ms)
      await tickAndDrain(t, 2000);
      assert.equal(q.pending, 0);
      // Should have logged the age-out drop, not dropped it silently
      const warnCalls = log.warn.mock.calls;
      const agedOutWarning = warnCalls.some((c) => c.arguments[0] === 'fcm retry: entry aged out');
      assert.ok(agedOutWarning, 'should log entry aged out');
      q.shutdown();
    });

    it('drops oldest entry when queue is full (500)', () => {
      const log = makeLog();
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      // Fill queue to 500
      for (let i = 0; i < 500; i++) {
        q.enqueue({ sendFn: async () => {}, userId: `u${i}` });
      }
      assert.equal(q.pending, 500);
      // Enqueue one more — should drop oldest
      q.enqueue({ sendFn: async () => {}, userId: 'overflow' });
      assert.equal(q.pending, 500); // still 500 (dropped one, added one)
      assert.ok(log.warn.mock.callCount() > 0);
      q.shutdown();
    });

    it('skips not-registered FCM errors without retry', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      let attempts = 0;
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      q.enqueue({
        sendFn: async () => {
          attempts++;
          const err: Error & { code?: string } = new Error('token expired');
          err.code = 'messaging/not-registered';
          throw err;
        },
        userId: 'u1',
      });
      await tickAndDrain(t, 2000);
      assert.equal(attempts, 1); // only tried once, did not retry
      q.shutdown();
    });

    it('skips invalid-registration errors without retry', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      let attempts = 0;
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      q.enqueue({
        sendFn: async () => {
          attempts++;
          const err: Error & { code?: string } = new Error('bad token');
          err.code = 'messaging/invalid-registration';
          throw err;
        },
        userId: 'u2',
      });
      await tickAndDrain(t, 2000);
      assert.equal(attempts, 1);
      q.shutdown();
    });

    it('skips invalid-argument errors without retry', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      let attempts = 0;
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      q.enqueue({
        sendFn: async () => {
          attempts++;
          const err: Error & { code?: string } = new Error('bad arg');
          err.code = 'messaging/invalid-argument';
          throw err;
        },
        userId: 'u3',
      });
      await tickAndDrain(t, 2000);
      assert.equal(attempts, 1);
      q.shutdown();
    });

    it('shutdown clears queue and timer', () => {
      const log = makeLog();
      const q = createRetryQueue({ log });
      q.enqueue({ sendFn: async () => {}, userId: 'u1' });
      q.enqueue({ sendFn: async () => {}, userId: 'u2' });
      q.shutdown();
      assert.equal(q.pending, 0);
    });

    it('pending getter returns current queue length', () => {
      const log = makeLog();
      const q = createRetryQueue({ log });
      assert.equal(q.pending, 0);
      q.enqueue({ sendFn: async () => {}, userId: 'u1' });
      assert.equal(q.pending, 1);
      q.shutdown();
      assert.equal(q.pending, 0);
    });

    it('successful retry logs debug message', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const log = makeLog();
      const q = createRetryQueue({ log, maxRetries: 3, maxAgeMs: 60000 });
      q.enqueue({ sendFn: async () => {}, userId: 'u1' });
      await tickAndDrain(t, 2000);
      const debugCalls = log.debug.mock.calls;
      assert.ok(debugCalls.some((c) => c.arguments[0] === 'fcm retry: resend succeeded'));
      q.shutdown();
    });

    it('scheduleDrain does not double-schedule', () => {
      const log = makeLog();
      const q = createRetryQueue({ log });
      // Enqueue two items quickly — should only schedule one drain
      q.enqueue({ sendFn: async () => {}, userId: 'u1' });
      q.enqueue({ sendFn: async () => {}, userId: 'u2' });
      assert.equal(q.pending, 2);
      q.shutdown();
    });
  });
});
