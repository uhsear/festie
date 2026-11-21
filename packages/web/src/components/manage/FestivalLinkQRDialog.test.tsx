import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FestivalLinkQRDialog from './FestivalLinkQRDialog';

describe('FestivalLinkQRDialog', () => {
  it('shows the public link and a QR image named for it', () => {
    render(<FestivalLinkQRDialog open onOpenChange={() => {}} festivalName="Fest" link="https://festie.us/f/fest" />);
    expect(screen.getByRole('img', { name: 'QR code for https://festie.us/f/fest' })).toBeInTheDocument();
    expect(screen.getByText('https://festie.us/f/fest')).toBeInTheDocument();
    expect(screen.getByText('QR code for Fest')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(<FestivalLinkQRDialog open={false} onOpenChange={() => {}} festivalName="Fest" link="https://festie.us/f/fest" />);
    expect(screen.queryByTestId('festival-link-qr')).not.toBeInTheDocument();
  });
});
