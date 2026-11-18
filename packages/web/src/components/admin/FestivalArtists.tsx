import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  artistTitle,
  changeEverywhereText,
  changedArtistFrom,
  listFestivalArtists,
  searchArtists,
  updateArtist,
} from '@festie/shared/services';
import type { AdminArtistRow } from '@festie/shared/services';
import { isSafeExternalUrl, platformLabel } from '@festie/shared/utils';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import SpotifyCandidates from './SpotifyCandidates';

interface FestivalArtistsProps {
  festivalId: string;
  festivalName: string;
  onClose: () => void;
}

type Scope = 'festival' | 'all';
type RowStatus = { kind: 'saving' | 'saved' | 'conflict' | 'error'; message?: string };
interface Draft {
  name: string;
  addLink: string;
  label: string;
  removed: string[];
}

const INPUT_CLASS =
  'w-full min-w-0 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder:text-text-muted text-sm';
const emptyDraft = (artist: AdminArtistRow): Draft => ({ name: artist.name, addLink: '', label: artist.label, removed: [] });
const hasChanges = (artist: AdminArtistRow, draft: Draft) =>
  draft.addLink.trim() !== '' ||
  draft.removed.length > 0 ||
  draft.label.trim() !== artist.label ||
  (draft.name.trim() !== '' && draft.name.trim() !== artist.name);
/** Typing in the search box waits this long, so a name is one request, not one per key. */
const SEARCH_DELAY_MS = 300;

/**
 * Admin: one screen for every artist task. An edit changes every festival that lists the artist,
 * past ones too, so the first save of an artist on other festivals asks "Change it everywhere?".
 * Each row saves on its own. "Find Spotify links" opens the candidate picker: nothing is linked without a pick.
 */
export default function FestivalArtists({ festivalId, festivalName, onClose }: FestivalArtistsProps) {
  const [artists, setArtists] = useState<AdminArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [scope, setScope] = useState<Scope>('festival');
  const [query, setQuery] = useState('');
  const [noLinksOnly, setNoLinksOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);

  // Each load takes a number. A reply that arrives after a newer load started is dropped.
  const latestLoad = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    const list = scope === 'festival' ? await listFestivalArtists(festivalId) : await searchArtists(query.trim());
    if (mine === latestLoad.current) setArtists(list);
  }, [scope, festivalId, query]);

  // Only the first load replaces the screen: later loads leave the toolbar and the search box mounted.
  const refresh = useCallback(async () => {
    const mine = latestLoad.current + 1;
    setLoadError(false);
    setReloading(true);
    try {
      await load();
    } catch {
      if (mine === latestLoad.current) setLoadError(true);
    } finally {
      if (mine === latestLoad.current) {
        setLoading(false);
        setReloading(false);
      }
    }
  }, [load]);

  useEffect(() => {
    const wait = scope === 'all' && query.trim() ? SEARCH_DELAY_MS : 0;
    const timer = setTimeout(() => void refresh(), wait);
    return () => clearTimeout(timer);
  }, [refresh, scope, query]);

  const draftOf = (artist: AdminArtistRow) => drafts[artist.id] ?? emptyDraft(artist);
  const patchDraft = (artist: AdminArtistRow, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [artist.id]: { ...draftOf(artist), ...patch } }));
  const setRowStatus = (id: string, next: RowStatus | null) =>
    setStatus((s) => {
      const { [id]: _gone, ...rest } = s;
      return next ? { ...rest, [id]: next } : rest;
    });

  const replaceArtist = (id: string, next: AdminArtistRow) => {
    setArtists((list) => list.map((a) => (a.id === id ? next : a)));
    setDrafts((d) => ({ ...d, [id]: emptyDraft(next) }));
  };

  const save = async (artist: AdminArtistRow) => {
    const draft = draftOf(artist);
    const changes: Parameters<typeof updateArtist>[2] = {};
    if (draft.name.trim() && draft.name.trim() !== artist.name) changes.name = draft.name.trim();
    if (draft.addLink.trim()) changes.addLink = draft.addLink.trim();
    if (draft.removed.length > 0) changes.removeLinks = draft.removed;
    if (draft.label.trim() !== artist.label) changes.label = draft.label.trim();
    setAsked((s) => new Set(s).add(artist.id));
    setRowStatus(artist.id, { kind: 'saving' });
    try {
      const saved = await updateArtist(artist.id, artist.updatedAt, changes);
      replaceArtist(artist.id, { ...artist, ...saved.artist });
      setRowStatus(artist.id, { kind: 'saved' });
    } catch (err) {
      const current = changedArtistFrom(err);
      if (current) {
        replaceArtist(artist.id, { ...artist, ...current });
        setRowStatus(artist.id, {
          kind: 'conflict',
          message: `Someone changed ${current.name} while you were editing. Here is the new version. Apply your change again.`,
        });
        return;
      }
      setRowStatus(artist.id, { kind: 'error', message: err instanceof Error ? err.message : "Couldn't save. Try again." });
    }
  };

  const requestSave = (artist: AdminArtistRow) => {
    if (artist.alsoOn > 0 && !asked.has(artist.id)) setConfirmId(artist.id);
    else void save(artist);
  };

  const shown = useMemo(() => artists.filter((a) => !noLinksOnly || a.linkCount === 0), [artists, noLinksOnly]);
  const linked = artists.filter((a) => a.linkCount > 0).length;
  const confirming = artists.find((a) => a.id === confirmId) ?? null;

  if (loading && !loadError) return <div className="text-center py-12 text-text-muted">Loading artists…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-label text-text-primary">Artists: {festivalName || 'Untitled'}</h2>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>
      <p className="text-sm text-text-secondary">
        {linked} of {artists.length} {artists.length === 1 ? 'artist has' : 'artists have'} a link.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={scope === 'festival' ? 'primary' : 'secondary'} aria-pressed={scope === 'festival'} onClick={() => setScope('festival')}>
          On this festival
        </Button>
        <Button size="sm" variant={scope === 'all' ? 'primary' : 'secondary'} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
          All artists
        </Button>
        <Button size="sm" variant={noLinksOnly ? 'primary' : 'secondary'} aria-pressed={noLinksOnly} onClick={() => setNoLinksOnly((v) => !v)}>
          No links
        </Button>
        <Button size="sm" disabled={findOpen} onClick={() => setFindOpen(true)}>
          Find Spotify links
        </Button>
      </div>

      {scope === 'all' && (
        <input
          type="search"
          aria-label="Search artists"
          placeholder="Search by name"
          className={INPUT_CLASS}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {findOpen && <SpotifyCandidates festivalId={festivalId} onApplied={() => void refresh()} onClose={() => setFindOpen(false)} />}

      {loadError && (
        <div role="alert" className="flex items-center gap-3 text-sm text-text-secondary">
          <span>Couldn’t load the artists.</span>
          <Button size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}
      {reloading && !loadError && <p className="text-sm text-text-muted">Loading artists…</p>}
      {!loadError && !reloading && shown.length === 0 && <p className="text-sm text-text-muted">No artists to show.</p>}
      <ul className="space-y-2">
        {shown.map((artist) => {
          const open = openId === artist.id;
          const draft = draftOf(artist);
          const rowStatus = status[artist.id];
          const links = Object.entries(artist.links);
          return (
            <li key={artist.id} className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-3 space-y-3">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${artistTitle(artist)}${open ? ', collapse' : ', edit'}`}
                onClick={() => setOpenId(open ? null : artist.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              >
                <span className="text-sm text-text-primary break-words">
                  {artist.name}
                  {artist.label && <span className="ml-1 text-text-muted">({artist.label})</span>}
                </span>
                <span className="text-xs text-text-muted">
                  {links.length === 0 ? 'No links' : links.map(([platform]) => platformLabel(platform)).join(', ')}
                  {artist.alsoOn > 0 && ` · Also on ${artist.alsoOn} ${artist.alsoOn === 1 ? 'festival' : 'festivals'}`}
                </span>
              </button>

              {open && (
                <div className="space-y-3">
                  {links.length > 0 && (
                    <ul className="space-y-1">
                      {links.map(([platform, url]) => {
                        const removed = draft.removed.includes(platform);
                        return (
                          <li key={platform} className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                            <span className={removed ? 'line-through' : undefined}>
                              {isSafeExternalUrl(url) ? (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-aqua underline">
                                  {platformLabel(platform)}
                                </a>
                              ) : (
                                platformLabel(platform)
                              )}
                            </span>
                            <Button
                              size="sm"
                              variant={removed ? 'secondary' : 'danger'}
                              aria-label={`${removed ? 'Keep' : 'Remove'} ${platformLabel(platform)} link for ${artist.name}`}
                              onClick={() =>
                                patchDraft(artist, {
                                  removed: removed ? draft.removed.filter((p) => p !== platform) : [...draft.removed, platform],
                                })
                              }
                            >
                              {removed ? 'Keep' : 'Remove'}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <input
                    type="text"
                    aria-label={`Name for ${artist.name}`}
                    placeholder="Artist name"
                    maxLength={300}
                    className={INPUT_CLASS}
                    value={draft.name}
                    onChange={(e) => patchDraft(artist, { name: e.target.value })}
                  />
                  <input
                    type="url"
                    aria-label={`Add link for ${artist.name}`}
                    placeholder="Paste a link. Festie detects the platform."
                    className={INPUT_CLASS}
                    value={draft.addLink}
                    onChange={(e) => patchDraft(artist, { addLink: e.target.value })}
                  />
                  {(artist.sameName || artist.label) && (
                    <input
                      type="text"
                      aria-label={`Note to tell ${artist.name} apart`}
                      placeholder="Note to tell them apart, for example UK"
                      maxLength={40}
                      className={INPUT_CLASS}
                      value={draft.label}
                      onChange={(e) => patchDraft(artist, { label: e.target.value })}
                    />
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      disabled={rowStatus?.kind === 'saving' || !hasChanges(artist, draft)}
                      aria-label={`Save ${artist.name}`}
                      onClick={() => requestSave(artist)}
                    >
                      Save
                    </Button>
                    {rowStatus?.kind === 'saving' && <span className="text-xs text-text-muted">Saving…</span>}
                    {rowStatus?.kind === 'saved' && (
                      <span role="status" className="text-xs text-accent-aqua">
                        Saved
                      </span>
                    )}
                  </div>
                  {(rowStatus?.kind === 'conflict' || rowStatus?.kind === 'error') && (
                    <p role="alert" className="text-xs text-accent-coral">
                      {rowStatus.message}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmId(null);
        }}
        title="Change everywhere?"
        description={confirming ? changeEverywhereText(confirming.name, confirming.alsoOn) : ''}
        confirmLabel="Change everywhere"
        onConfirm={() => {
          const target = confirming;
          setConfirmId(null);
          if (target) void save(target);
        }}
      />
    </div>
  );
}
