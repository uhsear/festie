import { parseHomeBaseTime } from './homeBaseTime';

describe('parseHomeBaseTime', () => {
  it.each([
    ['18:00', '18:00'],
    ['6:00 PM', '18:00'],
    ['6 pm', '18:00'],
    ['6pm', '18:00'],
    ['12am', '00:00'],
    ['12:30 PM', '12:30'],
  ])('%s -> %s', (input, expected) => {
    expect(parseHomeBaseTime(input)).toBe(expected);
  });

  it.each(['soon', '25:00', '13pm', '6:75'])('rejects %s', (input) => {
    expect(parseHomeBaseTime(input)).toBeNull();
  });
});
