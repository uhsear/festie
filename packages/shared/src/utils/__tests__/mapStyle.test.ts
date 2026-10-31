import { describe, it, expect } from 'vitest';
import { pickMapStyle, OPENFREEMAP_HOST } from '../mapStyle';

describe('pickMapStyle', () => {
  it('uses the dark OpenFreeMap style for Stage and when no theme is given', () => {
    expect(pickMapStyle(null)).toBe(`https://${OPENFREEMAP_HOST}/styles/dark`);
    expect(pickMapStyle(undefined, 'stage')).toBe(`https://${OPENFREEMAP_HOST}/styles/dark`);
  });

  it('uses the light OpenFreeMap style for Daylight', () => {
    expect(pickMapStyle({ version: 1 }, 'daylight')).toBe(`https://${OPENFREEMAP_HOST}/styles/positron`);
  });

  it('keeps the festival PMTiles basemap whatever the theme', () => {
    const style = pickMapStyle({ version: 1, offlineBasemap: { pmtilesUrl: 'https://festie.us/b.pmtiles' } }, 'daylight');
    expect(typeof style).toBe('object');
    expect(JSON.stringify(style)).toContain('pmtiles://https://festie.us/b.pmtiles');
  });
});
