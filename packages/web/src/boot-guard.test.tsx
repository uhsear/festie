import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

describe('boot guard (public/boot-guard.js)', () => {
  const source = readFileSync(resolve(__dirname, '../public/boot-guard.js'), 'utf8');
  const bootShell =
    '<div id="root"><div class="boot-shell" role="status"><span>Loading Festie…</span></div></div>';

  function run() {
    document.body.innerHTML = bootShell;
    runInThisContext(source);
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves the spinner alone while the bundle is still loading', () => {
    run();
    vi.advanceTimersByTime(19_000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Loading Festie…')).toBeInTheDocument();
  });

  it('swaps the spinner for a recovery message after the timeout', () => {
    run();
    vi.advanceTimersByTime(20_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Festie didn’t finish loading');
    expect(screen.queryByText('Loading Festie…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Status page' })).toHaveAttribute('href', expect.stringMatching(/^https:/));
  });

  it('shows the fallback at once when a module throws on evaluation', () => {
    run();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: `${window.location.origin}/assets/index.js` }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the fallback on an unhandled rejection', () => {
    run();
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('ignores errors from other origins such as browser extensions', () => {
    run();
    window.dispatchEvent(new ErrorEvent('error', { message: 'x', filename: 'chrome-extension://abc/content.js' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does nothing once React has replaced the shell', () => {
    run();
    document.body.innerHTML = '<div id="root"><main>app</main></div>';
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
