import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CHECKIN_COPY } from '@festie/shared/constants';
import { ApiClientError } from '@festie/shared';
import { fmtZonedClock } from '@festie/shared/utils';

const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast }) }));

const start = vi.fn();
const done = vi.fn();
let checkin: { dueAt: string; minutes: number } | null = null;
vi.mock('@festie/shared/hooks', () => ({ useCheckIn: () => ({ checkin, busy: false, start, done }) }));

import CheckInCard from './CheckInCard';

describe('CheckInCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkin = null;
    start.mockResolvedValue({ dueAt: '2026-06-06T13:40:00.000Z', minutes: 30 });
    done.mockResolvedValue(true);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
    });
  });

  it('idle shows four duration buttons', () => {
    render(<CheckInCard crewId="c1" />);
    for (const label of ['15 min', '30 min', '1 hour', '2 hours']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('starts a 30 minute timer without GPS and toasts', async () => {
    render(<CheckInCard crewId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(30, undefined));
    const clock = fmtZonedClock(Date.parse('2026-06-06T13:40:00.000Z'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(CHECKIN_COPY.started(clock), 'success'));
  });

  it('active state shows the title and the I am OK button', () => {
    checkin = { dueAt: new Date(Date.now() + 15 * 60_000).toISOString(), minutes: 15 };
    render(<CheckInCard crewId="c1" />);
    expect(screen.getByText(/^Check in by /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CHECKIN_COPY.okA11y })).toBeInTheDocument();
  });

  it('I am OK after the timer already fired says the crew was alerted', async () => {
    checkin = { dueAt: new Date(Date.now() + 15 * 60_000).toISOString(), minutes: 15 };
    done.mockResolvedValue(false);
    render(<CheckInCard crewId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: CHECKIN_COPY.okA11y }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(CHECKIN_COPY.ended, 'error'));
    expect(toast).not.toHaveBeenCalledWith(CHECKIN_COPY.done, 'success');
  });

  it('a rejected done shows the network message', async () => {
    checkin = { dueAt: new Date(Date.now() + 15 * 60_000).toISOString(), minutes: 15 };
    done.mockRejectedValue(new ApiClientError('x', 0, undefined, undefined, true));
    render(<CheckInCard crewId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: CHECKIN_COPY.okA11y }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('your timer is still running'), 'error'),
    );
  });
});
