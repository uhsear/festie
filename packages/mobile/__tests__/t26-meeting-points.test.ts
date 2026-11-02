import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T26 mobile meeting points', () => {
  it('registers the meeting-point sheet as a formSheet', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain('name="meeting-point-new"');
    expect(src).toContain("presentation: 'formSheet'");
  });
  it('opens the sheet from the map instead of the crew tab', () => {
    const src = read('app/(tabs)/map.tsx');
    expect(src).toContain("'/meeting-point-new'");
    expect(src).not.toContain('mpLat');
  });
  it('labels the map button "Add meeting point"', () => {
    const src = read('components/OfflineMap.tsx');
    expect(src).toContain("'Add meeting point'");
    expect(src).not.toContain("'Drop pin'");
  });
  it('uses the shared split and directions helpers', () => {
    const src = read('components/CrewMeetingPoints.tsx');
    expect(src).toContain('splitMeetingPoints(');
    expect(src).toContain('meetingPointDirectionsUrl(');
    expect(src).toContain('formOnly');
  });
});
