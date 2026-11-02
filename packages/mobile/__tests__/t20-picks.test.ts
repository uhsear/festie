import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t20 mobile picks source guards', () => {
  const picks = read('app/(tabs)/picks.tsx');
  it('uses the shared picks plan, clear-with-undo and bulk add', () => {
    for (const needle of ['usePicksPlan(', 'usePickClear(', 'useBulkAddPicks(', 'BULK_SCOPE_LABEL']) {
      expect(picks).toContain(needle);
    }
  });
  it('drops the blocking bulk alert, the wrong count and the silent remove', () => {
    expect(picks).not.toContain("Alert.alert('Picks added'");
    expect(picks).not.toContain('Added ${setIds.length}');
    expect(picks).not.toContain('removePick(currentFestival.id, set.id).catch(() => {})');
  });
  it('SetCardMobile takes reminderMinutes and compares it in areEqual', () => {
    const card = read('components/SetCardMobile.tsx');
    expect(card).toContain('reminderMinutes?: number');
    expect(card).toMatch(/prev\.reminderMinutes !== next\.reminderMinutes/);
  });
});

describe('t20 mobile picks order toggle', () => {
  it('offers Openers first / Headliners first from the shared plan', () => {
    const picks = read('app/(tabs)/picks.tsx');
    for (const needle of ['setOrder(next)', "'Openers first'", "'Headliners first'", '{orderRow}']) {
      expect(picks).toContain(needle);
    }
  });
});
