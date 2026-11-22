import { describe, it, expect } from 'vitest';
import { backfillLabel, classifyBackfillReport, describeBackfillEntry, isIdempotentPlan } from './artistBackfillReview';

const kinds = (items: Array<{ kind: string }>) => items.map((i) => i.kind);

describe('classifyBackfillReport', () => {
  it('returns nothing to stop or review for an empty report', () => {
    const out = classifyBackfillReport({ counts: { festivals: 2, festivalsToWrite: 2 } });
    expect(out.stop).toEqual([]);
    expect(out.review).toEqual([]);
    expect(out.info.counts.festivals).toBe(2);
  });

  it('stops on a rename that changes the name and reviews a case-only or diacritic-only rename', () => {
    const out = classifyBackfillReport({
      renames: [
        { festivalId: 'f1', setId: 's1', before: 'Zed Zebra', after: 'Zed Zebras' },
        { festivalId: 'f1', setId: 's2', before: 'ZED ZEBRA', after: 'Zed Zebra' },
        { festivalId: 'f1', setId: 's3', before: 'Zoë Quill', after: 'Zoe Quill' },
      ],
    });
    expect(out.stop).toEqual([{ kind: 'renames', count: 1, examples: ['f1 | s1 | Zed Zebra -> Zed Zebras'] }]);
    expect(out.review.find((r) => r.kind === 'renamesCaseOnly')?.count).toBe(2);
  });

  it('stops on the hard lists and on festivalsToWrite above festivals', () => {
    const out = classifyBackfillReport({
      counts: { festivals: 1, festivalsToWrite: 2 },
      needsPick: [{ festivalId: 'f1', kind: 'set', ownerId: 's1', ordinal: 0, name: 'Pat Pending' }],
      linkConflicts: [{ artist: 'A', platform: 'instagram', kept: 'x', dropped: 'y' }],
      photosNotCopied: [{ festivalId: 'f1', ownerId: 's1', name: 'A', photo: 'p' }],
      linksNotCopied: [{ festivalId: 'f1', ownerId: 's1', name: 'A', links: { a: 'b' } }],
    });
    expect(kinds(out.stop)).toEqual(['needsPick', 'linkConflicts', 'photosNotCopied', 'linksNotCopied', 'festivalsToWrite']);
  });

  it('stops when a joinedByName set name differs from the artist beyond case', () => {
    const out = classifyBackfillReport({
      joinedByName: [
        { artist: 'Moss Quartet', festivalId: 'f1', ownerId: 's1', name: 'moss quartet' },
        { artist: 'Moss Quartet', festivalId: 'f1', ownerId: 's2', name: 'Moss Quartet Live' },
      ],
    });
    expect(out.stop.find((s) => s.kind === 'joinedByNameDiffers')?.count).toBe(1);
  });

  it('stops on suffix-only differences across festivals unless the pair is a copy pair', () => {
    const report = {
      joinedByName: [
        { artist: 'Moss Quartet', festivalId: 'f1', ownerId: 's1', name: 'Moss Quartet' },
        { artist: 'Moss Quartet', festivalId: 'f2', ownerId: 's2', name: 'Moss Quartet (Sunset Set)' },
      ],
    };
    expect(kinds(classifyBackfillReport(report).stop)).toContain('joinedByNameSuffix');
    const copy = classifyBackfillReport(report, { copyPairs: [['f2', 'f1']] });
    expect(kinds(copy.stop)).not.toContain('joinedByNameSuffix');
    expect(kinds(copy.review)).toContain('joinedByNameAcrossFestivals');
  });

  it('reviews the soft lists and groups link failures by message', () => {
    const failure = (message: string) => ({ festivalId: 'f1', ownerId: 's', name: 'A', platform: 'x', url: 'u', message });
    const out = classifyBackfillReport({
      joinedBySpotify: [{ artist: 'A', names: ['A', 'a'] }],
      b2bSplits: [{ festivalId: 'f1', ownerId: 's1', name: 'A b2b B', parts: ['A', 'B'] }],
      separateArtists: [{ key: 'k', names: ['A', 'A'], notes: [] }],
      linkFailures: [failure('bad host'), failure('bad host'), failure('too long')],
    });
    expect(out.stop).toEqual([]);
    expect(kinds(out.review)).toEqual(['joinedBySpotify', 'b2bSplits', 'separateArtists', 'linkFailures']);
    const failures = out.review.find((r) => r.kind === 'linkFailures');
    expect(failures).toEqual({ kind: 'linkFailures', count: 3, examples: ['2 x bad host', '1 x too long'] });
  });

  it('caps examples', () => {
    const needsPick = Array.from({ length: 9 }, (_, i) => ({ festivalId: 'f', kind: 'set', ownerId: `s${i}`, ordinal: 0, name: `N${i}` }));
    const out = classifyBackfillReport({ needsPick }, { maxExamples: 3 });
    expect(out.stop[0]!.count).toBe(9);
    expect(out.stop[0]!.examples).toHaveLength(3);
  });
});

describe('describeBackfillEntry', () => {
  it('puts location first and before -> after last', () => {
    expect(describeBackfillEntry({ before: 'a', after: 'b', festivalId: 'f1', setId: 's1' })).toBe('f1 | s1 | a -> b');
  });
  it('joins arrays and prints objects as JSON', () => {
    expect(describeBackfillEntry({ key: 'k', names: ['a', 'b'], links: { x: 'y' } })).toBe('k | a, b | {"x":"y"}');
  });
});

describe('isIdempotentPlan', () => {
  it('is true only when all three to-write counts are zero', () => {
    expect(isIdempotentPlan({ counts: { artistsToCreate: 0, festivalsToWrite: 0, ownersToWrite: 0 } })).toBe(true);
    expect(isIdempotentPlan({ counts: { artistsToCreate: 0, festivalsToWrite: 1, ownersToWrite: 0 } })).toBe(false);
    expect(isIdempotentPlan({})).toBe(false);
  });
});

describe('backfillLabel', () => {
  it('names the report keys in plain words and passes unknown keys through', () => {
    expect(backfillLabel('legacyFlatOnlySets')).toBe('Sets with only an old single name');
    expect(backfillLabel('b2bSplits')).toBe('B2B names split into separate artists');
    expect(backfillLabel('somethingNew')).toBe('somethingNew');
  });
});
