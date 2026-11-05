// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createVenueGeocoder, venueQueries, backfillVenueCoords, isWeakVenueMatch } from '../lib/geocode';

const hit = (lat: string, lon: string) => ({ ok: true, json: async () => [{ lat, lon }] });
const miss = { ok: true, json: async () => [] };

describe('venueQueries', () => {
  it('tries the full location, then the venue, then the town', () => {
    assert.deepEqual(venueQueries('SeatGeek Stadium · Chicago, IL'), [
      'SeatGeek Stadium, Chicago, IL',
      'SeatGeek Stadium',
      'Chicago, IL',
    ]);
    assert.deepEqual(venueQueries('Central Florida Fairgrounds'), ['Central Florida Fairgrounds']);
  });
});

describe('createVenueGeocoder', () => {
  it('falls back to the next query and returns numeric coordinates', async () => {
    const queries: string[] = [];
    const fetchImpl = async (url: string, init: any) => {
      assert.match(init.headers['User-Agent'], /^Festie\//);
      queries.push(new URL(url).searchParams.get('q') ?? '');
      return queries.length === 1 ? miss : hit('41.7648', '-87.8062');
    };
    const { geocodeVenue } = createVenueGeocoder({ fetchImpl });
    assert.deepEqual(await geocodeVenue('SeatGeek Stadium · Chicago, IL'), { latitude: 41.7648, longitude: -87.8062, guessed: false });
    assert.deepEqual(queries, ['SeatGeek Stadium, Chicago, IL', 'SeatGeek Stadium']);
  });

  it('returns null for an empty location, a failed request or out-of-range data', async () => {
    const { geocodeVenue } = createVenueGeocoder({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    assert.equal(await geocodeVenue(''), null);
    assert.equal(await geocodeVenue('Somewhere'), null);
    const bad = createVenueGeocoder({ fetchImpl: async () => hit('123', '0') });
    assert.equal(await bad.geocodeVenue('Nowhere'), null);
  });
});

describe('backfillVenueCoords', () => {
  it('updates only the festivals it can find and reports once', async () => {
    const updates: unknown[][] = [];
    let reported = 0;
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT')) return { rows: [{ id: 'a', location: 'Found' }, { id: 'b', location: 'Lost' }] };
        updates.push(params ?? []);
        return { rowCount: 1 };
      },
    };
    const geocodeVenue = async (loc: string) => (loc === 'Found' ? { latitude: 1, longitude: 2, guessed: false } : null);
    const filled = await backfillVenueCoords({ pool, geocodeVenue, onUpdated: () => reported++ });
    assert.equal(filled, 1);
    assert.deepEqual(updates, [[1, 2, 'a']]);
    assert.equal(reported, 1);
  });
});

describe('isWeakVenueMatch', () => {
  it('flags area-level and low-importance matches', () => {
    assert.equal(isWeakVenueMatch({ addresstype: 'city', importance: 0.7 }), true);
    assert.equal(isWeakVenueMatch({ addresstype: 'suburb' }), true);
    assert.equal(isWeakVenueMatch({ addresstype: 'leisure', importance: 0.19 }), true);
  });

  it('keeps venue-level matches and rows with no evidence', () => {
    assert.equal(isWeakVenueMatch({ addresstype: 'leisure', importance: 0.2 }), false);
    assert.equal(isWeakVenueMatch({ addresstype: 'amenity', importance: 0.45 }), false);
    assert.equal(isWeakVenueMatch({}), false);
    assert.equal(isWeakVenueMatch(undefined), false);
  });

  it('reports guessed on the geocoder result', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => [{ lat: '28.5', lon: '-81.4', addresstype: 'city', importance: 0.6 }],
    });
    const { geocodeVenue } = createVenueGeocoder({ fetchImpl });
    assert.deepEqual(await geocodeVenue('Orlando'), { latitude: 28.5, longitude: -81.4, guessed: true });
  });
});
