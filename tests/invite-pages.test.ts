import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeHtml, renderInviteJoinPage, renderInviteErrorPage, INVITE_ERROR_MESSAGES } from '../lib/invite-pages';

// ---------------------------------------------------------------------------
// escapeHtml (re-exported from lib/helpers/sanitize.js)
// ---------------------------------------------------------------------------

describe('invite-pages: escapeHtml', () => {
  it('escapes all dangerous HTML characters', () => {
    const input = '<script>alert("xss")</script> & \'backtick`';
    const result = escapeHtml(input);
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.ok(!result.includes('"'));
    assert.ok(result.includes('&lt;script&gt;'));
    assert.ok(result.includes('&amp;'));
    assert.ok(result.includes('&#39;'));
    assert.ok(result.includes('&#96;'));
  });

  it('coerces non-string values to string', () => {
    assert.equal(escapeHtml(42 as any), '42');
    assert.equal(escapeHtml(null as any), 'null');
    assert.equal(escapeHtml(undefined as any), 'undefined');
  });

  it('returns safe strings unchanged', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });
});

// ---------------------------------------------------------------------------
// renderInviteJoinPage
// ---------------------------------------------------------------------------

describe('invite-pages: renderInviteJoinPage', () => {
  const defaultArgs = {
    crewName: 'Test Crew',
    ownerName: 'Dana',
    memberCount: 6,
    spotsLeft: 2,
    festivalName: 'EDC Orlando',
    startDate: '2026-11-06',
    endDate: '2026-11-08',
    inviteCode: 'ABC123',
    origin: 'https://festie.us',
  };

  it('returns valid HTML document', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('puts the crew in the title, og:title and h1', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('<title>Join Test Crew on Festie</title>'));
    assert.ok(html.includes('<meta property="og:title" content="Join Test Crew on Festie">'));
    assert.ok(html.includes('<h1>Test Crew</h1>'));
  });

  it('describes festival, dates and spots in og:description', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(
      html.includes(
        'og:description" content="EDC Orlando · Nov 6 – Nov 8, 2026 · Crew of 6 · 2 spots left. Plan your sets together on Festie.">',
      ),
    );
  });

  it('leaves null parts out of the description and body', () => {
    const html = renderInviteJoinPage({
      ...defaultArgs,
      ownerName: null,
      festivalName: null,
      startDate: null,
      endDate: null,
    });
    assert.ok(html.includes('og:description" content="Crew of 6 · 2 spots left. Plan your sets together on Festie.">'));
    assert.ok(!html.includes('Started by'));
    assert.ok(!html.includes('null'));
  });

  it('says full when no spots are left, and 1 spot in the singular', () => {
    assert.ok(renderInviteJoinPage({ ...defaultArgs, memberCount: 30, spotsLeft: 0 }).includes('Crew of 30 · full'));
    assert.ok(renderInviteJoinPage({ ...defaultArgs, spotsLeft: 1 }).includes('Crew of 6 · 1 spot left'));
  });

  it('renders the body lines in order', () => {
    const html = renderInviteJoinPage(defaultArgs);
    const bodyStart = html.indexOf('<body>');
    const order = [
      'Crew invite',
      '<h1>Test Crew</h1>',
      'Crew of 6 · 2 spots left',
      'EDC Orlando · Nov 6 – Nov 8, 2026',
      'Started by Dana',
      '>Join Test Crew</a>',
      'New to Festie? You can create an account after you tap Join.',
    ].map((part) => html.indexOf(part, bodyStart));
    assert.ok(order.every((i) => i > bodyStart), `missing body part: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it('links Join to the app with the code and sets og:url and og:image', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('href="https://festie.us/?joinCrew=ABC123"'));
    assert.ok(html.includes('og:url" content="https://festie.us/join/ABC123"'));
    assert.ok(html.includes('og:type" content="website"'));
    assert.ok(html.includes('og:image" content="https://festie.us/og-image.png"'));
    assert.ok(html.includes('og:image:width" content="1200"'));
    assert.ok(html.includes('og:image:height" content="630"'));
    assert.ok(html.includes('twitter:card" content="summary_large_image"'));
    assert.ok(html.includes('theme-color" content="#0a0a0a"'));
  });

  it('escapes every interpolated value inside the renderer', () => {
    const html = renderInviteJoinPage({
      ...defaultArgs,
      crewName: '<script>alert(1)</script>',
      ownerName: '"><img src=x>',
      festivalName: 'Rock & Roll',
      inviteCode: 'A"B',
      origin: 'https://x.test"><b>',
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x>'));
    assert.ok(!html.includes('"><b>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('Rock &amp; Roll'));
    assert.ok(html.includes('joinCrew=A%22B'));
  });

  it('embeds viewport meta tag for mobile', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('width=device-width, initial-scale=1.0'));
  });
});

// ---------------------------------------------------------------------------
// renderInviteErrorPage
// ---------------------------------------------------------------------------

describe('invite-pages: renderInviteErrorPage', () => {
  it('returns valid HTML document', () => {
    const html = renderInviteErrorPage('https://festie.us', INVITE_ERROR_MESSAGES.expired);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('contains the error title', () => {
    const html = renderInviteErrorPage('https://festie.us', INVITE_ERROR_MESSAGES.invalid);
    assert.ok(html.includes("<title>This invite doesn't work</title>"));
  });

  it('contains the escaped error message', () => {
    const expired = renderInviteErrorPage('https://festie.us', INVITE_ERROR_MESSAGES.expired);
    assert.ok(expired.includes('This invite has expired. Ask someone in the crew for a new link.'));
    const invalid = renderInviteErrorPage('https://festie.us', INVITE_ERROR_MESSAGES.invalid);
    assert.ok(invalid.includes('We couldn&#39;t find a crew with this code. Check the link or ask for a new one.'));
  });

  it('contains an Open Festie link with origin', () => {
    const html = renderInviteErrorPage('https://festie.us', 'error');
    assert.ok(html.includes('href="https://festie.us/"'));
    assert.ok(html.includes('Open Festie'));
  });

  it('HTML-escapes the message and the origin', () => {
    const html = renderInviteErrorPage('https://x.test"><b>', '<script>alert("xss")</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('"><b>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('escapes ampersands in error message', () => {
    const html = renderInviteErrorPage('https://festie.us', 'A & B');
    assert.ok(html.includes('A &amp; B'));
  });

  it('contains viewport meta tag', () => {
    const html = renderInviteErrorPage('https://festie.us', 'error');
    assert.ok(html.includes('width=device-width, initial-scale=1.0'));
  });
});
