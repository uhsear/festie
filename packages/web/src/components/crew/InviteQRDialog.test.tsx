import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteQRDialog from './InviteQRDialog';

describe('InviteQRDialog', () => {
  it('shows the code, the QR and the crew name when open', () => {
    render(<InviteQRDialog open onOpenChange={vi.fn()} crewName="Night Owls" code="AB12CD" />);
    expect(screen.getByRole('dialog', { name: 'Scan to join Night Owls' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code to join Night Owls' })).toBeInTheDocument();
    expect(screen.getByTestId('invite-qr-code').querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('AB12CD')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<InviteQRDialog open={false} onOpenChange={vi.fn()} crewName="Night Owls" code="AB12CD" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks to close from the Close button', async () => {
    const onOpenChange = vi.fn();
    render(<InviteQRDialog open onOpenChange={onOpenChange} crewName="Night Owls" code="AB12CD" />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
