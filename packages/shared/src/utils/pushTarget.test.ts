import { describe, it, expect } from 'vitest';
import { resolvePushTarget } from './pushTarget';

const link = (deepLink: string, extra: Record<string, unknown> = {}) => resolvePushTarget({ deepLink, ...extra });

describe('resolvePushTarget', () => {
  it('reads the new set link on every accepted origin', () => {
    expect(link('https://festie.us/set/s1')).toEqual({ kind: 'set', setId: 's1' });
    expect(link('festie://set/s1')).toEqual({ kind: 'set', setId: 's1' });
    expect(link('rave://set/s1')).toEqual({ kind: 'set', setId: 's1' });
  });

  it('reads legacy shapes', () => {
    expect(link('rave://festival/f1?set=s1')).toEqual({ kind: 'set', setId: 's1' });
    expect(link('rave://festival/f1/profile/p1')).toEqual({ kind: 'screen', screen: 'compare' });
    expect(link('rave://festival/f1')).toEqual({ kind: 'festival', festivalId: 'f1' });
    expect(link('rave://crew/c1/sos')).toEqual({ kind: 'crew' });
    expect(link('https://festie.us/festival/f1')).toEqual({ kind: 'festival', festivalId: 'f1' });
  });

  it('reads an empty path with ?festival=', () => {
    expect(link('https://festie.us/?festival=f9')).toEqual({ kind: 'festival', festivalId: 'f9' });
  });

  it('reads crew, join and screens', () => {
    expect(link('https://festie.us/crew?sos=u7')).toEqual({ kind: 'crew', sosUserId: 'u7' });
    expect(link('https://festie.us/join/ABC123')).toEqual({ kind: 'join', code: 'ABC123' });
    expect(link('https://festie.us/compare')).toEqual({ kind: 'screen', screen: 'compare' });
    expect(link('rave://crew-compare')).toEqual({ kind: 'screen', screen: 'compare' });
    expect(link('https://festie.us/picks')).toEqual({ kind: 'screen', screen: 'picks' });
    expect(link('https://festie.us/timeline')).toEqual({ kind: 'screen', screen: 'timeline' });
  });

  it('keeps a valid festival for wrap and rate', () => {
    expect(link('https://festie.us/wrap?festival=f1')).toEqual({ kind: 'screen', screen: 'wrap', festivalId: 'f1' });
    expect(link('festie://rate?festival=edc_2026#x')).toEqual({ kind: 'screen', screen: 'rate', festivalId: 'edc_2026' });
    expect(link('rave://rate')).toEqual({ kind: 'screen', screen: 'rate' });
  });

  it('drops a bad festival for wrap and rate', () => {
    expect(link('https://festie.us/wrap?festival=a/b')).toEqual({ kind: 'screen', screen: 'wrap' });
    expect(link('https://festie.us/rate?festival=' + 'a'.repeat(129))).toEqual({ kind: 'screen', screen: 'rate' });
    expect(link('https://festie.us/rate?festival=')).toEqual({ kind: 'screen', screen: 'rate' });
  });

  it('falls back to setId, then festivalId, then null', () => {
    expect(link('https://festie.us/unknown', { setId: 's2', festivalId: 'f2' })).toEqual({ kind: 'set', setId: 's2' });
    expect(resolvePushTarget({ festivalId: 'f2' })).toEqual({ kind: 'festival', festivalId: 'f2' });
    expect(resolvePushTarget({})).toBeNull();
    expect(resolvePushTarget(undefined)).toBeNull();
  });

  it('ignores a link from another origin', () => {
    expect(link('https://evil.example/set/s1')).toBeNull();
    expect(link('https://evil.example/rate?festival=f1')).toBeNull();
  });

  it('rejects unsafe ids', () => {
    expect(link('https://festie.us/set/..%2Fx')).toBeNull();
    expect(link('https://festie.us/set/a b')).toBeNull();
    expect(resolvePushTarget({ setId: '../x' })).toBeNull();
    expect(resolvePushTarget({ setId: 'a b', festivalId: 'f1' })).toEqual({ kind: 'festival', festivalId: 'f1' });
  });
});
