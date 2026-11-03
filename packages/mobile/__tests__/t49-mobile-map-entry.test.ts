// Source-level guards for the T49 mobile map entry (no RN renderer in mobile vitest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T49 mobile map entry', () => {
  it('map tab focuses a stage and gates "Set as meeting point" on crew layers', () => {
    const src = read('app/(tabs)/map.tsx');
    expect(src).toContain('focusStage');
    expect(src).toContain('onSetMeetingPoint={crewLayers ?');
  });
  it('meeting-point-new reads the prefill params', () => {
    expect(read('app/meeting-point-new.tsx')).toContain('stageReference');
  });
  it('the create form prefills the label', () => {
    expect(read('components/CrewMeetingPoints.tsx')).toContain("prefillCoords.label ?? ''");
  });
});
