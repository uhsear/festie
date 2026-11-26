// Source-level guards for DP-35: time leads the card, the stage is a rail plus a primary-text name,
// and one compact pick control replaces the three equal pills. Mobile vitest has no RN renderer.
import { read } from './read-source';

const card = read('components/SetCardMobile.tsx');
const at = (needle: string) => card.indexOf(needle);

describe('DP-35 set card spine (source-level guards)', () => {
  it('renders the time before the stage name and the artist name', () => {
    expect(at('styles.time,')).toBeGreaterThan(-1);
    expect(at('styles.time,')).toBeLessThan(at('styles.stageText,'));
    expect(at('styles.stageText,')).toBeLessThan(at('<ArtistName'));
  });

  it('sets the time in a tabular title style', () => {
    expect(card).toMatch(/time: \{\s*\.\.\.typeStyle\('title', undefined, \{ tabular: true \}\)/);
  });

  it('colours the rail from the stage and keeps the stage name in primary text', () => {
    expect(card).toContain('styles.rail');
    expect(card).toMatch(/stageText: \{\s*\.\.\.typeStyle\('caption', 600\),\s*color: t\.colors\.text\.primary/);
    expect(card).not.toContain('stagePill');
    expect(card).not.toContain('ensureWhiteContrast');
  });

  it('shows one pick control that expands the trio on tap and collapses after a pick', () => {
    expect(card).toContain('<PickControl');
    expect(card).toContain('accessibilityState={{ expanded: false }}');
    expect(card).toContain('setExpanded(false)');
  });
});
