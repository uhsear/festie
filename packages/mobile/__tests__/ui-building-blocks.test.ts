import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('mobile building blocks', () => {
  it('Button shows loadingLabel beside the spinner', () => {
    const src = read('components/Button.tsx');
    expect(src).toMatch(/loading \? <ActivityIndicator/);
    expect(src).toContain('loading ? (loadingLabel ?? label) : label');
    expect(src).not.toMatch(/loading \? <ActivityIndicator[^]*?\) : \(\s*<>/);
  });

  it('Toaster gives each kind an icon and alerts on error and warning', () => {
    const src = read('components/Toaster.tsx');
    for (const icon of ['checkmark-circle', 'alert-circle', 'warning', 'information-circle']) {
      expect(src).toContain(`'${icon}'`);
    }
    expect(src).toContain("toast.kind === 'error' || toast.kind === 'warning' ? 'alert'");
  });

  it('ErrorBoundary recovery actions use the canonical pill Button', () => {
    const src = read('components/ErrorBoundary.tsx');
    expect(src).toContain("import Button from './Button'");
    expect(src).not.toContain('TouchableOpacity');
  });

  it('Avatar falls back to initials when the image fails', () => {
    expect(read('components/Avatar.tsx')).toContain('onError={() => setFailedImage(image)}');
  });
});
