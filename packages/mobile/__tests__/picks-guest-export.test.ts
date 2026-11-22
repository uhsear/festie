import { read } from './read-source';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const picks = read('app/(tabs)/picks.tsx');
const image = read('app/picks-image.tsx');

describe('PICKS-13 guests export picks without an account', () => {
  it('builds the calendar file from the picks on this device, not only a profile', () => {
    expect(picks).toContain('useFestivalDataStore(selectMyPicks)');
    expect(picks).not.toContain('if (!currentFestival || !currentProfile || exportBusy) return;');
    expect(picks).toContain('notes: currentProfile?.notes');
  });

  it('skips the Subscribe chooser for a guest and downloads the file directly', () => {
    expect(picks).toContain('if (!currentProfile) {');
    expect(picks).toContain('void handleDownloadCalendar();');
  });

  it('draws the image from the picks on this device', () => {
    expect(image).toContain('useFestivalDataStore(selectMyPicks)');
    expect(image).not.toContain('const picks = profile?.picks;');
  });

  it('shows the action row to guests and sends the Share tap to sign-in', () => {
    expect(picks).not.toContain('{user ? (\n    <View style={[styles.headerActions');
    expect(picks).toContain("Sign in to share your picks.");
    expect(picks).toContain("router.push('/(auth)/login')");
  });
});
