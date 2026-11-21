import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const requireCjs = createRequire(import.meta.url);
const app = requireCjs('../app.json') as { expo: { plugins: unknown[] } };
const buildConfig = requireCjs('../app.config.js') as (a: { config: unknown }) => {
  plugins: unknown[];
  extra: Record<string, unknown>;
};

const hasWidgets = (plugins: unknown[]) => plugins.some((p) => Array.isArray(p) && p[0] === 'expo-widgets');
const run = () => buildConfig({ config: app.expo });

afterEach(() => {
  delete process.env.FESTIE_LIVE_ACTIVITY;
});

describe('Live Activity build flag', () => {
  it('is off by default: no widget extension and extra.liveActivity false', () => {
    const cfg = run();
    expect(hasWidgets(app.expo.plugins)).toBe(false);
    expect(hasWidgets(cfg.plugins)).toBe(false);
    expect(cfg.extra.liveActivity).toBe(false);
  });

  it('FESTIE_LIVE_ACTIVITY=1 adds the Now & Next widget extension', () => {
    process.env.FESTIE_LIVE_ACTIVITY = '1';
    const cfg = run();
    expect(hasWidgets(cfg.plugins)).toBe(true);
    expect(cfg.extra.liveActivity).toBe(true);
  });
});
