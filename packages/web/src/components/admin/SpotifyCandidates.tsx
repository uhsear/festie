import { useCallback, useEffect, useRef, useState } from 'react';
import {
  artistTitle,
  changeEverywhereText,
  findSpotifyCandidates,
  followersText,
  pickSpotifyCandidates,
} from '@festie/shared/services';
import type { SpotifyCandidate, SpotifyCandidateRow, SpotifyPick, SpotifyPickResult } from '@festie/shared/services';
import { isSafeExternalUrl } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

interface SpotifyCandidatesProps {
  festivalId: string;
  /** Called after picks were stored, so the artist list behind this panel reloads. */
  onApplied: () => void;
  onClose: () => void;
}

interface PickRequest {
  row: SpotifyCandidateRow;
  spotifyId: string;
  /** Other festivals the editor confirmed; 0 when none was shown. */
  acceptedAlsoOn: number;
}

interface Confirm {
  text: string;
  label: string;
  run: () => void;
}

/**
 * Admin: "Find Spotify links". Shows the top 3 Spotify candidates for each artist on the festival that
 * has no Spotify link. The editor picks one or "None of these". Nothing is stored until a pick: Festie
 * never links an artist from a guess. A pick on an artist that plays at other festivals asks first,
 * because it changes them too, past ones included. "None of these" hides the row for this visit only.
 */
export default function SpotifyCandidates({ festivalId, onApplied, onClose }: SpotifyCandidatesProps) {
  const { toastError } = useToast();
  const [rows, setRows] = useState<SpotifyCandidateRow[] | null>(null);
  const [notSearched, setNotSearched] = useState(0);
  const [searchFailed, setSearchFailed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const started = useRef(false);
  // Artists the next search leaves out: skipped by the editor, or unmatched by Spotify. Without it they hold the first slots of every run.
  const skip = useRef(new Set<string>());

  const search = useCallback(async () => {
    setFailed(false);
    setRows(null);
    try {
      const found = await findSpotifyCandidates(festivalId, [...skip.current]);
      // When Spotify answered for everyone, an artist with no candidates has no match. Otherwise it may be a failed search: keep it.
      if (found.searchFailed === 0) for (const r of found.artists) if (r.candidates.length === 0) skip.current.add(r.artist.id);
      setRows(found.artists);
      setNotSearched(found.notSearched);
      setSearchFailed(found.searchFailed);
    } catch (err) {
      setFailed(true);
      toastError(err, "Couldn't search Spotify. Try again.");
    }
  }, [festivalId, toastError]);

  useEffect(() => {
    // Strict mode runs an effect twice: one search is one batch of Spotify calls.
    if (started.current) return;
    started.current = true;
    void search();
  }, [search]);

  const shownRows = (rows ?? []).filter((row) => !dismissed.has(row.artist.id));
  const confirmable = shownRows.filter((row) => row.singleExact);

  const setMessage = (artistId: string, text: string | null) =>
    setMessages((m) => {
      const { [artistId]: _gone, ...rest } = m;
      return text ? { ...rest, [artistId]: text } : rest;
    });

  /** Sends picks and reads each answer. A `shared` answer asks the editor, then sends that pick again with the count it showed. */
  const apply = async (requests: PickRequest[]) => {
    setBusy(true);
    for (const request of requests) setMessage(request.row.artist.id, null);
    try {
      const picks: SpotifyPick[] = requests.map(({ row, spotifyId, acceptedAlsoOn }) => ({
        artistId: row.artist.id,
        expectedUpdatedAt: row.artist.updatedAt,
        spotifyId,
        ...(acceptedAlsoOn > 0 ? { acceptedAlsoOn } : {}),
      }));
      const results = await pickSpotifyCandidates(festivalId, picks);
      const byArtist = new Map<string, SpotifyPickResult>(results.map((r) => [r.artistId, r]));
      const saved = new Set<string>();
      const askAgain: PickRequest[] = [];
      for (const request of requests) {
        const result = byArtist.get(request.row.artist.id);
        const id = request.row.artist.id;
        if (!result) continue;
        if (result.status === 'saved') saved.add(id);
        else if (result.status === 'shared') askAgain.push({ ...request, acceptedAlsoOn: result.alsoOn ?? 0 });
        else {
          setMessage(id, result.message ?? "Couldn't save this pick. Try again.");
          const current = result.artist;
          if (result.status === 'changed' && current?.links?.spotify) {
            // Someone else linked it: a pick can never replace a link, so the row is done.
            saved.add(id);
          } else if (result.status === 'changed' && current) {
            setRows((list) => (list ?? []).map((r) => (r.artist.id === id ? { ...r, artist: { ...r.artist, ...current } } : r)));
          }
        }
      }
      if (saved.size > 0) {
        setRows((list) => (list ?? []).filter((r) => !saved.has(r.artist.id)));
        onApplied();
      }
      if (askAgain.length > 0) {
        const first = askAgain[0]!;
        const others = byArtist.get(first.row.artist.id)?.alsoOn ?? 0;
        setConfirm({
          text:
            askAgain.length === 1
              ? changeEverywhereText(first.row.artist.name, others)
              : `${askAgain.length} of these artists are also on other festivals, including past ones. Link them everywhere?`,
          label: 'Change everywhere',
          run: () => void apply(askAgain),
        });
      }
    } catch (err) {
      toastError(err, "Couldn't save the picks. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pick = (row: SpotifyCandidateRow, candidate: SpotifyCandidate) => {
    const request: PickRequest = { row, spotifyId: candidate.spotifyId, acceptedAlsoOn: row.artist.alsoOn };
    if (row.artist.alsoOn > 0) {
      setConfirm({ text: changeEverywhereText(row.artist.name, row.artist.alsoOn), label: 'Change everywhere', run: () => void apply([request]) });
    } else {
      void apply([request]);
    }
  };

  const confirmAll = () => {
    const requests = confirmable.map((row): PickRequest => {
      const exact = row.candidates.find((c) => c.exact)!;
      return { row, spotifyId: exact.spotifyId, acceptedAlsoOn: row.artist.alsoOn };
    });
    const shared = requests.filter((r) => r.acceptedAlsoOn > 0).length;
    if (shared === 0) {
      void apply(requests);
      return;
    }
    setConfirm({
      text: `${shared} of these ${requests.length} artists are also on other festivals, including past ones. Link them everywhere?`,
      label: 'Link everywhere',
      run: () => void apply(requests),
    });
  };

  return (
    <section aria-label="Find Spotify links" className="space-y-3 rounded-lg border border-glass-border bg-bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-label text-text-primary">Find Spotify links</h3>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>

      {rows === null && !failed && <p className="text-sm text-text-muted">Searching Spotify…</p>}
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-sm text-text-secondary">
          <span>Couldn’t search Spotify.</span>
          <Button size="sm" onClick={() => void search()}>
            Try again
          </Button>
        </div>
      )}

      {rows !== null && (
        <>
          <p className="text-sm text-text-secondary">
            {shownRows.length === 0
              ? 'Every artist on this festival has a Spotify link, or you skipped the rest.'
              : `${shownRows.length} ${shownRows.length === 1 ? 'artist has' : 'artists have'} no Spotify link. Pick the right Spotify artist for each, or choose None of these.`}
          </p>
          {searchFailed > 0 && (
            <p role="status" className="text-sm text-accent-coral">
              Spotify did not answer for {searchFailed} {searchFailed === 1 ? 'artist' : 'artists'}. Search again to try them.
            </p>
          )}
          {notSearched > 0 && (
            <p className="text-sm text-text-muted">
              {notSearched} more {notSearched === 1 ? 'artist was' : 'artists were'} not searched. Link or skip these, then search again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || confirmable.length === 0} onClick={confirmAll}>
              Confirm all single exact matches ({confirmable.length})
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void search()}>
              Search again
            </Button>
          </div>

          <ul className="space-y-3">
            {shownRows.map((row) => (
              <li key={row.artist.id} className="space-y-2 border-t border-glass-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-text-primary break-words">
                    {artistTitle(row.artist)}
                    {row.artist.alsoOn > 0 && (
                      <span className="ml-2 text-xs text-text-muted">
                        Also on {row.artist.alsoOn} {row.artist.alsoOn === 1 ? 'festival' : 'festivals'}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`None of these for ${artistTitle(row.artist)}`}
                    onClick={() => {
                      skip.current.add(row.artist.id);
                      setDismissed((d) => new Set(d).add(row.artist.id));
                    }}
                  >
                    None of these
                  </Button>
                </div>
                {row.candidates.length === 0 && <p className="text-xs text-text-muted">Spotify has no artist with this name.</p>}
                <ul className="space-y-2">
                  {row.candidates.map((candidate) => {
                    const followers = followersText(candidate.followers);
                    return (
                      <li key={candidate.spotifyId} className="flex items-center gap-3">
                        {candidate.imageUrl && isSafeExternalUrl(candidate.imageUrl) ? (
                          <img src={candidate.imageUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="h-10 w-10 shrink-0 rounded-full bg-bg-primary" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1 text-xs text-text-secondary">
                          <div className="text-sm text-text-primary break-words">
                            {isSafeExternalUrl(candidate.spotifyUrl) ? (
                              <a href={candidate.spotifyUrl} target="_blank" rel="noopener noreferrer" className="text-accent-aqua underline">
                                {candidate.name}
                              </a>
                            ) : (
                              candidate.name
                            )}
                            {candidate.exact && <span className="ml-2 text-xs text-text-muted">Exact name</span>}
                          </div>
                          <div>{[followers, candidate.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</div>
                          {candidate.linkedTo && <div className="text-accent-coral">Already linked to {candidate.linkedTo}. Possible duplicate.</div>}
                        </div>
                        <Button
                          size="sm"
                          disabled={busy || candidate.linkedTo !== null}
                          aria-label={`Pick ${candidate.name} for ${artistTitle(row.artist)}`}
                          onClick={() => pick(row, candidate)}
                        >
                          Pick
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {messages[row.artist.id] && (
                  <p role="alert" className="text-xs text-accent-coral">
                    {messages[row.artist.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) setConfirm(null);
        }}
        title="Change everywhere?"
        description={confirm?.text ?? ''}
        confirmLabel={confirm?.label ?? 'Change everywhere'}
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          run?.();
        }}
      />
    </section>
  );
}
