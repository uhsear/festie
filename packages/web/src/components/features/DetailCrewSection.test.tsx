import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailCrewSection from './DetailCrewSection';

describe('DetailCrewSection', () => {
  it('closes the empty state with a sentence under the heading', () => {
    render(<DetailCrewSection title="Nobody else going yet" others={[]} crewNotes={[]} />);
    expect(screen.getByText('When friends pick this set, they show up here.')).toBeInTheDocument();
  });

  it('shows no empty line once someone is going', () => {
    render(
      <DetailCrewSection
        title="Who's Going (1)"
        others={[{ profileId: 'p1', name: 'Alex', priority: 'must' }]}
        crewNotes={[]}
      />,
    );
    expect(screen.queryByText(/show up here/)).not.toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  const others = [
    { profileId: 'p1', name: 'Alex', priority: 'must' },
    { profileId: 'p2', name: 'Ana', priority: 'maybe' },
  ];

  it('shows no View as button without the props', () => {
    render(<DetailCrewSection title="Who" others={others} crewNotes={[]} />);
    expect(screen.queryByRole('button', { name: /View as/ })).not.toBeInTheDocument();
  });

  it('shows View as only where canViewAs allows and passes the profile id', async () => {
    const user = userEvent.setup();
    const onViewAs = vi.fn();
    render(
      <DetailCrewSection
        title="Who"
        others={others}
        crewNotes={[]}
        canViewAs={(id) => id === 'p2'}
        onViewAs={onViewAs}
      />,
    );
    expect(screen.queryByRole('button', { name: 'View as Alex' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View as Ana' }));
    expect(onViewAs).toHaveBeenCalledWith('p2');
  });
});
