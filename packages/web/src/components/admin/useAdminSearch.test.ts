import { describe, it, expect } from 'vitest';
import { parseAdminSearch } from './useAdminSearch';

describe('parseAdminSearch', () => {
  it('keeps valid values', () => {
    expect(parseAdminSearch({ tab: 'audit', festival: 'fest_1-a', view: 'map', q: '  sam ' })).toEqual({
      tab: 'audit',
      festival: 'fest_1-a',
      view: 'map',
      q: 'sam',
    });
  });

  it('drops a bad tab, id and view', () => {
    expect(parseAdminSearch({ tab: 'nope', festival: 'a b/c', view: 'bad' })).toEqual({});
  });

  it('drops an empty or 201-character q', () => {
    expect(parseAdminSearch({ q: '   ' })).toEqual({});
    expect(parseAdminSearch({ q: 'x'.repeat(201) })).toEqual({});
    expect(parseAdminSearch({ q: 'x'.repeat(200) }).q).toHaveLength(200);
  });

  it('drops unknown keys', () => {
    expect(parseAdminSearch({ tab: 'users', evil: '1' })).toEqual({ tab: 'users' });
  });
});
