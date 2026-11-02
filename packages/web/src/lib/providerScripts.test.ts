import { describe, it, expect } from 'vitest';
import { loadScript } from './providerScripts';

const scripts = (src: string) => document.head.querySelectorAll(`script[src="${src}"]`);

describe('loadScript', () => {
  it('adds one script for repeated calls and resolves on load', async () => {
    const src = 'https://example.test/a.js';
    const first = loadScript(src);
    const second = loadScript(src);
    expect(first).toBe(second);
    expect(scripts(src)).toHaveLength(1);
    scripts(src)[0]!.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
  });

  it('rejects on error, removes the tag and allows a retry', async () => {
    const src = 'https://example.test/b.js';
    const failed = loadScript(src);
    scripts(src)[0]!.dispatchEvent(new Event('error'));
    await expect(failed).rejects.toThrow(/did not load/);
    expect(scripts(src)).toHaveLength(0);
    void loadScript(src);
    expect(scripts(src)).toHaveLength(1);
  });
});
