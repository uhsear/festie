// Source-level guards (mobile tests run without an RN renderer), like accountScreen.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('mobile account sign-in methods', () => {
  it('re-auth dialog hides Apple on Android and links festie.us when nothing is usable', () => {
    const source = read('admin', 'ReauthDialog.tsx');
    expect(source).toContain("platform === 'android' ? linked.filter((p) => p !== 'apple')");
    expect(source).toContain('Confirm on festie.us, or set a password first.');
    expect(source).toContain('https://festie.us/account');
  });

  it('account screen mounts the sign-in methods card and shares one identities copy', () => {
    const source = read('..', 'app', '(tabs)', 'account.tsx');
    expect(source).toContain('<AccountSignInMethodsSection identities={identities} onChanged={refreshIdentities} />');
    expect(source).toContain('onChanged={refreshIdentities} />');
    // Set password, link and unlink must refresh the copy the other sections read, not a local one.
    for (const file of ['AccountSignInMethodsSection.tsx', 'AccountPasswordSection.tsx', 'AccountDangerSection.tsx']) {
      expect(read(file)).not.toContain('listIdentities');
    }
  });

  it('unlink confirms with an Alert and runs through withReauth', () => {
    const source = read('AccountSignInMethodsSection.tsx');
    expect(source).toContain('Alert.alert');
    expect(source).toContain('withReauth(() => unlinkIdentity(provider), ask)');
  });

  it('danger zone hides the password field for provider-only accounts', () => {
    expect(read('AccountDangerSection.tsx')).toContain('{hasPassword ? (');
  });
});
