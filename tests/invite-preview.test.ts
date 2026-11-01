import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { loadInvitePreview, formatInviteDateRange } from '../lib/invite-preview';

const CREW = {
  id: 'c1',
  name: 'Bass Gang',
  festivalId: 'fest-1',
  maxMembers: 8,
  inviteExpiresAt: '2026-12-01T00:00:00.000Z',
};
const MEMBERS = [
  { userId: 'u1', role: 'owner', username: 'dj', name: 'DJ Dana' },
  { userId: 'u2', role: 'member', username: 'x' },
];

function makeDeps(opts: { crew?: any; expired?: any; members?: any[]; festival?: any } = {}) {
  const crews = {
    getByInviteCode: mock.fn(async () => opts.crew ?? null),
    getExpiredByInviteCode: mock.fn(async () => opts.expired ?? null),
    getMembers: mock.fn(async () => opts.members ?? MEMBERS),
  };
  const getFestivalById = mock.fn(async () => opts.festival ?? null);
  return { deps: { stores: { crews }, getFestivalById }, crews, getFestivalById };
}

describe('loadInvitePreview', () => {
  it('builds the contract shape from crew, members and festival', async () => {
    const { deps } = makeDeps({
      crew: CREW,
      festival: {
        id: 'fest-1',
        name: 'EDC Orlando',
        days: [{ date: '2026-11-08' }, { date: '2026-11-06' }, { date: '2026-11-07' }],
      },
    });
    const result = await loadInvitePreview(deps, 'ABC123');
    assert.deepEqual(result, {
      status: 'ok',
      preview: {
        crewName: 'Bass Gang',
        ownerName: 'DJ Dana',
        memberCount: 2,
        maxMembers: 8,
        spotsLeft: 6,
        festivalId: 'fest-1',
        festivalName: 'EDC Orlando',
        startDate: '2026-11-06',
        endDate: '2026-11-08',
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    });
  });

  it('upper-cases and trims a lower-case code', async () => {
    const { deps, crews } = makeDeps({ crew: CREW });
    await loadInvitePreview(deps, '  abc123 ');
    assert.equal((crews.getByInviteCode.mock.calls[0] as any).arguments[0], 'ABC123');
  });

  it('treats a malformed code as invalid without touching the store', async () => {
    for (const code of ['AB', 'ABCDEFGHIJKLM', 'AB-C!23', '', null]) {
      const { deps, crews } = makeDeps({ crew: CREW });
      assert.deepEqual(await loadInvitePreview(deps, code), { status: 'invalid' });
      assert.equal(crews.getByInviteCode.mock.callCount(), 0);
    }
  });

  it('reports an expired code as expired and an unknown code as invalid', async () => {
    assert.deepEqual(await loadInvitePreview(makeDeps({ expired: { id: 'c1' } }).deps, 'OLD123'), { status: 'expired' });
    assert.deepEqual(await loadInvitePreview(makeDeps().deps, 'NOPE99'), { status: 'invalid' });
  });

  it('gives null dates and festival name when the festival has no days or is missing', async () => {
    const noDays = await loadInvitePreview(makeDeps({ crew: CREW, festival: { id: 'fest-1', name: 'F', days: [] } }).deps, 'ABC123');
    assert.equal(noDays.status, 'ok');
    if (noDays.status === 'ok') {
      assert.equal(noDays.preview.startDate, null);
      assert.equal(noDays.preview.endDate, null);
      assert.equal(noDays.preview.festivalName, 'F');
    }
    const missing = await loadInvitePreview(makeDeps({ crew: CREW }).deps, 'ABC123');
    if (missing.status === 'ok') {
      assert.equal(missing.preview.festivalName, null);
      assert.equal(missing.preview.startDate, null);
    }
  });

  it('never reports fewer than 0 spots left', async () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, role: i ? 'member' : 'owner', username: `u${i}` }));
    const result = await loadInvitePreview(makeDeps({ crew: CREW, members }).deps, 'ABC123');
    assert.equal(result.status === 'ok' && result.preview.spotsLeft, 0);
  });
});

describe('formatInviteDateRange', () => {
  it('formats a range in the shared festival-date style', () => {
    assert.equal(formatInviteDateRange('2026-11-06', '2026-11-08'), 'Nov 6 – Nov 8, 2026');
  });

  it('returns null when either end is missing or invalid', () => {
    assert.equal(formatInviteDateRange(null, '2026-11-08'), null);
    assert.equal(formatInviteDateRange('2026-11-06', null), null);
    assert.equal(formatInviteDateRange('nope', '2026-11-08'), null);
  });
});
