import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallAppRow from './InstallAppRow';

vi.mock('../features/IOSInstallDrawer', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: (r: string) => void }) =>
    open ? (
      <div data-testid="ios-steps">
        <button type="button" onClick={() => onClose('got-it')}>
          Got it
        </button>
      </div>
    ) : null,
}));

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

let originalUA: string;
function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  originalUA = navigator.userAgent;
  window.__festieInstallPrompt = null;
  setUA(DESKTOP_FIREFOX);
});

afterEach(() => {
  setUA(originalUA);
  delete (navigator as unknown as { standalone?: boolean }).standalone;
  localStorage.clear();
});

describe('InstallAppRow', () => {
  it('renders nothing in the installed app', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const { container } = render(<InstallAppRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Install and calls the captured prompt', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    window.__festieInstallPrompt = {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    } as unknown as BeforeInstallPromptEvent;
    const user = userEvent.setup();
    const { container } = render(<InstallAppRow />);
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalled();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(window.__festieInstallPrompt).toBeNull();
  });

  it('opens the Add to Home Screen steps on iPhone Safari without recording a dismissal', async () => {
    setUA(IPHONE_SAFARI);
    const user = userEvent.setup();
    render(<InstallAppRow />);
    await user.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(screen.getByTestId('ios-steps')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('ios-steps')).not.toBeInTheDocument();
    expect(localStorage.getItem('fp:install:ios-dismissed-at')).toBeNull();
  });

  it('explains how to install where the browser cannot', () => {
    render(<InstallAppRow />);
    expect(
      screen.getByText('To install Festie, open festie.us in Safari on iPhone or Chrome on Android.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
