import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SetEditor from './SetEditor';

const renderEditor = (startTime: string, dayLabel?: string) =>
  render(<SetEditor set={{ id: 's1', startTime }} dayLabel={dayLabel} stages={[]} onField={vi.fn()} onRemove={vi.fn()} />);

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
