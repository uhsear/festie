import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminFestivalSubTabs from './AdminFestivalSubTabs';

describe('AdminFestivalSubTabs', () => {
  it('marks the current view and selects another', async () => {
    const onSelect = vi.fn();
    render(<AdminFestivalSubTabs current="edit" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(onSelect).toHaveBeenCalledWith('map');
  });
});
