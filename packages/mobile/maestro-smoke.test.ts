// Source-level guards for the Maestro smoke flows: the authed phase must keep
// the controls that catch a broken session, and iOS must check what Android checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const flows = {
  ios: readFileSync(join(__dirname, '.maestro', 'ios-smoke.yaml'), 'utf8'),
  android: readFileSync(join(__dirname, '.maestro', 'android-smoke.yaml'), 'utf8'),
};

// The wait that follows `openLink: festie://<route>`, up to the next openLink.
function section(src: string, route: string): string {
  const start = src.indexOf(`- openLink: "festie://${route}"`);
  expect(start, `${route} step exists`).toBeGreaterThan(-1);
  const next = src.indexOf('- openLink:', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe.each(Object.entries(flows))('%s smoke', (_name, src) => {
  it('does not accept the non-admin empty state as a loaded admin home', () => {
    const admin = section(src, 'admin');
    expect(admin).not.toMatch(/text: "[^"]*Admins only[^"]*"/);
    expect(admin).toContain('- assertNotVisible: "Admins only"');
  });

  it('does not wait on the Compass header title, which shows before any body state', () => {
    expect(section(src, 'compass')).not.toMatch(/text: "(?:[^"|]*\|)*Compass(?:\|[^"]*)?"/);
  });

  it('waits for content on cards, timeline and map', () => {
    expect(src).toContain("^Must See");
    expect(src).toMatch(/Set times not announced yet/);
    expect(section(src, 'map')).toMatch(/notVisible: "Loading map…"/);
  });

  it('requires the authed crew to load on crew-plan and crew-compare', () => {
    const plan = section(src, 'crew-plan');
    expect(plan).toContain('visible: "Meet up"');
    expect(plan).not.toMatch(/No crew yet|Joining when/);
    expect(section(src, 'crew-compare')).not.toMatch(/No crew yet|Joining when/);
  });
});
