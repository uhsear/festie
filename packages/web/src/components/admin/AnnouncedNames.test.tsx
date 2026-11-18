import React, { useState } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { LineupDraft } from '@festie/shared/utils';
import AnnouncedNames from './AnnouncedNames';

const services = vi.hoisted(() => ({ matchArtists: vi.fn(), createArtist: vi.fn() }));
vi.mock('@festie/shared/services', async (orig) => ({ ...(await orig<typeof import('@festie/shared/services')>()), ...services }));
beforeEach(() => {
  vi.clearAllMocks();
  services.matchArtists.mockResolvedValue([]);
});

const candidate = (id: string, label = '') => ({ id, name: 'Mira', label, photo: null, platforms: ['spotify'], lastFestival: { id: 'f0', name: 'Old Fest' } });

const entry = (id: string, names: string[], extra: Partial<LineupDraft> = {}): LineupDraft => ({
  id,
  artists: names.map((name) => ({ name, links: {} })),
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...extra,
});

const days = [
  { date: '2027-02-05', label: 'Fri', sets: [{ id: 's1', artist: 'Kai', artists: [{ name: 'Kai' }] }] },
  { date: '2027-02-06', label: 'Sat', sets: [] },
];

/** Holds the lineup like the edit form does, so edits flow back into props. */
function Harness({ initial, savedAt }: { initial: LineupDraft[]; savedAt?: string }) {
  const [lineup, setLineup] = useState(initial);
  return (
    <>
      <AnnouncedNames lineup={lineup} days={days} savedAt={savedAt} onChange={setLineup} />
      <div data-testid="json">{JSON.stringify(lineup)}</div>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('json').textContent!) as LineupDraft[];
const dialogOf = () => within(screen.getByRole('dialog'));

describe('AnnouncedNames', () => {
  it('shows the count and a derived chip per row', () => {
    render(<Harness initial={[entry('a', ['Kai']), entry('b', ['Mira']), entry('c', ['Zed'], { status: 'cancelled' })]} />);
    expect(screen.getByText('3 acts')).toBeTruthy();
    expect(screen.getByText('Scheduled (1 set)')).toBeTruthy();
    expect(screen.getByText('Announced')).toBeTruthy();
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
  });

  it('edits tier, day and status in place and keeps the id', () => {
    render(<Harness initial={[entry('a', ['Mira'])]} />);
    fireEvent.change(screen.getByLabelText('Tier for Mira'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Day for Mira'), { target: { value: '2027-02-06' } });
    fireEvent.click(screen.getByLabelText('Cancelled'));
    expect(state()[0]).toMatchObject({ id: 'a', tier: 2, dayDate: '2027-02-06', status: 'cancelled' });
  });

  it('renames in place on blur, keeps the id and splits b2b', () => {
    render(<Harness initial={[entry('a', ['Mira'])]} />);
    const input = screen.getByLabelText('Artists for Mira');
    fireEvent.change(input, { target: { value: 'Mira b2b Zed' } });
    fireEvent.blur(input);
    expect(state()[0]!.id).toBe('a');
    expect(state()[0]!.artists.map((a) => a.name)).toEqual(['Mira', 'Zed']);
  });

  it('refuses a rename to no names or more than four, shows why and resets the text', () => {
    render(<Harness initial={[entry('a', ['Mira'])]} />);
    const input = screen.getByLabelText('Artists for Mira') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/at least one artist/);
    expect(input.value).toBe('Mira');
    fireEvent.change(input, { target: { value: 'A b2b B b2b C b2b D b2b E' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/at most 4 artists/);
    expect(input.value).toBe('Mira');
    expect(state()[0]!.artists.map((a) => a.name)).toEqual(['Mira']);
  });

  it('Edit names can clear a tier and a poster name', () => {
    render(<Harness initial={[entry('a', ['Mira'], { tier: 1, displayName: 'Poster' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Mira' } });
    fireEvent.click(dialogOf().getByRole('button', { name: 'Update list' }));
    expect(state()[0]).toMatchObject({ id: 'a', tier: null, displayName: null });
  });

  it('flags a day that no longer exists as "Day removed"', () => {
    render(<Harness initial={[entry('a', ['Mira'], { dayDate: '2027-03-01' })]} />);
    expect(screen.getByRole('option', { name: /Day removed/ })).toBeTruthy();
  });

  it('filters to Day TBA, Not scheduled yet and Cancelled', () => {
    render(
      <Harness
        initial={[entry('a', ['Kai'], { dayDate: '2027-02-05' }), entry('b', ['Mira']), entry('c', ['Zed'], { status: 'cancelled' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Not scheduled yet' }));
    expect(screen.queryByLabelText('Artists for Kai')).toBeNull();
    expect(screen.getByLabelText('Artists for Mira')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    expect(screen.getByLabelText('Artists for Zed')).toBeTruthy();
    expect(screen.queryByLabelText('Artists for Mira')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Day TBA' }));
    expect(screen.getByLabelText('Artists for Mira')).toBeTruthy();
    expect(screen.queryByLabelText('Artists for Kai')).toBeNull();
  });

  it('pastes names: summary, add, and "Not saved yet"', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Kai\nA b2b B | Poster AB\n# Tier 2\nMira' } });
    expect(dialogOf().getByText(/3 names \(1 is b2b\)/)).toBeTruthy();
    fireEvent.click(dialogOf().getByRole('button', { name: 'Add' }));
    expect(state().map((e) => [e.artists.map((a) => a.name).join('+'), e.tier, e.displayName])).toEqual([
      ['Kai', null, null],
      ['A+B', null, 'Poster AB'],
      ['Mira', 2, null],
    ]);
    expect(screen.getByRole('status').textContent).toMatch(/Not saved yet/);
  });

  it('pasting again keeps ids, and paste for one day sets the day', () => {
    render(<Harness initial={[entry('a', ['Mira'])]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'mira\nNew Act' } });
    fireEvent.change(dialogOf().getByLabelText('Paste for day'), { target: { value: '2027-02-06' } });
    expect(dialogOf().getByText('1 matched, 1 new, 0 kept')).toBeTruthy();
    fireEvent.click(dialogOf().getByRole('button', { name: 'Add' }));
    expect(state().map((e) => [e.id, e.dayDate])).toEqual([['a', '2027-02-06'], [undefined, '2027-02-06']]);
  });

  it('blocks Add on a blocking flag', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'A b2b B b2b C b2b D b2b E' } });
    expect(dialogOf().getByText(/more than 4 artists/)).toBeTruthy();
    expect((dialogOf().getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Replace list asks before it removes entries', () => {
    render(<Harness initial={[entry('a', ['Mira']), entry('b', ['Zed'])]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Mira' } });
    fireEvent.click(dialogOf().getByLabelText('Replace list'));
    fireEvent.click(dialogOf().getByRole('button', { name: 'Replace list' }));
    expect(dialogOf().getByRole('alert').textContent).toMatch(/1 entry is not in this paste/);
    expect(state()).toHaveLength(2);
    fireEvent.click(dialogOf().getByRole('button', { name: 'Replace list' }));
    expect(state().map((e) => e.id)).toEqual(['a']);
  });

  it('JSON mode keeps source ids and reports dropped keys', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.click(dialogOf().getByLabelText('Advanced: paste lineup JSON'));
    fireEvent.change(dialogOf().getByLabelText('Lineup JSON'), {
      target: { value: JSON.stringify({ candidates: [{ id: 'fk-2dy4', artists: [{ name: '2DY4' }], _officialBilling: '2DY4' }] }) },
    });
    expect(dialogOf().getByText(/dropped keys: _officialBilling \(1\)/)).toBeTruthy();
    fireEvent.click(dialogOf().getByRole('button', { name: 'Add' }));
    expect(state()[0]!.id).toBe('fk-2dy4');
  });

  it('"Same act as" maps a near-miss onto the stored entry and keeps its id', () => {
    render(<Harness initial={[entry('a', ['Mira'], { dayDate: '2027-02-05' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Mirra' } });
    fireEvent.click(dialogOf().getByRole('button', { name: 'Same act as Mira' }));
    fireEvent.click(dialogOf().getByRole('button', { name: 'Add' }));
    expect(state()).toHaveLength(1);
    expect(state()[0]).toMatchObject({ id: 'a', dayDate: '2027-02-05' });
    expect(state()[0]!.artists[0]!.name).toBe('Mirra');
  });

  it('Edit names fills the box and replaces', () => {
    render(<Harness initial={[entry('a', ['Mira'], { tier: 1 }), entry('b', ['A', 'B'])]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    expect((dialogOf().getByLabelText('Names') as HTMLTextAreaElement).value).toBe('A b2b B\n# Tier 1\nMira');
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'A b2b B\n# Tier 1\nMira Two' } });
    fireEvent.click(dialogOf().getByRole('button', { name: 'Update list' }));
    fireEvent.click(dialogOf().getByRole('button', { name: 'Update list' }));
    expect(state().map((e) => e.artists[0]!.name)).toEqual(['A', 'Mira Two']);
  });

  it('Remove all clears the list', () => {
    render(<Harness initial={[entry('a', ['Mira'])]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(state()).toEqual([]);
  });

  it('warns about acts with no matching set once sets exist', () => {
    render(<Harness initial={[entry('a', ['Kai']), entry('b', ['Mira'])]} />);
    expect(screen.getByLabelText('Lineup notices').textContent).toMatch(/1 announced act has no matching set: Mira/);
  });

  it('after a paste, one match call links the clear names and lists the ones that need a pick', async () => {
    services.matchArtists.mockResolvedValue([
      { name: 'Kai', outcome: 'linked', candidates: [{ ...candidate('art-kai'), name: 'Kai' }] },
      { name: 'Mira', outcome: 'pick', candidates: [candidate('art-m1'), candidate('art-m2', 'UK')] },
      { name: 'Solo', outcome: 'new', candidates: [] },
    ]);
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Kai\nMira\nSolo' } });
    fireEvent.click(dialogOf().getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/2 names match artists already in Festie\. 1 needs a choice\./)).toBeTruthy();
    expect(services.matchArtists).toHaveBeenCalledTimes(1);
    expect(services.matchArtists).toHaveBeenCalledWith([{ name: 'Kai' }, { name: 'Mira' }, { name: 'Solo' }]);
    await waitFor(() => expect(state().map((e) => e.artists[0]!.id)).toEqual(['art-kai', undefined, undefined]));

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: /Mira \(UK\)/ }));
    await waitFor(() => expect(state().map((e) => e.artists[0]!.id)).toEqual(['art-kai', 'art-m2', undefined]));
    expect(screen.getByText(/Linked: Mira \(UK\)/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Not this one' })[1]!);
    await waitFor(() => expect(state().map((e) => e.artists[0]!.id)).toEqual(['art-kai', undefined, undefined]));
  });
});
