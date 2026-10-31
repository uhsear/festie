import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
