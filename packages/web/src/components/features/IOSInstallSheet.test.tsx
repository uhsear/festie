import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const dismiss = vi.fn();
let shouldShow = false;
vi.mock('../../hooks/useIOSInstall', () => ({
  useIOSInstall: () => ({ shouldShow, dismiss }),
}));

import IOSInstallSheet from './IOSInstallSheet';

describe('IOSInstallSheet', () => {
  it('stays hidden until the hook says to show', () => {
    shouldShow = false;
    render(<IOSInstallSheet />);
    expect(screen.queryByText('Add Festie to Home Screen')).not.toBeInTheDocument();
  });

  it('shows the drawer and records the dismissal reason', () => {
    shouldShow = true;
    render(<IOSInstallSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(dismiss).toHaveBeenCalledWith('got-it');
  });
});
