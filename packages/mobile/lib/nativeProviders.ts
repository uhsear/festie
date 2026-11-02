import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import type { ProviderCredentialBody, ProvidersConfig } from '@festie/shared/types';

// The only file that touches the two native sign-in modules. Both load lazily and only after a
// presence check, so a binary built without them (runtime 1.4.0) hides the buttons instead of crashing.

type GoogleConfig = NonNullable<ProvidersConfig['google']>;

// Autolinking links both modules into every new build, so presence alone is not enough: app.config.js
// sets these flags only when the build carries the Apple entitlement or the Google iOS URL scheme.
// Without the scheme, GoogleSignin.signIn on iOS raises a native exception and crashes the app.
const buildFlag = (name: 'appleSignIn' | 'googleSignIn') => Constants.expoConfig?.extra?.[name] === true;
const hasAppleModule = () =>
  buildFlag('appleSignIn') && requireOptionalNativeModule('ExpoAppleAuthentication') != null;
const hasGoogleModule = () =>
  (Platform.OS === 'android' || buildFlag('googleSignIn')) &&
  (NativeModules.RNGoogleSignin ?? TurboModuleRegistry.get('RNGoogleSignin')) != null;

/** The expo-apple-authentication module, or null when this binary lacks it. Used for the native button. */
export async function loadAppleAuthentication() {
  if (!hasAppleModule()) return null;
  return import('expo-apple-authentication');
}

export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const apple = await loadAppleAuthentication();
  return apple ? apple.isAvailableAsync() : false;
}

export function googleAvailable(): boolean {
  return hasGoogleModule();
}

export async function appleCredential(nonce: string): Promise<ProviderCredentialBody | null> {
  const apple = await loadAppleAuthentication();
  if (!apple) throw new Error('Sign in with Apple is not available in this version of the app.');
  try {
    const c = await apple.signInAsync({
      requestedScopes: [apple.AppleAuthenticationScope.FULL_NAME, apple.AppleAuthenticationScope.EMAIL],
      nonce,
    });
    if (!c.identityToken) throw new Error('Apple did not return an identity token.');
    return {
      idToken: c.identityToken,
      nonce,
      authorizationCode: c.authorizationCode ?? undefined,
      name: { givenName: c.fullName?.givenName ?? undefined, familyName: c.fullName?.familyName ?? undefined },
    };
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw err;
  }
}

let googleConfigured = false;

export async function googleCredential(cfg: GoogleConfig): Promise<ProviderCredentialBody | null> {
  if (!hasGoogleModule()) throw new Error('Google sign-in is not available in this version of the app.');
  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: cfg.webClientId, iosClientId: cfg.iosClientId ?? undefined });
    googleConfigured = true;
  }
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
  const r = await GoogleSignin.signIn();
  if (r.type === 'cancelled') return null;
  const idToken = r.data.idToken;
  // Festie keeps its own session; signing out here makes the next tap show the account chooser.
  await GoogleSignin.signOut();
  if (!idToken) throw new Error('Google did not return an ID token.');
  return { idToken };
}
