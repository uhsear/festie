// Source-level guards for the mobile clash cards. Mobile vitest runs in plain
// node with no RN renderer, so these read the file directly.
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '..', 'components/ClashCards.tsx'), 'utf8');

describe('ClashCards (source-level guards)', () => {
  it('resolves clashes through the shared hook with Undo, Suggested and typeStyle', () => {
    expect(src).toContain('useClashResolver');
    expect(src).toContain('COPY.clash.undo');
    expect(src).toContain('COPY.clash.suggested');
    expect(src).toContain('typeStyle(');
  });

  it('keeps no transitive import and no old prompt copy', () => {
    expect(src).not.toContain('socket.io-client');
    expect(src).not.toContain("'Tap to decide'");
  });
});
