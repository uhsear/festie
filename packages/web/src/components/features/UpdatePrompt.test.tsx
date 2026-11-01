import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdatePrompt from './UpdatePrompt';

const originalLocation = window.location;
const reload = vi.fn();

function stubServiceWorker(controller: unknown) {
  const sw = Object.assign(new EventTarget(), {
    controller,
    ready: new Promise(() => {}),
  });
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  return sw;
}

beforeEach(() => {
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, reload },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
});

describe('UpdatePrompt', () => {
  it('shows the bar on controllerchange without reloading', () => {
    const sw = stubServiceWorker({});
    render(<UpdatePrompt />);
    act(() => {
      sw.dispatchEvent(new Event('controllerchange'));
    });
    expect(screen.getByRole('status').textContent).toContain('A new version of Festie is ready.');
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores controllerchange when there was no initial controller', () => {
    const sw = stubServiceWorker(null);
    render(<UpdatePrompt />);
    act(() => {
      sw.dispatchEvent(new Event('controllerchange'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Reload reloads and Later hides the bar', () => {
    const sw = stubServiceWorker({});
    render(<UpdatePrompt />);
    act(() => {
      sw.dispatchEvent(new Event('controllerchange'));
    });
    fireEvent.click(screen.getByText('Reload'));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Later'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reloads on vite:preloadError only after an update', () => {
    const sw = stubServiceWorker({});
    render(<UpdatePrompt />);
    const before = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(before);
    expect(reload).not.toHaveBeenCalled();
    expect(before.defaultPrevented).toBe(false);

    act(() => {
      sw.dispatchEvent(new Event('controllerchange'));
    });
    const after = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(after);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(after.defaultPrevented).toBe(true);
  });
});
