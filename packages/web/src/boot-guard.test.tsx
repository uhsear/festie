import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

describe('boot guard (public/boot-guard.js)', () => {
  const source = readFileSync(resolve(__dirname, '../public/boot-guard.js'), 'utf8');
  const origin = 'https://festie.test';
  const bootShell =
    '<div id="root"><div class="boot-shell" role="status"><span>Loading Festie…</span></div></div>';
  const windows: Array<{ close: () => void }> = [];

  // Each case gets its own window, so a listener from an earlier case cannot satisfy a later one.
  function boot() {
    const dom = new JSDOM(`<!doctype html><body>${bootShell}</body>`, {
      url: `${origin}/`,
      runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
    });
    windows.push(dom.window);
    const timers: Array<() => void> = [];
    // The guard's 20 s timer is captured, not run, so the test controls when it fires.
    dom.window.setTimeout = ((fn: () => void) => timers.push(fn)) as unknown as typeof dom.window.setTimeout;
    const { document } = dom.window;
    const runScript = (code: string) => {
      const el = document.createElement('script');
      el.textContent = code;
      document.body.append(el);
    };
    runScript(source);
    return { window: dom.window, document, ui: within(document.body), timers, runScript };
  }

  afterEach(() => {
    windows.splice(0).forEach((w) => w.close());
  });

  it('leaves the spinner alone while the bundle is still loading', () => {
    const { ui } = boot();
    expect(ui.queryByRole('alert')).toBeNull();
    expect(ui.getByText('Loading Festie…')).toBeInTheDocument();
  });

  it('swaps the spinner for a still-loading message after the timeout', () => {
    const { ui, timers } = boot();
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(ui.getByRole('alert')).toHaveTextContent('Still loading…');
    expect(ui.queryByText('Loading Festie…')).toBeNull();
    expect(ui.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(ui.getByRole('link', { name: 'Status page' })).toHaveAttribute('href', expect.stringMatching(/^https:/));
  });

  it('shows the fallback at once when a script throws on evaluation', () => {
    const { ui, runScript } = boot();
    runScript("throw new Error('boom');");
    expect(ui.getByRole('alert')).toHaveTextContent('Festie didn’t finish loading');
  });

  it('shows the fallback when an app script fails to load', () => {
    const { window, document, ui } = boot();
    const script = document.createElement('script');
    script.src = `${origin}/assets/index.js`;
    document.body.append(script);
    script.dispatchEvent(new window.Event('error'));
    expect(ui.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the fallback on an unhandled rejection', () => {
    const { window, ui } = boot();
    window.dispatchEvent(new window.Event('unhandledrejection'));
    expect(ui.getByRole('alert')).toBeInTheDocument();
  });

  it('ignores errors from other origins such as browser extensions', () => {
    const { window, ui } = boot();
    window.dispatchEvent(new window.ErrorEvent('error', { message: 'x', filename: 'chrome-extension://abc/content.js' }));
    expect(ui.queryByRole('alert')).toBeNull();
  });

  it('ignores a script that fails to load from another origin', () => {
    const { window, document, ui } = boot();
    const script = document.createElement('script');
    script.src = 'https://extension.example/content.js';
    document.body.append(script);
    script.dispatchEvent(new window.Event('error'));
    expect(ui.queryByRole('alert')).toBeNull();
  });

  it.each(['link', 'img'])('ignores a failed %s load such as a blocked font', (tag) => {
    const { window, document, ui } = boot();
    const el = document.createElement(tag);
    el.setAttribute(tag === 'link' ? 'href' : 'src', 'https://fonts.googleapis.com/css2?family=Space+Grotesk');
    document.body.append(el);
    el.dispatchEvent(new window.Event('error'));
    expect(ui.queryByRole('alert')).toBeNull();
  });

  it('does nothing once React has replaced the shell', () => {
    const { document, ui, timers, runScript } = boot();
    document.body.innerHTML = '<div id="root"><main>app</main></div>';
    timers[0]();
    runScript("throw new Error('late');");
    expect(ui.queryByRole('alert')).toBeNull();
  });
});
