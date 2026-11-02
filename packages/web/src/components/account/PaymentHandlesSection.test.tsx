import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
let storeUser: Record<string, unknown>;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: storeUser, updatePaymentHandles: (...a: unknown[]) => mockUpdate(...a) }),
}));
vi.mock('@festie/shared/services/api', () => ({
  mapErrorToUserMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PaymentHandlesSection from './PaymentHandlesSection';

describe('PaymentHandlesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeUser = { id: 'u1', username: 'raver' };
    mockUpdate.mockResolvedValue({ venmoHandle: 'sam', cashappCashtag: null, paypalHandle: null });
  });

  it('shows the three prefixes', () => {
    render(<PaymentHandlesSection />);
    expect(screen.getByText('@')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('paypal.me/')).toBeInTheDocument();
  });

  it('shows a Test link only for a filled field', async () => {
    render(<PaymentHandlesSection />);
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.type(screen.getByLabelText('Venmo username'), 'sam');
    const link = screen.getByRole('link', { name: /Venmo username/ });
    expect(link).toHaveAttribute('href', 'https://venmo.com/sam');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('saves trimmed values through the store', async () => {
    render(<PaymentHandlesSection />);
    await userEvent.type(screen.getByLabelText('Venmo username'), '  sam ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockUpdate).toHaveBeenCalledWith({ venmoHandle: 'sam', cashappCashtag: '', paypalHandle: '' });
  });
});
