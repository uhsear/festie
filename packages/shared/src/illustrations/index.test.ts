import { describe, it, expect } from 'vitest';
import { illustrationDataUri, illustrationSvg, type IllustrationName } from './index';
import * as svgs from './svgs';

const NAMES: IllustrationName[] = ['noPicks', 'noCrew', 'emptyList', 'offline'];
// The SVG namespace is required for an <img> data URI to render; it is not a fetch.
const withoutNamespace = (s: string) => s.replace(' xmlns="http://www.w3.org/2000/svg"', '');

describe('illustrations', () => {
  it.each(NAMES)('%s is a safe, local, single-ink SVG', (name) => {
    const raw = svgs[name];
    expect(raw.startsWith('<svg')).toBe(true);
    expect(raw).not.toMatch(/<script/i);
    expect(raw).not.toMatch(/\son\w+\s*=/i);
    expect(withoutNamespace(raw)).not.toMatch(/http/i);
    expect(raw).toContain('currentColor');
    expect(raw).toMatch(/viewBox="/);
    expect(raw).not.toMatch(/\s(width|height)=/);
    expect(new TextEncoder().encode(raw).length).toBeLessThan(8192);
  });

  it.each(NAMES)('%s takes the given colour everywhere', (name) => {
    const svg = illustrationSvg(name, '#123456');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('#123456');
  });

  it('builds an encoded data URI', () => {
    const uri = illustrationDataUri('noCrew', '#123456');
    expect(uri.startsWith('data:image/svg+xml;utf8,%3Csvg')).toBe(true);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length))).toBe(illustrationSvg('noCrew', '#123456'));
  });
});
