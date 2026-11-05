import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  escapeHtml,
  renderInviteJoinPage,
  renderInviteErrorPage,
  renderInviteIcs,
  INVITE_ERROR_MESSAGES,
} from '../lib/invite-pages';

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

  it('tints the page with the festival colour', () => {
    const html = renderInviteJoinPage({ ...defaultArgs, festivalName: 'Coachella' });
    assert.ok(html.includes('body { background: #08160c; }'));
  });

  it('has a light-scheme block that follows the tint rules, on the join and error pages', () => {
    const html = renderInviteJoinPage(defaultArgs);
    const light = html.indexOf('@media (prefers-color-scheme: light)');
    assert.ok(light > html.indexOf('body { background: #'), 'light block must come after the tint');
    assert.ok(html.includes('background: #f4f4f7'));
    assert.ok(html.includes('border-top-color'));
    assert.ok(renderInviteErrorPage('https://festie.us', 'x').includes('@media (prefers-color-scheme: light)'));
  });

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
    assert.ok(!html.includes('Led by'));
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
      'Led by Dana',
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

  it('offers Save for later under Join when the festival has dates', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(
      html.includes('<a href="https://festie.us/join/ABC123/save.ics" class="invite-link invite-save" download>Save for later</a>'),
    );
    assert.ok(html.includes('Adds the festival dates and this invite to your calendar.'));
    assert.ok(html.indexOf('>Join Test Crew</a>') < html.indexOf('Save for later'));
    assert.ok(html.includes('.invite-save { display: inline-block; margin-top: 16px; padding: 12px 8px; }'));
  });

  it('has no Save for later link without both dates', () => {
    for (const dates of [{ startDate: null }, { endDate: null }, { startDate: null, endDate: null }]) {
      const html = renderInviteJoinPage({ ...defaultArgs, ...dates });
      assert.ok(!html.includes('save.ics'));
      assert.ok(!html.includes('Save for later'));
    }
  });

  it('encodes and escapes the code in the Save for later link', () => {
    const html = renderInviteJoinPage({ ...defaultArgs, inviteCode: 'A"B<x>' });
    assert.ok(html.includes('href="https://festie.us/join/A%22B%3Cx%3E/save.ics"'));
    assert.ok(!html.includes('A"B<x>'));
  });
});

// ---------------------------------------------------------------------------
// renderInviteIcs
// ---------------------------------------------------------------------------

describe('invite-pages: renderInviteIcs', () => {
  // The public preview this comes from also knows the owner and members. None
  // of that may reach the calendar file.
  const preview = {
    crewName: 'Bass Gang',
    ownerName: 'Ana Lopez',
    members: [
      { userId: 'u-1', username: 'ana', name: 'Ana Lopez', role: 'owner' },
      { userId: 'u-2', username: 'ben', name: 'Ben Ortiz', role: 'member' },
    ],
    festivalName: 'EDC Orlando',
    startDate: '2026-11-06',
    endDate: '2026-11-08',
  };
  const args = {
    festivalName: preview.festivalName,
    crewName: preview.crewName,
    startDate: preview.startDate,
    endDate: preview.endDate,
    inviteCode: 'ABC123',
    origin: 'https://festie.us',
  };

  it('is one all-day event over the festival dates, with an exclusive end', () => {
    const ics = renderInviteIcs(args);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR'));
    assert.equal(ics.split('BEGIN:VEVENT').length - 1, 1);
    assert.ok(ics.includes('\r\nDTSTART;VALUE=DATE:20261106\r\n'));
    assert.ok(ics.includes('\r\nDTEND;VALUE=DATE:20261109\r\n'));
    assert.ok(ics.includes('PRODID:-//Festie//Invite//EN'));
    assert.ok(ics.includes('X-WR-CALNAME:EDC Orlando'));
    assert.ok(ics.includes('SUMMARY:EDC Orlando'));
    assert.ok(ics.includes('UID:invite-ABC123@https://festie.us'));
    assert.ok(!ics.includes('VALARM'));
    assert.ok(!ics.includes('LOCATION:'));
  });

  it('crosses a month end for the exclusive end date', () => {
    const ics = renderInviteIcs({ ...args, startDate: '2026-12-30', endDate: '2026-12-31' });
    assert.ok(ics.includes('DTEND;VALUE=DATE:20270101'));
  });

  it('holds the invite URL and no owner, member or user id', () => {
    // Unfold first so a folded line cannot hide or split a string.
    const ics = renderInviteIcs(args).replace(/\r\n /g, '');
    assert.ok(ics.includes('DESCRIPTION:Crew invite to Bass Gang on Festie: https://festie.us/join/ABC123'));
    for (const leak of ['Ana Lopez', 'Ben Ortiz', 'ana', 'ben', 'u-1', 'u-2']) {
      assert.ok(!ics.includes(leak), `ICS leaks ${leak}`);
    }
    assert.ok(!/u-\d/.test(ics));
  });

  it('escapes commas and semicolons in the crew name', () => {
    const ics = renderInviteIcs({ ...args, crewName: 'Bass, Gang; Crew' }).replace(/\r\n /g, '');
    assert.ok(ics.includes('Crew invite to Bass\\, Gang\\; Crew on Festie'));
  });

  it('falls back to generic names without a festival name', () => {
    const ics = renderInviteIcs({ ...args, festivalName: null });
    assert.ok(ics.includes('SUMMARY:Festival'));
    assert.ok(ics.includes('X-WR-CALNAME:Festie'));
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

  it('has the locked message', () => {
    assert.equal(INVITE_ERROR_MESSAGES.locked, "This crew isn't taking new members.");
    const html = renderInviteErrorPage('https://festie.us', INVITE_ERROR_MESSAGES.locked);
    assert.ok(html.includes('This crew isn&#39;t taking new members.'));
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
