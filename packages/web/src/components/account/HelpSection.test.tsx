import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HelpSection from './HelpSection';

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: { username: 'alice' } }),
}));
vi.mock('./InstallAppRow', () => ({ default: () => <div>Install Festie</div> }));

describe('HelpSection', () => {
  it('renders the rows in order', () => {
    const { container } = render(<HelpSection />);
    const text = container.textContent ?? '';
    const order = [
      'How Festie works',
      'Contact support',
      'Terms of service',
      'Privacy policy',
      'Support Festie',
      'Third-party notices',
      'Install Festie',
      'Festie web',
    ].map((label) => text.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('links support, terms and privacy', () => {
    render(<HelpSection />);
    const support = screen.getByRole('link', { name: /Contact support/ });
    expect(support.getAttribute('href')).toMatch(/^mailto:support@festie\.us\?/);
    expect(decodeURIComponent(support.getAttribute('href')!)).toContain('Username: alice');
    expect(screen.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy.html');
  });

  it('shows the dev version line under vitest', () => {
    render(<HelpSection />);
    expect(screen.getByText('Festie web · dev')).toBeInTheDocument();
  });
});
