import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import './zodJitless';

describe('zodJitless', () => {
  it('sets zod to jitless so object schemas never probe eval', () => {
    expect(z.config().jitless).toBe(true);
    expect(z.object({ a: z.string() }).parse({ a: 'x' })).toEqual({ a: 'x' });
  });
});
