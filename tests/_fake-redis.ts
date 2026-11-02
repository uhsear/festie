/**
 * In-memory stand-in for the ioredis commands the check-in timer, the crew
 * nudge limit and the battery-low line use: strings (get / set with PX and NX /
 * del / pttl), sorted sets (zadd / zrem / zrangebyscore with LIMIT), hashes
 * (hget / hset / hgetall / hexists / pexpire) and multi().exec(). TTLs are
 * recorded, not enforced: a key never expires, and pttl returns the recorded
 * TTL (-1 when none was set, -2 when the key is missing).
 */
export function makeFakeRedis() {
  const strings = new Map<string, string>();
  const ttls = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();

  const api: any = {
    strings,
    ttls,
    zsets,
    hashes,
    async get(key: string) {
      return strings.get(key) ?? null;
    },
    async set(key: string, value: string, mode?: string, ms?: number, flag?: string) {
      if (flag === 'NX' && strings.has(key)) return null;
      strings.set(key, value);
      if (mode === 'PX' && typeof ms === 'number') ttls.set(key, ms);
      return 'OK';
    },
    async pttl(key: string) {
      if (!strings.has(key) && !hashes.has(key) && !zsets.has(key)) return -2;
      return ttls.get(key) ?? -1;
    },
    async del(key: string) {
      const had = strings.delete(key) || hashes.delete(key) || zsets.delete(key);
      ttls.delete(key);
      return had ? 1 : 0;
    },
    async zadd(key: string, score: number, member: string) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      const isNew = !zsets.get(key)!.has(member);
      zsets.get(key)!.set(member, score);
      return isNew ? 1 : 0;
    },
    async zrem(key: string, member: string) {
      return zsets.get(key)?.delete(member) ? 1 : 0;
    },
    async zrangebyscore(key: string, min: string | number, max: string | number, ...rest: Array<string | number>) {
      const lo = min === '-inf' ? -Infinity : Number(min);
      const hi = max === '+inf' ? Infinity : Number(max);
      let out = [...(zsets.get(key) ?? new Map<string, number>())]
        .filter(([, s]) => s >= lo && s <= hi)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      if (rest[0] === 'LIMIT') out = out.slice(Number(rest[1]), Number(rest[1]) + Number(rest[2]));
      return out;
    },
    async hget(key: string, field: string) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hset(key: string, field: string, value: string) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, value);
      return 1;
    },
    async hgetall(key: string) {
      return Object.fromEntries(hashes.get(key) ?? []);
    },
    async hexists(key: string, field: string) {
      return hashes.get(key)?.has(field) ? 1 : 0;
    },
    async pexpire(key: string, ms: number) {
      ttls.set(key, ms);
      return 1;
    },
    multi() {
      const ops: Array<() => Promise<unknown>> = [];
      const chain: any = new Proxy(
        {},
        {
          get(_t, name: string) {
            if (name === 'exec') {
              return async () => {
                const out: Array<[null, unknown]> = [];
                for (const op of ops) out.push([null, await op()]);
                return out;
              };
            }
            return (...args: unknown[]) => {
              ops.push(() => api[name](...args));
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return api;
}
