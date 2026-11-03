import { describe, it, expect } from 'vitest';
import { pickMapStyle, pmtilesVectorStyle, OPENFREEMAP_HOST } from '../mapStyle';

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

describe('pmtilesVectorStyle', () => {
  const bg = (s: { layers: Array<Record<string, any>> }) => s.layers[0].paint['background-color'];
  it('keeps the dark palette for Stage and by default', () => {
    expect(bg(pmtilesVectorStyle('https://festie.us/b.pmtiles'))).toBe('#0c0c14');
    expect(pmtilesVectorStyle('https://festie.us/b.pmtiles', undefined, 'stage')).toEqual(
      pmtilesVectorStyle('https://festie.us/b.pmtiles'),
    );
  });

  it('uses the light palette for Daylight', () => {
    const style = pmtilesVectorStyle('https://festie.us/b.pmtiles', undefined, 'daylight');
    expect(bg(style)).toBe('#f2f0eb');
    expect(style.layers.find((l) => l.id === 'roads')?.paint).toEqual({ 'line-color': '#c9c5bd', 'line-width': 1.5 });
  });

  it('pickMapStyle passes the theme to the PMTiles style', () => {
    const cfg = { version: 1, offlineBasemap: { pmtilesUrl: 'https://festie.us/b.pmtiles' } };
    expect(bg(pickMapStyle(cfg, 'daylight') as any)).toBe('#f2f0eb');
  });
});
