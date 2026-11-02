import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app/set/[setId].tsx'), 'utf8');

describe('T3 mobile set sheet', () => {
  it('uses the shared note hook and the reminder delivery check', () => {
    expect(src).toContain('useDebouncedNote');
    expect(src).toContain('reminderDeliveryProblem');
  });
  it('does not swallow pick, reminder or note save errors', () => {
    expect(src).not.toMatch(/(savePick|saveReminder|saveNote)\([^)]*\)\.catch\(\(\) => \{\}\)/);
  });
  it('shows a failed reminder save inline, beside the chip that failed', () => {
    expect(src).toContain('Reminder not saved.');
    expect(src).toContain('setReminderFailed({ minutes })');
  });
  it('matches web note copy and uses amber, not danger, for save failures', () => {
    expect(src).toContain('>Not saved.<');
    expect(src).not.toContain('Note not saved.');
    expect(src).toMatch(/statusWarn: \{[^}]*accent\.amber/);
  });
  it('no longer manages its own note timers', () => {
    expect(src).not.toContain('clearTimeout(personalTimer');
  });
});
