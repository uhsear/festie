import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t53 Now & Next caught card source guards', () => {
  const card = read('components/CaughtNowCard.tsx');
  it('writes through markCaught and selects with selectCatchable from shared', () => {
    expect(card).toMatch(/import \{[^}]*\bmarkCaught\b[^}]*\} from '@festie\/shared\/services'/);
    expect(card).toMatch(/import \{[^}]*\bselectCatchable\b[^}]*\} from '@festie\/shared\/utils'/);
    expect(card).not.toContain('api.put(');
  });
  it('reverts the wrap data, not only the overlay, when the write fails', () => {
    expect(card).toContain('applyCaughtMark(w, setId, prevShown)');
  });
  it('announces the mark', () => {
    expect(card).toContain('announceForAccessibility');
  });
  it('festival-mode renders the card', () => {
    expect(read('app/festival-mode.tsx')).toContain('<CaughtNowCard');
  });
});

describe('t53 mobile checklist source guards', () => {
  it('caught screen seeds RatingButtons and builds the checklist', () => {
    const src = read('app/caught.tsx');
    expect(src).toContain('initial=');
    expect(src).toContain('compact');
    expect(src).toContain('buildCaughtChecklist');
    expect(src).not.toContain('api.put(');
  });
  it('RatingButtons gates the summary on compact', () => {
    expect(read('components/RatingButtons.tsx')).toContain('compact ? null : <SetRatingSummary');
  });
  it('rate and wrap link to /caught', () => {
    expect(read('app/rate.tsx')).toContain("pathname: '/caught'");
    expect(read('app/wrap.tsx')).toContain("pathname: '/caught'");
  });
});
