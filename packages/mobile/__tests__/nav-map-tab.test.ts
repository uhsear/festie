import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const path = (rel: string) => join(__dirname, '..', rel);
const read = (rel: string) => readFileSync(path(rel), 'utf8');

describe('five-tab navigation and the Map tab', () => {
  it('tab layout builds the triggers from APP_SECTIONS in shared order', () => {
    const src = read('app/(tabs)/_layout.tsx');
    expect(src).toContain('APP_SECTIONS');
    const names = [...src.matchAll(/name: '([a-z]+)'/g)].map((m) => m[1]);
    expect(names).toEqual(['index', 'picks', 'crew', 'map', 'account']);
  });

  it('the map screen lives in the tabs group', () => {
    expect(existsSync(path('app/map.tsx'))).toBe(false);
    expect(existsSync(path('app/(tabs)/map.tsx'))).toBe(true);
  });

  it('the old find hub redirects to the map', () => {
    expect(read('app/find.tsx')).toContain('<Redirect href="/map"');
  });

  it('the Map tab is open to guests and uses the Find crew tab', () => {
    const src = read('app/(tabs)/map.tsx');
    expect(src).not.toContain('Sign in required');
    expect(src).not.toContain("tab: 'logistics'");
  });

  it('find deep links open the map', () => {
    expect(read('app/_layout.tsx')).toContain("find: '/map'");
  });
});
