import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapNameInput from './MapNameInput';

describe('MapNameInput', () => {
  it('commits on Enter only when the draft changed', async () => {
    const onCommit = vi.fn();
    render(<MapNameInput label="Camp" value="Camp" onCommit={onCommit} />);
    const input = screen.getByLabelText('Name of Camp');
    await userEvent.type(input, '{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.type(input, ' A{Enter}');
    expect(onCommit).toHaveBeenCalledWith('Camp A');
  });
});
