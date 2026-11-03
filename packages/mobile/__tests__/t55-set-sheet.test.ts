// Source-level guards for the T55 mobile set sheet. Mobile vitest runs in plain
// node with no RN renderer, so these read the files directly.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const sheet = read('app/set/[setId].tsx');
const also = read('components/AlsoPlaysSection.tsx');
const clash = read('components/ClashCards.tsx');

describe('set sheet (source-level guards)', () => {
  it('renders Also plays, member colour and the View as button', () => {
    expect(sheet).toContain('<AlsoPlaysSection');
    expect(sheet).toContain('viewAsButtonLabel');
    expect(sheet).toContain('getAvatarColor');
    expect(sheet).toContain('canView(');
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
