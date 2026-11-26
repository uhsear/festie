// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/** The share page and its error page take their colours, mark and copy from the design module. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { renderShareErrorPage, renderSharePage, sharePriorityCss } from '../routes/share.js';
import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';

const page = renderSharePage({
  username: 'dana', avatarUrl: '', festivalName: 'Example Fest', festivalLocation: '',
  days: [{ label: 'Fri', date: '', sets: [{ artist: 'Alpha', timeText: '8:00 PM', stage: 'Main', stageColor: '#112233', priority: 'want-to-see' }] }],
  totalPicks: 1, mustCount: 0, wantCount: 1, maybeCount: 0,
  origin: 'https://example.test', shareUrl: 'https://example.test/s/x', ogUrl: 'https://example.test/s/x/og.png',
  ogAlt: 'alt', jsonLd: '{}', compareUrl: 'https://example.test/c', addUrl: 'https://example.test/c#add', appUrl: 'festie://x',
});

describe('share page design', () => {
  test('the priority colours equal colors.priority in Stage and Daylight', () => {
    const [stage, daylight] = sharePriorityCss.split('@media');
    for (const key of ['must', 'want', 'maybe'] as const) {
      assert.ok(stage!.includes(`--pr-${key}: ${colors.priority[key]};`), `stage ${key}`);
      assert.ok(daylight!.includes(`--pr-${key}: ${colorsDaylight.priority[key]};`), `daylight ${key}`);
    }
    assert.equal(colors.priority.want, colors.accent.aqua, 'Want is aqua');
  });

  test('a pick shows its priority through the token variable, not a literal colour', () => {
    assert.ok(page.includes('color: var(--pr-want)'));
    assert.ok(!/ffaa00|#888|d6154f|ff5c85/i.test(page));
  });

  test('the page and the error page carry the mark and the aqua CTA', () => {
    const error = renderShareErrorPage('We cannot find that schedule', 'Ask for a new link.', 'https://example.test');
    for (const html of [page, error]) {
      assert.ok(html.includes('aria-label="Festie"'), 'mark');
      assert.ok(html.includes('class="ds-cta'), 'CTA');
    }
    assert.ok(error.includes('Open Festie'));
    assert.ok(!error.includes('🎵'));
  });

  test('the error page escapes the title and the message', () => {
    const error = renderShareErrorPage('<b>t</b>', '<i>m</i>', 'https://example.test');
    assert.ok(!error.includes('<b>t</b>') && !error.includes('<i>m</i>'));
  });

  test('routes/share.ts holds none of the retired literals', () => {
    const src = readFileSync(new URL('../routes/share.ts', import.meta.url), 'utf8');
    assert.ok(!/ffaa00|#888|🎵/.test(src));
  });
});
