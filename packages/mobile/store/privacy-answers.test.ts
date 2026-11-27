import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const md = readFileSync(join(here, 'privacy-answers.md'), 'utf8');
const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8')) as {
  expo: { ios: { privacyManifests: { NSPrivacyCollectedDataTypes: { NSPrivacyCollectedDataType: string }[] } } };
};
const declared = appJson.expo.ios.privacyManifests.NSPrivacyCollectedDataTypes.map((t) => t.NSPrivacyCollectedDataType);
const appleTable = (md.split('## Apple App Privacy')[1] ?? '').split('## Google Play Data safety')[0] ?? '';

describe('privacy answers', () => {
  it('lists every collected data type declared in app.json', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const type of declared) expect(appleTable).toContain(`\`${type}\``);
  });

  it('has no placeholders', () => {
    expect(md).not.toMatch(/TODO|TBD|FIXME/);
  });

  it('cites only code paths that exist', () => {
    const paths = [...md.matchAll(/`((?:routes|lib|public|packages)\/[^`\s]+\.[a-z]+)`/g)].map((m) => m[1] as string);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(join(repoRoot, p)), p).toBe(true);
  });
});
