import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T48 mobile Account: your data and who sees it', () => {
  it('AccountDataSection uses exportErrorMessage, not the raw error text', () => {
    const src = read('components/AccountDataSection.tsx');
    expect(src).toContain('exportErrorMessage');
    expect(src).not.toContain('err.message');
  });

  it('the delete form offers Download my data first', () => {
    expect(read('components/AccountDangerSection.tsx')).toContain('DATA_COPY.downloadFirst');
  });

  it('Privacy and sharing renders AccountPrivacySection before the public page section', () => {
    const src = read('app/(tabs)/account.tsx');
    expect(src).toContain('<AccountPrivacySection />');
    expect(src.indexOf('<AccountPrivacySection />')).toBeLessThan(src.indexOf('<AccountPublicScheduleSection />'));
  });

  it('the public schedule hint is the short one', () => {
    expect(read('components/AccountPublicScheduleSection.tsx')).not.toContain('Turning it off hides this page');
  });

  it('AccountPrivacySection stops sharing, reads server status and lets text wrap', () => {
    const src = read('components/AccountPrivacySection.tsx');
    expect(src).toContain('stopAllSharing');
    expect(src).toContain('fetchSharingStatus');
    expect(src).not.toContain('numberOfLines');
  });

  it('useRealtimeSync registers and removes crew:status-updated', () => {
    const src = read('hooks/useRealtimeSync.ts');
    expect(src).toContain("socket.on('crew:status-updated'");
    expect(src).toContain("socket.off('crew:status-updated'");
  });
});
