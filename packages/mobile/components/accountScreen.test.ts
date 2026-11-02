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

  it('identity card uploads the RN file part with the shared copy', async () => {
    const source = await read('components', 'AccountIdentityCard.tsx');
    expect(source).toContain('AVATAR_COPY');
    expect(source).toContain('uri: asset.uri');
  });

  it('email card re-checks the session when the app returns to the foreground', async () => {
    const source = await read('components', 'AccountEmailVerifySection.tsx');
    expect(source).toContain('AppState.addEventListener');
  });
});
