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
