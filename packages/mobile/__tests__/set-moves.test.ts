// Source-level guards for the T46 "Moved" chip and line. Mobile vitest runs in
// plain node with no RN renderer, so these read the files directly.
import fs from 'node:fs';
import path from 'node:path';

const card = fs.readFileSync(path.join(__dirname, '..', 'components/SetCardMobile.tsx'), 'utf8');
const screen = fs.readFileSync(path.join(__dirname, '..', 'app/set/[setId].tsx'), 'utf8');

describe('T46 set moves (source-level guards)', () => {
  it('both files use the shared hook', () => {
    expect(card).toMatch(/import \{[^}]*useSetMove[^}]*\} from '@festie\/shared\/hooks'/);
    expect(screen).toMatch(/import \{[^}]*useSetMove[^}]*\} from '@festie\/shared\/hooks'/);
  });

  it('the card adds move.a11y to its label and styles the chip with typeStyle-backed styles', () => {
    expect(card).toContain('move.a11y');
    expect(card).toContain('move.chip');
    expect(card).toContain('styles.movedMark');
    expect(card).toContain('styles.reminderText');
  });

  it('the set screen calls the hook null-safely and renders move.line', () => {
    expect(screen).toContain('useSetMove(set ?? null)');
    expect(screen).toContain('move.line');
    expect(screen).toMatch(/moved: \{\s*\.\.\.typeStyle\('caption'\)/);
  });

  it('keeps no transitive import', () => {
    expect(card).not.toContain('socket.io-client');
    expect(screen).not.toContain('socket.io-client');
  });
});
