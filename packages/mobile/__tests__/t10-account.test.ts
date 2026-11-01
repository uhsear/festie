import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const files = [
  'app/(tabs)/account.tsx',
  'components/AccountPaymentHandlesSection.tsx',
  'components/AccountDataSection.tsx',
  'components/AccountDisplayNameSection.tsx',
  'components/AccountEmailVerifySection.tsx',
];

describe('T10 account rows at large text', () => {
  it.each(files)('%s does not clamp rowHint to one line', (f) => {
    expect(read(f)).not.toContain('rowHint} numberOfLines={1}');
  });
  it.each([files[0], files[4]])('%s does not middle-ellipsize', (f) => {
    expect(read(f)).not.toContain('ellipsizeMode="middle"');
  });
});
