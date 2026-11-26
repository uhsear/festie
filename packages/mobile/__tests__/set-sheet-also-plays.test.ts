// Source-level guards for the T55 mobile set sheet. Mobile vitest runs in plain
// node with no RN renderer, so these read the files directly.
import { read } from './read-source';

const sheet = read('app/set/[setId].tsx');
const also = read('components/AlsoPlaysSection.tsx');
const clash = read('components/ClashCards.tsx');

describe('set sheet (source-level guards)', () => {
  it('renders Also plays, member colour and the View as button', () => {
    expect(sheet).toContain('<AlsoPlaysSection');
    expect(sheet).toContain('<SetContextSection');
    expect(sheet).toContain('viewAsButtonLabel');
    expect(sheet).toContain('getAvatarColor');
    expect(sheet).toContain('canView(');
  });

  it('labels artist links and groups them per artist for B2B sets', () => {
    expect(sheet).toContain('platformLabel(key)');
    expect(sheet).not.toContain('{key}</Text>');
    expect(sheet).toContain('isB2B ?');
  });

  it('keeps the View as button outside the accessible info group', () => {
    const start = sheet.indexOf('style={styles.crewInfo}');
    const end = sheet.indexOf('</View>', sheet.indexOf('meta.label}</Text>', start));
    const info = sheet.slice(start, end);
    expect(info).toContain('accessible');
    expect(info).not.toContain('AppPressable');
    expect(sheet.indexOf('styles.viewAsButton')).toBeGreaterThan(end);
  });
});

describe('AlsoPlaysSection (source-level guards)', () => {
  it('uses the shared hook, copy and typeStyle without one-line clipping', () => {
    expect(also).toContain('useAlsoPlays(');
    expect(also).toContain('COPY.alsoPlays');
    expect(also).toContain('typeStyle(');
    expect(also).not.toContain('numberOfLines={1}');
    expect(also).not.toContain('socket.io-client');
  });
});

describe('ClashCards catch instead (source-level guards)', () => {
  it('offers the catch button', () => {
    expect(clash).toContain('catchOption');
    expect(clash).toContain('COPY.alsoPlays.catchInstead');
  });
});

describe('set sheet order and same-time cap (DP-36)', () => {
  it('puts the pick control before time, map actions and context', () => {
    const pick = sheet.indexOf('PRIORITY_BUTTONS.map');
    expect(pick).toBeGreaterThan(sheet.indexOf('accessibilityRole="header"'));
    for (const later of ['styles.time}', 'styles.stageActions', '<AlsoPlaysSection', '<SetContextSection']) {
      expect(sheet.indexOf(later)).toBeGreaterThan(pick);
    }
  });

  it('caps the same-time list at three rows with a See all row', () => {
    const ctx = read('components/SetContextSection.tsx');
    expect(ctx).toContain('OVERLAP_PREVIEW_LIMIT = 3');
    expect(ctx).toContain('overlaps.slice(0, OVERLAP_PREVIEW_LIMIT)');
    expect(ctx).toContain('COPY.setContext.overlapSeeAll(');
  });
});
