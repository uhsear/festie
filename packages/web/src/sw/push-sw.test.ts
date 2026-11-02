import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (event: unknown) => void;

const source = readFileSync(resolve(__dirname, '../../public/push-sw.js'), 'utf8');

function setup(clients: Array<{ focus: () => Promise<void>; navigate?: (u: string) => Promise<void> }> = []) {
  const listeners: Record<string, Listener> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fakeSelf = {
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    registration: { showNotification },
    location: { origin: 'https://festie.us' },
    clients: { matchAll: vi.fn().mockResolvedValue(clients), openWindow },
  };
  runInNewContext(source, { self: fakeSelf, URL });
  return { listeners, showNotification, openWindow };
}

async function click(listeners: Record<string, Listener>, url: string | undefined) {
  const waits: Promise<unknown>[] = [];
  const close = vi.fn();
  listeners.notificationclick({
    notification: { close, data: { url } },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  return close;
}

describe('push-sw.js', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('shows a notification with title, body, tag and data.url', async () => {
    const waits: Promise<unknown>[] = [];
    ctx.listeners.push({
      data: { json: () => ({ title: 'Peggy Gou', body: 'Moved', tag: 't1', url: 'https://festie.us/set/s1' }) },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(ctx.showNotification).toHaveBeenCalledWith(
      'Peggy Gou',
      expect.objectContaining({ body: 'Moved', tag: 't1', data: { url: 'https://festie.us/set/s1' } }),
    );
  });

  it('falls back to a generic title when the payload is not JSON', async () => {
    const waits: Promise<unknown>[] = [];
    ctx.listeners.push({
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(ctx.showNotification.mock.calls[0][0]).toBe('Festie');
  });

  it('opens / for a cross-origin url', async () => {
    const close = await click(ctx.listeners, 'https://evil.example/x');
    expect(close).toHaveBeenCalled();
    expect(ctx.openWindow).toHaveBeenCalledWith('https://festie.us/');
  });

  it('focuses and navigates an open client', async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const c = setup([{ focus, navigate }]);
    await click(c.listeners, 'https://festie.us/set/s1');
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://festie.us/set/s1');
    expect(c.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when no client is open', async () => {
    await click(ctx.listeners, '/picks');
    expect(ctx.openWindow).toHaveBeenCalledWith('https://festie.us/picks');
  });
});
