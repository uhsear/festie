import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IOSInstallDrawer from './IOSInstallDrawer';

describe('IOSInstallDrawer', () => {
  it('renders nothing when closed', () => {
    render(<IOSInstallDrawer open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Add Festie to Home Screen')).not.toBeInTheDocument();
  });

  it('shows the install steps when open', () => {
    render(<IOSInstallDrawer open onClose={vi.fn()} />);
    expect(screen.getByText('Add Festie to Home Screen')).toBeInTheDocument();
    expect(screen.getByText('Add to Home Screen')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('reports "later" and "got-it" from the action buttons', () => {
    const onClose = vi.fn();
    render(<IOSInstallDrawer open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(onClose).toHaveBeenLastCalledWith('later');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenLastCalledWith('got-it');
  });
});
