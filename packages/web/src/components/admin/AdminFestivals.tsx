import React, { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  bulkArchiveFestivals,
  describeRemovals,
  removalFromError,
  withReauth,
} from '@festie/shared/services/admin';
import {
  fetchAdminFestival,
  fetchArchivedFestivals,
  fetchDeleteImpact,
  issuesFromError,
  restoreFestival,
} from '@festie/shared/services/festivalAdmin';
import { getSetEngagement, type SetEngagementMap } from '@festie/shared/services';
import type { AdminFestivalDetail, ArchivedFestival } from '@festie/shared/services/festivalAdmin';
import type { EditableFestival, FestivalIssue } from '@festie/shared/utils';
import {
  bulkConfirmCopy,
  countFestivalChanges,
  describeDeleteImpact,
  describeScheduleNotice,
  SELECTION_LIMIT_MESSAGE,
  sortLineup,
  summarizeBulkResults,
  timeAgo,
  toggleSelection,
  type ScheduleNotice,
} from '@festie/shared/utils';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import LineupImport from './LineupImport';
import FestivalEditForm, { Festival as FormFestival } from './FestivalEditForm';
import FestivalMapEditor from './FestivalMapEditor';
import FestivalStatusPanel, { FestivalMeta } from './FestivalStatusPanel';
import AdminFestivalPreview from './AdminFestivalPreview';
import SelectionBar from './SelectionBar';
import FestivalLinks from './FestivalLinks';
import FestivalAnnouncements from './FestivalAnnouncements';
import { cn } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import { ArrowLeft, Plus, SearchX } from 'lucide-react';
import { useAdminSearch, type AdminSearch } from './useAdminSearch';
import { ADMIN_QUERY_OPTIONS, adminKeys, useAdminFestivals } from './adminQueries';
import type { Day } from './DayEditor';

type ListView = 'live' | 'archived';
type OpenView = 'edit' | 'map' | 'import';

const SEARCH_URL_DELAY_MS = 300;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rowButton =
  'px-3 py-1.5 min-h-11 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium';
const SUB_TABS: ReadonlyArray<{ view: OpenView; label: string }> = [
  { view: 'edit', label: 'Details' },
  { view: 'map', label: 'Map' },
  { view: 'import', label: 'Import lineup' },
];

/**
 * Festival management: CRUD, CSV import/export, lineup management.
 *
 * Hosts the list view, the new-festival form and the open-festival editor. Which one shows,
 * and the search text, live in the URL (`festival`, `view`, `q`), so refresh, Back and shared
 * links reopen the same view. The edit form itself (stages, days, per-set artist rows) is
 * split into FestivalEditForm → DayEditor → SetEditor.
 */
export default function AdminFestivals() {
  const [{ festival: festivalId, view: urlView, q, preview: previewId }, setAdminSearch] = useAdminSearch();
  const queryClient = useQueryClient();
  const festivalsQuery = useAdminFestivals();
  const festivals = festivalsQuery.data ?? [];
  const [archived, setArchived] = useState<ArchivedFestival[]>([]);
  const [listView, setListView] = useState<ListView>('live');
  const [notifyPickers, setNotifyPickers] = useState(true);
  const [formData, setFormData] = useState<Partial<FormFestival>>({});
  const [original, setOriginal] = useState<Partial<FormFestival> | null>(null);
  const [meta, setMeta] = useState<FestivalMeta>({});
  const [issues, setIssues] = useState<FestivalIssue[]>([]);
  const [saving, setSaving] = useState(false);
  // Bumped by Discard to remount the form: SetEditor keeps artist-name drafts in local state.
  const [discardCount, setDiscardCount] = useState(0);
  const [initialExpandedDays, setInitialExpandedDays] = useState<Set<string>>(new Set());
  // The box keeps what was typed (the URL value is trimmed); the URL follows after a pause.
  const [searchQuery, setSearchQuery] = useState(q ?? '');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; description: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // When set, the Spotify links panel takes over the panel for this festival.
  const [linksTarget, setLinksTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-set picks and reminders for the festival being edited.
  const [engagement, setEngagement] = useState<SetEngagementMap | undefined>(undefined);
  const [engagementError, setEngagementError] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [selectionNote, setSelectionNote] = useState<string | undefined>();
  // The festival id whose saved data is in the form. Null means the form is not seeded yet.
  const [seededId, setSeededId] = useState<string | null>(null);
  // A navigation that waits one render so the unsaved-changes guard sees a clean form.
  const [pendingNav, setPendingNav] = useState<AdminSearch | null>(null);
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();

  // What is on screen: the list, the new-festival form (`edit`, no id) or an open festival.
  const openView: OpenView | null = festivalId ? (urlView ?? 'edit') : urlView === 'edit' ? 'edit' : null;
  const editing = openView === 'edit';

  const detail = useQuery({
    queryKey: adminKeys.festival(festivalId ?? ''),
    queryFn: () => fetchAdminFestival(festivalId!),
    enabled: !!festivalId,
    refetchOnMount: 'always',
    ...ADMIN_QUERY_OPTIONS,
  });

  const changes = useMemo(
    () => countFestivalChanges(original as EditableFestival | null, formData as EditableFestival),
    [original, formData],
  );
  const seeded = !festivalId || seededId === festivalId;
  const { confirmLeave, guardDialog } = useUnsavedChangesGuard(
    editing && seeded && changes.total > 0 && !pendingNav,
  );

  const go = (next: AdminSearch) => setPendingNav(next);
  const leave = (next: AdminSearch) => confirmLeave(() => go(next));

  useEffect(() => {
    if (!pendingNav) return;
    setAdminSearch(pendingNav);
    setPendingNav(null);
  }, [pendingNav, setAdminSearch]);

  // An outside change to q (link, finder) moves the box.
  useEffect(() => {
    setSearchQuery((t) => (t.trim() === (q ?? '') ? t : (q ?? '')));
  }, [q]);

  useEffect(() => {
    if (searchQuery.trim() === (q ?? '')) return;
    const timer = setTimeout(
      () => setAdminSearch({ tab: 'festivals', ...(searchQuery.trim() && { q: searchQuery.trim() }) }, { replace: true }),
      SEARCH_URL_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [searchQuery, q, setAdminSearch]);

  const clearEditor = () => {
    setNotifyPickers(true);
    setFormData({});
    setOriginal(null);
    setMeta({});
    setIssues([]);
    setInitialExpandedDays(new Set());
    setEngagement(undefined);
    setEngagementError(false);
  };

  // Leaving the Details view drops the seeded form; coming back loads the saved festival again.
  useEffect(() => {
    if (festivalId && editing) return;
    setSeededId(null);
    if (!festivalId) clearEditor();
  }, [festivalId, editing]);

  // Seeds the form from the saved festival once. A background refetch never overwrites edits.
  // Every day gets an id (the list endpoint omits them) and each day's sets sort by stage, then start time.
  useEffect(() => {
    if (!festivalId || !editing || seededId === festivalId || !detail.data || detail.isFetching) return;
    const { checklist, publishedAt, updatedByUsername, ...full }: AdminFestivalDetail = detail.data;
    const stages = (full.stages || []) as unknown as NonNullable<FormFestival['stages']>;
    const days: Day[] = ((full.days || []) as unknown as Partial<Day>[]).map((d, i) => ({
      id: d.id ?? `day-${i}`,
      label: d.label ?? '',
      date: d.date ?? '',
      sets: sortLineup(d.sets ?? [], stages),
    }));
    const form = { ...full, stages, days } as unknown as Partial<FormFestival>;
    setNotifyPickers(true);
    setOriginal(form);
    setFormData(form);
    setMeta({ publishedAt, updatedAt: full.updatedAt, updatedByUsername, checklist });
    setIssues([]);
    setInitialExpandedDays(new Set(days.length === 1 && days[0] ? [days[0].id] : []));
    setEngagement(undefined);
    setEngagementError(false);
    // Pick counts load beside the festival; a failure only hides the counts.
    getSetEngagement(festivalId).then(setEngagement, () => setEngagementError(true));
    setSeededId(festivalId);
  }, [festivalId, editing, seededId, detail.data, detail.isFetching]);

  // Refreshes every admin read, then seeds the form again from the saved festival.
  const reloadEditor = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin'] });
    setSeededId(null);
  };

  const refreshAdmin = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const loadArchived = async () => {
    try {
      const result = await fetchArchivedFestivals();
      setArchived(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toastError(err, "Couldn't load archived festivals. Try again.");
    }
  };

  const showView = (next: ListView) => {
    setListView(next);
    if (next === 'archived') loadArchived();
  };

  const afterEditSave = async (notice?: ScheduleNotice) => {
    const n = changes.total;
    await reloadEditor();
    toast(notice ? describeScheduleNotice(notice) : `Saved ${plural(n, 'change')}.`, 'success');
  };

  const handleSave = async () => {
    if (!formData.name || !formData.location) {
      toast('Name and location are required', 'error');
      return;
    }
    if (!formData.timeZone) {
      toast("Choose the festival's time zone. Set times, countdowns and reminders use it.", 'error');
      return;
    }

    setSaving(true);
    try {
      if (festivalId) {
        const res = await api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${festivalId}`, {
          ...formData,
          expectedUpdatedAt: formData.updatedAt,
          notify: notifyPickers,
        });
        await afterEditSave(res?.scheduleNotice);
      } else {
        const created = await api.post<{ id?: string }>('/admin/festivals', formData);
        toast('Festival created as a draft. Only admins can see it.', 'success');
        await refreshAdmin();
        go(created?.id ? { tab: 'festivals', festival: created.id, view: 'edit' } : { tab: 'festivals' });
      }
    } catch (err: unknown) {
      const removal = removalFromError(err);
      if (removal) {
        setPendingRemoval(describeRemovals(removal));
        return;
      }
      const found = issuesFromError(err);
      setIssues(found);
      if (found.length > 0) toast('Fix the highlighted problems, then save again.', 'error');
      else toastError(err, "Couldn't save festival. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemovals = async () => {
    if (!festivalId) return;
    setRemovalBusy(true);
    try {
      const done = await withReauth(async () => {
        const res = await api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${festivalId}`, {
          ...formData,
          expectedUpdatedAt: formData.updatedAt,
          confirmRemovals: true,
          notify: notifyPickers,
        });
        return { notice: res?.scheduleNotice };
      }, askPassword);
      if (done === null) return;
      setPendingRemoval(null);
      await afterEditSave(done.notice);
    } catch (err: unknown) {
      setPendingRemoval(null);
      toastError(err, "Couldn't save festival. Try again.");
    } finally {
      setRemovalBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    const name = festivals.find((f) => f.id === id)?.name || 'this festival';
    let description = describeDeleteImpact(null);
    try {
      description = describeDeleteImpact(await fetchDeleteImpact(id));
    } catch (err: unknown) {
      console.warn('Could not load delete impact', err);
    }
    setConfirmDelete({ id, title: `Delete ${name}?`, description });
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    const name = festivals.find((f) => f.id === id)?.name || 'this festival';
    setDeleteBusy(true);
    try {
      const done = await withReauth(async () => {
        await api.delete<void>(`/admin/festivals/${id}`);
        return true;
      }, askPassword);
      if (done === null) return;
      toast(`Deleted ${name}`, 'success');
      setConfirmDelete(null);
      await refreshAdmin();
    } catch (err: unknown) {
      toastError(err, "Couldn't delete festival. Try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleSelected = (id: string) => {
    const { next, limited } = toggleSelection(selected, id);
    setSelected(next);
    setSelectionNote(limited ? SELECTION_LIMIT_MESSAGE : undefined);
  };

  const doArchive = async () => {
    const ids = [...selected];
    setArchiveBusy(true);
    try {
      const done = await withReauth(() => bulkArchiveFestivals(ids), askPassword);
      if (done === null) return;
      const archivedIds = new Set(done.results.filter((r) => r.status === 'archived').map((r) => r.festivalId));
      toast(summarizeBulkResults('archive', done.results), archivedIds.size === ids.length ? 'success' : 'error');
      setSelected(new Set());
      setSelectionNote(undefined);
      setConfirmArchive(false);
      await refreshAdmin();
    } catch (err: unknown) {
      setConfirmArchive(false);
      toastError(err, "Couldn't archive festivals. Try again.");
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleRestore = async (item: ArchivedFestival) => {
    try {
      const { published } = await restoreFestival(item.id);
      toast(published ? `${item.name} is restored.` : `${item.name} is restored as a draft.`, 'success');
      await Promise.all([refreshAdmin(), loadArchived()]);
    } catch (err: unknown) {
      toastError(err, "Couldn't restore festival. Try again.");
    }
  };

  // The map editor saves on its own; refresh the festival so the form picks up the new save time.
  const closeMap = async () => {
    if (!festivalId) return;
    await queryClient.invalidateQueries({ queryKey: adminKeys.festival(festivalId) });
    setAdminSearch({ tab: 'festivals', festival: festivalId, view: 'edit' });
  };

  const needle = searchQuery.trim().toLowerCase();
  const filteredFestivals = festivals.filter(
    (f) => f.name.toLowerCase().includes(needle) || (f.location ?? '').toLowerCase().includes(needle),
  );

  if (previewId) return <AdminFestivalPreview festivalId={previewId} />;

  if (linksTarget) {
    return (
      <FestivalLinks festivalId={linksTarget.id} festivalName={linksTarget.name} onClose={() => setLinksTarget(null)} />
    );
  }

  const toggleClass = (active: boolean) =>
    cn(
      'px-3 py-1.5 min-h-11 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-accent-aqua/20 text-accent-aqua' : 'text-text-secondary hover:text-text-primary',
    );

  const backButton = (
    <button
      type="button"
      onClick={() => leave({ tab: 'festivals', ...(q && { q }) })}
      className="inline-flex items-center gap-2 min-h-11 text-sm text-text-secondary hover:text-text-primary transition-colors"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Back to festivals
    </button>
  );

  const savedName = detail.data?.name || formData.name || 'this festival';

  const renderEditor = () => (
    <div className="space-y-4">
      {festivalId && (
        <FestivalStatusPanel
          festivalId={festivalId}
          name={savedName}
          meta={meta}
          dirty={changes.total > 0}
          onPublished={() => void reloadEditor()}
          onImport={() => leave({ tab: 'festivals', festival: festivalId, view: 'import' })}
          onEditMap={() => leave({ tab: 'festivals', festival: festivalId, view: 'map' })}
        />
      )}
      {festivalId && <FestivalAnnouncements festivalId={festivalId} festivalName={savedName} />}
      <FestivalEditForm
        key={`${festivalId ?? 'new'}-${discardCount}`}
        formData={formData}
        setFormData={setFormData}
        editingId={festivalId ?? null}
        notifyPickers={notifyPickers}
        onNotifyPickersChange={setNotifyPickers}
        initialExpandedDays={initialExpandedDays}
        changes={changes}
        issues={issues}
        saving={saving}
        engagement={engagement}
        engagementError={engagementError}
        onSave={handleSave}
        onDiscard={() => {
          setFormData(original ?? {});
          setIssues([]);
          setDiscardCount((n) => n + 1);
        }}
        onCancel={() => leave({ tab: 'festivals', ...(q && { q }) })}
      />
    </div>
  );

  // The new-festival form, or one festival with its Details, Map and Import lineup views.
  if (openView) {
    const missing = detail.error instanceof ApiClientError && detail.error.status === 404;
    return (
      <div className="space-y-4">
        {backButton}
        <h2 className="type-heading text-text-primary">{festivalId ? savedName : 'New festival'}</h2>
        {festivalId && !detail.isError && (
          <div className="flex gap-2 overflow-x-auto border-b border-glass-border">
            {SUB_TABS.map(({ view: v, label }) => (
              <button
                key={v}
                type="button"
                aria-current={openView === v ? 'page' : undefined}
                onClick={() => openView !== v && leave({ tab: 'festivals', festival: festivalId, view: v })}
                className={cn(
                  'px-4 py-2 min-h-11 whitespace-nowrap font-medium text-sm transition-colors border-b-2',
                  openView === v
                    ? 'border-accent-aqua text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {festivalId && detail.isError ? (
          missing ? (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title="This festival doesn't exist or was deleted."
              cta={{ label: 'Back to festivals', onClick: () => go({ tab: 'festivals' }) }}
            />
          ) : (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title="Couldn't load this festival"
              description={mapErrorToUserMessage(detail.error, 'Check your connection, then try again.')}
              cta={{ label: 'Retry', onClick: () => void detail.refetch() }}
            />
          )
        ) : openView === 'map' && festivalId ? (
          <FestivalMapEditor festivalId={festivalId} onClose={closeMap} onEditFestival={closeMap} />
        ) : openView === 'import' && festivalId ? (
          <LineupImport
            key={festivalId}
            festivalId={festivalId}
            festivalName={savedName}
            onDone={() => void refreshAdmin()}
          />
        ) : !seeded ? (
          <div className="text-center py-12 text-text-muted">Loading festival…</div>
        ) : (
          renderEditor()
        )}
        {guardDialog}
        <ConfirmDialog
          open={pendingRemoval !== null}
          onOpenChange={(o) => !o && setPendingRemoval(null)}
          title="Remove sets with picks?"
          description={pendingRemoval ?? ''}
          confirmLabel="Remove and save"
          destructive
          busy={removalBusy}
          onConfirm={confirmRemovals}
        />
        {reauthDialog}
      </div>
    );
  }

  if (festivalsQuery.isPending) {
    return <div className="text-center py-12 text-text-muted">Loading festivals…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex gap-2">
          <button type="button" aria-pressed={listView === 'live'} onClick={() => showView('live')} className={toggleClass(listView === 'live')}>
            Live
          </button>
          <button
            type="button"
            aria-pressed={listView === 'archived'}
            onClick={() => showView('archived')}
            className={toggleClass(listView === 'archived')}
          >
            Archived
          </button>
        </div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            aria-label="Search festivals by name or location"
            placeholder="Search festivals…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 min-h-11 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <button
            type="button"
            onClick={() => setAdminSearch({ tab: 'festivals', view: 'edit' })}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-11 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New festival
          </button>
        </div>

        {listView === 'archived' &&
          (archived.length === 0 ? (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title="No archived festivals."
              description="Deleted festivals appear here so you can restore them."
            />
          ) : (
            <div className="space-y-3">
              {archived.map((item) => (
                <div
                  key={item.id}
                  className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <h2 className="text-base font-semibold text-text-primary">{item.name}</h2>
                    <p className="text-sm text-text-muted">
                      {item.location} · Deleted {timeAgo(Date.parse(item.deletedAt))}
                    </p>
                  </div>
                  <button onClick={() => handleRestore(item)} className={rowButton}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          ))}

        {listView === 'live' &&
          (festivalsQuery.isError ? (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title="Couldn't load festivals"
              description={mapErrorToUserMessage(festivalsQuery.error, 'Check your connection, then try again.')}
              cta={{ label: 'Retry', onClick: () => void festivalsQuery.refetch() }}
            />
          ) : filteredFestivals.length === 0 ? (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title="No festivals found"
              description="Try adjusting your search or create a new festival."
            />
          ) : (
            <div className="space-y-3">
              {filteredFestivals.map((festival) => (
                <div
                  key={festival.id}
                  className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between hover:bg-bg-card/80 transition-colors"
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${festival.name}`}
                    checked={selected.has(festival.id)}
                    onChange={() => toggleSelected(festival.id)}
                    className="mr-3 h-5 w-5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-text-primary">
                      {festival.name}
                      {!festival.published && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-accent-amber/20 text-accent-amber text-xs font-semibold">
                          Draft
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-text-muted">
                      {festival.location} · {festival.stageCount ?? 0} stages · {festival.dayCount ?? 0} days
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setAdminSearch({ tab: 'festivals', festival: festival.id, view: 'edit' })}
                      aria-label={`Edit ${festival.name}`}
                      className={rowButton}
                    >
                      Edit
                    </button>
                    <Link
                      to="/admin"
                      search={{ tab: 'festivals', preview: festival.id }}
                      target="_blank"
                      rel="noopener"
                      aria-label={`Preview ${festival.name}`}
                      className={`inline-flex items-center ${rowButton}`}
                    >
                      Preview
                    </Link>
                    <button
                      onClick={() => setAdminSearch({ tab: 'festivals', festival: festival.id, view: 'import' })}
                      aria-label={`Import lineup for ${festival.name}`}
                      className={rowButton}
                    >
                      Import
                    </button>
                    <button
                      onClick={() => setAdminSearch({ tab: 'festivals', festival: festival.id, view: 'map' })}
                      aria-label={`Edit map for ${festival.name}`}
                      className={rowButton}
                    >
                      Map
                    </button>
                    <button
                      onClick={() => setLinksTarget({ id: festival.id, name: festival.name })}
                      aria-label={`Spotify links for ${festival.name}`}
                      className={rowButton}
                    >
                      Links
                    </button>
                    <button
                      onClick={() => handleDelete(festival.id)}
                      aria-label={`Delete ${festival.name}`}
                      className="px-3 py-1.5 min-h-11 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        {listView === 'live' && (
          <SelectionBar
            count={selected.size}
            actionLabel="Archive"
            onAction={() => setConfirmArchive(true)}
            onClear={() => {
              setSelected(new Set());
              setSelectionNote(undefined);
            }}
            busy={archiveBusy}
            note={selectionNote}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete?.title || ''}
        description={confirmDelete?.description}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={doDelete}
      />
      {guardDialog}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={(o) => !o && setConfirmArchive(false)}
        title={bulkConfirmCopy('archive', selected.size).title}
        description={bulkConfirmCopy('archive', selected.size).message}
        confirmLabel="Archive"
        destructive
        busy={archiveBusy}
        onConfirm={doArchive}
      />
      {reauthDialog}
    </div>
  );
}
