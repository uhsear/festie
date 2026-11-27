import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { SosEntry } from '@festie/shared/types';

let user: { id: string } | null = { id: 'me' };
let crew: { id: string } | null = { id: 'c1' };
let entries: SosEntry[] = [];
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (selector: (s: { user: typeof user }) => unknown) => selector({ user }),
  useCrewStore: (selector: (s: { activeCrew: typeof crew }) => unknown) => selector({ activeCrew: crew }),
}));
vi.mock('@festie/shared/hooks', () => ({ useActiveSos: () => entries }));
vi.mock('../crew/SosRaiseButton', () => ({
  default: ({ crewId, alerting }: { crewId: string; alerting?: boolean }) => (
    <button data-testid="sos-raise" data-alerting={String(!!alerting)}>
      {crewId}
    </button>
  ),
}));

import SosDock from './SosDock';

const sos = (userId: string): SosEntry => ({ crewId: 'c1', userId, username: userId, raisedAt: '2026-06-12T21:00:00Z' });

describe('SosDock', () => {
  beforeEach(() => {
    user = { id: 'me' };
    crew = { id: 'c1' };
    entries = [];
  });

  it('mounts one SOS control for a signed-in crew member', () => {
    render(<SosDock />);
    expect(screen.getAllByTestId('sos-raise')).toHaveLength(1);
    expect(screen.getByTestId('sos-raise')).toHaveTextContent('c1');
    expect(screen.getByTestId('sos-raise')).toHaveAttribute('data-alerting', 'false');
  });

  it('rings while a crewmate has an SOS up', () => {
    entries = [sos('dani')];
    render(<SosDock />);
    expect(screen.getByTestId('sos-raise')).toHaveAttribute('data-alerting', 'true');
  });

  it('hides while your own SOS is active (a second raise would 429)', () => {
    entries = [sos('me')];
    render(<SosDock />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
  });

  it('hides for a guest and for a user with no open crew', () => {
    user = null;
    const { unmount } = render(<SosDock />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
    unmount();
    user = { id: 'me' };
    crew = null;
    render(<SosDock />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
  });

  it('publishes the corner it occupies while shown and clears it after', () => {
    const { unmount } = render(<SosDock />);
    expect(document.documentElement.style.getPropertyValue('--sos-dock-h')).toBe('72px');
    expect(document.documentElement.style.getPropertyValue('--sos-dock-w')).toBe('88px');
    expect(document.documentElement.style.getPropertyValue('--sos-band-h')).toContain('72px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--sos-dock-h')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--sos-band-h')).toBe('');
  });

  // jsdom has no layout, so the no-overlap guarantee is checked as a contract between the three
  // places that must agree: the dock's offset, the band it publishes, and the scroller's margin.
  it('reserves exactly the band the dock occupies, so the page scroller ends above it', () => {
    const dock = readFileSync(resolve(process.cwd(), 'src/components/layout/SosDock.tsx'), 'utf8');
    const button = readFileSync(resolve(process.cwd(), 'src/components/crew/SosRaiseButton.tsx'), 'utf8');
    const pages = readFileSync(resolve(process.cwd(), 'src/styles/pages.css'), 'utf8');
    const gap = /const DOCK_GAP = (\d+);/.exec(dock)![1];
    expect(dock).toContain(`+var(--sticky-bar-h,0px)+${gap}px+env(safe-area-inset-bottom,0px))]`);
    expect(dock).toContain('const DOCK_H = `${64 + 2 * DOCK_GAP}px`;');
    expect(button).toContain('h-16 w-16');
    expect(pages).toMatch(/\n\.main-content \{[^}]*margin-bottom: var\(--sos-band-h, 0px\);/);
    expect(pages).toMatch(/\.main-content:has\(\.map-page\) \{[^}]*margin-bottom: 0;/);
  });
});
