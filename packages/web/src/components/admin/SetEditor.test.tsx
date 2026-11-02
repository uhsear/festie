import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SetEditor from './SetEditor';

const renderEditor = (startTime: string, dayLabel?: string) =>
  render(
    <SetEditor set={{ id: 's1', startTime }} dayLabel={dayLabel} stages={[]} onField={vi.fn()} onRemove={vi.fn()} />,
  );

describe('SetEditor after-midnight hint', () => {
  it('shows the hint for a 01:00 start', () => {
    renderEditor('01:00', 'Friday');
    expect(screen.getByText('After midnight. Shows as part of Friday night.')).toBeTruthy();
  });

  it("falls back to this day's when there is no label", () => {
    renderEditor('01:00');
    expect(screen.getByText("After midnight. Shows as part of this day's night.")).toBeTruthy();
  });

  it('hides the hint for a 21:00 start', () => {
    renderEditor('21:00', 'Friday');
    expect(screen.queryByText(/After midnight/)).toBeNull();
  });
});

describe('SetEditor phone layout and engagement', () => {
  const base = { id: 's1', artist: 'Alpha', startTime: '21:00' };

  it('shows the engagement label when showEngagement is true', () => {
    render(
      <SetEditor
        set={base}
        stages={[]}
        engagement={{ picks: 3, reminders: 1 }}
        showEngagement
        onField={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Picked by 3 · 1 reminder')).toBeTruthy();
  });

  it('says there are no picks for a loaded set with no entry', () => {
    render(<SetEditor set={base} stages={[]} showEngagement onField={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('No picks or reminders yet')).toBeTruthy();
  });

  it('has no engagement row when showEngagement is false', () => {
    render(
      <SetEditor set={base} stages={[]} engagement={{ picks: 3, reminders: 1 }} onField={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/Picked by/)).toBeNull();
    expect(screen.queryByText('No picks or reminders yet')).toBeNull();
  });

  it('renders a visible label for each field', () => {
    render(<SetEditor set={base} stages={[]} onField={vi.fn()} onRemove={vi.fn()} />);
    for (const label of ['Artist', 'Stage', 'Start', 'End']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText('Artist name')).toBeTruthy();
  });

  it('Remove set calls onRemove', () => {
    const onRemove = vi.fn();
    render(<SetEditor set={base} stages={[]} onField={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByText('Remove set'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
