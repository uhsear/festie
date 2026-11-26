import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('schedule view primitives (T18 MB0)', () => {
  it('SetCardMobile conflict styles use the clash token, not coral', () => {
    const src = read('SetCardMobile.tsx');
    expect(src).toContain('colors.clash');
    const conflictStyles = src.slice(src.indexOf('conflictBadge: {'), src.indexOf('footer: {'));
    expect(conflictStyles).not.toContain('accent.coral');
  });
  it('set card and set sheet keep the testIDs the iOS Maestro artist-sheet flow taps', () => {
    expect(read('SetCardMobile.tsx')).toContain('testID={`set-card-${set.id}`}');
    const sheet = readFileSync(join(__dirname, '..', 'app', 'set', '[setId].tsx'), 'utf8');
    expect(sheet).toContain('testID="set-sheet"');
    expect(sheet).toContain('testID="set-sheet-close"');
  });
  it('TBASection groups by stage', () => {
    expect(read('TBASection.tsx')).toContain('groupUntimedByStage(');
  });
  it('ClashHatch draws with react-native-svg', () => {
    expect(read('ClashHatch.tsx')).toContain("from 'react-native-svg'");
  });
});

describe('lineup flyer (DP-54)', () => {
  it('the cards header shows the flyer and withholds the cards and the TBA banner while it is set', () => {
    const src = read('schedule/ScheduleCardsView.tsx');
    expect(src).toContain('<LineupFlyer model={flyer}');
    expect(src).toContain('data={flyer ? [] : rows}');
  });
  it('the flyer has no pick controls', () => {
    const src = read('LineupFlyer.tsx');
    expect(src).not.toMatch(/SetCardMobile|PriorityButtons|onSavePick/);
    expect(src).toContain('<FollowButton');
  });
});
