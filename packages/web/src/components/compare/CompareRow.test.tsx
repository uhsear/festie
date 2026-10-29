import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompareRow from './CompareRow';
import type { FestivalSet, Priority } from '@festie/shared/types';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    artist: 'Daft Punk',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>,
  );
}

describe('CompareRow', () => {
  const defaultProps = {
    set: makeSet(),
    mine: 'must' as Priority,
    others: [] as Array<{ profileId: string; priority: Priority }>,
    columns: [
      { id: 'me', isMe: true },
      { id: 'other', isMe: false },
    ],
    stageColor: '#ff3366',
    stageName: 'Main Stage',
    isConsensus: false,
  };

  it('renders the artist name', () => {
    renderInTable(<CompareRow {...defaultProps} />);
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('renders the stage name', () => {
    renderInTable(<CompareRow {...defaultProps} />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders time range', () => {
    renderInTable(<CompareRow {...defaultProps} />);
    // formatTime converts 14:00 to "2:00 PM" and 15:00 to "3:00 PM"
    expect(screen.getByText(/2:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/3:00 PM/)).toBeInTheDocument();
  });

  it('shows "N of M picked" with the crew overlap count, not an amber badge', () => {
    renderInTable(
      <CompareRow {...defaultProps} others={[{ profileId: 'other', priority: 'want-to-see' }]} isConsensus />,
    );
    const badge = screen.getByTestId('compare-picked-count');
    expect(badge).toHaveTextContent('2 of 2 picked');
    expect(badge.className).toContain('text-accent-aqua');
    expect(badge.className).not.toContain('amber');
  });

  it('keeps a lone pick neutral', () => {
    renderInTable(<CompareRow {...defaultProps} isConsensus={false} />);
    const badge = screen.getByTestId('compare-picked-count');
    expect(badge).toHaveTextContent('1 of 2 picked');
    expect(badge.className).toContain('text-text-muted');
  });

  it('renders my pick in the first column', () => {
    renderInTable(<CompareRow {...defaultProps} />);
    expect(screen.getByText('Must')).toBeInTheDocument();
  });

  it('renders a dash when other user has no pick', () => {
    renderInTable(<CompareRow {...defaultProps} />);
    // The "other" column has no match in others array
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders other user pick when present', () => {
    renderInTable(<CompareRow {...defaultProps} others={[{ profileId: 'other', priority: 'maybe' }]} />);
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('shows the stage name in the stage color', () => {
    // The stage cue is the stage-colored name (the old left-stripe was an AI
    // tell and was removed). jsdom normalizes hex to rgb.
    renderInTable(<CompareRow {...defaultProps} />);
    const stageEl = screen.getByText('Main Stage');
    expect(stageEl.style.color).toBe('rgb(255, 51, 102)');
  });
});
