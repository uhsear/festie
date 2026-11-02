import { mutedPrefKeys } from './notificationChannels';

const NONE = 0;
const DEFAULT = 3;

describe('mutedPrefKeys', () => {
  it('returns every crew key for a muted crew channel', () => {
    expect([...mutedPrefKeys([{ id: 'crew', importance: NONE }], NONE)].sort()).toEqual(
      ['crewMeetingPoints', 'crewMoney', 'crewPolls', 'crewReformed', 'crewRides', 'crewUpdates'],
    );
  });
  it('returns nothing for a set-reminders channel at default importance', () => {
    expect(mutedPrefKeys([{ id: 'set-reminders', importance: DEFAULT }], NONE).size).toBe(0);
  });
});
