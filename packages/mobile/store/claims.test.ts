import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

type Proof = { file: string; contains: string };
type Claim = { name: string; phrase: RegExp; proofs: Proof[] };

// Proofs are repo-root-relative. A claim with no match in a listing needs no proof,
// so the listing copy can change without breaking this test.
const CLAIMS: Claim[] = [
  { name: 'calendar export', phrase: /calendar|\.ics/i, proofs: [
    { file: 'packages/mobile/hooks/usePicksCalendar.ts', contains: 'buildPicksIcsExport' },
    { file: 'packages/shared/src/utils/ics.test.ts', contains: 'describe(' },
  ] },
  { name: 'crew of thirty', phrase: /thirty|\b30[- ]person/i, proofs: [
    { file: 'packages/shared/src/constants/config.ts', contains: 'DEFAULT_CREW_MAX_MEMBERS = 30' },
  ] },
  { name: 'live location opt-in, stops at chosen time', phrase: /live location/i, proofs: [
    { file: 'packages/mobile/lib/backgroundShare.ts', contains: 'background' },
    { file: 'packages/mobile/__tests__/live-share-ui.test.ts', contains: 'describe(' },
  ] },
  { name: 'SOS', phrase: /\bSOS\b/, proofs: [
    { file: 'routes/crew-sos.ts', contains: 'sos:raised' },
    { file: 'packages/mobile/__tests__/sos-tools.test.ts', contains: 'describe(' },
  ] },
  { name: 'meeting point', phrase: /meeting point/i, proofs: [
    { file: 'packages/mobile/components/CrewMeetingPoints.tsx', contains: 'export' },
    { file: 'packages/mobile/__tests__/meeting-points.test.ts', contains: 'describe(' },
  ] },
  { name: 'clash spotting', phrase: /clash/i, proofs: [
    { file: 'packages/shared/src/utils/clashPlan.ts', contains: 'export' },
    { file: 'packages/shared/src/utils/conflicts.ts', contains: 'export' },
  ] },
  { name: 'real-time sync', phrase: /real[- ]time|in sync/i, proofs: [
    { file: 'packages/shared/src/services/socket.ts', contains: 'export' },
    { file: 'packages/mobile/__tests__/realtime-sync.test.ts', contains: 'describe(' },
  ] },
  { name: 'push alerts', phrase: /push|notif/i, proofs: [
    { file: 'packages/mobile/hooks/useMobilePush.ts', contains: 'export' },
  ] },
  { name: 'plan share by QR', phrase: /\bQR\b/, proofs: [
    { file: 'packages/mobile/app/plan-share.tsx', contains: 'export' },
    { file: 'packages/mobile/components/PlanQRScan.tsx', contains: 'export' },
  ] },
  { name: 'offline map (narrow)', phrase: /offline maps?/i, proofs: [
    { file: 'packages/mobile/lib/basemapCache.ts', contains: 'MAX_INLINE_BYTES' },
  ] },
];

// SR-83 (OD-S17 = C): offline maps exist only for festivals that provide an archive.
const OVERCLAIMS = [
  /offline maps?\b[^.\n]*\b(every|all|any) festivals?/i,
  /\b(every|all|any) festivals?\b[^.\n]*offline maps?/i,
  /\b(full|complete)\b[^.\n]*offline maps?/i,
];

function listingTexts(): { source: string; text: string }[] {
  return ['play', 'ios'].flatMap((sub) => {
    const dir = join(here, sub);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith('listing.') && f.endsWith('.json'))
      .map((f) => {
        const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
        const text = Object.values(json).filter((v) => typeof v === 'string').join('\n');
        return { source: `${sub}/${f}`, text };
      });
  });
}

const PROSE = ['review-notes.md', 'release-notes/play.en-US.txt', 'release-notes/apple.en-US.txt'].map(
  (source) => ({ source, text: read(source) }),
);

describe('store claims', () => {
  it('every claim in a listing has a proof file that contains its string', () => {
    for (const { source, text } of listingTexts()) {
      for (const claim of CLAIMS.filter((c) => c.phrase.test(text))) {
        for (const { file, contains } of claim.proofs) {
          const path = join(repoRoot, file);
          expect(existsSync(path), `${source}: claim "${claim.name}" cites missing ${file}`).toBe(true);
          expect(readFileSync(path, 'utf8'), `${source}: claim "${claim.name}" needs "${contains}" in ${file}`).toContain(contains);
        }
      }
    }
  });

  it('every claim in the review and release notes has a proof file', () => {
    for (const { source, text } of PROSE) {
      for (const claim of CLAIMS.filter((c) => c.phrase.test(text))) {
        for (const { file, contains } of claim.proofs) {
          const path = join(repoRoot, file);
          expect(existsSync(path), `${source}: claim "${claim.name}" cites missing ${file}`).toBe(true);
          expect(readFileSync(path, 'utf8'), `${source}: claim "${claim.name}" needs "${contains}" in ${file}`).toContain(contains);
        }
      }
    }
  });

  it('no listing or note claims a full offline map for every festival', () => {
    for (const { source, text } of [...listingTexts(), ...PROSE]) {
      for (const bad of OVERCLAIMS) expect(text, source).not.toMatch(bad);
    }
  });

  it('overclaim patterns catch the wording they target', () => {
    expect('Full offline map for every festival').toMatch(OVERCLAIMS[0]!);
    expect('Download any festival for an offline map').toMatch(OVERCLAIMS[1]!);
    expect('A complete offline map').toMatch(OVERCLAIMS[2]!);
    for (const ok of ['Offline maps open where the festival provides one; a pin list otherwise.']) {
      for (const bad of OVERCLAIMS) expect(ok).not.toMatch(bad);
    }
  });
});

describe('store release notes', () => {
  it('play notes are at most 500 characters', () => {
    expect(read('release-notes/play.en-US.txt').trim().length).toBeLessThanOrEqual(500);
  });
  it('apple notes are at most 4000 characters', () => {
    expect(read('release-notes/apple.en-US.txt').trim().length).toBeLessThanOrEqual(4000);
  });
});

describe('store review notes', () => {
  it('stay under 4000 bytes', () => {
    expect(Buffer.byteLength(read('review-notes.md'))).toBeLessThan(4000);
  });
  it('hold no password', () => {
    expect(read('review-notes.md')).not.toMatch(/password\s*[:=]/i);
  });
  it('say demo account', () => {
    expect(read('review-notes.md')).toContain('demo account');
  });
});
