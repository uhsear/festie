import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetPickControl from './SetPickControl';

const setPointer = (touchFirst: boolean) =>
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({ matches: touchFirst && query.includes('pointer: coarse'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  );

describe('SetPickControl accessible names', () => {
  afterEach(() => setPointer(false));

  it('a fine pointer exposes every priority as "<Priority>: <artist>", picked or not', () => {
    setPointer(false);
    const { unmount } = render(<SetPickControl artistName="Alpha" myPick={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Must See: Alpha/ })).toHaveAttribute('aria-pressed', 'false');
    unmount();
    render(<SetPickControl artistName="Alpha" myPick="must" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Must See: Alpha/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a touch device names the collapsed control after the artist and the current priority', () => {
    setPointer(true);
    const { unmount } = render(<SetPickControl artistName="Alpha" myPick="must" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Must See: Alpha. Change priority' })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    render(<SetPickControl artistName="Alpha" myPick="want-to-see" syncState="queued" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Want to See: Alpha \(saved on this device, will sync\)\. Change priority$/ })).toBeInTheDocument();
  });

  it('an unpicked touch control says what a tap does, and the next tap exposes "Must See: <artist>"', async () => {
    setPointer(true);
    render(<SetPickControl artistName="Alpha" myPick={null} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Must See: / })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Set priority for Alpha' }));
    expect(screen.getByRole('button', { name: 'Must See: Alpha' })).toBeInTheDocument();
  });
});
