// Source-level guard: backgrounding must stop a reconnecting socket, not only a connected one.
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '..', 'hooks/useRealtimeSync.ts'), 'utf8');

describe('useRealtimeSync AppState handling', () => {
  const bg = src.slice(src.indexOf('Going to background'), src.indexOf('const appStateSub'));

  it('calls disconnect() outside the socket.connected guard', () => {
    const guardOpen = bg.indexOf('if (socket.connected) {');
    const disconnect = bg.indexOf('socket.disconnect();');
    expect(guardOpen).toBeGreaterThan(-1);
    expect(disconnect).toBeGreaterThan(-1);
    // The only emits live inside the guard; disconnect follows its closing brace.
    expect(bg.slice(guardOpen, disconnect)).toMatch(/\}\s*$/);
    expect(bg.slice(guardOpen, disconnect).match(/\{/g)!.length).toBe(bg.slice(guardOpen, disconnect).match(/\}/g)!.length);
  });

  it('reconnects once on foreground only when the socket is not already active', () => {
    expect(src).toContain('if (!socket.active) {');
  });
});
