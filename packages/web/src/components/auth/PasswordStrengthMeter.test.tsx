import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PasswordStrengthMeter from './PasswordStrengthMeter';

describe('PasswordStrengthMeter', () => {
  it('renders nothing for an empty password', () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('flags a short password', () => {
    render(<PasswordStrengthMeter password="abc" />);
    expect(screen.getByRole('status', { name: 'Password strength: Too short' })).toBeInTheDocument();
  });

  it('does not call a common password good', () => {
    render(<PasswordStrengthMeter password="Password1" />);
    expect(screen.getByRole('status', { name: 'Password strength: Too guessable' })).toBeInTheDocument();
  });

  it('uses the username and email to cap the score', () => {
    render(<PasswordStrengthMeter password="Maria1234!" username="maria" email="m@example.com" />);
    expect(screen.getByRole('status', { name: 'Password strength: Too guessable' })).toBeInTheDocument();
  });

  it('fills every segment for a strong password', () => {
    render(<PasswordStrengthMeter password="Abcdefgh1!" />);
    expect(screen.getByRole('status', { name: 'Password strength: Strong' })).toBeInTheDocument();
    expect(screen.getAllByTestId('strength-segment').filter((s) => s.dataset.filled === 'true')).toHaveLength(4);
  });
});
