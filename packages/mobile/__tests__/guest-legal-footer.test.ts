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

  it('shows on login and on the festival picker for guests only', () => {
    expect(read('app/(auth)/login.tsx')).toContain('<GuestLegalFooter />');
    const list = read('components/FestivalList.tsx');
    expect(list).toContain('useAuthStore((s) => !s.user)');
    expect(list).toContain('{isGuest ? <GuestLegalFooter /> : null}');
  });
});
