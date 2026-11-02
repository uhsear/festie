import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SetEditor from './SetEditor';

const renderEditor = (startTime: string, dayLabel?: string) =>
  render(<SetEditor set={{ id: 's1', startTime }} dayLabel={dayLabel} stages={[]} onSetArtists={vi.fn()} onField={vi.fn()} onRemove={vi.fn()} />);

describe('SetEditor after-midnight hint', () => {
  it('shows the hint for a 01:00 start', () => {
    renderEditor('01:00', 'Friday');
    expect(screen.getByText('After midnight. Shows as part of Friday night.')).toBeTruthy();
  });

  it("falls back to this day's when there is no label", () => {
    renderEditor('01:00');
    expect(screen.getByText("After midnight. Shows as part of this day's night.")).toBeTruthy();
  });

  it('hides the hint for a 21:00 start', () => {
    renderEditor('21:00', 'Friday');
    expect(screen.queryByText(/After midnight/)).toBeNull();
  });
});

describe('SetEditor B2B artists', () => {
  const renderSet = (set: object) => {
    const onSetArtists = vi.fn();
    render(<SetEditor set={{ id: 's1', ...set }} stages={[]} onSetArtists={onSetArtists} onField={vi.fn()} onRemove={vi.fn()} />);
    return onSetArtists;
  };
  const names = (call: unknown) => (call as { name: string }[]).map((a) => a.name);

  it('adding a B2B artist calls onSetArtists with 2 artists', () => {
    const onSetArtists = renderSet({ artist: 'Kai', artists: [{ name: 'Kai', links: { spotify: 'https://s/kai' } }] });
    fireEvent.click(screen.getByText('+ B2B artist'));
    fireEvent.change(screen.getByLabelText('B2B artist 2'), { target: { value: 'Mira' } });
    const last = onSetArtists.mock.calls.at(-1)![0];
    expect(names(last)).toEqual(['Kai', 'Mira']);
    expect(last[0].links.spotify).toBe('https://s/kai');
  });

  it('keeps the third artist links when the middle name is cleared', () => {
    const artists = ['A', 'B', 'C'].map((name) => ({ name, links: { spotify: `https://s/${name}` } }));
    const onSetArtists = renderSet({ artist: 'A b2b B b2b C', artists });
    fireEvent.change(screen.getByLabelText('B2B artist 2'), { target: { value: '' } });
    const last = onSetArtists.mock.calls.at(-1)![0];
    expect(names(last)).toEqual(['A', 'C']);
    expect(last[1].links.spotify).toBe('https://s/C');
  });

  it('keeps the third artist links when the middle artist is removed, and gives a new artist none', () => {
    const artists = ['A', 'B', 'C'].map((name) => ({ name, links: { spotify: `https://s/${name}` } }));
    const onSetArtists = renderSet({ artist: 'A b2b B b2b C', artists });
    fireEvent.click(screen.getByLabelText('Remove B'));
    let last = onSetArtists.mock.calls.at(-1)![0];
    expect(names(last)).toEqual(['A', 'C']);
    expect(last[1].links.spotify).toBe('https://s/C');
    fireEvent.click(screen.getByText('+ B2B artist'));
    fireEvent.change(screen.getByLabelText('B2B artist 3'), { target: { value: 'D' } });
    last = onSetArtists.mock.calls.at(-1)![0];
    expect(names(last)).toEqual(['A', 'C', 'D']);
    expect(last[2].links).toEqual({});
  });

  it('hides the add button at 4 artists', () => {
    renderSet({ artists: ['A', 'B', 'C', 'D'].map((name) => ({ name, links: {} })) });
    expect(screen.queryByText('+ B2B artist')).toBeNull();
  });
});
