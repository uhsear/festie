import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app', 'admin', 'crews.tsx'), 'utf8');

// DELETE /admin/crews/:id needs a recent password check, so a bare api.delete only shows a dead-end banner.
describe('admin crews delete reauth', () => {
  it('wraps the crew delete in withReauth', () => {
    expect(src).toMatch(/withReauth\(\s*async \(\) => \{\s*await api\.delete<void>\(`\/admin\/crews\//);
  });
  it('lets the admin retry a mistyped password', () => expect(src).toContain('retryWrongPassword: true'));
  it('renders the reauth dialog', () => expect(src).toContain('{reauthDialog}'));
});
