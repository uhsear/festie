import { useEffect, useMemo, useState } from 'react';
import {
  artistTitle,
  getArtistUse,
  mergeArtists,
  mergeFestivalCount,
  mergePreviewText,
  searchArtists,
} from '@festie/shared/services';
import { withReauth } from '@festie/shared/services/admin';
import type { AdminArtistRow, ArtistMergePick, ArtistUse } from '@festie/shared/services';
import { platformLabel } from '@festie/shared/utils';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';

interface ArtistMergeProps {
  /** The artist whose row is open. The editor picks the other artist and which of the two survives. */
  artist: AdminArtistRow;
  /** Called after a merge: the list behind this panel reloads. */
  onMerged: () => void;
  onClose: () => void;
}

type Side = 'this' | 'other';
type Field = 'name' | 'label' | 'photo' | 'genres' | `link:${string}`;

const INPUT_CLASS =
  'w-full min-w-0 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder:text-text-muted text-sm';
const SEARCH_DELAY_MS = 300;
const appearances = (use: ArtistUse) => use.counts.sets + use.counts.lineupEntries;

interface Option {
  field: Field;
  label: string;
  /** What each artist has for the field, as text. */
  this: string;
  other: string;
}

/** The fields where both artists have a value and the values differ. An empty field fills from the other artist on the server. */
function differingFields(a: AdminArtistRow, b: AdminArtistRow): Option[] {
  const out: Option[] = [];
  const add = (field: Field, label: string, x: string, y: string) => {
    if (x !== y) out.push({ field, label, this: x, other: y });
  };
  add('name', 'Name', a.name, b.name);
  // A note is never filled from the other artist, so an empty note on one side is also a choice.
  add('label', 'Note', a.label || 'No note', b.label || 'No note');
  if (a.photo && b.photo && a.photo !== b.photo) add('photo', 'Photo', 'This photo', 'That photo');
  const genres = (row: AdminArtistRow) => row.genres.join(', ');
  if (a.genres.length > 0 && b.genres.length > 0) add('genres', 'Genres', genres(a), genres(b));
  for (const platform of new Set([...Object.keys(a.links), ...Object.keys(b.links)])) {
    const x = a.links[platform];
    const y = b.links[platform];
    if (x && y) add(`link:${platform}`, `${platformLabel(platform)} link`, x, y);
  }
  return out;
}

/**
 * Admin, web only: merge two artists. The editor picks the other artist, which one survives (default:
 * the one with more appearances) and, for each field where both differ, which value stays. The preview
 * says how many appearances move. A merge cannot be undone, so it asks for a recent password check.
 */
export default function ArtistMerge({ artist, onMerged, onClose }: ArtistMergeProps) {
  const { toast } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();
  const [query, setQuery] = useState(artist.name);
  const [found, setFound] = useState<AdminArtistRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [other, setOther] = useState<AdminArtistRow | null>(null);
  const [uses, setUses] = useState<{ this: ArtistUse; other: ArtistUse } | null>(null);
  const [survivor, setSurvivor] = useState<Side>('this');
  const [choice, setChoice] = useState<Partial<Record<Field, Side>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (other) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchArtists(query.trim());
        if (!cancelled) setFound(rows.filter((row) => row.id !== artist.id));
      } catch {
        if (!cancelled) setError("Couldn't search the artists. Try again.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, other, artist.id]);

  const choose = async (row: AdminArtistRow) => {
    setError(null);
    setBusy(true);
    try {
      const [mine, theirs] = await Promise.all([getArtistUse(artist.id), getArtistUse(row.id)]);
      setUses({ this: mine, other: theirs });
      setSurvivor(appearances(theirs) > appearances(mine) ? 'other' : 'this');
      setChoice({});
      setOther(row);
    } catch {
      setError("Couldn't load where these artists play. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const options = useMemo(() => (other ? differingFields(artist, other) : []), [artist, other]);

  const merge = async () => {
    if (!other || !uses) return;
    const winner = survivor === 'this' ? artist : other;
    const loser = survivor === 'this' ? other : artist;
    const pick: ArtistMergePick = {};
    for (const [field, side] of Object.entries(choice) as Array<[Field, Side]>) {
      const value = side === survivor ? 'survivor' : 'loser';
      if (field.startsWith('link:')) pick.links = { ...pick.links, [field.slice(5)]: value };
      else pick[field as 'name' | 'label' | 'photo' | 'genres'] = value;
    }
    const acceptedFestivals = mergeFestivalCount(uses.this, uses.other);
    setError(null);
    setBusy(true);
    try {
      const done = await withReauth(() => mergeArtists(winner, loser, { pick, acceptedFestivals }), askPassword, {
        retryWrongPassword: true,
      });
      if (done === null) return;
      toast('Merged.', 'success');
      onMerged();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't merge these artists. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const winner = other && (survivor === 'this' ? artist : other);
  const loser = other && (survivor === 'this' ? other : artist);
  const loserUse = uses && (survivor === 'this' ? uses.other : uses.this);

  return (
    <div className="space-y-3 rounded-lg border border-glass-border p-3" aria-label={`Merge ${artist.name}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm text-text-primary">Merge {artistTitle(artist)} with…</h3>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {!other && (
        <>
          <input
            type="search"
            aria-label="Search for the other artist"
            placeholder="Search by name"
            className={INPUT_CLASS}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <p className="text-xs text-text-muted">Searching…</p>}
          {!searching && found.length === 0 && <p className="text-xs text-text-muted">No other artist matches.</p>}
          <ul className="space-y-1">
            {found.slice(0, 20).map((row) => (
              <li key={row.id}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`Merge with ${artistTitle(row)}`}
                  onClick={() => void choose(row)}
                >
                  {artistTitle(row)}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {other && uses && winner && loser && loserUse && (
        <div className="space-y-3">
          <fieldset className="space-y-1">
            <legend className="text-xs text-text-muted">Which artist stays?</legend>
            {(['this', 'other'] as const).map((side) => {
              const row = side === 'this' ? artist : other;
              return (
                <label key={side} className="flex items-center gap-2 text-sm text-text-primary">
                  <input type="radio" name="merge-survivor" checked={survivor === side} onChange={() => setSurvivor(side)} />
                  <span>
                    {artistTitle(row)} <span className="text-text-muted">({appearances(uses[side])} appearances)</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {options.map((option) => {
            const picked = choice[option.field] ?? survivor;
            return (
              <fieldset key={option.field} className="space-y-1">
                <legend className="text-xs text-text-muted">{option.label}</legend>
                {(['this', 'other'] as const).map((side) => (
                  <label key={side} className="flex items-center gap-2 text-sm text-text-primary break-all">
                    <input
                      type="radio"
                      name={`merge-${option.field}`}
                      aria-label={`${option.label}: ${option[side]}`}
                      checked={picked === side}
                      onChange={() => setChoice((c) => ({ ...c, [option.field]: side }))}
                    />
                    <span>{option[side]}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}

          <p className="text-sm text-text-secondary">{mergePreviewText(loser, winner, loserUse)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} isLoading={busy} onClick={() => void merge()}>
              Merge
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setOther(null);
                setUses(null);
              }}
            >
              Pick another artist
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-accent-coral">
          {error}
        </p>
      )}
      {reauthDialog}
    </div>
  );
}
