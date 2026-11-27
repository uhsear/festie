import { cellTitleLines, microLineHeight } from './gridCellText';

describe('cellTitleLines', () => {
  it('gives a tall cell at large text the three lines "Marsh Choir Collective" needs', () => {
    expect(cellTitleLines(142, 1.3, true)).toBe(3);
  });
  it('keeps two lines in a mid cell at normal text', () => {
    expect(cellTitleLines(60, 1, true)).toBe(2);
  });
  it('counts the cell border so the last line is never clipped', () => {
    expect(cellTitleLines(59, 1, true)).toBe(2);
    expect(cellTitleLines(58, 1, true)).toBe(1);
  });
  it('never drops below one line and never exceeds three', () => {
    expect(cellTitleLines(44, 1.4, false)).toBe(1);
    expect(cellTitleLines(600, 1, true)).toBe(3);
  });
});

describe('microLineHeight', () => {
  it('scales with the font scale', () => {
    expect(microLineHeight(1.3)).toBeCloseTo(16.9);
  });
});
