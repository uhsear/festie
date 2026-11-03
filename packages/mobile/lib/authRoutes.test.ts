import { isGuestBlocked } from './authRoutes';

describe('isGuestBlocked', () => {
  it.each([['wrap'], ['rate'], ['caught'], ['crew-plan'], ['crew-compare'], ['admin'], ['inbox'], ['(tabs)', 'account']])(
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
