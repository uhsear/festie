import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  assert.match(html, /<li><strong>Invitations:<\/strong>[^<]*accepted or cancelled\./);
  assert.match(html, /expires after 90 days, and we delete it 120 days after we sent it/);
});

test('mobile privacy screen mirrors the organizer subsection', () => {
  const tsx = readFileSync(resolve('packages/mobile/app/privacy.tsx'), 'utf8');
  assert.ok(tsx.includes("heading: 'If you work with a festival organizer account'"));
});

test('placeholders are plain text, never a stray tag, and all of them are marked TODO', () => {
  for (const name of ['terms.html', 'privacy.html', 'dmca.html', 'security-whitepaper.html']) {
    const html = page(name);
    assert.doesNotMatch(html, /<(?:D|D30|SEND|ADDRESS|AGENT NAME|DATE)>/, `${name} has a raw placeholder tag`);
    for (const m of html.matchAll(/\[(TODO[^\]]*)\]/g)) {
      assert.match(m[1] ?? '', /^TODO(?:-[A-Za-z0-9-]+)?:/, `${name}: malformed placeholder [${m[1]}]`);
    }
  }
});

test('security whitepaper no longer makes the claims the code does not back', () => {
  const html = page('security-whitepaper.html');
  for (const stale of ['tamper-evident', 'SHA-256 checksums', 'Origin and Referer headers', 'explicit re-acceptance', 'Monthly restoration', 'WAL files retained for 7 days', 'geographically distributed']) {
    assert.ok(!html.includes(stale), `security-whitepaper.html still says "${stale}"`);
  }
  // Production leaves COOKIE_SAME_SITE unset, so lib/config.ts normalizeSameSite falls back to lax.
  assert.match(html, /SameSite=Lax/, 'the whitepaper must state the SameSite=Lax default production uses');
  assert.ok(!html.includes('SameSite=Strict'), 'the whitepaper must not claim SameSite=Strict');
});

test('release check flags a placeholder left in a legal page or the mobile privacy screen', () => {
  const root = mkdtempSync(join(tmpdir(), 'legal-check-'));
  mkdirSync(join(root, 'public'));
  mkdirSync(join(root, 'packages/mobile/app'), { recursive: true });
  const write = (file: string, text: string) => writeFileSync(join(root, file), text + '\n');
  write('public/terms.html', '<p>Effective [TODO-D: effective date]</p>');
  write('public/about.html', '<p>Clean</p>');
  write('packages/mobile/app/privacy.tsx', "const D = '[TODO-D: effective date]';");
  const check = () => spawnSync(process.execPath, [resolve('scripts/ci/check-legal-placeholders.mjs'), '--root', root], { encoding: 'utf8' });
  const failed = check();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /public\/terms\.html:1:/);
  assert.match(failed.stderr, /packages\/mobile\/app\/privacy\.tsx:1:/);
  assert.doesNotMatch(failed.stderr, /about\.html/);
  write('public/terms.html', '<p>Effective December 1, 2026</p>');
  write('packages/mobile/app/privacy.tsx', "const D = 'December 1, 2026';");
  assert.equal(check().status, 0);
});
