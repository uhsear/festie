import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(src, rel), 'utf8');

describe('empty and error states are wired to EmptyState with an illustration', () => {
  it.each([
    ['components/features/FestivalLoadError.tsx', 'illustration="offline"'],
    ['routes/inbox.tsx', 'illustration="offline"'],
    ['routes/inbox.tsx', 'illustration="emptyList"'],
    ['routes/not-found.tsx', 'illustration="emptyList"'],
    ['routes/plan-snapshot.tsx', 'illustration="emptyList"'],
  ])('%s has %s', (file, illustration) => {
    const text = read(file);
    expect(text).toContain('<EmptyState');
    expect(text).toContain(illustration);
  });

  it('every error boundary renders through ErrorState', () => {
    expect(read('components/layout/RouteErrorBoundary.tsx')).toContain('<ErrorState');
    expect(read('components/layout/GlobalErrorBoundary.tsx')).toContain('<ErrorState');
  });
});
