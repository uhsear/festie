import { colors, colorsDaylight } from '@festie/shared/tokens';
import { contrastRatio, inkOnFill } from './inkOnFill';

describe('inkOnFill on the aqua fill', () => {
  it.each([
    ['stage', colors],
    ['daylight', colorsDaylight],
  ])('reaches 4.5:1 in %s', (_name, c) => {
    const ink = inkOnFill(c.accent.aqua, c.text.onAccent, c.text.onLightAccent);
    expect(contrastRatio(ink, c.accent.aqua)).toBeGreaterThanOrEqual(4.5);
  });

  it('chooses dark ink on Stage and white ink on Daylight', () => {
    expect(inkOnFill(colors.accent.aqua, colors.text.onAccent, colors.text.onLightAccent)).toBe(colors.text.onLightAccent);
    expect(inkOnFill(colorsDaylight.accent.aqua, colorsDaylight.text.onAccent, colorsDaylight.text.onLightAccent)).toBe(
      colorsDaylight.text.onAccent,
    );
  });
});

// Off Switch track (trackColor.false): the thumb is white in both themes, so
// the track must separate from the thumb and from the card (WCAG 1.4.11, 3:1).
describe('Switch off track', () => {
  it.each([
    ['stage', colors],
    ['daylight', colorsDaylight],
  ])('reaches 3:1 against the thumb and the card in %s', (_name, c) => {
    expect(contrastRatio(c.text.muted, c.text.onAccent)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.text.muted, c.bg.primary)).toBeGreaterThanOrEqual(3);
  });
});
