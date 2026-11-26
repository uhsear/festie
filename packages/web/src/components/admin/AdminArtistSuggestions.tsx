import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  decideArtistSuggestion,
  describeSuggestedChanges,
  type ArtistSuggestion,
} from '@festie/shared/services/adminArtistSuggestions';
import { artistTitle } from '@festie/shared/services/adminArtists';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import PromptDialog from '../ui/PromptDialog';
import { adminKeys, useArtistSuggestions } from './adminQueries';

type Action = { kind: 'accept' | 'reject'; suggestion: ArtistSuggestion } | null;

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-xl border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const day = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * The organizer suggestions for artists (artist plan 8.3). An organizer's change to an artist that another organization
 * or an admin-only festival also uses, and every organizer Spotify change, waits here. Accepting applies it to the artist
 * and every festival that lists it. Rejecting sends the organization your note.
 */
export default function AdminArtistSuggestions() {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const suggestions = useArtistSuggestions();
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (suggestion: ArtistSuggestion, decision: 'accept' | 'reject', note?: string) => {
    setBusy(true);
    try {
      const result = await decideArtistSuggestion(suggestion.id, decision, note?.trim());
      toast(
        decision === 'accept'
          ? result.festivalsUpdated === 0
            ? `Applied to ${artistTitle(suggestion.artist)}. No festival copies needed updating.`
            : `Applied to ${artistTitle(suggestion.artist)} and ${plural(result.festivalsUpdated, 'festival')}.`
          : 'Rejected. The organization sees your note.',
        'success',
      );
      setAction(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.artistSuggestions });
    } catch (err) {
      setAction(null);
      toastError(err, "Couldn't decide the suggestion. Reload the list and try again.");
      await queryClient.invalidateQueries({ queryKey: adminKeys.artistSuggestions });
    } finally {
      setBusy(false);
    }
  };

  if (suggestions.isPending) {
    return (
      <div role="status" className="py-12 text-center text-text-muted">
        Loading the suggestions…
      </div>
    );
  }
  if (suggestions.isError) {
    return (
      <EmptyState
        icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
        title="Couldn't load the suggestions"
        description={mapErrorToUserMessage(suggestions.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void suggestions.refetch() }}
      />
    );
  }

  const list = suggestions.data;
  const target = action?.suggestion;

  return (
    <div className="space-y-4">
      <section aria-label="Artist suggestions" className="space-y-3">
        <h2 className="type-heading text-text-primary">Artist suggestions ({list.length})</h2>
        <p className="text-sm text-text-muted">
          Until you decide, every festival keeps the artist&apos;s current details. Accepting changes the artist everywhere it plays.
        </p>
        {list.length === 0 ? (
          <EmptyState icon={<SearchX className="h-9 w-9" aria-hidden="true" />} title="No artist suggestions are waiting." />
        ) : (
          <ul className="list-none space-y-3 p-0">
            {list.map((s) => {
              const merged = !!s.artist.mergedInto;
              return (
                <li key={s.id} className="space-y-2 rounded-xl border border-glass-border bg-bg-card/60 p-4">
                  <p className="text-base font-semibold text-text-primary">{artistTitle(s.artist)}</p>
                  <p className="text-xs text-text-muted">
                    {s.organization?.name ?? 'An organization'}
                    {s.createdBy ? `, sent by ${s.createdBy}` : ''}. {day(s.createdAt)}. The artist is on {plural(s.festivalCount, 'festival')}.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
                    {describeSuggestedChanges(s.changes).map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                  {merged && <p className="text-xs text-accent-coral">This artist was merged into another one. Reject the suggestion.</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={smallButton}
                      aria-label={`Accept the change to ${artistTitle(s.artist)}`}
                      disabled={busy || merged}
                      onClick={() => setAction({ kind: 'accept', suggestion: s })}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      aria-label={`Reject the change to ${artistTitle(s.artist)}`}
                      disabled={busy}
                      onClick={() => setAction({ kind: 'reject', suggestion: s })}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={action?.kind === 'accept'}
        onOpenChange={(o) => !o && setAction(null)}
        title={target ? `Change ${artistTitle(target.artist)}?` : ''}
        description={
          target
            ? `${describeSuggestedChanges(target.changes).join('. ')}. It changes the artist on ${plural(target.festivalCount, 'festival')}, past ones too.`
            : undefined
        }
        confirmLabel="Accept"
        busy={busy}
        onConfirm={() => (action?.kind === 'accept' ? decide(action.suggestion, 'accept') : undefined)}
      />
      <PromptDialog
        open={action?.kind === 'reject'}
        onOpenChange={(o) => !o && setAction(null)}
        title={target ? `Reject the change to ${artistTitle(target.artist)}` : ''}
        description="Write why. The organization reads this note."
        placeholder="Why is it rejected?"
        confirmLabel="Reject"
        maxLength={500}
        busy={busy}
        onConfirm={(note) => (action?.kind === 'reject' ? decide(action.suggestion, 'reject', note) : undefined)}
      />
    </div>
  );
}
