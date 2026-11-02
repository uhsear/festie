import { describe, it, expect } from 'vitest';
import { availableProviders } from './oauth';
import type { ProvidersConfig } from '../types/oauth';

const google = { webClientId: 'g', iosClientId: 'gi' };
const apple = { servicesId: 'us.festie.web', redirectUri: 'https://festie.us/login' };
const cfg = (g: boolean, a: boolean): ProvidersConfig => ({ google: g ? google : null, apple: a ? apple : null });

describe('availableProviders', () => {
  it('web lists google then apple', () => {
    expect(availableProviders(cfg(true, true), 'web')).toEqual(['google', 'apple']);
    expect(availableProviders(cfg(true, false), 'web')).toEqual(['google']);
    expect(availableProviders(cfg(false, true), 'web')).toEqual(['apple']);
  });
  it('web hides apple without a services id', () => {
    expect(availableProviders({ google: null, apple: { redirectUri: 'x' } }, 'web')).toEqual([]);
  });
  it('ios leads with apple and needs apple for google', () => {
    expect(availableProviders(cfg(true, true), 'ios')).toEqual(['apple', 'google']);
    expect(availableProviders(cfg(false, true), 'ios')).toEqual(['apple']);
    expect(availableProviders(cfg(true, false), 'ios')).toEqual([]);
  });
  it('android is google only', () => {
    expect(availableProviders(cfg(true, true), 'android')).toEqual(['google']);
    expect(availableProviders(cfg(false, true), 'android')).toEqual([]);
  });
  it('returns nothing without config', () => {
    expect(availableProviders(null, 'web')).toEqual([]);
  });
});
