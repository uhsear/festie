import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mockUsePickSync = vi.fn();
vi.mock('@festie/shared/hooks', () => ({ usePickSync: (id: string) => mockUsePickSync(id) }));

import DetailPriorityPicker from './DetailPriorityPicker';

describe('DetailPriorityPicker', () => {
  const defaultProps = {
    setId: 'set-1',
    myPick: null as null,
    priorityBusy: null as null,
    onPriorityClick: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    mockUsePickSync.mockReturnValue({ sync: undefined, retry: vi.fn() });
  });

  it('shows the pending clock for saving and queued', () => {
    for (const state of ['saving', 'queued']) {
      mockUsePickSync.mockReturnValue({ sync: { state, priority: 'must' }, retry: vi.fn() });
      const { container, unmount } = render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
      expect(container.querySelector('svg.lucide-clock')).toBeInTheDocument();
      unmount();
    }
  });

  it('shows no clock when nothing is pending', () => {
    const { container } = render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
    expect(container.querySelector('svg.lucide-clock')).not.toBeInTheDocument();
  });

  it('shows Retry for a failed pick and calls retry', async () => {
    const retry = vi.fn();
    mockUsePickSync.mockReturnValue({ sync: { state: 'failed', priority: 'must' }, retry });
    render(<DetailPriorityPicker {...defaultProps} />);
    expect(screen.getByText(/Pick not saved\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders all four priority options', () => {
    render(<DetailPriorityPicker {...defaultProps} />);
    expect(screen.getByLabelText('Must See')).toBeInTheDocument();
    expect(screen.getByLabelText('Want to See')).toBeInTheDocument();
    expect(screen.getByLabelText('Maybe')).toBeInTheDocument();
    // Clear is never a selected state: no aria-pressed, disabled while there is nothing to clear.
    const clear = screen.getByLabelText('Clear');
    expect(clear).not.toHaveAttribute('aria-pressed');
    expect(clear).toBeDisabled();
  });

  it('marks active priority as pressed', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
    expect(screen.getByLabelText('Must See (selected)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Want to See')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onPriorityClick with priority value on click', async () => {
    const user = userEvent.setup();
    const onPriorityClick = vi.fn().mockResolvedValue(undefined);
    render(<DetailPriorityPicker {...defaultProps} onPriorityClick={onPriorityClick} />);
    await user.click(screen.getByLabelText('Must See'));
    expect(onPriorityClick).toHaveBeenCalledWith('must');
  });

  it('calls onPriorityClick with null for Clear', async () => {
    const user = userEvent.setup();
    const onPriorityClick = vi.fn().mockResolvedValue(undefined);
    render(<DetailPriorityPicker {...defaultProps} myPick="must" onPriorityClick={onPriorityClick} />);
    await user.click(screen.getByLabelText('Clear'));
    expect(onPriorityClick).toHaveBeenCalledWith(null);
  });

  it('disables all buttons when any priority is busy', () => {
    render(<DetailPriorityPicker {...defaultProps} priorityBusy="must" />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('sets aria-busy on the busy option', () => {
    render(<DetailPriorityPicker {...defaultProps} priorityBusy="must" />);
    expect(screen.getByLabelText('Must See')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Want to See')).toHaveAttribute('aria-busy', 'false');
  });

  it('renders a Lucide icon for each priority', () => {
    render(<DetailPriorityPicker {...defaultProps} />);
    // Icons are now Lucide SVGs (Star/Heart/Circle/X), not Unicode glyphs.
    for (const label of ['Must See', 'Want to See', 'Maybe', 'Clear']) {
      expect(screen.getByLabelText(label).querySelector('svg')).toBeInTheDocument();
    }
  });

  it('adds active styling when priority is selected', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="want-to-see" />);
    const btn = screen.getByLabelText('Want to See (selected)');
    expect(btn.className).toContain('border-priority-want');
  });

  it('does not add active styling when priority is not selected', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
    const btn = screen.getByLabelText('Maybe');
    expect(btn.className).not.toContain('border-priority-maybe');
  });
});
