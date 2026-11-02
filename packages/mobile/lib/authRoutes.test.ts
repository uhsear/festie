import { isGuestBlocked } from './authRoutes';

describe('isGuestBlocked', () => {
  it.each([['wrap'], ['crew-plan'], ['crew-compare'], ['admin'], ['(tabs)', 'account']])(
    'blocks %j',
    (...segments) => {
      expect(isGuestBlocked(segments)).toBe(true);
    },
  );

  it.each([['(tabs)', 'picks'], ['(tabs)', 'crew'], ['(tabs)'], ['set', '[setId]'], ['festival-mode']])(
    'allows %j',
    (...segments) => {
      expect(isGuestBlocked(segments)).toBe(false);
    },
  );
});
