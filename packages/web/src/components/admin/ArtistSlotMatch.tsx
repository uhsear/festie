import { useState } from 'react';
import { artistTitle } from '@festie/shared/services';
import type { ArtistCandidate } from '@festie/shared/services';
import { platformLabel } from '@festie/shared/utils';

/** What the server's match said about one artist slot of a set. */
export type SlotMatch =
  | { kind: 'linked'; candidate: ArtistCandidate }
  | { kind: 'pick'; name: string; candidates: ArtistCandidate[] };

interface ArtistSlotMatchProps {
  name: string;
  match: SlotMatch;
  onPick: (candidate: ArtistCandidate) => void;
  /** Opens the picker for a linked slot ("Not this one"). */
  onNotThisOne: () => void;
  /** Creates an artist with a note. Resolves to an error message, or null when it worked. */
  onCreate: (label: string) => Promise<string | null>;
}

const lastPlayed = (c: ArtistCandidate) => (c.lastFestival ? `Last played: ${c.lastFestival.name}` : 'Not on a festival yet');

/** The chip under an artist field: Linked with "Not this one", or Pick one with "+ New artist with this name". */
export default function ArtistSlotMatch({ name, match, onPick, onNotThisOne, onCreate }: ArtistSlotMatchProps) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (match.kind === 'linked') {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>
          Linked: {artistTitle(match.candidate)}. {lastPlayed(match.candidate)}.
        </span>
        <button type="button" onClick={onNotThisOne} className="text-accent-aqua hover:underline">
          Not this one
        </button>
      </p>
    );
  }

  const create = async () => {
    const message = await onCreate(label);
    setError(message);
  };

  return (
    <div role="group" aria-label={`Pick the artist for ${name}`} className="space-y-1 rounded border border-glass-border p-2 text-xs">
      <p className="text-text-primary">Pick one. {match.candidates.length} artists are named {name}.</p>
      <ul className="space-y-1">
        {match.candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className="w-full rounded px-2 py-1 text-left text-text-secondary hover:bg-bg-primary"
            >
              <span className="text-text-primary">{artistTitle(c)}</span>
              {c.platforms.length > 0 && <span> · {c.platforms.map(platformLabel).join(', ')}</span>}
              <span> · {lastPlayed(c)}</span>
            </button>
          </li>
        ))}
      </ul>
      {creating ? (
        <div className="space-y-1">
          <input
            type="text"
            aria-label={`Note to tell ${name} apart`}
            placeholder="Note to tell them apart, for example UK or Berlin"
            maxLength={40}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full min-w-0 rounded bg-bg-primary border border-glass-border px-2 py-1 text-text-primary"
          />
          <button
            type="button"
            disabled={!label.trim()}
            onClick={() => void create()}
            className="text-accent-aqua hover:underline disabled:opacity-50"
          >
            Create artist
          </button>
          {error && (
            <p role="alert" className="text-text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="text-accent-aqua hover:underline">
          + New artist with this name
        </button>
      )}
    </div>
  );
}
