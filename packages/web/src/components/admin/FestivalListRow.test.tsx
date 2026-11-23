import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalListRow from './FestivalListRow';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode; 'aria-label'?: string }) => (
    <a href="/admin" aria-label={rest['aria-label']}>{children}</a>
  ),
}));

const festival = { id: 'f1', name: 'Fest', location: 'Orlando', published: false, stageCount: 2, dayCount: 3 };

describe('FestivalListRow', () => {
  it('shows the draft badge and counts', () => {
    render(
      <FestivalListRow festival={festival} selected={false} onToggleSelected={vi.fn()} onOpen={vi.fn()} onArtists={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Orlando · 2 stages · 3 days')).toBeInTheDocument();
  });

  it('shows Waiting for review in place of Draft while an organizer request is open', () => {
    render(
      <FestivalListRow festival={festival} waitingForReview selected={false} onToggleSelected={vi.fn()} onOpen={vi.fn()} onArtists={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Waiting for review')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('uses singular nouns for one stage or one day', () => {
    render(
      <FestivalListRow festival={{ ...festival, stageCount: 1, dayCount: 1 }} selected={false} onToggleSelected={vi.fn()} onOpen={vi.fn()} onArtists={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Orlando · 1 stage · 1 day')).toBeInTheDocument();
  });

  it('routes each action', async () => {
    const onOpen = vi.fn();
    const onArtists = vi.fn();
    const onDelete = vi.fn();
    const onToggleSelected = vi.fn();
    render(
      <FestivalListRow festival={festival} selected onToggleSelected={onToggleSelected} onOpen={onOpen} onArtists={onArtists} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit Fest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import lineup for Fest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit map for Fest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Artists for Fest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Fest' }));
    await userEvent.click(screen.getByLabelText('Select Fest'));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['edit', 'import', 'map']);
    expect(onArtists).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });
});
