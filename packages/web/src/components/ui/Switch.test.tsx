import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Switch from './Switch';

describe('Switch', () => {
  it('exposes role=switch and follows checked', () => {
    const { rerender } = render(<Switch checked={false} onChange={() => {}} label="Thing" />);
    const sw = screen.getByRole('switch', { name: 'Thing' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw.className).toContain('bg-control-track-off');
    rerender(<Switch checked onChange={() => {}} label="Thing" />);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.className).toContain('bg-accent-aqua');
  });

  it('calls onChange with the opposite value', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Thing" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
