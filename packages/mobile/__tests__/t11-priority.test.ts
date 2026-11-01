import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t11 priority labels source guards', () => {
  it.each(['components/SetCardMobile.tsx', 'components/TBASection.tsx'])('%s does not append (selected)', (file) => {
    expect(read(file)).not.toContain('(selected');
  });
});
