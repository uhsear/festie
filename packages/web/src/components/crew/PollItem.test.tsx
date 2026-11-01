import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewMember } from '@festie/shared';
import PollItem, { type PollItemProps } from './PollItem';

function makePoll(overrides: Partial<PollItemProps['poll']> = {}): PollItemProps['poll'] {
  return {
    id: 'poll-1',
    crew_id: 'crew-1',
    closes_at: null,
    closed: false,
    created_at: '2026-10-31T12:00:00.000Z',
    created_by: 'user-a',
    question: 'Where should we camp?',
    options: ['North field', 'South field', 'West lot'],
    votes: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<PollItemProps> = {}): PollItemProps {
  return {
    poll: makePoll(),
    index: 0,
    currentUserId: 'user-b',
    isOwner: false,
    isVotePending: false,
    isClosePending: false,
    members: [],
    picks: {},
    onVote: vi.fn(),
    onClose: vi.fn(),
    onNudge: vi.fn(),
    onAddToPicks: vi.fn(),
    ...overrides,
  };
}

describe('PollItem', () => {
  it('renders the poll question', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('Where should we camp?')).toBeInTheDocument();
  });

  it('renders all option buttons', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('North field')).toBeInTheDocument();
    expect(screen.getByText('South field')).toBeInTheDocument();
    expect(screen.getByText('West lot')).toBeInTheDocument();
  });

  it('shows "0 voted" when no votes exist', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('0 voted')).toBeInTheDocument();
  });

  it('shows "1 voted" label', () => {
    const poll = makePoll({
      votes: [{ option: 0, user_id: 'user-x' }],
    });
    render(<PollItem {...makeProps({ poll })} />);
    expect(screen.getByText('1 voted')).toBeInTheDocument();
  });

  it('shows "N voted" label for multiple voters', () => {
    const poll = makePoll({
      votes: [
        { option: 0, user_id: 'user-x' },
        { option: 1, user_id: 'user-y' },
        { option: 0, user_id: 'user-z' },
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    expect(screen.getByText('3 voted')).toBeInTheDocument();
  });

  it('calculates percentages correctly', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [
        { option: 0, user_id: 'u1' },
        { option: 0, user_id: 'u2' },
        { option: 1, user_id: 'u3' },
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    // 2/3 = 67%, 1/3 = 33%
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows 0% for all options when there are no votes', () => {
    const poll = makePoll({ options: ['X', 'Y'] });
    render(<PollItem {...makeProps({ poll })} />);
    const zeroPcts = screen.getAllByText('0%');
    expect(zeroPcts).toHaveLength(2);
  });

  it('marks the current user vote via isMine', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [{ option: 1, user_id: 'user-b' }],
    });
    render(<PollItem {...makeProps({ poll, currentUserId: 'user-b' })} />);
    const buttons = screen.getAllByRole('button');
    // Option B (index 1) should be pressed
    const optionB = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(optionB).toBeDefined();
  });

  it('calls onVote when an option is clicked', async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();
    render(<PollItem {...makeProps({ onVote })} />);
    const buttons = screen.getAllByRole('button');
    // Click the first poll option button (not the end button)
    await user.click(buttons[0]);
    expect(onVote).toHaveBeenCalledWith('poll-1', 0);
  });

  it('shows end button for the poll creator', () => {
    render(<PollItem {...makeProps({ poll: makePoll({ created_by: 'user-b' }), currentUserId: 'user-b' })} />);
    expect(screen.getByText('End poll')).toBeInTheDocument();
  });

  it('shows end button for crew owner even if not poll creator', () => {
    render(<PollItem {...makeProps({ isOwner: true })} />);
    expect(screen.getByText('End poll')).toBeInTheDocument();
  });

  it('hides end button for non-owner, non-creator users', () => {
    render(<PollItem {...makeProps({ isOwner: false, currentUserId: 'user-b' })} />);
    expect(screen.queryByText('End poll')).not.toBeInTheDocument();
  });

  it('calls onClose with poll id when end button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PollItem {...makeProps({ isOwner: true, onClose })} />);
    await user.click(screen.getByText('End poll'));
    expect(onClose).toHaveBeenCalledWith('poll-1');
  });

  it('disables end button when isClosePending is true', () => {
    render(<PollItem {...makeProps({ isOwner: true, isClosePending: true })} />);
    const closeBtn = screen.getByText('End poll').closest('button');
    expect(closeBtn).toBeDisabled();
  });

  it('ignores votes with out-of-range option indices', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [
        { option: 0, user_id: 'u1' },
        { option: 5, user_id: 'u2' },  // out of range
        { option: -1, user_id: 'u3' }, // negative
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    // Only 1 valid vote
    expect(screen.getByText('1 voted')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  describe('decided and reminders', () => {
    const members = (ids: string[]) => ids.map((userId) => ({ userId, name: userId })) as unknown as CrewMember[];
    const setPoll = (votes: { option: number; user_id: string }[]) =>
      makePoll({
        options: ['Alpha', 'Beta'],
        closed: true,
        votes,
        set_refs: [
          { setId: 'set-a', label: 'Alpha', stageReference: null, meetAt: null },
          { setId: 'set-b', label: 'Beta', stageReference: null, meetAt: null },
        ],
      });

    it('shows the decision line and disables options on a closed poll', () => {
      render(<PollItem {...makeProps({ poll: setPoll([{ option: 1, user_id: 'u1' }]) })} />);
      expect(screen.getByText('Decided: Beta')).toBeInTheDocument();
      for (const b of screen.getAllByRole('button', { name: /percent/ })) expect(b).toBeDisabled();
    });

    it('calls onAddToPicks with the winning set id', async () => {
      const user = userEvent.setup();
      const onAddToPicks = vi.fn();
      render(<PollItem {...makeProps({ poll: setPoll([{ option: 1, user_id: 'u1' }]), onAddToPicks })} />);
      await user.click(screen.getByText('Add to my picks'));
      expect(onAddToPicks).toHaveBeenCalledWith('set-b');
    });

    it('shows In your picks when the set is already picked', () => {
      render(<PollItem {...makeProps({ poll: setPoll([{ option: 1, user_id: 'u1' }]), picks: { 'set-b': 'must' } })} />);
      expect(screen.getByText('In your picks')).toBeInTheDocument();
      expect(screen.queryByText('Add to my picks')).not.toBeInTheDocument();
    });

    it('shows a tie and no Add to my picks', () => {
      const poll = setPoll([
        { option: 0, user_id: 'u1' },
        { option: 1, user_id: 'u2' },
      ]);
      render(<PollItem {...makeProps({ poll })} />);
      expect(screen.getByText('Tie: Alpha and Beta')).toBeInTheDocument();
      expect(screen.queryByText('Add to my picks')).not.toBeInTheDocument();
    });

    it('shows the reminder button with the right count and calls onNudge', async () => {
      const user = userEvent.setup();
      const onNudge = vi.fn();
      const poll = makePoll({ votes: [{ option: 0, user_id: 'user-a' }] });
      render(
        <PollItem
          {...makeProps({ poll, isOwner: true, onNudge, members: members(['user-a', 'user-b', 'user-c', 'user-d']) })}
        />,
      );
      await user.click(screen.getByText('Remind 2 people'));
      expect(onNudge).toHaveBeenCalledWith('poll-1');
    });

    it('hides the reminder button after nudged_at and shows Reminder sent', () => {
      const poll = makePoll({ nudged_at: '2026-10-31T12:05:00.000Z' });
      render(<PollItem {...makeProps({ poll, isOwner: true, members: members(['user-a', 'user-c']) })} />);
      expect(screen.queryByText(/^Remind d/)).not.toBeInTheDocument();
      expect(screen.getByText('Reminder sent')).toBeInTheDocument();
    });

    it('shows Pick any for a multi-answer poll', () => {
      render(<PollItem {...makeProps({ poll: makePoll({ multi_answer: true }) })} />);
      expect(screen.getByText('Pick any')).toBeInTheDocument();
    });
  });
});
