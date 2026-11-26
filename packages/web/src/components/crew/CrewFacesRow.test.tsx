import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const faces: unknown[] = [];
vi.mock('@festie/shared/hooks', () => ({
  useCrewFaces: () => faces,
  useFestival: () => ({ getStageColor: (id: string) => (id === 'main' ? 'rgb(1, 2, 3)' : 'rgb(9, 9, 9)') }),
}));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ days: [], currentFestival: null }),
}));
vi.mock('../../hooks/useLastKnownFix', () => ({ useLastKnownFix: () => ({ coord: null, at: null }) }));

import CrewFacesRow from './CrewFacesRow';

describe('CrewFacesRow', () => {
  beforeEach(() => {
    faces.length = 0;
  });

  it('renders nothing when nobody else is in the crew', () => {
    const { container } = render(<CrewFacesRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each member with a caption and rings the avatar in the stage colour', () => {
    faces.push(
      { userId: 'a', name: 'Ari', stageId: 'main', caption: '4 min walk', sos: false },
      { userId: 'b', name: 'Bo', stageId: null, caption: 'Seen 12 min ago', sos: false },
    );
    render(<CrewFacesRow />);
    expect(screen.getByText('4 min walk')).toBeInTheDocument();
    expect(screen.getByText('Seen 12 min ago')).toBeInTheDocument();
    const ring = screen.getByText('Ari').parentElement!.querySelector('span');
    expect(ring).toHaveStyle({ borderColor: 'rgb(1, 2, 3)' });
  });
});
