import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalStore } from '@festie/shared/stores';
import MyDaysCard from './MyDaysCard';

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const DAYS = [
  { id: 'd0', festivalId: 'f1', date: '2026-11-06', label: 'Friday' },
  { id: 'd1', festivalId: 'f1', date: '2026-11-07', label: 'Saturday' },
];
const setMyDays = vi.fn(() => Promise.resolve('sent' as const));

beforeEach(() => {
  setMyDays.mockClear();
  useFestivalStore.setState({ currentFestival: { id: 'f1' } as never, days: DAYS as never });
  useCrewStore.setState({
    activeCrew: { id: 'c1', festivalId: 'f1' } as never,
    crewDays: [],
    setMyDays,
  } as never);
});

describe('MyDaysCard', () => {
  it('sets an answer on tap', async () => {
    render(<MyDaysCard currentUserId="u1" />);
    const group = screen.getByRole('radiogroup', { name: 'Saturday: are you going?' });
    await userEvent.click(group.querySelectorAll('[role="radio"]')[2]!);
    expect(setMyDays).toHaveBeenCalledWith('c1', 'u1', { days: [{ dayIndex: 1, answer: 'no' }] });
  });

  it('clears the answer on a second tap', async () => {
    useCrewStore.setState({ crewDays: [{ userId: 'u1', dayIndex: 0, answer: 'going' }] } as never);
    render(<MyDaysCard currentUserId="u1" />);
    const going = screen.getAllByRole('radio', { name: 'Going' })[0]!;
    expect(going).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(going);
    expect(setMyDays).toHaveBeenCalledWith('c1', 'u1', { days: [] });
  });

  it('renders nothing with no festival days', () => {
    useFestivalStore.setState({ days: [] as never });
    const { container } = render(<MyDaysCard currentUserId="u1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
