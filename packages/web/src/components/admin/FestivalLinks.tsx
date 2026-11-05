import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { runSpotifyBackfill, saveSetLink } from '@festie/shared/services';
import type { SpotifyBackfillResult } from '@festie/shared/services';
import { setLinkRows, linkCoverage, linkCoverageText, backfillSummary, isHttpsUrl } from '@festie/shared/utils';
import type { LooseFestivalDetail, SetLinkRow } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

interface FestivalLinksProps {
  festivalId: string;
  festivalName: string;
  onClose: () => void;
}

const draftKey = (setId: string, index: number) => `${setId}:${index}`;
const INPUT_CLASS =
  'w-full min-w-0 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder:text-text-muted text-sm';

/**
 * Admin: every set and artist with its Spotify link. Paste a link, search
 * again for one set, or find missing links for the whole festival.
 */
export default function FestivalLinks({ festivalId, festivalName, onClose }: FestivalLinksProps) {
  const { toast, toastError } = useToast();
  const [rows, setRows] = useState<SetLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missingOnly, setMissingOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SpotifyBackfillResult | null>(null);

  const load = useCallback(async () => {
    const full = await api.get<LooseFestivalDetail>(`/admin/festivals/${festivalId}`);
    const next = setLinkRows(full);
    const nextDrafts: Record<string, string> = {};
    for (const row of next) for (const a of row.artists) nextDrafts[draftKey(row.setId, a.index)] = a.spotifyUrl ?? '';
    setRows(next);
    setDrafts(nextDrafts);
    setErrors({});
  }, [festivalId]);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      await load();
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  const coverage = useMemo(() => linkCoverage(rows), [rows]);

  const saveArtist = async (row: SetLinkRow, index: number) => {
    const key = draftKey(row.setId, index);
    const value = (drafts[key] ?? '').trim();
    if (value && !isHttpsUrl(value)) {
      setErrors((e) => ({ ...e, [key]: 'Paste a link that starts with https://' }));
      return;
    }
    setErrors((e) => ({ ...e, [key]: '' }));
    setBusy(true);
    try {
      const saved = await saveSetLink(festivalId, row.setId, value || null, index);
      setRows((prev) =>
        prev.map((r) =>
          r.setId !== row.setId
            ? r
            : { ...r, artists: r.artists.map((a) => (a.index === index ? { ...a, spotifyUrl: saved.linkUrl } : a)) },
        ),
      );
      toast('Link saved.', 'success');
    } catch (err) {
      toastError(err, "Couldn't save the link. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const findMissing = async () => {
    setConfirmOpen(false);
    setBusy(true);
    setResult(null);
    try {
      setResult(await runSpotifyBackfill(festivalId));
      await load();
    } catch (err) {
      toastError(err, "Couldn't search Spotify. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const searchAgain = async (row: SetLinkRow) => {
    const label = row.artists.map((a) => a.name).join(' b2b ');
    setBusy(true);
    try {
      const res = await runSpotifyBackfill(festivalId, { setIds: [row.setId], force: true });
      await load();
      if (res.updated > 0) toast(`Linked ${label}.`, 'success');
      else toast(`No Spotify match for ${label}.`, 'info');
    } catch (err) {
      toastError(err, "Couldn't search Spotify. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-text-muted">Loading Spotify links…</div>;
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-text-secondary">Couldn’t load this festival.</p>
        <Button onClick={() => void initialLoad()}>Try again</Button>
      </div>
    );
  }

  const days: { label: string; rows: SetLinkRow[] }[] = [];
  for (const row of rows) {
    if (missingOnly && !row.artists.some((a) => !a.spotifyUrl)) continue;
    const last = days[days.length - 1];
    if (last && last.label === row.dayLabel) last.rows.push(row);
    else days.push({ label: row.dayLabel, rows: [row] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-label text-text-primary">Spotify links: {festivalName || 'Untitled'}</h2>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>
      <p className="text-sm text-text-secondary">{linkCoverageText(coverage)}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={missingOnly ? 'secondary' : 'primary'}
          aria-pressed={!missingOnly}
          onClick={() => setMissingOnly(false)}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={missingOnly ? 'primary' : 'secondary'}
          aria-pressed={missingOnly}
          onClick={() => setMissingOnly(true)}
        >
          Missing only
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
          {busy ? 'Searching Spotify…' : 'Find missing links'}
        </Button>
      </div>

      {result && (
        <div role="status" className="rounded-lg border border-glass-border bg-bg-card/60 p-3 text-sm text-text-primary">
          <p>{backfillSummary(result)}</p>
          {result.unmatched?.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-text-secondary">
              {result.unmatched.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {days.map((day) => (
        <section key={day.label} className="space-y-2">
          <h3 className="type-label text-text-primary">{day.label}</h3>
          {day.rows.map((row) => (
            <div
              key={row.setId}
              className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-3 space-y-3"
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary break-words">
                    {row.artists.map((a) => a.name).join(' b2b ') || 'Untitled set'}
                  </p>
                  {row.stageName && <p className="text-xs text-text-muted">{row.stageName}</p>}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full md:w-auto"
                  disabled={busy}
                  onClick={() => void searchAgain(row)}
                >
                  Search again
                </Button>
              </div>
              {row.artists.map((a) => {
                const key = draftKey(row.setId, a.index);
                const draft = drafts[key] ?? '';
                const remove = draft.trim() === '' && !!a.spotifyUrl;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <div className="text-xs text-text-secondary md:w-40 shrink-0 break-words">
                        <p>{a.name}</p>
                        {a.spotifyUrl ? (
                          <p>
                            Linked{' '}
                            <a
                              href={a.spotifyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-aqua underline"
                            >
                              Open in Spotify
                            </a>
                          </p>
                        ) : (
                          <p className="text-text-muted">No link</p>
                        )}
                      </div>
                      <input
                        type="url"
                        aria-label={`Spotify link for ${a.name}`}
                        placeholder="https://open.spotify.com/artist/…"
                        className={INPUT_CLASS}
                        value={draft}
                        disabled={busy}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant={remove ? 'danger' : 'primary'}
                        className="w-full md:w-auto shrink-0"
                        disabled={busy}
                        onClick={() => void saveArtist(row, a.index)}
                      >
                        {remove ? 'Remove link' : 'Save link'}
                      </Button>
                    </div>
                    {errors[key] && (
                      <p role="alert" className="text-xs text-accent-coral">
                        {errors[key]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Find missing Spotify links?"
        description={`Festie searches Spotify for the ${coverage.total - coverage.linked} artists without a link and adds the best match. Links you already have stay as they are.`}
        confirmLabel="Search Spotify"
        busy={busy}
        onConfirm={findMissing}
      />
    </div>
  );
}
