import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthLayout from './AuthLayout';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

describe('AuthLayout', () => {
  it('renders the sample lineup panel and the form column', () => {
    render(
      <AuthLayout>
        <form aria-label="sign in" />
      </AuthLayout>,
    );
    expect(screen.getByTestId('auth-lineup-panel').querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByRole('form', { name: 'sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('auth-sample-row')).toBeNull();
  });

  it('adds the single phone sample row only when asked', () => {
    render(
      <AuthLayout phoneSample>
        <span />
      </AuthLayout>,
    );
    expect(screen.getByTestId('auth-sample-row').querySelectorAll('li')).toHaveLength(1);
  });
});
