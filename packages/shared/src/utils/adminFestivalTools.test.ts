import { describe, it, expect } from 'vitest';
import {
  setEngagementLabel,
  parseLatLng,
} from './adminFestivalTools';

describe('setEngagementLabel', () => {
  it('formats counts', () => {
    expect(setEngagementLabel(undefined)).toBe('');
    expect(setEngagementLabel({ picks: 0, reminders: 0 })).toBe('No picks or reminders yet');
    expect(setEngagementLabel({ picks: 3, reminders: 1 })).toBe('Picked by 3 · 1 reminder');
    expect(setEngagementLabel({ picks: 214, reminders: 61 })).toBe('Picked by 214 · 61 reminders');
  });
});

describe('parseLatLng', () => {
  it('parses valid and rejects invalid text', () => {
    expect(parseLatLng('28.53834, -81.37923')).toEqual({ latitude: 28.53834, longitude: -81.37923 });
    expect(parseLatLng('28.5 -81.3')).toEqual({ latitude: 28.5, longitude: -81.3 });
    expect(parseLatLng('+28.5,-81.3')).toEqual({ latitude: 28.5, longitude: -81.3 });
    expect(parseLatLng('91, 0')).toBeNull();
    expect(parseLatLng('abc')).toBeNull();
    expect(parseLatLng('')).toBeNull();
  });
});
