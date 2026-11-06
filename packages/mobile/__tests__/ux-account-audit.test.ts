// Source-level guards for the account/auth consistency fixes (web parity).
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const sharedRead = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'shared', rel), 'utf8');

describe('account email section', () => {
  it('refreshes the session after a send and shows the pending address', () => {
    const src = read('components/AccountEmailSection.tsx');
    expect(src).toContain('useAuthStore.getState().checkSession()');
    expect(src).toContain('ACCOUNT_COPY.emailPending(user.pendingEmail)');
  });
});

describe('error mapping', () => {
  it('delete-account and notification toggles map errors instead of printing err.message', () => {
    expect(read('components/AccountDangerSection.tsx')).toContain('mapErrorToUserMessage(err, ACCOUNT_COPY.deleteFailed)');
    const n = read('components/AccountNotificationsSection.tsx');
    expect(n).toContain("mapErrorToUserMessage(err, 'Could not update notifications.')");
    expect(n).not.toContain('err.message');
  });
});

describe('provider and link labels', () => {
  it('link mode says Link Google', () => {
    const src = read('components/ProviderButtons.tsx');
    expect(src).toContain("mode === 'link' ? PROVIDER_COPY.linkGoogle : PROVIDER_COPY.continueGoogle");
    expect(src).not.toContain('label={PROVIDER_COPY.continueGoogle}');
  });

  it('forgot-password support link falls back to an alert when no mail app exists', () => {
    expect(read('app/(auth)/forgot-password.tsx')).toContain('ACCOUNT_COPY.contactSupportNoMail(AUTH_COPY.supportEmail)');
  });
});

describe('toasts instead of blocking alerts', () => {
  it.each([
    'app/(auth)/login.tsx',
    'components/ProviderButtons.tsx',
    'app/(auth)/register.tsx',
    'components/AccountNotificationPrefsSection.tsx',
    'components/AccountDataSection.tsx',
    'components/AccountPrivacySection.tsx',
  ])('%s has no result Alert for success or failure notices', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(
      /Alert\.alert\((ACCOUNT_REACTIVATED_MESSAGE|AUTH_COPY\.accountCreated|PRIVACY_COPY\.title, PRIVACY_COPY\.error|DATA_COPY\.title|'Update failed')/,
    );
  });

  it('register and complete-signup toast Account created with the verification hint', () => {
    for (const rel of ['app/(auth)/register.tsx', 'app/(auth)/complete-signup.tsx']) {
      const src = read(rel);
      expect(src).toContain('AUTH_COPY.accountCreated');
      expect(src).toContain('durationMs');
      expect(src).toContain("kind: 'success'");
    }
  });

  it('device sign-out toasts the shared copy', () => {
    const src = read('components/AccountDevicesSection.tsx');
    expect(src).toContain('ACCOUNT_COPY.signedOutDevice(deviceTitle(d))');
    expect(src).toContain('ACCOUNT_COPY.signedOutOthers');
    expect(src).toContain("showToast(message, { kind: 'success' })");
  });
});

describe('register parity', () => {
  it('uses the shared password hint and web length limits', () => {
    const src = read('app/(auth)/register.tsx');
    expect(src).toContain('{AUTH_COPY.passwordHint}');
    expect(src).toContain('maxLength={30}');
    expect(src).toContain('maxLength={254}');
  });

  it('keeps text links at the 44pt tap target', () => {
    for (const file of ['app/(auth)/login.tsx', 'app/(auth)/register.tsx']) {
      const s = read(file);
      for (const name of ['guestButton', 'linkButton']) {
        expect(s).toMatch(new RegExp(`${name}: \\{[^}]*minHeight: 44`));
      }
    }
    expect(read('app/(auth)/login.tsx')).toMatch(/forgotButton: \{[^}]*minHeight: 44/);
  });
});

describe('vibration row and share-link reset', () => {
  it('mobile uses the shared vibration hint', () => {
    expect(sharedRead('src/constants/accountSettings.ts')).toContain('SOS alerts always vibrate.');
    expect(read('app/(tabs)/account.tsx')).toContain('ACCOUNT_COPY.vibrationHint');
  });

  it('Reset my share links is disabled offline', () => {
    expect(read('components/AccountPublicScheduleSection.tsx')).toContain('onPress={onReset} disabled={offlineMode}');
  });
});
