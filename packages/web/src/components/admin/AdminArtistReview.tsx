import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { ApiClientError, mapErrorToUserMessage } from '@festie/shared/services/api';
import { withReauth } from '@festie/shared/services/admin';
import {
  approveArtistReview,
  importArtistReview,
  parseArtistReviewBatch,
  rejectArtistReview,
  type ArtistReviewCandidate,
  type ArtistReviewItem,
} from '@festie/shared/services/adminArtistReview';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import PromptDialog from '../ui/PromptDialog';
import { INPUT_CLASS } from './adminStyles';
import { adminKeys, useArtistReview } from './adminQueries';

const PAGE_SIZE = 25;
const MAX_BATCH_BYTES = 200_000;

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';
const linkClass = 'underline break-all text-accent-aqua focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

const BADGE: Record<ArtistReviewCandidate['confidence'], string> = {
  high: 'border-accent-aqua text-accent-aqua',
  medium: 'border-glass-border text-text-primary',
  low: 'border-accent-coral text-accent-coral',
};

const KIND_LABEL = { link: 'Link', merge: 'Merge', rename: 'Rename' } as const;

function ExternalLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {url}
    </a>
  );
}

/** The link an approval would apply: the typed one, else the chosen candidate's Spotify link. */
const linkFor = (item: ArtistReviewItem, selected: number, typed: string | null) => typed ?? item.candidates[selected]?.spotifyUrl ?? '';

function errorText(err: unknown): string {
  if (err instanceof ApiClientError && err.status === 409 && err.message) return `${err.message} Reload the list if it is stale.`;
  return mapErrorToUserMessage(err, "Couldn't save the decision. Try again.");
}

interface RowProps {
  item: ArtistReviewItem;
  busy: boolean;
  onApprove: (item: ArtistReviewItem, pick: { candidateIndex: number; url?: string }) => void;
  onReject: (item: ArtistReviewItem, note: string) => void;
}

function ReviewRow({ item, busy, onApprove, onReject }: RowProps) {
  const [selected, setSelected] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const link = linkFor(item, selected, typed);
  const needsLink = item.kind === 'link';
  const canApprove = !busy && (!needsLink || !!link);
  const nameId = `review-${item.id}-name`;

  return (
    <tr className="block md:table-row border-b border-glass-border py-3 md:py-0 align-top">
      <td className="block md:table-cell md:p-3 md:w-48">
        <p id={nameId} className="font-semibold text-text-primary break-words">
          {item.artistName}
        </p>
        {item.kind !== 'link' && item.proposed.to && (
          <p className="text-xs text-text-secondary break-words">
            {item.proposed.from} {'->'} {item.proposed.to}
          </p>
        )}
        {item.note && <p className="text-xs text-text-muted break-words">{item.note}</p>}
        {item.merge && (
          <p className="text-xs text-text-secondary break-words">
            Merges {item.merge.loserName} into {item.merge.survivorName}
          </p>
        )}
        {item.current && (
          <p className="text-xs text-text-secondary break-words">
            Now: {item.current.name}
            {item.kind === 'link' && ` (Spotify: ${item.current.spotifyUrl ?? 'none'})`}
          </p>
        )}
      </td>
      <td className="block md:table-cell md:p-3 text-sm text-text-secondary break-words">
        <span className="md:hidden text-text-muted">Festival: </span>
        {item.festival || 'Any'}
      </td>
      <td className="block md:table-cell md:p-3 text-sm text-text-primary">
        <span className="md:hidden text-text-muted">Kind: </span>
        {KIND_LABEL[item.kind]}
      </td>
      <td className="block md:table-cell md:p-3">
        {item.candidates.length === 0 && <p className="text-sm text-text-muted">No candidate. Use Edit link to type one.</p>}
        <ul className="list-none p-0 space-y-3">
          {item.candidates.map((candidate, index) => (
            <li key={`${candidate.spotifyUrl}-${index}`} className="space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {needsLink && (
                  <input
                    type="radio"
                    name={`candidate-${item.id}`}
                    className="h-5 w-5"
                    checked={typed === null && selected === index}
                    onChange={() => {
                      setSelected(index);
                      setTyped(null);
                    }}
                    aria-label={`Use candidate ${index + 1} for ${item.artistName}`}
                  />
                )}
                <span className={`rounded-full border px-2 py-0.5 text-xs ${BADGE[candidate.confidence]}`}>{candidate.confidence} confidence</span>
              </div>
              {candidate.spotifyUrl && <ExternalLink url={candidate.spotifyUrl} />}
              {candidate.otherUrls.map((url) => (
                <div key={url}>
                  <ExternalLink url={url} />
                </div>
              ))}
              {candidate.evidence && <p className="text-xs text-text-secondary break-words">{candidate.evidence}</p>}
            </li>
          ))}
        </ul>
        {typed !== null && (
          <p className="mt-2 text-sm text-text-primary break-all">
            Your link: <ExternalLink url={typed} />
          </p>
        )}
      </td>
      <td className="block md:table-cell md:p-3 md:w-56">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={smallButton}
            disabled={!canApprove}
            aria-label={`Approve ${item.artistName}`}
            onClick={() => onApprove(item, { candidateIndex: selected, ...(typed !== null ? { url: typed } : {}) })}
          >
            Approve
          </button>
          <button type="button" className={smallButton} disabled={busy} aria-label={`Reject ${item.artistName}`} onClick={() => onReject(item, note)}>
            Reject
          </button>
          {needsLink && (
            <button type="button" className={smallButton} disabled={busy} aria-label={`Edit link for ${item.artistName}`} onClick={() => setEditing(true)}>
              Edit link
            </button>
          )}
        </div>
        <input
          type="text"
          className={`${INPUT_CLASS} mt-2`}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Reject note (optional)"
          aria-label={`Reject note for ${item.artistName} (optional)`}
          aria-describedby={nameId}
        />
        <PromptDialog
          open={editing}
          onOpenChange={setEditing}
          title={`Edit the link for ${item.artistName}`}
          description="Type an https link. It replaces the candidate when you approve."
          placeholder="https://open.spotify.com/artist/..."
          defaultValue={link}
          confirmLabel="Use this link"
          maxLength={500}
          onConfirm={(value) => {
            setTyped(value);
            setEditing(false);
          }}
        />
      </td>
    </tr>
  );
}

/**
 * Admin, web only: the artist review queue. Import a JSON batch of researched link, merge and rename proposals, then
 * approve or reject them one by one. An approval goes through the same artist edit and merge code as the Artists tab.
 * A merge asks for a confirmation and a recent password check, because it cannot be undone.
 */
export default function AdminArtistReview() {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();
  const [offset, setOffset] = useState(0);
  const queue = useArtistReview(offset, PAGE_SIZE);
  const [text, setText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState<{ item: ArtistReviewItem; url?: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.artistReview });

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BATCH_BYTES) return setImportError('That file is too large for one batch. Split it.');
    setText(await file.text());
    setImportError(null);
  };

  const runImport = async () => {
    const parsed = parseArtistReviewBatch(text);
    if (!parsed.ok) return setImportError(parsed.message);
    setImportError(null);
    setBusy(true);
    try {
      const result = await importArtistReview(parsed.batch);
      toast(
        `Imported ${result.added} new ${result.added === 1 ? 'item' : 'items'}, updated ${result.refined} pending, skipped ${result.skipped} already in the queue.`,
        'success',
      );
      setText('');
      setOffset(0);
      await refresh();
    } catch (err) {
      setImportError(mapErrorToUserMessage(err, "Couldn't import the batch. Check the JSON and try again."));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (item: ArtistReviewItem, pick: { candidateIndex: number; url?: string }) => {
    setBusy(true);
    try {
      const body = {
        ...(item.candidates[pick.candidateIndex] ? { candidateIndex: pick.candidateIndex } : {}),
        ...(pick.url ? { url: pick.url } : {}),
        ...(item.kind === 'merge' ? { acceptedFestivals: item.festivalCount ?? 0, ...(item.merge ? { expectedSurvivorId: item.merge.survivorId } : {}) } : {}),
      };
      const result = await withReauth(() => approveArtistReview(item.id, body), askPassword, { retryWrongPassword: true });
      if (result === null) return;
      toast(`Applied to ${item.artistName}. ${result.festivalsUpdated} ${result.festivalsUpdated === 1 ? 'festival' : 'festivals'} updated.`, 'success');
      await refresh();
    } catch (err) {
      toastError(err, errorText(err));
      await refresh();
    } finally {
      setBusy(false);
      setMerge(null);
    }
  };

  const reject = async (item: ArtistReviewItem, note: string) => {
    setBusy(true);
    try {
      await rejectArtistReview(item.id, note.trim() || undefined);
      toast(`Rejected ${item.artistName}.`, 'success');
      await refresh();
    } catch (err) {
      toastError(err, errorText(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const importSection = (
    <section aria-label="Import a batch" className="space-y-2 rounded-lg border border-glass-border p-4">
      <h2 className="type-heading text-text-primary">Import a batch</h2>
      <p className="text-sm text-text-muted">Upload or paste the research JSON. An item that is already in the queue is skipped.</p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Batch file"
        className="block text-sm text-text-primary"
        onChange={(event) => void readFile(event.target.files?.[0])}
      />
      <textarea
        className={`${INPUT_CLASS} min-h-32 font-mono`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder='{"generatedAt":"...","items":[...]}'
        aria-label="Batch JSON"
        aria-invalid={importError ? true : undefined}
        aria-describedby={importError ? 'review-import-error' : undefined}
      />
      {importError && (
        <p id="review-import-error" role="alert" className="text-sm text-accent-coral">
          {importError}
        </p>
      )}
      <button type="button" className={smallButton} disabled={busy || !text.trim()} onClick={() => void runImport()}>
        Import
      </button>
    </section>
  );

  let body;
  if (queue.isPending) {
    body = (
      <div role="status" className="py-12 text-center text-text-muted">
        Loading the review queue…
      </div>
    );
  } else if (queue.isError) {
    body = (
      <EmptyState
        icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
        title="Couldn't load the review queue"
        description={mapErrorToUserMessage(queue.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void queue.refetch() }}
      />
    );
  } else if (queue.data.items.length === 0) {
    body = <EmptyState icon={<SearchX className="h-9 w-9" aria-hidden="true" />} title="Nothing is waiting for review." />;
  } else {
    const { items, total } = queue.data;
    body = (
      <>
        <table className="w-full text-left">
          <caption className="sr-only">Pending artist review items</caption>
          <thead className="hidden md:table-header-group text-xs text-text-muted">
            <tr>
              <th scope="col" className="p-3">Artist</th>
              <th scope="col" className="p-3">Festival</th>
              <th scope="col" className="p-3">Kind</th>
              <th scope="col" className="p-3">Candidates</th>
              <th scope="col" className="p-3">Decision</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {items.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                busy={busy}
                onApprove={(row, pick) => (row.kind === 'merge' ? setMerge({ item: row, url: pick.url }) : void approve(row, pick))}
                onReject={(row, note) => void reject(row, note)}
              />
            ))}
          </tbody>
        </table>
        <nav aria-label="Review pages" className="flex items-center justify-between gap-2">
          <button type="button" className={smallButton} disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </button>
          <span className="text-sm text-text-muted">
            {offset + 1} to {offset + items.length} of {total}
          </span>
          <button type="button" className={smallButton} disabled={offset + items.length >= total || busy} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </button>
        </nav>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {importSection}
      <section aria-label="Review queue" className="space-y-3">
        <h2 className="type-heading text-text-primary">Artist review{queue.data ? ` (${queue.data.total})` : ''}</h2>
        {body}
      </section>
      <ConfirmDialog
        open={merge !== null}
        onOpenChange={(open) => !open && setMerge(null)}
        title={merge ? `Merge ${merge.item.artistName}?` : ''}
        description={
          merge
            ? `This merges ${merge.item.merge?.loserName ?? 'the artist'} into ${merge.item.merge?.survivorName ?? 'the one that holds the link'}, on ${merge.item.festivalCount ?? 0} ${merge.item.festivalCount === 1 ? 'festival' : 'festivals'}, past ones too. It cannot be undone. You will be asked for your password.`
            : undefined
        }
        confirmLabel="Merge"
        destructive
        busy={busy}
        onConfirm={() => (merge ? approve(merge.item, { candidateIndex: 0, ...(merge.url ? { url: merge.url } : {}) }) : undefined)}
      />
      {reauthDialog}
    </div>
  );
}
