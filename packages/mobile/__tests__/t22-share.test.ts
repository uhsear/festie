import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t22 mobile share hub', () => {
  it('plan-share has the Link tab, the new label and the tab param', () => {
    const src = read('app/plan-share.tsx');
    expect(src).toContain('Text meeting point');
    expect(src).toContain('plan-share-tab-link');
    expect(src).toContain('useLocalSearchParams');
    expect(src).not.toContain('Text crew');
  });

  it('scanner reads the URL form and handles a blocked camera', () => {
    const src = read('components/PlanQRScan.tsx');
    expect(src).toContain('extractPlanSnapshotText(');
    expect(src).toContain('canAskAgain');
    expect(src).toContain('Linking.openSettings()');
  });

  it('QR share builds a URL from the shared snapshot helper', () => {
    const src = read('components/PlanQRShare.tsx');
    expect(src).toContain('buildPlanQrUrl(');
    expect(src).toContain('buildPlanSnapshotInput(');
    expect(src).not.toContain('function pickShareMeetingPoint');
  });
});
