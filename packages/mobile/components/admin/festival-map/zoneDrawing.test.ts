import { zoneDrawHint } from './zoneDrawing';

describe('zoneDrawHint', () => {
  it('asks for more points below three', () => {
    expect(zoneDrawHint(2)).toBe('Tap the map to add zone points (2 added — need 3+)');
  });

  it('says the zone can be finished from three points', () => {
    expect(zoneDrawHint(3)).toBe('Finish the zone, or tap the map to add more points (3 added)');
  });
});
