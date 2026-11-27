import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Crew, Festival } from '@festie/shared/types';

// Mock useHaptics
vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: vi.fn(() => ({ tap: vi.fn(), select: vi.fn() })),
}));

import CrewSelector from './CrewSelector';

const makeCrew = (overrides: Partial<Crew> = {}): Crew => ({
  id: 'crew-1',
  name: 'Test Crew',
  owner: 'user-1',
  members: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('CrewSelector', () => {
  const defaultProps = {
    crews: [
      makeCrew({ id: 'crew-1', name: 'Alpha Crew' }),
      makeCrew({ id: 'crew-2', name: 'Beta Squad' }),
    ],
    selectedCrewId: 'crew-1',
    onSelectCrew: vi.fn(),
    onCreateCrew: vi.fn(),
    onJoinCrew: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the select crew trigger button', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByRole('button', { name: /^Select crew/ })).toBeInTheDocument();
  });

  it('shows selected crew name in the trigger', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByText('Alpha Crew')).toBeInTheDocument();
  });

  it('shows "Select Crew" when no crews match selectedCrewId', () => {
    render(<CrewSelector {...defaultProps} crews={[]} selectedCrewId={undefined} />);
    expect(screen.getByText('Select Crew')).toBeInTheDocument();
  });

  it('starts collapsed (listbox not visible)', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('expands on click to show crew list', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Alpha Crew/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Beta Squad/ })).toBeInTheDocument();
  });

  it('marks selected crew with aria-selected', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    expect(screen.getByRole('option', { name: /Alpha Crew/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Beta Squad/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelectCrew and closes when a crew is selected', async () => {
    const onSelectCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onSelectCrew={onSelectCrew} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    await user.click(screen.getByRole('option', { name: /Beta Squad/ }));
    expect(onSelectCrew).toHaveBeenCalledWith('crew-2');
    // Panel should close after selection
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders Create crew and Join with code buttons in the dropdown', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    expect(screen.getByRole('button', { name: /Create crew/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join with code/ })).toBeInTheDocument();
  });

  it('calls onCreateCrew and closes when Create crew is clicked', async () => {
    const onCreateCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onCreateCrew={onCreateCrew} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    await user.click(screen.getByRole('button', { name: /Create crew/ }));
    expect(onCreateCrew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onJoinCrew and closes when Join with code is clicked', async () => {
    const onJoinCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onJoinCrew={onJoinCrew} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    await user.click(screen.getByRole('button', { name: /Join with code/ }));
    expect(onJoinCrew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sets aria-expanded correctly on the trigger button', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /^Select crew/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('has aria-haspopup=listbox on the trigger', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByRole('button', { name: /^Select crew/ })).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('moves focus between options with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /^Select crew/ }));
    const alpha = screen.getByRole('option', { name: /Alpha Crew/ });
    const beta = screen.getByRole('option', { name: /Beta Squad/ });
    // Opening focuses the first option in a requestAnimationFrame. Wait for it, or it can land after the first arrow key and steal focus back.
    await waitFor(() => expect(alpha).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(beta).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(alpha).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(beta).toHaveFocus();
    await user.keyboard('{End}');
    expect(beta).toHaveFocus();
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /^Select crew/ });
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('toggles closed on second click', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /^Select crew/ });
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  describe('festival groups', () => {
    const festivals = [
      { id: 'f-now', name: 'EDC Orlando', startDate: '2026-11-06', endDate: '2026-11-08' },
      { id: 'f-past', name: 'Lost Lands 2025', startDate: '2025-09-18', endDate: '2025-09-20' },
    ] as unknown as Festival[];
    const crews = [
      makeCrew({ id: 'c-past', name: 'Old Crew', festivalId: 'f-past' }),
      makeCrew({ id: 'c-now', name: 'New Crew', festivalId: 'f-now' }),
    ];
    const props = { ...defaultProps, crews, selectedCrewId: 'c-now', festivals, currentFestivalId: 'f-now' };
    // Pin the clock inside EDC so the "current" group never ages into a dimmed past one.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders labelled groups with the current festival first and past ones dimmed', async () => {
      const user = userEvent.setup();
      render(<CrewSelector {...props} />);
      await user.click(screen.getByRole('button', { name: /^Select crew/ }));
      const groups = screen.getAllByRole('group');
      expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['EDC Orlando', 'Lost Lands 2025']);
      expect(groups[1]).toHaveClass('opacity-60');
      expect(groups[0]).not.toHaveClass('opacity-60');
    });

    it('adds the year to the trigger label only when two festivals share a name', () => {
      const twins = [
        ...festivals,
        { id: 'f-next', name: 'EDC Orlando', startDate: '2027-11-05', endDate: '2027-11-07' },
      ] as unknown as Festival[];
      render(<CrewSelector {...props} festivals={twins} />);
      expect(screen.getByRole('button', { name: /^Select crew/ })).toHaveTextContent('New CrewEDC Orlando 2026');
    });

    it('shows the festival label of the selected crew under its name in the trigger', () => {
      render(<CrewSelector {...props} />);
      expect(screen.getByRole('button', { name: /^Select crew/ })).toHaveTextContent('New CrewEDC Orlando');
    });

    it('adds the member count after the festival, so the switcher is the whole header', () => {
      render(<CrewSelector {...props} memberCount={4} />);
      expect(screen.getByRole('button', { name: /^Select crew/ })).toHaveTextContent('EDC Orlando · 4 members');
    });

    it('uses the singular for a crew of one and shows the count without a festival', () => {
      render(<CrewSelector {...defaultProps} memberCount={1} />);
      expect(screen.getByRole('button', { name: /^Select crew/ })).toHaveTextContent('Alpha Crew1 member');
    });
  });
});
