import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'hooks/useRealtimeSync.ts'), 'utf8');

describe('T58 mobile realtime sync', () => {
  it('does not subscribe to onlineUsers, so the tab layout skips presence re-renders', () => {
    expect(src).not.toContain('s.onlineUsers');
    expect(src).toContain('return { connected };');
  });

  it('festival:updated reloads only for the current festival id', () => {
    const handler = src.slice(src.indexOf('const handleFestivalUpdated'), src.indexOf('const handleSetAdded'));
    expect(handler).toContain('data?.id ===');
    expect(handler).toContain('currentFestivalId');
  });

  it('presence:update is still registered and removed', () => {
    expect(src).toContain("socket.on('presence:update', handlePresenceUpdate)");
    expect(src).toContain("socket.off('presence:update', handlePresenceUpdate)");
  });
});
