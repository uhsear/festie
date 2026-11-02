import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  selectFestival: vi.fn(),
  toastError: vi.fn(),
  state: {
    festivals: [] as Array<Record<string, unknown>>,
    currentFestival: null as Record<string, unknown> | null,
    user: null as Record<string, unknown> | null,
  },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: h.toastError }) }));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ festivals: h.state.festivals, currentFestival: h.state.currentFestival, selectFestival: h.selectFestival }),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: h.state.user }),
}));

import Onboarding from './Onboarding';

const DONE_KEY = 'festie_onboarding_completed';
const fest = (id: string, name: string, startDate: string, endDate: string) => ({ id, name, startDate, endDate });
const future = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function toStep(user: ReturnType<typeof userEvent.setup>, label: string) {
  for (let i = 0; i < 6 && !screen.queryByRole('heading', { name: label }); i++) {
    await user.click(screen.getByRole('button', { name: 'Next' }));
  }
}

describe('Onboarding sequencing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
    h.selectFestival.mockResolvedValue(undefined);
    h.state.festivals = [];
    h.state.currentFestival = null;
    h.state.user = null;
  });

  it('shows on a first visit with the brand mark on step one', () => {
    render(<Onboarding />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Festie' })).toBeInTheDocument();
    expect(document.querySelector('img[src="/favicon.svg"]')).toBeInTheDocument();
  });

  it('is skipped, and not re-shown, when the visit arrived through an invite', () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    const { rerender } = render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    sessionStorage.clear();
    rerender(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(DONE_KEY)).toBe('true');
  });

  it('is skipped when a ?joinCrew= link is in the URL', () => {
    window.history.replaceState({}, '', '/cards?joinCrew=ABC123');
    render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds while the join prompt is open, then appears once it closes', () => {
    const { rerender } = render(<Onboarding suspended />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<Onboarding suspended={false} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Festie' })).toBeInTheDocument();
  });

  it('dismisses with Skip and stays dismissed on the next mount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Onboarding />);
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the three priority labels on step one', () => {
    render(<Onboarding />);
    for (const label of ['Must See', 'Want to See', 'Maybe']) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it('shows Skip on every step', async () => {
    h.state.festivals = [fest('a', 'Alpha', future(5), future(7))];
    const user = userEvent.setup();
    render(<Onboarding />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
      const next = screen.queryByRole('button', { name: 'Next' });
      if (next) await user.click(next);
    }
  });

  it('has four steps and no festival step without festivals', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '4');
    await toStep(user, 'Going with friends?');
    expect(screen.queryByRole('heading', { name: 'Which festival?' })).not.toBeInTheDocument();
  });

  it('presses the default festival and selects another on Next', async () => {
    h.state.festivals = [fest('a', 'Alpha', future(20), future(22)), fest('b', 'Bravo', future(5), future(7))];
    h.state.currentFestival = h.state.festivals[0]!;
    const user = userEvent.setup();
    render(<Onboarding />);
    await toStep(user, 'Which festival?');
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Bravo/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(h.selectFestival).toHaveBeenCalledWith('b');
    expect(screen.getByRole('heading', { name: 'Going with friends?' })).toBeInTheDocument();
  });

  it('a guest "Start a crew" goes to register with a next path', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await toStep(user, 'Going with friends?');
    await user.click(screen.getByRole('button', { name: 'Start a crew' }));
    expect(h.navigate).toHaveBeenCalledWith({ to: '/register', search: { next: '/crew?start=create' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a signed-in "I have an invite code" opens the join prompt', async () => {
    h.state.user = { id: 'u1' };
    const user = userEvent.setup();
    render(<Onboarding />);
    await toStep(user, 'Going with friends?');
    await user.click(screen.getByRole('button', { name: 'I have an invite code' }));
    expect(h.navigate).toHaveBeenCalledWith({ to: '/crew', search: { start: 'join' } });
  });

  it('"Just me" closes without navigating', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await toStep(user, 'Going with friends?');
    await user.click(screen.getByRole('button', { name: 'Just me' }));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows Sign in only for a guest', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Onboarding />);
    await toStep(user, 'Going with friends?');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(h.navigate).toHaveBeenCalledWith({ to: '/login' });
    unmount();
    localStorage.clear();
    h.state.user = { id: 'u1' };
    render(<Onboarding />);
    await toStep(user, 'Going with friends?');
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
