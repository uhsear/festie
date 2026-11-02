import { describe, it, expect } from 'vitest';
import {
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  PRIORITY_SYMBOLS,
  CREW_ACTIVITY_LABELS,
  CREW_CURRENCIES,
  PACKING_TEMPLATES,
  EXPENSE_CATEGORIES,
  expenseCategoryFor,
  RATING_SCALE_DATA,
  RATING_SCALE,
  RATING_LABEL,
  ratingCaption,
  LIVE_SHARE_DURATIONS,
} from './config';
import { PRIORITY_WEIGHT } from '../utils/crewNudges';

describe('PRIORITY_LABEL', () => {
  it('has short labels for all three priorities', () => {
    expect(PRIORITY_LABEL.must).toBe('Must');
    expect(PRIORITY_LABEL['want-to-see']).toBe('Want');
    expect(PRIORITY_LABEL.maybe).toBe('Maybe');
  });
});

describe('PRIORITY_WEIGHT', () => {
  it('must > want-to-see > maybe', () => {
    expect(PRIORITY_WEIGHT.must).toBeGreaterThan(PRIORITY_WEIGHT['want-to-see']);
    expect(PRIORITY_WEIGHT['want-to-see']).toBeGreaterThan(PRIORITY_WEIGHT.maybe);
  });

  it('has values 3 / 2 / 1', () => {
    expect(PRIORITY_WEIGHT.must).toBe(3);
    expect(PRIORITY_WEIGHT['want-to-see']).toBe(2);
    expect(PRIORITY_WEIGHT.maybe).toBe(1);
  });
});

describe('PRIORITY_OPTIONS', () => {
  it('has exactly three entries', () => {
    expect(PRIORITY_OPTIONS).toHaveLength(3);
  });

  it('covers all three priority values', () => {
    const values = PRIORITY_OPTIONS.map((o) => o.value);
    expect(values).toContain('must');
    expect(values).toContain('want-to-see');
    expect(values).toContain('maybe');
  });

  it('sort order is ascending must→want→maybe', () => {
    const sorted = [...PRIORITY_OPTIONS].sort((a, b) => a.sort - b.sort);
    expect(sorted[0]!.value).toBe('must');
    expect(sorted[1]!.value).toBe('want-to-see');
    expect(sorted[2]!.value).toBe('maybe');
  });

  it('short matches PRIORITY_LABEL', () => {
    for (const opt of PRIORITY_OPTIONS) {
      expect(opt.short).toBe(PRIORITY_LABEL[opt.value]);
    }
  });
});

describe('CREW_ACTIVITY_LABELS', () => {
  it('covers core crew event types', () => {
    const required = [
      'member-joined',
      'member-left',
      'member-kicked',
      'poll-created',
      'poll-voted',
      'expense-added',
      'expense-deleted',
      'expense-settled',
      'home-base-updated',
      'meeting-point-added',
      'meeting-point-removed',
      'crew-updated',
      'owner-changed',
      'poll-closed',
      'meeting-point-updated',
      'expense_settled',
      'packing-created',
      'ride-created',
      'photo-album-updated',
    ];
    for (const key of required) {
      expect(CREW_ACTIVITY_LABELS[key], `missing key: ${key}`).toBeTruthy();
    }
  });

  it('has the check-in labels', () => {
    expect(CREW_ACTIVITY_LABELS['checkin-started']).toBe('started a check-in timer');
    expect(CREW_ACTIVITY_LABELS['checkin-done']).toBe('checked in safe');
  });

  it('all values are non-empty strings', () => {
    for (const [, label] of Object.entries(CREW_ACTIVITY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('EXPENSE_CATEGORIES', () => {
  it('has 6 entries', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(6);
  });

  it('last entry is "other" (the fallback)', () => {
    expect(EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]!.id).toBe('other');
  });

  it('all entries have non-empty id, icon and label', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(cat.id.length).toBeGreaterThan(0);
      expect(cat.icon.length).toBeGreaterThan(0);
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });
});

describe('expenseCategoryFor', () => {
  it('returns the matching category by id', () => {
    expect(expenseCategoryFor('food').label).toBe('Food');
    expect(expenseCategoryFor('transport').label).toBe('Ride');
  });

  it('falls back to "other" for unknown id', () => {
    expect(expenseCategoryFor('unknown').id).toBe('other');
  });
});

describe('RATING_SCALE_DATA', () => {
  it('has 5 entries, values 1-5', () => {
    expect(RATING_SCALE_DATA).toHaveLength(5);
    const values = RATING_SCALE_DATA.map((r) => r.value);
    expect(values).toContain(1);
    expect(values).toContain(5);
  });

  it('order is highest-first (value 5 is order 0)', () => {
    const fire = RATING_SCALE_DATA.find((r) => r.value === 5)!;
    const skip = RATING_SCALE_DATA.find((r) => r.value === 1)!;
    expect(fire.order).toBeLessThan(skip.order);
  });
});

describe('RATING_SCALE', () => {
  it('is [5, 4, 3, 2, 1]', () => {
    expect(RATING_SCALE).toEqual([5, 4, 3, 2, 1]);
  });
});

describe('RATING_LABEL', () => {
  it('maps 5→Fire, 1→Skip', () => {
    expect(RATING_LABEL[5]).toBe('Fire');
    expect(RATING_LABEL[1]).toBe('Skip');
  });
});

describe('ratingCaption', () => {
  it('prompts when unrated', () => {
    expect(ratingCaption(null)).toBe('Tap to rate this set');
  });
  it('names the rating', () => {
    expect(ratingCaption(5)).toBe('You rated this: Fire (5 of 5)');
  });
  it('prompts for an unknown value', () => {
    expect(ratingCaption(9)).toBe('Tap to rate this set');
  });
});

describe('PRIORITY_SYMBOLS', () => {
  it('gives each priority a distinct icon, label and colour token', () => {
    const entries = Object.values(PRIORITY_SYMBOLS);
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.icon)).size).toBe(3);
    expect(new Set(entries.map((e) => e.colorToken)).size).toBe(3);
  });

  it('agrees with PRIORITY_LABEL and PRIORITY_OPTIONS', () => {
    for (const opt of PRIORITY_OPTIONS) {
      expect(PRIORITY_SYMBOLS[opt.value].short).toBe(PRIORITY_LABEL[opt.value]);
      expect(PRIORITY_SYMBOLS[opt.value].label).toBe(opt.label);
    }
  });
});

describe('LIVE_SHARE_DURATIONS', () => {
  it('has only numeric bounds', () => {
    expect(LIVE_SHARE_DURATIONS.map((d) => d.id)).toEqual(['1h', '2h', '4h']);
    for (const d of LIVE_SHARE_DURATIONS) expect(typeof d.ms).toBe('number');
  });
});

describe('crew money and packing constants', () => {
  it('lists 14 unique three-letter currencies starting with USD', () => {
    expect(CREW_CURRENCIES).toHaveLength(14);
    expect(new Set(CREW_CURRENCIES).size).toBe(14);
    expect(CREW_CURRENCIES[0]).toBe('USD');
    for (const c of CREW_CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/);
  });

  it('has the camping and day-trip templates with unique items', () => {
    expect(PACKING_TEMPLATES.map((t) => t.id)).toEqual(['camping', 'day-trip']);
    expect(PACKING_TEMPLATES.map((t) => t.items.length)).toEqual([12, 8]);
    for (const t of PACKING_TEMPLATES) expect(new Set(t.items).size).toBe(t.items.length);
  });

  it('labels the new activity types', () => {
    for (const k of ['expense-edited', 'payment-confirmed', 'payment-disputed', 'currency-changed', 'expense_settled']) {
      expect(CREW_ACTIVITY_LABELS[k]).toBeTruthy();
    }
  });
});
