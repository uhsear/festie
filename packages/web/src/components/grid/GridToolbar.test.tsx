import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GridToolbar from './GridToolbar';

function renderToolbar(overrides: Partial<React.ComponentProps<typeof GridToolbar>> = {}) {
  const props = {
    clashCount: 0,
    onShowClash: vi.fn(),
    zoom: 1,
    onZoom: vi.fn(),
    exporting: false,
    onExport: vi.fn(),
    ...overrides,
  };
  render(<GridToolbar {...props} />);
  return props;
}

describe('GridToolbar', () => {
  it('hides the clash chip when there are no clashes', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: /schedule clash/ })).not.toBeInTheDocument();
  });

  it('labels the chip for one and for several clashes', () => {
    const { onShowClash } = renderToolbar({ clashCount: 1 });
    const one = screen.getByRole('button', { name: 'You have 1 schedule clash. Show it.' });
    expect(one).toHaveTextContent('1 clash');
    fireEvent.click(one);
    expect(onShowClash).toHaveBeenCalledOnce();
  });

  it('labels the chip for three clashes', () => {
    renderToolbar({ clashCount: 3 });
    const three = screen.getByRole('button', { name: 'You have 3 schedule clashes. Show the first one.' });
    expect(three).toHaveTextContent('3 clashes');
  });

  it('steps zoom by one level from the middle', () => {
    const { onZoom } = renderToolbar({ zoom: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoom.mock.calls).toEqual([[0], [2]]);
  });

  it('disables Zoom out at the smallest level and Zoom in at the largest', () => {
    renderToolbar({ zoom: 0 });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  });

  it('disables Zoom in at the largest level', () => {
    renderToolbar({ zoom: 2 });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  });

  it('calls onExport from the share button', () => {
    const { onExport } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Share grid as image' }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});
