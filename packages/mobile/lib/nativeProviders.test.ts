import { beforeEach, describe, expect, it, vi } from 'vitest';

const apple = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
const google = vi.hoisted(() => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const extra = vi.hoisted(() => ({ appleSignIn: true, googleSignIn: true }));

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra } } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: { RNGoogleSignin: {} },
  TurboModuleRegistry: { get: () => null },
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({}) }));
vi.mock('expo-apple-authentication', () => apple);
vi.mock('@react-native-google-signin/google-signin', () => ({ GoogleSignin: google }));

const load = async () => {
  vi.resetModules();
  return import('./nativeProviders');
};

const cfg = { webClientId: 'web', iosClientId: 'ios' };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(extra, { appleSignIn: true, googleSignIn: true });
});

describe('availability', () => {
  it('hides a provider whose build-time setup is missing, even though the module is linked', async () => {
    apple.isAvailableAsync.mockResolvedValue(true);
    let mod = await load();
    expect(await mod.appleAvailable()).toBe(true);
    expect(mod.googleAvailable()).toBe(true);

    Object.assign(extra, { appleSignIn: false, googleSignIn: false });
    mod = await load();
    expect(await mod.appleAvailable()).toBe(false);
    expect(mod.googleAvailable()).toBe(false);
    expect(apple.isAvailableAsync).toHaveBeenCalledTimes(1);
  });
});

describe('appleCredential', () => {
  it('returns null when the user cancels', async () => {
    apple.signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await (await load()).appleCredential('n')).toBeNull();
  });

  it('maps identityToken, code and fullName', async () => {
    apple.signInAsync.mockResolvedValue({
      identityToken: 'tok',
      authorizationCode: 'code',
      fullName: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    expect(await (await load()).appleCredential('n')).toEqual({
      idToken: 'tok',
      nonce: 'n',
      authorizationCode: 'code',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    expect(apple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'n' });
  });
});

describe('googleCredential', () => {
  it('returns null when the user cancels', async () => {
    google.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    expect(await (await load()).googleCredential(cfg)).toBeNull();
    expect(google.signOut).not.toHaveBeenCalled();
  });

  it('configures once across calls and signs out after each success', async () => {
    google.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'g-tok' } });
    const { googleCredential } = await load();
    expect(await googleCredential(cfg)).toEqual({ idToken: 'g-tok' });
    await googleCredential(cfg);
    expect(google.configure).toHaveBeenCalledTimes(1);
    expect(google.configure).toHaveBeenCalledWith({ webClientId: 'web', iosClientId: 'ios' });
    expect(google.signOut).toHaveBeenCalledTimes(2);
  });
});
