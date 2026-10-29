import { shouldPulse } from './ambientMotion';

describe('shouldPulse', () => {
  it('pulses only when live with motion allowed', () => {
    expect(shouldPulse({ live: true, reduceMotion: false, lowPowerMode: false })).toBe(true);
    expect(shouldPulse({ reduceMotion: false, lowPowerMode: false })).toBe(true);
  });

  it('parks when nothing is live', () => {
    expect(shouldPulse({ live: false, reduceMotion: false, lowPowerMode: false })).toBe(false);
  });

  it('parks under Reduce Motion or low-power mode', () => {
    expect(shouldPulse({ live: true, reduceMotion: true, lowPowerMode: false })).toBe(false);
    expect(shouldPulse({ live: true, reduceMotion: false, lowPowerMode: true })).toBe(false);
  });
});
