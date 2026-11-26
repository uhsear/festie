import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read } from '../__tests__/read-source';

describe('empty states are wired to EmptyState with an illustration', () => {
  it.each([
    ['app/(tabs)/crew.tsx', 'illustration="noCrew"', 'title="No crew yet"'],
    ['app/(tabs)/picks.tsx', 'illustration="noPicks"', 'title="No picks yet"'],
    ['components/CrewExpenses.tsx', 'illustration="emptyList"', 'title="No expenses yet"'],
    ['components/CrewPolls.tsx', 'illustration="emptyList"', 'title="No polls yet"'],
    ['app/inbox.tsx', 'illustration="emptyList"', 'title={INBOX_COPY.emptyTitle}'],
    ['app/+not-found.tsx', 'illustration="emptyList"', 'title="Page not found"'],
    ['components/LoadErrorState.tsx', 'illustration="offline"', '<EmptyState'],
  ])('%s', (file, illustration, title) => {
    const src = read(file);
    expect(src).toContain('<EmptyState');
    expect(src).toContain(illustration);
    expect(src).toContain(title);
  });

  it('inbox load failure goes through LoadErrorState', () => {
    expect(read('app/inbox.tsx')).toContain('<LoadErrorState');
  });

  it('the error boundary shows the brand mark and the not-found screen uses the shared Button via EmptyState', () => {
    expect(read('components/ErrorBoundary.tsx')).toContain('<BrandMark />');
    expect(read('app/+not-found.tsx')).toContain("action={{ label: 'Back to the schedule'");
  });
});

describe('load errors have one source', () => {
  const root = join(__dirname, '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });

  it('no screen passes the offline icon to EmptyState; LoadErrorState owns it', () => {
    const offenders = ['app', 'components']
      .flatMap((d) => sources(join(root, d)))
      .filter((f) => /<EmptyState[^>]*icon="cloud-offline-outline"/s.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});
