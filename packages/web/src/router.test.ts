import { describe, expect, it } from 'vitest';
import { router } from './router';

const validateCrewSearch = (search: Record<string, unknown>) => {
  const validate = router.routesByPath['/crew'].options.validateSearch as (s: Record<string, unknown>) => unknown;
  return validate(search);
};

describe('manage route', () => {
  it('is registered and keeps only valid festival params', () => {
    const route = router.routesByPath['/manage'];
    expect(route).toBeDefined();
    const validate = route.options.validateSearch as (s: Record<string, unknown>) => unknown;
    expect(validate({ festival: 'f-1', view: 'import', q: 'x' })).toEqual({ festival: 'f-1', view: 'import', q: 'x' });
    expect(validate({ festival: 'bad id!', view: 'junk' })).toEqual({});
  });
});

describe('crew route search', () => {
  it('maps old tab keys to the new ones', () => {
    expect(validateCrewSearch({ tab: 'expenses' })).toEqual({ tab: 'money' });
  });

  it('drops an unknown tab', () => {
    expect(validateCrewSearch({ tab: 'junk' })).toEqual({});
  });

  it('keeps the sos param', () => {
    expect(validateCrewSearch({ sos: 'u1', tab: 'meeting' })).toEqual({ sos: 'u1', tab: 'find' });
  });
});
