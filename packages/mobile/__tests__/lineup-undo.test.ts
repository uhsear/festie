import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');

describe('t20 lineup undo', () => {
  it('clears picks through usePickClear', () => expect(src).toContain('usePickClear('));
  it('passes the reminder to cards', () => expect(src).toContain('reminderMinutes='));
});
