import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'hooks/useRealtimeSync.ts'), 'utf8');
const shared = readFileSync(join(__dirname, '..', '../shared/src/hooks/useRealtimeSync.ts'), 'utf8');

describe('T58 mobile realtime sync', () => {
  it('does not subscribe to onlineUsers, so the tab layout skips presence re-renders', () => {
    expect(src).not.toContain('s.onlineUsers');
    expect(src).toContain('return { connected };');
  });

  it('festival:updated reloads only for the current festival id', () => {
    const handler = shared.slice(shared.indexOf('const handleFestivalUpdated'), shared.indexOf('const handleSetAdded'));
    expect(handler).toContain('data?.id ===');
    expect(handler).toContain('currentFestivalId');
  });

  it('presence:update is still registered and removed', () => {
    expect(shared).toContain("socket.on('presence:update', handlePresenceUpdate)");
    expect(shared).toContain("socket.off('presence:update', handlePresenceUpdate)");
  });
});
