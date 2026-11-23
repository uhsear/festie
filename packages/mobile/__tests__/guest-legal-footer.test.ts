// Source-level guards for the signed-out Privacy / Terms / Help footer.
import { read } from './read-source';

describe('guest legal footer (source-level guards)', () => {
  const src = read('components/GuestLegalFooter.tsx');

  it('uses the shared copy, typeStyle and 44pt targets', () => {
    expect(src).toContain('GUEST_LEGAL_COPY');
    expect(src).toContain("typeStyle('caption')");
    expect(src).toContain('minHeight: 44');
    expect(src).toContain('minWidth: 44');
  });

  it('opens privacy in-app, terms in the in-app browser, help by mail', () => {
    expect(src).toContain("router.push('/privacy')");
    expect(src).toContain('WebBrowser.openBrowserAsync');
    expect(src).toContain('Linking.openURL(helpHref)');
  });

  it('handles a failed mail or browser open and lets caption text scale fully', () => {
    expect(src).toMatch(/Linking\.openURL\(helpHref\)\.catch\(/);
    expect(src).toContain('ACCOUNT_COPY.contactSupportNoMail(SUPPORT_EMAIL)');
    expect(src).not.toMatch(/void Linking\.openURL/);
    expect(src).not.toContain('maxFontSizeMultiplier');
  });

  it('shows on login and on the festival picker for guests only', () => {
    expect(read('app/(auth)/login.tsx')).toContain('<GuestLegalFooter />');
    const list = read('components/FestivalList.tsx');
    expect(list).toContain('useAuthStore((s) => !s.user)');
    expect(list).toContain('{isGuest ? <GuestLegalFooter /> : null}');
  });

  it('also shows on register and forgot-password, as on web', () => {
    expect(read('app/(auth)/register.tsx')).toContain('<GuestLegalFooter />');
    expect(read('app/(auth)/forgot-password.tsx')).toContain('<GuestLegalFooter />');
  });

  it('opens Terms through the footer opener from register, complete-signup and Account', () => {
    expect(src).toMatch(/export async function openPage/);
    for (const file of ['app/(auth)/register.tsx', 'app/(auth)/complete-signup.tsx', 'app/(tabs)/account.tsx']) {
      const text = read(file);
      expect(text).toContain('openPage(GUEST_LEGAL_COPY.termsPath)');
      expect(text).not.toMatch(/Linking\.openURL\((TERMS_URL|SUPPORT_URL_TERMS)\)/);
    }
  });

  it('labels the forgot-password email field visibly, as web does', () => {
    expect(read('app/(auth)/forgot-password.tsx')).toContain('AUTH_COPY.emailLabel');
  });
});
