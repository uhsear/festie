import { getPendingInvite, isValidInviteCode, setPendingInvite, shouldSkipIntro } from './pendingInvite';

describe('pending invite', () => {
  afterEach(() => setPendingInvite(null));

  it('keeps a well-formed code and drops a malformed one', () => {
    setPendingInvite('ABC123');
    expect(getPendingInvite()).toBe('ABC123');
    setPendingInvite('no way!');
    expect(getPendingInvite()).toBeNull();
    expect(isValidInviteCode('AB')).toBe(false);
  });

  it('skips the intro on the join route', () => {
    expect(shouldSkipIntro('join')).toBe(true);
  });

  it('skips the intro when an invite is pending', () => {
    setPendingInvite('ABC123');
    expect(shouldSkipIntro('(auth)')).toBe(true);
  });

  it('shows the intro on other routes with no pending invite', () => {
    expect(shouldSkipIntro('(tabs)')).toBe(false);
    expect(shouldSkipIntro(undefined)).toBe(false);
  });
});
