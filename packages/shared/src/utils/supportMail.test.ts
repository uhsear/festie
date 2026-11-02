import { describe, it, expect } from 'vitest';
import { buildSupportMailto } from './supportMail';

function parse(url: string) {
  const [head, query] = url.split('?');
  const params = new URLSearchParams(query);
  return { head, subject: params.get('subject'), body: params.get('body') };
}

describe('buildSupportMailto', () => {
  it('builds subject and body', () => {
    const r = parse(buildSupportMailto({ platform: 'ios', version: '1.4.0', device: 'iPhone 15', username: 'alice' }));
    expect(r.head).toBe('mailto:support@festie.us');
    expect(r.subject).toBe('Festie support');
    expect(r.body).toBe(
      '\n\n\n---\nPlease keep these lines. They help us find the problem.\nApp: Festie ios 1.4.0\nDevice: iPhone 15\nUsername: alice',
    );
  });
  it('drops the Username line when empty', () => {
    const r = parse(buildSupportMailto({ platform: 'web', version: '1.4.0', device: 'Chrome', username: '' }));
    expect(r.body).not.toContain('Username');
    expect(r.body!.endsWith('Device: Chrome')).toBe(true);
  });
});
