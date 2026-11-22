import { describe, it, expect } from 'vitest';
import { describeMutation } from './mutationLabel';

describe('describeMutation', () => {
  it('names picks and notes writes instead of the raw profile path', () => {
    expect(describeMutation('PUT', '/profiles/prof-1')).toBe('Update picks');
    expect(describeMutation('POST', '/profiles', { festivalId: 'f1' })).toBe('Join festival');
  });

  it('puts the meeting point label in the text so two rows differ', () => {
    expect(describeMutation('POST', '/crews/c1/meeting-points', { label: 'Doomed one' })).toBe(
      'Add meeting point: Doomed one',
    );
    expect(describeMutation('POST', '/crews/c1/meeting-points', { label: 'Doomed two' })).toBe(
      'Add meeting point: Doomed two',
    );
  });

  it('names polls, expenses, rides, packing, status, days, ratings and reminders', () => {
    expect(describeMutation('POST', '/crews/c1/polls', { question: 'Pizza?' })).toBe('Add poll: Pizza?');
    expect(describeMutation('POST', '/crews/c1/expenses', { description: 'Taxi' })).toBe('Add expense: Taxi');
    expect(describeMutation('DELETE', '/crews/c1/rides/r1')).toBe('Remove ride');
    expect(describeMutation('PUT', '/crews/c1/packing/p1')).toBe('Update packing item');
    expect(describeMutation('PUT', '/crews/c1/status')).toBe('Update crew status');
    expect(describeMutation('PUT', '/crews/c1/days')).toBe('Update my days');
    expect(describeMutation('POST', '/ratings/s1')).toBe('Add rating');
    expect(describeMutation('POST', '/crews/c1/reminders')).toBe('Add reminder');
    expect(describeMutation('POST', '/crews/join')).toBe('Join crew');
  });

  it('keeps the method and path fallback for unknown endpoints', () => {
    expect(describeMutation('POST', '/widgets/1?x=1')).toBe('POST /widgets/1');
    expect(describeMutation(undefined, undefined)).toBe('POST (unknown)');
  });
});
