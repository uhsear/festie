import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));
vi.mock('./InviteQRDialog', () => ({ default: () => null }));

import CrewInviteBar from './CrewInviteBar';

const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function renderBar(props: Partial<React.ComponentProps<typeof CrewInviteBar>> = {}) {
  return render(
    <CrewInviteBar
      inviteCode="K7XQ2M"
      crewId="c1"
      crewName="Sunset Squad"
      isOwner={false}
      expiresAt={future()}
      {...props}
    />,
  );
}

describe('CrewInviteBar', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('labels the copy button "Copy link"', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('hides regenerate from a non-owner and shows it to the owner', () => {
    const { unmount } = renderBar();
    expect(screen.queryByRole('button', { name: 'Regenerate invite code' })).toBeNull();
    unmount();
    renderBar({ isOwner: true });
    expect(screen.getByRole('button', { name: 'Regenerate invite code' })).toBeInTheDocument();
  });

  it('shows the QR button to a non-owner', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeInTheDocument();
  });

  it('puts the crew name in the share text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    renderBar();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share invite link' }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Join Sunset Squad on Festie',
        text: expect.stringContaining('Sunset Squad'),
        url: expect.stringContaining('/join/K7XQ2M'),
      }),
    );
  });

  it('tells a non-owner to ask the owner when the invite expired', () => {
    renderBar({ expiresAt: past() });
    expect(screen.getByText('Expired. Ask the crew owner for a new link.')).toBeInTheDocument();
  });

  it('keeps the plain Expired text for the owner', () => {
    renderBar({ expiresAt: past(), isOwner: true });
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
