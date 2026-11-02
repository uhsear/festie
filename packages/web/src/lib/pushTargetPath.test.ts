import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PushTarget } from '@festie/shared/utils/pushTarget';

const selectCrew = vi.fn().mockResolvedValue(undefined);
const selectFestival = vi.fn().mockResolvedValue(undefined);
const loadFestivals = vi.fn().mockResolvedValue(undefined);
let activeCrewId: string | null = 'c1';
const festivals: unknown[] = [];

vi.mock('@festie/shared/stores', () => ({
  useCrewStore: { getState: () => ({ activeCrew: activeCrewId ? { id: activeCrewId } : null, selectCrew }) },
  useFestivalStore: { getState: () => ({ festivals, loadFestivals, selectFestival }) },
}));

import { pushTargetPath, openInboxItem } from './pushTargetPath';
import type { InboxItem } from '@festie/shared/stores/inboxStore';

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'n1',
  type: 'set_reminder',
  title: 't',
  body: 'b',
  createdAt: '2026-11-01T00:00:00.000Z',
  data: {},
  ...over,
});

describe('pushTargetPath', () => {
  it.each<[PushTarget, unknown]>([
    [{ kind: 'set', setId: 's1' }, { to: '/set/s1' }],
    [{ kind: 'festival', festivalId: 'f1' }, { to: '/' }],
    [{ kind: 'crew' }, { to: '/crew' }],
    [{ kind: 'crew', sosUserId: 'u9' }, { to: '/crew', search: { sos: 'u9' } }],
    [{ kind: 'join', code: 'ABC' }, { to: '/join/ABC', external: true }],
    [{ kind: 'screen', screen: 'picks' }, { to: '/picks' }],
    [{ kind: 'screen', screen: 'compare' }, { to: '/compare' }],
    [{ kind: 'screen', screen: 'wrap' }, { to: '/wrap' }],
    [{ kind: 'screen', screen: 'wrap', festivalId: 'f1' }, { to: '/wrap', search: { festival: 'f1' } }],
    [{ kind: 'screen', screen: 'rate', festivalId: 'f1' }, { to: '/rate', search: { festival: 'f1' } }],
    [{ kind: 'screen', screen: 'crew-plan' }, { to: '/crew-plan' }],
    [{ kind: 'screen', screen: 'festival-mode' }, { to: '/festival-mode' }],
    [{ kind: 'screen', screen: 'grid' }, { to: '/grid' }],
    [{ kind: 'screen', screen: 'timeline' }, { to: '/timeline' }],
    [{ kind: 'screen', screen: 'map' }, { to: '/map' }],
    [{ kind: 'screen', screen: 'privacy' }, { to: '/privacy.html', external: true }],
    [{ kind: 'screen', screen: 'find' }, { to: '/crew' }],
    [{ kind: 'screen', screen: 'plan-share' }, { to: '/crew' }],
  ])('maps %j', (target, expected) => {
    expect(pushTargetPath(target)).toEqual(expected);
  });
});

describe('openInboxItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeCrewId = 'c1';
  });

  it('navigates to a set', () => {
    const navigate = vi.fn();
    openInboxItem(item({ data: { setId: 's1' } }), navigate);
    expect(navigate).toHaveBeenCalledWith({ to: '/set/s1' });
  });

  it('does nothing for an item with no target', () => {
    const navigate = vi.fn();
    openInboxItem(item({ data: {} }), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('switches crew for an SOS row from another crew', () => {
    const navigate = vi.fn();
    openInboxItem(
      item({ type: 'crew_sos', data: { crewId: 'c2', deepLink: 'https://festie.us/crew?sos=u9' } }),
      navigate,
    );
    expect(selectCrew).toHaveBeenCalledWith('c2');
    expect(navigate).toHaveBeenCalledWith({ to: '/crew', search: { sos: 'u9' } });
  });

  it('does not switch crew when it already matches', () => {
    const data = { crewId: 'c1', deepLink: 'https://festie.us/crew?sos=u9' };
    openInboxItem(item({ type: 'crew_sos', data }), vi.fn());
    expect(selectCrew).not.toHaveBeenCalled();
  });

  it('selects the festival for a festival target', async () => {
    const navigate = vi.fn();
    openInboxItem(item({ type: 'lineup_drop', data: { festivalId: 'f1' } }), navigate);
    await vi.waitFor(() => expect(selectFestival).toHaveBeenCalledWith('f1'));
    expect(loadFestivals).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });
});
