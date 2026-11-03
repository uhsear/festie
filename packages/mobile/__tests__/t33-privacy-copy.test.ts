// Source-level guards for T33 packet P4 (privacy policy text and in-app Terms).
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const WEB = read('../../public/privacy.html');
const MOBILE = read('app/privacy.tsx');

// Lawyer notes, draft markers, database names and API paths must never reach users.
const FORBIDDEN = /DRAFT|[Cc]ounsel|<code>|users\.|_handle|\/api\/v1|Spotify Account|OAuth|username, and avatar/;

const webText = WEB.replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<\/?(?:a|strong)\b[^>]*>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

/** Every string literal in the mobile SUMMARY and SECTIONS data. */
function mobilePolicyStrings(): string[] {
  const data = MOBILE.slice(MOBILE.indexOf('const SUMMARY'), MOBILE.indexOf('function Bullet('));
  return [...data.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'),
  );
}

describe('T33 privacy policy copy (source-level guards)', () => {
  it.each([
    ['public/privacy.html', WEB],
    ['app/privacy.tsx', MOBILE],
  ])('%s has no draft markers, lawyer notes, column names or API paths', (_name, src) => {
    expect(src).not.toMatch(FORBIDDEN);
  });

  it.each([
    ['public/privacy.html', WEB],
    ['app/privacy.tsx', MOBILE],
  ])('%s has the summary and the fixed-username statement', (_name, src) => {
    expect(src).toContain('In short');
    expect(src).toContain('Your username cannot be changed.');
  });

  it('the mobile text matches the web text word for word', () => {
    const strings = mobilePolicyStrings();
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) expect(webText, s).toContain(s);
  });

  // Fails on purpose until the owner approves the text and fills in the placeholders.
  it.each([
    ['public/privacy.html', WEB],
    ['app/privacy.tsx', MOBILE],
  ])('%s has an effective date and an operator name', (_name, src) => {
    expect(src).not.toContain('{PUBLISH DATE}');
    expect(src).not.toContain('[YOUR NAME]');
  });

  it('the privacy screen opens Terms the same way', () => {
    expect(MOBILE).toContain('WebBrowser.openBrowserAsync(TERMS_URL)');
  });
});
