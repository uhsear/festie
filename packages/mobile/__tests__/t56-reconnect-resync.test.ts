import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
};

describe('t56 mobile reconnect resync', () => {
  const src = read('hooks/useRealtimeSync.ts');

  it('a reconnect re-reads picks and crews inside handleConnect', () => {
    const body = between(src, 'const handleConnect = () => {', 'const handleDisconnect = () => {');
    expect(body).toContain('if (connectedBefore)');
    expect(body).toContain('reloadProfiles();');
    expect(body).toContain('reloadCrews();');
    expect(body).toContain('RECONNECT_FESTIVAL_RELOAD_GAP_MS');
  });

  it('a failed socket token refresh is logged, not swallowed', () => {
    const refresh = between(src, 'createSocket(userToken', 'socketRef.current = socket;');
    expect(refresh).toContain('refreshToken()');
    expect(refresh).not.toContain('.catch(() => {})');
    expect(refresh).toContain("console.warn('socket token refresh failed; realtime paused until the next request'");
  });
});
