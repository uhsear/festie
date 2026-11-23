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

  it('shows how many people marked an act, open and converted together, and nothing for an act no one marked', () => {
    render(
      <AnnouncedNames
        lineup={[entry('a', ['Kai']), entry('b', ['Mira']), entry('c', ['Zed'])]}
        days={days}
        interestCounts={{ a: { open: 2, converted: 3 }, b: { open: 0, converted: 0 } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('5 marked')).toBeTruthy();
    expect(screen.getAllByText(/ marked$/)).toHaveLength(1);
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
    fireEvent.change(input, { target: { value: 'A b2b B b2b C b2b D b2b E b2b F b2b G b2b H b2b I' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/at most 8 artists/);
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
    fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'A b2b B b2b C b2b D b2b E b2b F b2b G b2b H b2b I' } });
    expect(dialogOf().getByText(/more than 8 artists/)).toBeTruthy();
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

  describe('scheduling tools', () => {
    const stages = [{ id: 'st1', name: 'Main' }, { id: 'st2', name: 'Forest' }];
    type TestDay = { date?: string; label?: string; sets?: { id: string; artist?: string; artists?: { name: string }[]; stageId?: string; startTime?: string; displayName?: string }[] };
    const baseDays: TestDay[] = [
      { date: '2027-02-05', label: 'Fri', sets: [{ id: 's1', artist: 'Kai', artists: [{ name: 'Kai' }], stageId: 'st1', startTime: '20:00' }] },
      { date: '2027-02-06', label: 'Sat', sets: [] },
    ];

    /** Holds lineup and days like the edit form does, so a change that edits both flows back. */
    function Form({
      initial,
      counts,
      saved,
      initialDays = baseDays,
    }: {
      initial: LineupDraft[];
      counts?: Record<string, { open: number; converted: number }>;
      saved?: LineupDraft[];
      initialDays?: TestDay[];
    }) {
      const [lineup, setLineup] = useState(initial);
      const [formDays, setFormDays] = useState(initialDays);
      return (
        <>
          <AnnouncedNames
            lineup={lineup}
            days={formDays}
            stages={stages}
            interestCounts={counts}
            savedLineup={saved}
            onChange={(next, nextDays) => {
              setLineup(next);
              if (nextDays) setFormDays(nextDays);
            }}
          />
          <div data-testid="json">{JSON.stringify(lineup)}</div>
          <div data-testid="days">{JSON.stringify(formDays)}</div>
        </>
      );
    }
    const formDays = () => JSON.parse(screen.getByTestId('days').textContent!) as TestDay[];

    it('Cancelled removes the act sets from the form and says so, and un-cancelling clears the note', () => {
      render(<Form initial={[entry('a', ['Kai'])]} />);
      fireEvent.click(screen.getByLabelText('Cancelled'));
      expect(state()[0]!.status).toBe('cancelled');
      expect(formDays()[0]!.sets).toEqual([]);
      expect(screen.getByText('Its 1 set is removed too. To drop one set only, delete that set instead.')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Cancelled'));
      expect(state()[0]!.status).toBe('announced');
      expect(screen.queryByText(/removed too/)).toBeNull();
    });

    it('Cancelled on an act with no set leaves the days alone and adds no note', () => {
      render(<Form initial={[entry('a', ['Mira'])]} />);
      fireEvent.click(screen.getByLabelText('Cancelled'));
      expect(formDays()[0]!.sets).toHaveLength(1);
      expect(screen.queryByText(/removed too/)).toBeNull();
    });

    it('Cancelled also removes a hand-linked set', () => {
      render(<Form initial={[entry('a', ['Mira'], { linkedSetIds: ['s1'] })]} />);
      fireEvent.click(screen.getByLabelText('Cancelled'));
      expect(formDays()[0]!.sets).toEqual([]);
    });

    it('Remove asks first when people marked the act, and removes only after the confirm', () => {
      render(<Form initial={[entry('a', ['Mira']), entry('b', ['Zed'])]} counts={{ a: { open: 2, converted: 1 } }} />);
      fireEvent.click(screen.getByLabelText('Remove Zed'));
      expect(state().map((e) => e.id)).toEqual(['a']);
      fireEvent.click(screen.getByLabelText('Remove Mira'));
      expect(state()).toHaveLength(1);
      expect(dialogOf().getByText('3 people marked it. Remove it anyway? Use Cancelled to keep their marks.')).toBeTruthy();
      fireEvent.click(dialogOf().getByRole('button', { name: 'Remove' }));
      expect(state()).toEqual([]);
    });

    it('Remove all asks with a count when any act has marks', () => {
      render(<Form initial={[entry('a', ['Mira']), entry('b', ['Zed'])]} counts={{ a: { open: 4, converted: 0 } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
      expect(state()).toHaveLength(2);
      expect(dialogOf().getByText(/1 of these 2 acts has marks\. They carry 4 marks\./)).toBeTruthy();
      fireEvent.click(dialogOf().getByRole('button', { name: 'Cancel' }));
      expect(state()).toHaveLength(2);
    });

    it('Replace list names how many people marked the entries it would drop', () => {
      render(<Form initial={[entry('a', ['Mira']), entry('b', ['Zed'])]} counts={{ b: { open: 5, converted: 7 } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
      fireEvent.change(dialogOf().getByLabelText('Names'), { target: { value: 'Mira' } });
      fireEvent.click(dialogOf().getByLabelText('Replace list'));
      fireEvent.click(dialogOf().getByRole('button', { name: 'Replace list' }));
      expect(dialogOf().getByRole('alert').textContent).toMatch(/1 entry is not in this paste\. 12 people marked it\. Click again to remove it\./);
    });

    it('the save summary counts marks on entries this save removes', () => {
      render(
        <Form
          initial={[entry('a', ['Mira'])]}
          saved={[entry('a', ['Mira']), entry('b', ['Zed']), entry('c', ['Ana'])]}
          counts={{ b: { open: 5, converted: 7 }, c: { open: 1, converted: 0 } }}
        />,
      );
      expect(screen.getByLabelText('Lineup notices').textContent).toContain('2 entries with marks will be removed (13 marks).');
    });

    it('Copy to day adds a set with the artists and poster name, no times, to the chosen day', () => {
      render(<Form initial={[entry('a', ['Mira', 'Zed'], { displayName: 'Mira and Zed (live)' })]} />);
      fireEvent.click(screen.getByLabelText('Copy Mira b2b Zed to a day'));
      expect(dialogOf().getByText('For small fixes: put one act on a day and stage, without times.')).toBeTruthy();
      expect((dialogOf().getByRole('button', { name: 'Add set' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(dialogOf().getByLabelText('Copy to day'), { target: { value: '1' } });
      fireEvent.change(dialogOf().getByLabelText('Copy to stage'), { target: { value: 'st2' } });
      fireEvent.click(dialogOf().getByRole('button', { name: 'Add set' }));
      const [added] = formDays()[1]!.sets!;
      expect(added).toMatchObject({
        artist: 'Mira b2b Zed',
        stageId: 'st2',
        startTime: '',
        displayName: 'Mira and Zed (live)',
        artists: [{ name: 'Mira' }, { name: 'Zed' }],
      });
      expect(screen.getByText('Scheduled (1 set)')).toBeTruthy();
      expect(formDays()[0]!.sets).toHaveLength(1);
    });

    it('Copy to day is offered only for an act no set covers', () => {
      render(<Form initial={[entry('a', ['Kai']), entry('b', ['Mira'], { status: 'cancelled' }), entry('c', ['Zed'])]} />);
      expect(screen.queryByLabelText('Copy Kai to a day')).toBeNull();
      expect(screen.queryByLabelText('Copy Mira to a day')).toBeNull();
      expect(screen.getByLabelText('Copy Zed to a day')).toBeTruthy();
    });

    it('Matches set links a B2B act to the two solo sets and keeps the rest of the entry', () => {
      const soloDays: TestDay[] = [
        {
          date: '2027-02-05',
          label: 'Fri',
          sets: [
            { id: 's1', artist: 'Kai', artists: [{ name: 'Kai' }], stageId: 'st1', startTime: '20:00' },
            { id: 's2', artist: 'Mira', artists: [{ name: 'Mira' }], stageId: 'st2' },
            { id: 's3', artist: 'Other', artists: [{ name: 'Other' }] },
          ],
        },
      ];
      render(<Form initial={[entry('a', ['Kai', 'Mira'], { tier: 2, displayName: 'KAI x MIRA', dayDate: '2027-02-05' })]} initialDays={soloDays} />);
      fireEvent.click(screen.getByLabelText('Matches set for Kai b2b Mira'));
      expect(dialogOf().getByText('For small fixes: tell Festie that this act and that set are the same.')).toBeTruthy();
      expect(dialogOf().queryByText(/Other/)).toBeNull();
      fireEvent.click(dialogOf().getByLabelText(/^Kai · Fri · Main · 20:00/));
      fireEvent.click(dialogOf().getByLabelText(/^Mira · Fri · Forest · Time TBA/));
      fireEvent.click(dialogOf().getByRole('button', { name: 'Save links' }));
      expect(state()[0]).toMatchObject({ id: 'a', tier: 2, displayName: 'KAI x MIRA', dayDate: '2027-02-05', linkedSetIds: ['s1', 's2'] });
      expect(screen.getByText('Scheduled (2 sets)')).toBeTruthy();
      expect(screen.getByText('Linked to 2 sets by hand')).toBeTruthy();
    });

    it('Matches set says so when no set shares a name, and keeps a link to a set it cannot list', () => {
      render(<Form initial={[entry('a', ['Nobody'], { linkedSetIds: ['gone'] })]} />);
      fireEvent.click(screen.getByLabelText('Matches set for Nobody'));
      expect(dialogOf().getByText('No set shares an artist name with this act yet.')).toBeTruthy();
      fireEvent.click(dialogOf().getByRole('button', { name: 'Save links' }));
      expect(state()[0]!.linkedSetIds).toEqual(['gone']);
    });

    it('explains the three ways to add days and times', () => {
      render(<Form initial={[entry('a', ['Mira'])]} />);
      const help = within(screen.getByLabelText('Ways to add days and times'));
      expect(help.getByText(/export, fill in stages and times in a sheet, then import/)).toBeTruthy();
      expect(help.getByText(/Copy to day…: for small fixes/)).toBeTruthy();
      expect(help.getByText(/Matches set…: for small fixes/)).toBeTruthy();
    });
  });
});
