// Source-level guards (mobile tests run without an RN renderer), like switchOffTrack.test.ts.
describe('Account screen', () => {
  const read = async (...parts: string[]) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  };

  it('renders the shared section list, not hard-coded groups', async () => {
    const source = await read('app', '(tabs)', 'account.tsx');
    expect(source).toContain('ACCOUNT_SECTIONS');
    expect(source).toContain('.map(');
    expect(source).not.toContain('<SectionLabel>Preferences');
  });

  it('keeps the Maestro theme testID and refreshes the session on pull', async () => {
    const source = await read('app', '(tabs)', 'account.tsx');
    expect(source).toContain("'daylight-switch'");
    expect(source).toContain('checkSession');
  });

  it('identity card uploads a bytes() part Expo fetch accepts with the shared copy', async () => {
    const source = await read('components', 'AccountIdentityCard.tsx');
    expect(source).toContain('AVATAR_COPY');
    expect(source).toContain('bytes: () => file.bytes()');
    expect(source).not.toContain('uri: asset.uri');
  });

  it('delete section goes through the store, never a raw DELETE /account/', async () => {
    const source = await read('components', 'AccountDangerSection.tsx');
    expect(source).toContain('deleteAccount(password, crewHandover)');
    expect(source).toContain('deleteAccount(undefined, crewHandover)');
    expect(source).not.toContain("api.delete('/account/");
    expect(source).not.toContain('api.delete<');
  });

  it('keeps shared UI copy in @festie/shared/constants, not inline', async () => {
    const danger = await read('components', 'AccountDangerSection.tsx');
    expect(danger).not.toContain('>Delete Account<');
    expect(danger).not.toContain("text: 'Delete Account'");
    const prefs = await read('components', 'AccountNotificationPrefsSection.tsx');
    expect(prefs).not.toContain('Must-see reminders');
    expect(prefs).not.toContain("title: 'Crew picks'");
    const account = await read('app', '(tabs)', 'account.tsx');
    expect(account).not.toContain('top sets after the festival');
  });

  it('email card re-checks the session when the app returns to the foreground', async () => {
    const source = await read('components', 'AccountEmailVerifySection.tsx');
    expect(source).toContain('AppState.addEventListener');
  });
});
