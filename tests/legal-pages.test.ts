import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = (name: string) => readFileSync(resolve('public', name), 'utf8');

/** Text of every h2 and h3 heading on a static page. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, '').trim());
}

test('terms page renders the new sections as headings', () => {
  const found = headings(page('terms.html'));
  for (const heading of [
    'Festival and artist information',
    'Spotify',
    'Copyright and removal requests',
    'Festival organizers',
    'Festie is not an emergency service',
  ]) {
    assert.ok(found.includes(heading), `terms.html is missing the heading "${heading}"`);
  }
});

test('privacy page renders the organizer subsection and the organizer recipient', () => {
  const html = page('privacy.html');
  assert.ok(headings(html).includes('If you work with a festival organizer account'));
  assert.match(html, /<li><strong>Festival organizers:<\/strong>/);
  assert.match(html, /<li><strong>Invitations:<\/strong>[^<]*after 90 days\./);
});

test('mobile privacy screen mirrors the organizer subsection', () => {
  const tsx = readFileSync(resolve('packages/mobile/app/privacy.tsx'), 'utf8');
  assert.ok(tsx.includes("heading: 'If you work with a festival organizer account'"));
});

test('placeholders are plain text, never a stray tag, and all of them are marked TODO', () => {
  for (const name of ['terms.html', 'privacy.html', 'security-whitepaper.html']) {
    const html = page(name);
    assert.doesNotMatch(html, /<(?:D|D30|SEND|ADDRESS|AGENT NAME|DATE)>/, `${name} has a raw placeholder tag`);
    for (const m of html.matchAll(/\[(TODO[^\]]*)\]/g)) {
      assert.match(m[1] ?? '', /^TODO(?:-[A-Za-z0-9-]+)?:/, `${name}: malformed placeholder [${m[1]}]`);
    }
  }
});

test('security whitepaper no longer makes the claims the code does not back', () => {
  const html = page('security-whitepaper.html');
  for (const stale of ['tamper-evident', 'SameSite=Strict', 'Monthly restoration', 'WAL files retained for 7 days', 'geographically distributed']) {
    assert.ok(!html.includes(stale), `security-whitepaper.html still says "${stale}"`);
  }
});
