import { describeInvite, getPendingInvite, isValidInviteCode, setPendingInvite } from './pendingInvite';

vi.mock('@festie/shared/services', () => ({ api: { get: vi.fn() } }));

describe('pending invite', () => {
  it('keeps a well-formed code and drops a malformed one', () => {
    setPendingInvite('ABC123');
    expect(getPendingInvite()).toBe('ABC123');
    setPendingInvite('no way!');
    expect(getPendingInvite()).toBeNull();
    expect(isValidInviteCode('AB')).toBe(false);
  });

  it('describes the crew, inviter and member count', () => {
    expect(describeInvite({ crewName: 'Bass Gang', ownerName: 'DJ Dana', memberCount: 4, expiresAt: null })).toEqual({
      title: 'Bass Gang',
      detail: 'DJ Dana invited you. 4 members so far.',
    });
    expect(describeInvite({ crewName: 'Solo', ownerName: null, memberCount: 1, expiresAt: null }).detail).toBe(
      '1 member so far.',
    );
  });
});
