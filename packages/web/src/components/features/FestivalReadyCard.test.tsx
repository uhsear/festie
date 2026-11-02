import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FestivalReadyCard from './FestivalReadyCard';
import { getFestivalReadyChecklist, formatReadyProgress } from '@festie/shared/utils';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));

function makeReady(flags: Partial<Parameters<typeof getFestivalReadyChecklist>[0]> = {}, visible = true) {
  const { items, doneCount, total } = getFestivalReadyChecklist({
    pickCount: 0,
    hasCrew: false,
    remindersOn: false,
    offlineReady: false,
    ...flags,
  });
  return {
    visible,
    items,
    doneCount,
    total,
    progressLabel: formatReadyProgress(doneCount, total),
    hide: vi.fn(),
  };
}

describe('FestivalReadyCard', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<FestivalReadyCard ready={makeReady({}, false)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows progress for two done items', () => {
    const { container } = render(<FestivalReadyCard ready={makeReady({ pickCount: 3, remindersOn: true })} />);
    expect(screen.getAllByText('2 of 4 done').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    // Two done rows carry a check icon, two open rows carry a circle.
    expect(container.querySelectorAll('svg.lucide-check')).toHaveLength(2);
    expect(container.querySelectorAll('svg.lucide-circle')).toHaveLength(2);
  });

  it('navigates from the crew row, and the picks row is not a button', () => {
    render(<FestivalReadyCard ready={makeReady()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start or join a crew, not done yet' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew' });
    expect(screen.queryByRole('button', { name: /Pick your first sets/ })).toBeNull();
    expect(screen.getByText('Pick your first sets')).toBeInTheDocument();
  });

  it('calls hide', () => {
    const ready = makeReady();
    render(<FestivalReadyCard ready={ready} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the Festival ready checklist' }));
    expect(ready.hide).toHaveBeenCalled();
  });
});
