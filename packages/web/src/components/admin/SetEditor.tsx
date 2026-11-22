import { useRef, useState } from 'react';
import { createArtist, matchArtists } from '@festie/shared/services';
import { useCanMatchArtists } from './festivalModeContext';
import type { ArtistCandidate } from '@festie/shared/services';
import {
  artistNamesOf,
  joinArtistNames,
  platformLabel,
  setEngagementLabel,
  startsAfterMidnight,
  withArtistNames,
} from '@festie/shared/utils';
import type { Artist } from '@festie/shared/types';
import ArtistSlotMatch from './ArtistSlotMatch';
import type { SlotMatch } from './ArtistSlotMatch';

const MAX_ARTISTS_PER_SET = 4;

export interface SetRow {
  id: string;
  artist?: string;
  stageId?: string;
  startTime?: string | null;
  endTime?: string | null;
  artists?: Artist[];
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
}

export interface SetEditorProps {
  set: SetRow;
  dayLabel?: string;
  stages: Stage[];
  separator?: string;
  onSetArtists: (artists: Artist[]) => void;
  /** Picks and reminders for this set; absent when it has neither. */
  engagement?: { picks: number; reminders: number };
  /** True once engagement has loaded for the festival. */
  showEngagement?: boolean;
  onField: (field: string, value: string | null) => void;
  onRemove: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  issues?: string[];
  /** Fields (target.field) the issues name, so the matching input gets aria-invalid. */
  issueFields?: string[];
  status?: 'new' | 'changed' | null;
}

/**
 * Edits one set row (artists, stage, startTime, endTime) inside a day.
 * A B2B set holds up to 4 artists; each keeps its own id, links and photo by index.
 * On blur the server matches the typed name: one artist links at once ("Not this one" undoes it),
 * two or more open the picker, none leaves the name free (the save creates the artist).
 * Links are read only here: they are edited once, on the Artists tab.
 */
const FIELD_LABEL = 'flex flex-col gap-1 min-w-0';
const FIELD_CAPTION = 'text-xs text-text-muted md:sr-only';

export default function SetEditor({
  set: s,
  dayLabel,
  stages,
  separator,
  onSetArtists,
  engagement,
  showEngagement,
  onField,
  onRemove,
  selected = false,
  onToggleSelect,
  issues = [],
  issueFields = [],
  status = null,
}: SetEditorProps) {
  const invalid = (field: string) => (issueFields.includes(field) ? true : undefined);
  const [drafts, setDrafts] = useState<string[]>(() => artistNamesOf(s));
  // Names this set in the labels of its controls, so a screen reader can tell the rows apart.
  const setName = joinArtistNames(drafts, separator) || 'artist';
  const [origin, setOrigin] = useState<Artist[] | undefined>(() => s.artists);

  const [matches, setMatches] = useState<Record<number, SlotMatch>>({});
  const canMatch = useCanMatchArtists();
  // The match answer arrives later: it must read the newest names, not the ones at blur time.
  const latest = useRef({ drafts, origin });
  latest.current = { drafts, origin };

  const changeDrafts = (next: string[], nextOrigin = origin) => {
    setDrafts(next);
    setOrigin(nextOrigin);
    onSetArtists(withArtistNames(nextOrigin, next));
  };

  const linkCandidate = (index: number, c: ArtistCandidate) => {
    const { drafts: names, origin: before } = latest.current;
    const picked: Artist = { id: c.id, name: c.name, links: {} };
    const nextOrigin = names.map((_, j) => (j === index ? picked : (before?.[j] ?? { name: '', links: {} })));
    changeDrafts(names.map((n, j) => (j === index ? c.name : n)), nextOrigin);
    setMatches((m) => ({ ...m, [index]: { kind: 'linked', candidate: c } }));
  };

  const matchSlot = async (index: number) => {
    const name = drafts[index]?.trim();
    if (!canMatch || !name || (origin?.[index]?.id && origin[index]?.name === name)) return;
    try {
      const [found] = await matchArtists([{ name }]);
      if (!found || latest.current.drafts[index]?.trim() !== name) return;
      if (found.outcome === 'linked' && found.candidates[0]) linkCandidate(index, found.candidates[0]);
      else if (found.outcome === 'pick') setMatches((m) => ({ ...m, [index]: { kind: 'pick', name, candidates: found.candidates } }));
    } catch (err) {
      // Offline or refused: the name stays free text and the server resolves it on save.
      console.warn('Could not match the artist name', err);
    }
  };

  const notThisOne = (index: number, match: Extract<SlotMatch, { kind: 'linked' }>) => {
    const { drafts: names, origin: before } = latest.current;
    changeDrafts(names, names.map((n, j) => (j === index ? { name: n.trim(), links: {} } : (before?.[j] ?? { name: '', links: {} }))));
    setMatches((m) => ({ ...m, [index]: { kind: 'pick', name: names[index] ?? '', candidates: [match.candidate] } }));
  };

  const createFor = async (index: number, name: string, label: string): Promise<string | null> => {
    try {
      const created = await createArtist({ name, label });
      linkCandidate(index, { id: created.id, name: created.name, label: created.label, photo: created.photo, platforms: [], lastFestival: null });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't create the artist. Try again.";
    }
  };

  return (
    <div
      data-issue-key={`set:${s.id}`}
      data-issue={issues.length > 0 ? 'true' : undefined}
      className={`grid grid-cols-2 gap-2 rounded-lg border border-glass-border p-3 md:grid-cols-[auto_1fr_140px_7.5rem_7.5rem_auto] md:rounded-none md:border-0 md:p-0 ${
        status ? 'border-l-2 border-l-accent-aqua md:pl-2' : ''
      } ${issues.length > 0 ? 'ring-1 ring-accent-coral md:p-1' : ''}`}
    >
      <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:flex-col md:gap-1 md:pt-1.5">
        <input
          type="checkbox"
          aria-label={`Select ${s.artist || 'set'}`}
          checked={selected}
          onChange={() => onToggleSelect?.()}
        />
        {status && <span className="text-xs text-accent-aqua">{status === 'new' ? 'New' : 'Changed'}</span>}
      </div>
      <div className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Artist</span>
        <div className="space-y-1">
          {drafts.map((name, i) => {
            const label = i === 0 ? 'Artist' : `B2B artist ${i + 1}`;
            const match = matches[i];
            const known = origin?.[i];
            const readOnlyLinks = known?.id && known.name === name.trim() ? Object.keys(known.links ?? {}) : [];
            return (
              <div key={i} className="space-y-1">
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder={i === 0 ? 'Artist name' : label}
                    aria-label={label}
                    aria-invalid={i === 0 ? invalid('artist') : undefined}
                    value={name}
                    onChange={(e) => {
                      setMatches((m) => {
                        const { [i]: _gone, ...rest } = m;
                        return rest;
                      });
                      changeDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)));
                    }}
                    onBlur={() => void matchSlot(i)}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                  />
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMatches({});
                        changeDrafts(
                          drafts.filter((_, j) => j !== i),
                          origin?.filter((_, j) => j !== i),
                        );
                      }}
                      className="px-2 min-h-11 min-w-11 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                      aria-label={`Remove ${name.trim() || 'artist'}`}
                    >
                      ×
                    </button>
                  )}
                </div>
                {match && (
                  <ArtistSlotMatch
                    name={name.trim()}
                    match={match}
                    onPick={(c) => linkCandidate(i, c)}
                    onNotThisOne={() => match.kind === 'linked' && notThisOne(i, match)}
                    onCreate={(note) => createFor(i, name.trim(), note)}
                  />
                )}
                {readOnlyLinks.length > 0 && !match && (
                  <p className="text-xs text-text-muted">
                    {readOnlyLinks.map(platformLabel).join(', ')}. Edit links on the Artists tab.
                  </p>
                )}
              </div>
            );
          })}
          {drafts.length < MAX_ARTISTS_PER_SET && (
            <button
              type="button"
              onClick={() => changeDrafts([...drafts, ''])}
              className="min-h-11 px-2 text-xs text-accent-aqua hover:underline"
            >
              + B2B artist
            </button>
          )}
        </div>
      </div>
      <label className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Stage</span>
        <select
          value={s.stageId || ''}
          aria-label={`Stage for ${setName}`}
          aria-invalid={invalid('stageId')}
          onChange={(e) => onField('stageId', e.target.value)}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        >
          <option value="">— Stage —</option>
          {stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name || st.id}
            </option>
          ))}
        </select>
      </label>
      <label className={`${FIELD_LABEL} col-span-2 sm:col-span-1`}>
        <span className={FIELD_CAPTION}>Start</span>
        <input
          type="time"
          aria-label={`Start time for ${setName}`}
          aria-invalid={invalid('startTime')}
          value={s.startTime && s.startTime !== 'TBA' ? s.startTime : ''}
          onChange={(e) => onField('startTime', e.target.value || 'TBA')}
          className="w-full min-w-0 px-1.5 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <label className={`${FIELD_LABEL} col-span-2 sm:col-span-1`}>
        <span className={FIELD_CAPTION}>End</span>
        <input
          type="time"
          aria-label={`End time for ${setName}`}
          aria-invalid={invalid('endTime')}
          value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
          onChange={(e) => onField('endTime', e.target.value || null)}
          className="w-full min-w-0 px-1.5 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="col-span-2 md:col-span-1 px-2 py-1.5 md:py-0 min-h-11 md:min-w-11 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
        aria-label={`Remove ${setName}`}
      >
        <span className="md:hidden">Remove set</span>
        <span className="hidden md:inline">×</span>
      </button>
      {issues.length > 0 && (
        <div className="col-span-full space-y-0.5">
          {issues.map((m, i) => (
            <p key={i} className="text-xs text-accent-coral">
              {m}
            </p>
          ))}
        </div>
      )}
      {startsAfterMidnight(s.startTime) && (
        <p className="col-span-full text-xs text-text-muted">
          After midnight. Shows as part of {dayLabel || "this day's"} night.
        </p>
      )}
      {showEngagement && (
        <p className="col-span-full text-xs text-text-muted">
          {setEngagementLabel(engagement ?? { picks: 0, reminders: 0 })}
        </p>
      )}
    </div>
  );
}
