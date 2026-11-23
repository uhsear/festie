import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const matchArtists = vi.fn();
const createArtist = vi.fn();
vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  matchArtists: (...a: unknown[]) => matchArtists(...a),
  createArtist: (...a: unknown[]) => createArtist(...a),
}));

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

describe('SetEditor phone layout and engagement', () => {
  const base = { id: 's1', artist: 'Alpha', startTime: '21:00' };

  it('shows the engagement label when showEngagement is true', () => {
    render(
      <SetEditor
        set={base}
        stages={[]}
        engagement={{ picks: 3, reminders: 1 }}
        showEngagement
        onSetArtists={vi.fn()} onField={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Picked by 3 · 1 reminder')).toBeTruthy();
  });

  it('says there are no picks for a loaded set with no entry', () => {
    render(<SetEditor set={base} stages={[]} showEngagement onSetArtists={vi.fn()} onField={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('No picks or reminders yet')).toBeTruthy();
  });

  it('has no engagement row when showEngagement is false', () => {
    render(
      <SetEditor set={base} stages={[]} engagement={{ picks: 3, reminders: 1 }} onSetArtists={vi.fn()} onField={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/Picked by/)).toBeNull();
    expect(screen.queryByText('No picks or reminders yet')).toBeNull();
  });

  it('renders a visible label for each field', () => {
    render(<SetEditor set={base} stages={[]} onSetArtists={vi.fn()} onField={vi.fn()} onRemove={vi.fn()} />);
    for (const label of ['Artist', 'Stage', 'Start', 'End']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText('Artist')).toBeTruthy();
  });

  it('Remove set calls onRemove', () => {
    const onRemove = vi.fn();
    render(<SetEditor set={base} stages={[]} onSetArtists={vi.fn()} onField={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByText('Remove set'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('SetEditor artist matching', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'art-uk',
    name: 'HOL',
    label: 'UK',
    photo: null,
    platforms: ['spotify'],
    lastFestival: { id: 'f1', name: 'Cyclops Cove 2026' },
    ...over,
  });
  const renderSet = (set: object = { artist: '', artists: [] }) => {
    const onSetArtists = vi.fn();
    render(<SetEditor set={{ id: 's1', ...set }} stages={[]} onSetArtists={onSetArtists} onField={vi.fn()} onRemove={vi.fn()} />);
    return onSetArtists;
  };
  const typeAndBlur = (name: string) => {
    const input = screen.getByLabelText('Artist');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.blur(input);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    matchArtists.mockResolvedValue([{ name: 'x', outcome: 'new', candidates: [] }]);
  });

  it('a single match links on blur, sends the id and offers "Not this one"', async () => {
    matchArtists.mockResolvedValue([{ name: 'hol', outcome: 'linked', candidates: [candidate()] }]);
    const onSetArtists = renderSet();
    typeAndBlur('hol');
    expect(await screen.findByText(/Linked: HOL \(UK\)\. Last played: Cyclops Cove 2026\./)).toBeTruthy();
    expect(matchArtists).toHaveBeenCalledWith([{ name: 'hol' }]);
    expect(onSetArtists.mock.calls.at(-1)![0]).toEqual([{ id: 'art-uk', name: 'HOL', links: {} }]);
    expect(screen.getByLabelText('Artist')).toHaveValue('HOL');
    expect(screen.getByText('Not this one')).toBeTruthy();
  });

  it('two matches show "Pick one", and picking one links that artist', async () => {
    matchArtists.mockResolvedValue([
      { name: 'HOL', outcome: 'pick', candidates: [candidate(), candidate({ id: 'art-us', label: 'US', lastFestival: null })] },
    ]);
    const onSetArtists = renderSet();
    typeAndBlur('HOL');
    expect(await screen.findByText(/Pick one\. 2 artists are named HOL\./)).toBeTruthy();
    expect(onSetArtists.mock.calls.at(-1)![0]).toEqual([{ links: {}, name: 'HOL' }]);
    fireEvent.click(screen.getByText('HOL (US)'));
    expect(onSetArtists.mock.calls.at(-1)![0]).toEqual([{ id: 'art-us', name: 'HOL', links: {} }]);
    expect(screen.queryByText(/Pick one/)).toBeNull();
  });

  it('a new artist with a name that exists needs a note before it is created', async () => {
    matchArtists.mockResolvedValue([{ name: 'HOL', outcome: 'pick', candidates: [candidate(), candidate({ id: 'art-us', label: 'US' })] }]);
    createArtist.mockResolvedValue({ id: 'art-new', name: 'HOL', label: 'Berlin', photo: null, links: {}, genres: [], spotifyId: null, updatedAt: 'x' });
    const onSetArtists = renderSet();
    typeAndBlur('HOL');
    fireEvent.click(await screen.findByText('+ New artist with this name'));
    const create = screen.getByText('Create artist') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note to tell HOL apart'), { target: { value: 'Berlin' } });
    fireEvent.click(create);
    await waitFor(() => expect(createArtist).toHaveBeenCalledWith({ name: 'HOL', label: 'Berlin' }));
    await waitFor(() => expect(onSetArtists.mock.calls.at(-1)![0]).toEqual([{ id: 'art-new', name: 'HOL', links: {} }]));
  });

  it('shows the server message when the create is refused', async () => {
    matchArtists.mockResolvedValue([{ name: 'HOL', outcome: 'pick', candidates: [candidate(), candidate({ id: 'art-us', label: 'US' })] }]);
    createArtist.mockRejectedValue(new Error('HOL (UK) already exists. Pick that artist, or use a different note.'));
    renderSet();
    typeAndBlur('HOL');
    fireEvent.click(await screen.findByText('+ New artist with this name'));
    fireEvent.change(screen.getByLabelText('Note to tell HOL apart'), { target: { value: 'UK' } });
    fireEvent.click(screen.getByText('Create artist'));
    expect((await screen.findByRole('alert')).textContent).toContain('HOL (UK) already exists');
  });

  it('keeps the typed name when the match call fails (offline)', async () => {
    matchArtists.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSetArtists = renderSet();
    typeAndBlur('Kai');
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(onSetArtists.mock.calls.at(-1)![0]).toEqual([{ links: {}, name: 'Kai' }]);
    warn.mockRestore();
  });

  it('shows the links of a linked artist read only', () => {
    renderSet({ artist: 'Kai', artists: [{ id: 'art-1', name: 'Kai', links: { spotify: 'https://s/kai', apple_music: 'https://a/kai' } }] });
    expect(screen.getByText('Spotify, Apple Music. Edit links on the Artists tab.')).toBeTruthy();
  });

  it('tells an organizer to ask Festie, since there is no Artists tab', () => {
    render(
      <SetEditor
        set={{ id: 's1', artist: 'Kai', artists: [{ id: 'art-1', name: 'Kai', links: { spotify: 'https://s/kai' } }] }}
        stages={[]}
        organizer
        onSetArtists={vi.fn()}
        onField={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Spotify. Ask Festie to change links.')).toBeTruthy();
  });
});
