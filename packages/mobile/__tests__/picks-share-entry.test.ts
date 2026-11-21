import { read } from './read-source';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const src = read('app/(tabs)/picks.tsx');

describe('T22 mobile Picks entry points', () => {
  it('routes Share picks to the share hub and wires calendar subscribe + download summary', () => {
    expect(src).toContain("pathname: '/plan-share'");
    expect(src).toContain('fetchCalendarLinks(');
    expect(src).toContain('buildPicksIcsExport(');
    expect(src).toContain('describeIcsExport(');
  });

  it('no longer builds the profile-id link or probes canOpenURL', () => {
    expect(src).not.toContain('buildPicksShareUrl');
    expect(src).not.toContain('canOpenURL');
  });
});
