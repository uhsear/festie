import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// A renamed marker must fail the test, not widen the slice to the whole file.
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  expect(start, `marker not found: ${from}`).toBeGreaterThanOrEqual(0);
  expect(end, `marker not found: ${to}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('Map tab SOS FAB and empty states', () => {
  const map = read('app/(tabs)/map.tsx');
  const hook = read('hooks/useSosRaise.ts');

  it('disables and spins the FAB while raising, and says SOS active for your own SOS', () => {
    expect(map).toContain('const { confirmRaise, raising } = useSosRaise');
    expect(map).toContain('disabled={raising}');
    expect(map).toContain('<ActivityIndicator');
    expect(map).toContain("{mySosActive ? 'SOS active' : 'SOS'}");
    expect(map).toContain('Your SOS is active. Open crew to mark yourself safe');
  });

  it('guards a double raise with a ref and confirms a sent SOS with a toast', () => {
    expect(hook).toContain('inFlight.current');
    expect(hook).toContain("showToast('SOS sent to your crew', { kind: 'success' })");
    expect(hook).toContain('SOS sent without your location');
    expect(hook).toContain("'SOS not sent'");
  });

  it('branches the no-festival state on load state, like the grid', () => {
    expect(map).toContain('festivalLoadState({ currentFestival, festivals');
    expect(map).toContain('COPY.festivalLoad.errorTitle');
    expect(map).toContain('<LoadingState />');
    expect(map).toContain("label: 'Choose a festival'");
  });
});

describe('OfflineMap location, stale fix and fallback rows', () => {
  const src = read('components/OfflineMap.tsx');

  it('drops the stale fix and the blue dot when the tab loses focus', () => {
    const cleanup = between(src, 'useFocusEffect(', '// Frame a point.');
    expect(cleanup).toContain('setSelfCoord(null)');
    expect(src).toContain('window.__festieSetSelf && window.__festieSetSelf(null); true;');
  });

  it('offers Open Settings (not Try again) after a permanent denial', () => {
    expect(src).toContain("geoState === 'denied' ? (");
    expect(src).toContain('label={LIVE_SHARE_COPY.openSettings}');
    expect(src).toContain('Linking.openSettings()');
    expect(src).toContain("geoState === 'unavailable' ? (");
  });

  it('opens the offline compass from fallback SOS, peer and meeting-point rows', () => {
    const list = between(src, 'SOS first', 'uncoordedPoints.map');
    expect(list).toContain('compassHref(s.username');
    expect(list).toContain("peerCompassHref(p.id.slice('peer:'.length))");
    expect(list).toContain('compassHref(pin.label');
    expect(list).toContain('accessibilityHint={MAP_COPY.pointMeThere}');
    expect(list).toContain('accessibilityHint={sosHasFix(s) ? MAP_COPY.pointMeThere : undefined}');
    expect(list).toContain('FIND_FRIEND_COPY.openCompassA11y(p.label)');
    expect(list).not.toContain('accessibilityRole="text"');
  });
});

describe('Compass states', () => {
  const src = read('components/MeetingPointCompass.tsx');
  const noSensor = between(src, "phase === 'no-sensor'", "phase === 'init' ||");

  it('denied card has Open Settings and Try again', () => {
    const denied = between(src, "phase === 'denied'", "phase === 'no-fix'");
    expect(denied).toContain('LIVE_SHARE_COPY.openSettings');
    expect(denied).toContain('Linking.openSettings()');
    expect(denied).toContain('setRetry((n) => n + 1)');
  });

  it('no-sensor card never prints a dash distance and keeps ETA, note and age', () => {
    expect(noSensor).toContain('Number.isFinite(distanceM)');
    expect(noSensor).toContain('Getting your bearings');
    expect(noSensor).toContain('walk`');
    expect(noSensor).toContain('{note ?? DEFAULT_NOTE}');
    expect(noSensor).toContain('{subNote}');
  });

  it('explicit-coordinate targets get the neutral note, not "a point you saved"', () => {
    expect(read('app/compass.tsx')).toContain('hasExplicit ? FIND_FRIEND_COPY.explicitNote');
  });
});

describe('SOS surfaces', () => {
  it('CrewSos derives the compass entry from the live list and closes when it clears', () => {
    const src = read('components/CrewSos.tsx');
    expect(src).toContain('sosList.find((s) => s.userId === navUserId)');
    expect(src).toContain('setNavUserId(null)');
    expect(src).toContain('FIND_FRIEND_COPY.sosNote(navEntry.username)');
    expect(src).toContain('subNote={sosWhen([navEntry])}');
  });

  it('SosBanner routes through sosBannerHref and labels the destination', () => {
    const src = read('components/SosBanner.tsx');
    expect(src).toContain('sosBannerHref(entries, selfId)');
    expect(src).toContain('Open the compass to find them');
  });
});

describe('Live share and meeting point form', () => {
  it('disables the live-share switch in low power and offers to turn it off', () => {
    const src = read('components/CrewLiveLocation.tsx');
    expect(src).toContain('useFestivalModeStore((s) => s.lowPowerMode)');
    expect(src).toContain('disabled={busy || lowPowerMode}');
    expect(src).toContain('LOW_POWER_COPY.livePaused');
    expect(src).toContain('setLowPowerMode(false)');
  });

  it('toasts a failed standalone meeting-point save and labels Save correctly', () => {
    const src = read('components/CrewMeetingPoints.tsx');
    expect(src).toContain('if (formOnly) {');
    expect(src).toContain("Couldn't save the meeting point. Try again.");
    expect(src).toContain("editingId ? 'Save meeting point' : 'Add meeting point'");
  });
});
