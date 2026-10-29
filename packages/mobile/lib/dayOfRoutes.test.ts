import { CREW_MEET_HREF, SCHEDULE_HREF, meetHref } from './dayOfRoutes';

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

  it('falls back to the crew logistics tab', () => {
    expect(meetHref({ kind: 'meeting-point', id: 'mp2' }, [{ id: 'mp2', latitude: null, longitude: null }])).toBe(
      CREW_MEET_HREF,
    );
    expect(meetHref({ kind: 'home-base', id: null }, [])).toBe(CREW_MEET_HREF);
    expect(meetHref(null, [])).toBe(CREW_MEET_HREF);
  });
});
