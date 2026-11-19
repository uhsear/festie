import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PollEndPicker from './PollEndPicker';

describe('PollEndPicker', () => {
  it('renders a labelled radiogroup with the selected choice checked', () => {
    render(<PollEndPicker labelId="x-label" value="1h" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Ends' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '1 hour' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'No end' }).getAttribute('aria-checked')).toBe('false');
  });

  it('calls onChange with the clicked choice id and honours a filtered list', () => {
    const onChange = vi.fn();
    render(<PollEndPicker labelId="x-label" value="none" onChange={onChange} choices={[{ id: '30m', label: '30 min' }]} />);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    expect(onChange).toHaveBeenCalledWith('30m');
  });
});
