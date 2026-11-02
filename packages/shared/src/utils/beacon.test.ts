import { describe, it, expect } from 'vitest';
import { BEACON_FLASH_MS, beaconColors } from './beacon';

describe('beaconColors', () => {
  it('is stable per name and alternates with white', () => {
    expect(beaconColors('Sam').primary).toBe(beaconColors('Sam').primary);
    expect(beaconColors('Sam').alternate).toBe('#FFFFFF');
  });

  it('flashes at 1 Hz', () => {
    expect(BEACON_FLASH_MS).toBe(500);
  });
});
