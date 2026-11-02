// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { decodePlanSnapshot, extractPlanSnapshotText } from '@festie/shared/utils';

const festivalState: Record<string, unknown> = {};
const crewState: Record<string, unknown> = {};
const authState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(authState)),
}));

const mockFetchShareLink = vi.fn();
vi.mock('@festie/shared/services', () => ({
  fetchShareLink: (...args: unknown[]) => mockFetchShareLink(...args),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('lucide-react', () => ({
  Share2: () => <span data-testid="share-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

let lastQRValue: string | null = null;
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => {
    lastQRValue = value;
    return <svg data-testid="qr-svg" data-value={value} />;
  },
}));

import SharePicksDialog from './SharePicksDialog';

function setState({
  profile = { picks: { s1: 'must', s2: 'maybe' } } as unknown,
  publicSchedule = false,
}: { profile?: unknown; publicSchedule?: boolean } = {}) {
  [festivalState, crewState, authState].forEach((o) => Object.keys(o).forEach((k) => delete o[k]));
  Object.assign(festivalState, { currentFestival: { id: 'f1', name: 'Bonnaroo' }, currentProfile: profile });
  Object.assign(crewState, { meetingPoints: [] });
  Object.assign(authState, { user: { id: 'u1', publicSchedule } });
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Share my picks' }));
}

describe('SharePicksDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQRValue = null;
    setState();
    mockFetchShareLink.mockResolvedValue({ token: 'tok', url: 'http://localhost:3000/s/abcdefghijklmnopqrstuv' });
  });

  it('renders the trigger as "Share picks"', () => {
    render(<SharePicksDialog />);
    expect(screen.getByRole('button', { name: 'Share my picks' })).toHaveTextContent('Share picks');
  });

  it('shows the share URL and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    render(<SharePicksDialog />);
    open();
    expect(await screen.findByTestId('share-link-url')).toHaveTextContent('/s/abcdefghijklmnopqrstuv');
    expect(mockFetchShareLink).toHaveBeenCalledWith('f1', window.location.origin);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/s/abcdefghijklmnopqrstuv'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows the offline text when the link fetch fails, and the QR still renders', async () => {
    mockFetchShareLink.mockRejectedValue(new Error('network'));
    render(<SharePicksDialog />);
    open();
    expect(await screen.findByTestId('share-link-error')).toHaveTextContent(
      'Connect to the internet to get your link. Share by QR works offline.',
    );
    expect(screen.getByTestId('plan-qr-code')).toBeInTheDocument();
  });

  it('shows the no-profile text on a 404', async () => {
    mockFetchShareLink.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    render(<SharePicksDialog />);
    open();
    expect(await screen.findByTestId('share-link-error')).toHaveTextContent(
      'Pick a set at this festival first, then share your picks.',
    );
  });

  it('puts a /p# URL in the QR that round-trips to the snapshot', () => {
    render(<SharePicksDialog />);
    open();
    expect(lastQRValue).toMatch(new RegExp(`^${window.location.origin}/p#`));
    const decoded = decodePlanSnapshot(extractPlanSnapshotText(lastQRValue));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.festivalId).toBe('f1');
      expect(decoded.data.picks).toHaveLength(2);
    }
  });

  it('reports the public page status', () => {
    setState({ publicSchedule: true });
    render(<SharePicksDialog />);
    open();
    expect(screen.getByText(/Public schedule page is on/)).toBeInTheDocument();
  });
});
