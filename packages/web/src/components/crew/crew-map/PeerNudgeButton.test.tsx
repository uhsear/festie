import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiClientError } from '@festie/shared/services/api';
import { FIND_FRIEND_COPY } from '@festie/shared/constants';

const { nudgeCrewMember } = vi.hoisted(() => ({ nudgeCrewMember: vi.fn() }));
vi.mock('../../../../../shared/src/services/nudge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../shared/src/services/nudge')>()),
  nudgeCrewMember,
}));

import PeerNudgeButton from './PeerNudgeButton';

describe('PeerNudgeButton', () => {
  beforeEach(() => {
    nudgeCrewMember.mockReset();
  });

  it('renders the label and sends once, then disables', async () => {
    nudgeCrewMember.mockResolvedValue({ nudged: true });
    render(<PeerNudgeButton crewId="c1" userId="u1" name="Ana" />);
    const btn = screen.getByRole('button', { name: FIND_FRIEND_COPY.nudgeA11y('Ana') });
    expect(btn.textContent).toBe(FIND_FRIEND_COPY.nudge);
    fireEvent.click(btn);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(nudgeCrewMember).toHaveBeenCalledTimes(1);
    expect(nudgeCrewMember).toHaveBeenCalledWith('c1', 'u1');
    expect(screen.getByRole('status').textContent).toBe(FIND_FRIEND_COPY.nudgeSent('Ana'));
  });

  it('shows the limit message on a 429', async () => {
    nudgeCrewMember.mockImplementation(async () => {
      throw new ApiClientError('limited', 429, 'RATE_LIMITED', 300);
    });
    render(<PeerNudgeButton crewId="c1" userId="u1" name="Ana" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('status').textContent).toBe(FIND_FRIEND_COPY.nudgeLimited('Ana'));
  });
});
