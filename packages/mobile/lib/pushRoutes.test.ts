import { pushTargetHref } from './pushRoutes';

describe('pushTargetHref', () => {
  it('maps every push target kind to a route', () => {
    expect(pushTargetHref({ kind: 'set', setId: 's1' })).toBe('/set/s1');
    expect(pushTargetHref({ kind: 'festival', festivalId: 'f1' })).toBe('/(tabs)');
    expect(pushTargetHref({ kind: 'crew' })).toBe('/(tabs)/crew');
    expect(pushTargetHref({ kind: 'crew', sosUserId: 'u1' })).toBe('/(tabs)/crew');
    expect(pushTargetHref({ kind: 'join', code: 'ABC' })).toBe('/join/ABC');
    expect(pushTargetHref({ kind: 'screen', screen: 'compare' })).toBe('/crew-compare');
    expect(pushTargetHref({ kind: 'screen', screen: 'picks' })).toBe('/(tabs)/picks');
    expect(pushTargetHref({ kind: 'screen', screen: 'wrap' })).toBe('/wrap');
    expect(pushTargetHref({ kind: 'screen', screen: 'crew-plan' })).toBe('/crew-plan');
    expect(pushTargetHref({ kind: 'screen', screen: 'rate' })).toBe('/rate');
  });

  it('passes the festival to wrap and rate', () => {
    expect(pushTargetHref({ kind: 'screen', screen: 'wrap', festivalId: 'f1' })).toEqual({
      pathname: '/wrap',
      params: { festival: 'f1' },
    });
    expect(pushTargetHref({ kind: 'screen', screen: 'rate', festivalId: 'f1' })).toEqual({
      pathname: '/rate',
      params: { festival: 'f1' },
    });
  });
});
