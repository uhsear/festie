import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const component = read('components', 'admin', 'PickInsight.tsx');
const screen = read('app', 'admin', 'analytics.tsx');
const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };

describe('T51 mobile pick insight', () => {
  it('loads, lists and exports through shared helpers', () => {
    for (const needle of ['fetchAdminPickInsight', 'pickClashRows', 'picksPerSetCsv', 'Sharing.shareAsync', 'typeStyle']) {
      expect(component).toContain(needle);
    }
  });

  it('renders PickInsight on the analytics screen', () => {
    expect(screen).toContain('<PickInsight');
  });

  it('imports only declared mobile dependencies or @festie/shared', () => {
    const deps = new Set(Object.keys(pkg.dependencies ?? {}));
    for (const src of [component, screen]) {
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!;
        if (spec.startsWith('.') || spec.startsWith('@festie/shared')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        expect(deps.has(name)).toBe(true);
      }
    }
  });
});
