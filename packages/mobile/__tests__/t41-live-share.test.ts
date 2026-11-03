import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t41 live share UI source guards', () => {
  it('CrewLiveLocation asks for background permission behind the disclosure', () => {
    const src = read('components/CrewLiveLocation.tsx');
    expect(src).toContain('requestBackgroundPermissionsAsync');
    expect(src).toContain('LIVE_SHARE_COPY.bgDisclosureBody');
    expect(src).toContain('keepLocked');
    expect(src).toContain('lockedOnSub');
    expect(src).toMatch(/beginShare\(\s*[^,()]+,\s*[^,()]+,\s*[^,()]+,\s*(true|false)\s*\)/);
  });
  it('LiveSharePublisher skips background intents and posts the stop notice', () => {
    const src = read('components/LiveSharePublisher.tsx');
    expect(src).toContain('.background');
    expect(src).toContain("notifyShareStopped('background')");
  });
});
