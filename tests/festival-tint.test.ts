import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { festivalTint } from '../lib/festival-tint';

describe('festivalTint', () => {
  it('matches the shared vectors', () => {
    assert.deepEqual(festivalTint('Coachella'), { hue: 135, bg: '#08160c', pale: '#122b18', faint: '#21452a', active: '#42f06e' });
    assert.deepEqual(festivalTint('  edc orlando '), { hue: 248, bg: '#0a0816', pale: '#16122b', faint: '#262145', active: '#5942f0' });
    assert.deepEqual(festivalTint(''), { hue: 61, bg: '#161608', pale: '#2a2b12', faint: '#444521', active: '#edf042' });
  });
});
