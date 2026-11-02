import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T28 mobile live share', () => {
  it('CrewLiveLocation is UI only and says the honest stop rule', () => {
    const src = read('components/CrewLiveLocation.tsx');
    expect(src).not.toContain('useLiveLocationPublisher');
    expect(src).not.toContain('expo-battery');
    expect(src).not.toContain('Until the festival ends');
    expect(src).toContain('LIVE_SHARE_COPY.ruleNative');
    expect(src).toContain('beginShare');
  });

  it('LiveSharePublisher runs the shared session and ends on background', () => {
    const src = read('components/LiveSharePublisher.tsx');
    expect(src).toContain('useLiveShareSession');
    expect(src).toContain("endShare('background')");
  });

  it('the root layout mounts LiveSharePublisher', () => {
    expect(read('app/_layout.tsx')).toContain('<LiveSharePublisher />');
  });

  it('low-power copy comes from LOW_POWER_COPY', () => {
    const controls = read('components/LowPowerControls.tsx');
    const crew = read('app/(tabs)/crew.tsx');
    expect(controls).toContain('LOW_POWER_COPY');
    expect(crew).toContain('LOW_POWER_COPY');
    expect(controls).not.toContain('Now & Next screen');
    expect(crew).not.toContain('Now & Next screen');
  });

  it('the chooser shows the first-share explainer and ends rest of today after the last set', () => {
    const src = read('components/CrewLiveLocation.tsx');
    expect(src).toContain('useShareExplainer()');
    expect(src).toContain('LIVE_SHARE_COPY.explainerPoints');
    expect(src).toContain('liveShareOptions({ days, sets, timeZone, nowMs: now })');
  });

  it('the Now & Next crew row says when contact was lost', () => {
    expect(read('components/NowSurface.tsx')).toContain('lostContactLabel(row.lostAt');
  });
});
