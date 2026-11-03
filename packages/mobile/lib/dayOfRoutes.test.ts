import {
  CREW_MEET_HREF,
  SCHEDULE_HREF,
  compassHref,
  peerCompassHref,
  meetHref,
  meetingPointPrefillHref,
  sosPushCrewId,
  stageMapHref,
} from './dayOfRoutes';

describe('map entry routes', () => {
  it('builds the stage map href', () => {
    expect(stageMapHref('s1')).toEqual({ pathname: '/(tabs)/map', params: { focusStage: 's1' } });
  });

  it('stringifies compass coordinates, negatives included', () => {
    expect(compassHref('Mainstage', { latitude: 35.5, longitude: -86.25 })).toEqual({
      pathname: '/compass',
      params: { label: 'Mainstage', latitude: '35.5', longitude: '-86.25' },
    });
  });

  it('builds the peer compass href', () => {
    expect(peerCompassHref('u1')).toEqual({ pathname: '/compass', params: { peer: 'u1' } });
  });

  it('builds the meeting-point prefill href, with an empty stage reference for an amenity', () => {
    const coord = { latitude: 35.5, longitude: -86.25 };
    expect(meetingPointPrefillHref({ id: 's1', kind: 'stage', name: 'Mainstage', kindLabel: 'Stage', coord })).toEqual({
      pathname: '/meeting-point-new',
      params: {
        lat: '35.5',
        lng: '-86.25',
        label: 'Meet at Mainstage',
        location: 'Mainstage',
        stageReference: 'Mainstage',
      },
    });
    const amenity = meetingPointPrefillHref({ id: 'a1', kind: 'amenity', name: 'Water', kindLabel: 'Water', coord });
    expect((amenity as { params: Record<string, string> }).params.stageReference).toBe('');
  });
});

describe('day-of routes', () => {
  it('sends Browse lineup to the schedule tab, not the missing /schedule route', () => {
    expect(SCHEDULE_HREF).toBe('/(tabs)');
  });

  it('opens the compass for a meeting point with coordinates', () => {
    const points = [{ id: 'mp1', latitude: 35.1, longitude: -86.2 }];
    expect(meetHref({ kind: 'meeting-point', id: 'mp1' }, points)).toEqual({
      pathname: '/compass',
      params: { mpId: 'mp1' },
    });
  });

  it('falls back to the crew Find tab', () => {
    expect(CREW_MEET_HREF).toEqual({ pathname: '/(tabs)/crew', params: { tab: 'find' } });
    expect(meetHref({ kind: 'meeting-point', id: 'mp2' }, [{ id: 'mp2', latitude: null, longitude: null }])).toBe(
      CREW_MEET_HREF,
    );
    expect(meetHref({ kind: 'home-base', id: null }, [])).toBe(CREW_MEET_HREF);
    expect(meetHref(null, [])).toBe(CREW_MEET_HREF);
  });

  it('reads the crew id from an SOS push only', () => {
    expect(sosPushCrewId({ crewId: 'c1', deepLink: 'rave://crew/c1/sos' })).toBe('c1');
    expect(sosPushCrewId({ deepLink: 'rave://crew/c1/sos' })).toBeNull();
    expect(sosPushCrewId({ crewId: 'c1', deepLink: 'rave://crew/c1' })).toBeNull();
    expect(sosPushCrewId({ type: 'crew_sos', crewId: 'c1', deepLink: 'https://festie.us/crew?sos=u1' })).toBe('c1');
    expect(sosPushCrewId(undefined)).toBeNull();
  });
});
