import { describe, expect, it } from 'vitest';
import {
  geoStateFromErrorCode,
  locationPromptCopy,
  nearestMissingCopy,
  placeFromPin,
  placeShareText,
  placeTargetId,
  stageCoord,
  walkToStage,
  isFixRecent,
  metersPerPixel,
  nearestStep,
  nearestTarget,
  placeTarget,
  meetingPointPrefill,
  findMapPin,
  showingWayLabel,
  MAP_COPY,
} from './mapPlace';
import { buildPursuit } from './geo';
import type { MapPin } from './mapPins';

describe('geoStateFromErrorCode', () => {
  it('maps 1 to denied and everything else to unavailable', () => {
    expect(geoStateFromErrorCode(1)).toBe('denied');
    expect(geoStateFromErrorCode(2)).toBe('unavailable');
    expect(geoStateFromErrorCode(3)).toBe('unavailable');
    expect(geoStateFromErrorCode(undefined)).toBe('unavailable');
  });
});

describe('locationPromptCopy', () => {
  it('returns each row of the copy table', () => {
    expect(locationPromptCopy('idle', 'Mainstage')).toBe('Turn on location to show the way to Mainstage');
    expect(locationPromptCopy('idle')).toBe('Turn on location to see how far it is');
    expect(locationPromptCopy('locating')).toBe('Finding you…');
    expect(locationPromptCopy('denied')).toBe(
      'Location is blocked. Allow location for Festie in your settings, then try again.',
    );
    expect(locationPromptCopy('unavailable')).toBe("Can't get a GPS fix. Move into the open and try again.");
    expect(locationPromptCopy('on')).toBe('');
  });
});

describe('nearestMissingCopy', () => {
  it('matches the table', () => {
    expect(nearestMissingCopy('medical')).toBe('No medical tent is mapped. Ask any staff member.');
    expect(nearestMissingCopy('water')).toBe('No water point is mapped. Ask any staff member.');
    expect(nearestMissingCopy('toilet')).toBe('No toilets are mapped. Ask any staff member.');
    expect(nearestMissingCopy('food')).toBe('None is mapped. Ask any staff member.');
  });
});

describe('placeFromPin', () => {
  const at = { latitude: 1, longitude: 2 };
  it('sets kindLabel per pin shape', () => {
    expect(placeFromPin({ id: 's', kind: 'stage', label: 'Main', ...at }).kindLabel).toBe('Stage');
    expect(placeFromPin({ id: 'm', kind: 'meeting-point', label: 'Gate', ...at }).kindLabel).toBe('Meeting point');
    expect(placeFromPin({ id: 'w', kind: 'amenity', label: 'Tap', amenityType: 'water', ...at }).kindLabel).toBe('Water');
    const atm = placeFromPin({ id: 'a', kind: 'amenity', label: 'Cash', amenityType: 'atm', ...at });
    expect(atm.kindLabel).toBe('ATM');
    expect(atm.amenityType).toBe('atm');
    expect(atm.coord).toEqual(at);
    expect(placeTargetId(atm)).toBe('place:amenity:a');
  });
});

describe('placeShareText', () => {
  it('builds name, kind and a 6-decimal map link', () => {
    expect(
      placeShareText({
        id: 's',
        kind: 'stage',
        name: 'Mainstage',
        kindLabel: 'Stage',
        coord: { latitude: 28.5383355, longitude: -81.3792365 },
      }),
    ).toBe('Mainstage (Stage): https://maps.google.com/?q=28.538336,-81.379237');
  });
});

describe('stageCoord', () => {
  const stages = [
    { id: 'a', latitude: 1, longitude: 2 },
    { id: 'b', latitude: null, longitude: 2 },
    { id: 'c', latitude: NaN, longitude: 2 },
  ];
  it('returns the coord or null', () => {
    expect(stageCoord(stages, 'a')).toEqual({ latitude: 1, longitude: 2 });
    expect(stageCoord(stages, 'zzz')).toBeNull();
    expect(stageCoord(stages, 'b')).toBeNull();
    expect(stageCoord(stages, 'c')).toBeNull();
  });
});

describe('walkToStage', () => {
  const origin = { latitude: 0, longitude: 0 };
  // ~450 m north: 450 / 1.25 / 60 = 6 min
  const stage = { latitude: 450 / 111_194.93, longitude: 0 };
  const now = 1_000_000;
  it('flags late against minutes left', () => {
    const ok = walkToStage(origin, stage, now + 10 * 60_000, now);
    expect(ok).toMatchObject({ minutes: 6, late: false, label: '6 min walk' });
    expect(walkToStage(origin, stage, now + 3 * 60_000, now)?.late).toBe(true);
  });
  it('returns null without an origin', () => {
    expect(walkToStage(null, stage, now, now)).toBeNull();
  });
});

describe('isFixRecent', () => {
  it('is true at 5:00 and false at 5:01', () => {
    expect(isFixRecent(0, 300_000)).toBe(true);
    expect(isFixRecent(0, 301_000)).toBe(false);
    expect(isFixRecent(null, 0)).toBe(false);
  });
});

describe('metersPerPixel', () => {
  it('is about 78271.5 at zoom 0 and halves per zoom step', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.5, 1);
    expect(metersPerPixel(0, 1)).toBeCloseTo(metersPerPixel(0, 0) / 2, 6);
  });
});

describe('nearestStep and targets', () => {
  const amen = (id: string, amenityType: MapPin['amenityType'], latitude: number, label = ''): MapPin => ({
    id,
    kind: 'amenity',
    label,
    amenityType,
    latitude,
    longitude: 0,
  });
  const pins = [amen('far', 'medical', 1), amen('near', 'medical', 0.001), amen('w', 'water', 0.0001)];
  const self = { latitude: 0, longitude: 0 };

  it('returns missing, need-fix, then go with the closer pin of the type', () => {
    expect(nearestStep('toilet', pins, null)).toEqual({ kind: 'missing', type: 'toilet' });
    expect(nearestStep('medical', pins, null)).toEqual({ kind: 'need-fix', type: 'medical' });
    const step = nearestStep('medical', pins, self);
    expect(step.kind === 'go' && step.pin.id).toBe('near');
  });

  it('builds the nearest target id and label fallback', () => {
    const step = nearestStep('medical', pins, self);
    if (step.kind !== 'go') throw new Error('expected go');
    expect(nearestTarget(step)).toEqual({ id: 'amenity:near', label: 'Medical', coord: { latitude: 0.001, longitude: 0 } });
  });

  it('builds the place target id', () => {
    const place = placeFromPin({ id: 's1', kind: 'stage', label: 'Main', latitude: 1, longitude: 2 });
    expect(placeTarget(place).id).toBe('place:stage:s1');
    expect(placeTarget(place).label).toBe('Main');
  });
});

describe('meetingPointPrefill', () => {
  const at = { latitude: 1, longitude: 2 };
  it('prefills a stage and an amenity', () => {
    const stage = placeFromPin({ id: 's', kind: 'stage', label: 'Main', ...at });
    expect(meetingPointPrefill(stage)).toEqual({ label: 'Meet at Main', location: 'Main', stageReference: 'Main' });
    const amenity = placeFromPin({ id: 'w', kind: 'amenity', label: 'Tap', amenityType: 'water', ...at });
    expect(meetingPointPrefill(amenity).stageReference).toBe('');
  });

  it('clamps a 150-character stage name', () => {
    const long = placeFromPin({ id: 's', kind: 'stage', label: 'x'.repeat(150), ...at });
    const p = meetingPointPrefill(long);
    expect(p.label).toHaveLength(100);
    expect(p.stageReference).toHaveLength(100);
  });
});

describe('findMapPin', () => {
  it('matches kind and id', () => {
    const pin: MapPin = { id: 'a', kind: 'stage', label: 'A', latitude: 1, longitude: 2 };
    expect(findMapPin('stage', 'a', [pin])).toBe(pin);
    expect(findMapPin('amenity', 'a', [pin])).toBeNull();
  });
});

describe('showingWayLabel and MAP_COPY', () => {
  it('drops the ETA clause when the ETA is a dash', () => {
    const p = buildPursuit({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.003 });
    expect(showingWayLabel('Main', p)).toMatch(/^Showing the way to Main, .+, about .+ walk$/);
    expect(showingWayLabel('Main', { ...p, etaLabel: '—' })).not.toContain('about');
  });

  it('exposes the copy table', () => {
    expect(MAP_COPY.showWay).toBe('Show the way');
    expect(MAP_COPY.call911).toBe('Call 911');
  });
});
