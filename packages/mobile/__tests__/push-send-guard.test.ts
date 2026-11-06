import { describe, it, expect, vi } from 'vitest';
import { createSendGuard, isRateLimited } from '../lib/pushSendGuard';

const rateLimit = () => Object.assign(new Error('Too many'), { status: 429 });

describe('createSendGuard', () => {
  it('shares one request between concurrent identical calls', async () => {
    const guard = createSendGuard();
    const send = vi.fn(() => new Promise<void>((r) => setTimeout(r, 5)));
    await Promise.all(Array.from({ length: 10 }, () => guard.run('a', send)));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips an unchanged payload after success but sends a changed one', async () => {
    const guard = createSendGuard();
    const send = vi.fn(async () => {});
    await guard.run('a', send);
    await guard.run('a', send);
    await guard.run('b', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries a non-429 failure on the next call', async () => {
    const guard = createSendGuard();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(guard.run('a', send)).rejects.toThrow('offline');
    await guard.run('a', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('backs off for 60 s after a 429', async () => {
    let t = 1000;
    const guard = createSendGuard(() => t);
    const send = vi.fn().mockRejectedValueOnce(rateLimit()).mockResolvedValue(undefined);
    await expect(guard.run('a', send)).rejects.toSatisfy(isRateLimited);
    await guard.run('a', send);
    t += 59_000;
    await guard.run('b', send);
    expect(send).toHaveBeenCalledTimes(1);
    t += 1_001;
    await guard.run('a', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reset forgets the last payload', async () => {
    const guard = createSendGuard();
    const send = vi.fn(async () => {});
    await guard.run('a', send);
    guard.reset();
    await guard.run('a', send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
