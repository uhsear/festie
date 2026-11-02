import { describe, it, expect } from 'vitest';
import { summarizeSetRatings } from './ratingSummary';

const crowd = (avg: number, count: number) => new Map([['s', { avg, count }]]);
const run = (c: ReturnType<typeof crowd> | null) => summarizeSetRatings({ setId: 's', crowd: c, crew: null, myUserId: null });

describe('summarizeSetRatings crowd', () => {
  it('shows crowd favourite at count 5 and avg 4.5', () => {
    expect(run(crowd(4.5, 5)).crowd).toBe('Crowd favourite · 4.5 out of 5 from 5 ratings');
  });
  it('falls back to the plain line below the favourite thresholds', () => {
    expect(run(crowd(4.4, 5)).crowd).toBe('Crowd: 4.4 out of 5 from 5 ratings');
    expect(run(crowd(4.9, 4)).crowd).toBe('Crowd: 4.9 out of 5 from 4 ratings');
    expect(run(crowd(4, 3)).crowd).toBe('Crowd: 4.0 out of 5 from 3 ratings');
  });
  it('shows nothing under 3 ratings or with no data', () => {
    expect(run(crowd(5, 2)).crowd).toBeNull();
    expect(run(null).crowd).toBeNull();
  });
});

describe('summarizeSetRatings crew', () => {
  const r = (userId: string, username: string, rating: number) => ({ userId, username, rating });
  it('excludes me, sorts by rating then name, and labels', () => {
    const crew = new Map([['s', [r('me', 'Me', 5), r('2', 'Sam', 4), r('3', 'Alex', 5), r('4', 'Bo', 4)]]]);
    const out = summarizeSetRatings({ setId: 's', crowd: null, crew, myUserId: 'me' });
    expect(out.crew).toBe('Your crew: Alex (Fire), Bo (Good), Sam (Good)');
  });
  it('adds "and k more" after 4 names', () => {
    const list = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => r(String(i), n, 3));
    const out = summarizeSetRatings({ setId: 's', crowd: null, crew: new Map([['s', list]]), myUserId: null });
    expect(out.crew).toBe('Your crew: A (Okay), B (Okay), C (Okay), D (Okay) and 2 more');
  });
  it('gives no line when only I rated or nobody did', () => {
    const crew = new Map([['s', [r('me', 'Me', 5)]]]);
    expect(summarizeSetRatings({ setId: 's', crowd: null, crew, myUserId: 'me' }).crew).toBeNull();
    expect(summarizeSetRatings({ setId: 'x', crowd: null, crew, myUserId: 'me' }).crew).toBeNull();
  });
});
