import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GuestFooter from './GuestFooter';

describe('GuestFooter', () => {
  it('links to privacy, terms and support', () => {
    render(<GuestFooter />);
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms.html');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', 'mailto:support@festie.us');
    expect(screen.getByRole('contentinfo', { name: 'Legal and help' })).toBeInTheDocument();
  });
});
