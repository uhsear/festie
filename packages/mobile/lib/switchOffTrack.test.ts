// Source-level regression guard (mobile tests run without an RN renderer). On
// iOS an off Switch shrinks its track and shows ios_backgroundColor, not
// trackColor.false, so a Switch that sets one without the other renders a white
// thumb on a white card in Daylight (iOS sweep, 2026-10-29).
describe('Switch off-track colors', () => {
  it('every Switch that sets trackColor also sets ios_backgroundColor', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(__dirname, '..');
    const files = [
      ...fs.readdirSync(path.join(root, 'components')).map((f) => path.join(root, 'components', f)),
      ...fs.readdirSync(path.join(root, 'app'), { recursive: true }).map((f) => path.join(root, 'app', String(f))),
    ].filter((f) => f.endsWith('.tsx'));
    const count = (source: string, needle: string) => source.split(needle).length - 1;
    const missing = files.filter((f) => {
      const source = fs.readFileSync(f, 'utf8');
      return count(source, 'trackColor={{') !== count(source, 'ios_backgroundColor=');
    });
    expect(missing).toEqual([]);
  });

  it('account and low-power surfaces use AppSwitch, not Switch', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(__dirname, '..');
    const files = [
      ...fs
        .readdirSync(path.join(root, 'components'))
        .filter((f) => /^Account.*\.tsx$/.test(f) || f === 'LowPowerControls.tsx')
        .map((f) => path.join(root, 'components', f)),
      path.join(root, 'app', '(tabs)', 'account.tsx'),
    ];
    const raw = files.filter((f) => fs.readFileSync(f, 'utf8').includes('<Switch'));
    expect(raw).toEqual([]);
  });

  it('AppSwitch takes its off track from control.trackOff', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'AppSwitch.tsx'), 'utf8');
    expect(source).toContain('control.trackOff');
    expect(source).not.toContain('text.muted, true');
    expect(source).not.toMatch(/colors\.text\.muted/);
  });
});
