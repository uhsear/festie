import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const auth = { user: { id: 'u1' } as { id: string } | null };
const follow = {
  festivalIds: [] as string[],
  loaded: true,
  load: vi.fn(async () => {}),
  setFollowing: vi.fn(async (_id: string, _on: boolean) => {}),
};
const navigate = vi.fn();
const toast = vi.fn();
const toastError = vi.fn();

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: typeof auth) => unknown) => sel(auth),
  useFollowStore: Object.assign((sel: (s: typeof follow) => unknown) => sel(follow), { getState: () => follow }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ href: '/cards?x=1' }),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));

import FollowButton from './FollowButton';

describe('FollowButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 'u1' };
    follow.festivalIds = [];
    follow.loaded = true;
  });

  it('signed in: calls setFollowing and toasts', async () => {
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Follow Alpha' }));
    expect(follow.setFollowing).toHaveBeenCalledWith('f1', true);
    expect(toast).toHaveBeenCalledWith("We'll tell you when Alpha posts its lineup or set times.", 'success');
  });

  it('following: unfollows with the stop name', async () => {
    follow.festivalIds = ['f1'];
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    expect(screen.getByText('Following')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop following Alpha' }));
    expect(follow.setFollowing).toHaveBeenCalledWith('f1', false);
    expect(toast).toHaveBeenCalledWith('Stopped following Alpha.', 'success');
  });

  it('shows an error toast when the write fails', async () => {
    follow.setFollowing.mockRejectedValueOnce(new Error('offline'));
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Follow Alpha' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.any(Error), "Couldn't update. Try again."));
  });

  it('guest: opens the prompt and links to register and login', async () => {
    auth.user = null;
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    await userEvent.click(screen.getByRole('button', { name: 'Follow Alpha' }));
    expect(follow.setFollowing).not.toHaveBeenCalled();
    expect(screen.getByText('Follow Alpha', { selector: 'h2, [role="heading"], div' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/register', search: { next: '/cards?x=1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/login', search: { next: '/cards?x=1' } });
  });

  it('loads follows once after sign-in when not loaded', () => {
    follow.loaded = false;
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    expect(follow.load).toHaveBeenCalledTimes(1);
  });

  it('does not load for a guest', () => {
    auth.user = null;
    follow.loaded = false;
    render(<FollowButton festivalId="f1" festivalName="Alpha" />);
    expect(follow.load).not.toHaveBeenCalled();
  });
});
