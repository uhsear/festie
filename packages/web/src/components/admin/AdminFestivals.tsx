import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { describeRemovals, removalFromError, withReauth } from '@festie/shared/services/admin';
import {
  fetchAdminFestival,
  fetchAdminFestivals,
  fetchArchivedFestivals,
  fetchDeleteImpact,
  issuesFromError,
  restoreFestival,
} from '@festie/shared/services/festivalAdmin';
import type { AdminFestivalSummary, ArchivedFestival } from '@festie/shared/services/festivalAdmin';
import { countFestivalChanges, describeDeleteImpact, sortLineup, timeAgo } from '@festie/shared/utils';
import type { EditableFestival, FestivalIssue } from '@festie/shared/utils';
import { describeScheduleNotice, type ScheduleNotice } from '@festie/shared/utils';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import LineupImport from './LineupImport';
import FestivalEditForm, { Festival as FormFestival } from './FestivalEditForm';
import FestivalMapEditor from './FestivalMapEditor';
import FestivalStatusPanel, { FestivalMeta } from './FestivalStatusPanel';
import { cn } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import { SearchX } from 'lucide-react';
import type { Day } from './DayEditor';

type Tab = 'list' | 'create' | 'import';
type View = 'live' | 'archived';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Festival management: CRUD, CSV import/export, lineup management.
 *
 * Hosts the list/table view and "Create New" entry. The edit form itself
 * (stages, days, per-set artist rows) is split into FestivalEditForm →
 * DayEditor → SetEditor.
 */
export default function AdminFestivals() {
  const [festivals, setFestivals] = useState<AdminFestivalSummary[]>([]);
  const [archived, setArchived] = useState<ArchivedFestival[]>([]);
  const [view, setView] = useState<View>('live');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [notifyPickers, setNotifyPickers] = useState(true);
  const [formData, setFormData] = useState<Partial<FormFestival>>({});
  const [original, setOriginal] = useState<Partial<FormFestival> | null>(null);
  const [meta, setMeta] = useState<FestivalMeta>({});
  const [issues, setIssues] = useState<FestivalIssue[]>([]);
  const [saving, setSaving] = useState(false);
  // Bumped by Discard to remount the form: SetEditor keeps artist-name drafts in local state.
  const [discardCount, setDiscardCount] = useState(0);
  const [initialExpandedDays, setInitialExpandedDays] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; description: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // When set, the dedicated map editor is shown for this festival (Phase D). It
  // owns stage-pin + amenity authoring and persists via the same PUT path.
  const [mapEditingId, setMapEditingId] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState<{ id: string; name: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();

  const changes = useMemo(
    () => countFestivalChanges(original as EditableFestival | null, formData as EditableFestival),
    [original, formData],
  );
  const { confirmLeave, guardDialog } = useUnsavedChangesGuard(tab === 'create' && changes.total > 0);

  useEffect(() => {
    loadFestivals();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadFestivals = async () => {
    try {
      setLoading(true);
      const result = await fetchAdminFestivals();
      setFestivals(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toastError(err, "Couldn't load festivals. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadArchived = async () => {
    try {
      const result = await fetchArchivedFestivals();
      setArchived(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toastError(err, "Couldn't load archived festivals. Try again.");
    }
  };

  const showView = (next: View) => {
    setView(next);
    if (next === 'archived') loadArchived();
  };

  const clearEditor = () => {
    setEditingId(null);
    setNotifyPickers(true);
    setFormData({});
    setOriginal(null);
    setMeta({});
    setIssues([]);
    setInitialExpandedDays(new Set());
  };

  // Loads the saved festival into the editor. Every day gets an id (the list
  // endpoint omits them) and each day's sets sort by stage, then start time.
  const openEditor = async (id: string) => {
    setEditingId(id);
    setNotifyPickers(true);
    setTab('create');
    setEditorLoading(true);
    try {
      const { checklist, publishedAt, updatedByUsername, ...full } = await fetchAdminFestival(id);
      const stages = (full.stages || []) as unknown as NonNullable<FormFestival['stages']>;
      const days: Day[] = ((full.days || []) as unknown as Partial<Day>[]).map((d, i) => ({
        id: d.id ?? `day-${i}`,
        label: d.label ?? '',
        date: d.date ?? '',
        sets: sortLineup(d.sets ?? [], stages),
      }));
      const form = { ...full, stages, days } as unknown as Partial<FormFestival>;
      setOriginal(form);
      setFormData(form);
      setMeta({ publishedAt, updatedAt: full.updatedAt, updatedByUsername, checklist });
      setIssues([]);
      setInitialExpandedDays(new Set(days.length === 1 && days[0] ? [days[0].id] : []));
    } catch (err: unknown) {
      toastError(err, "Couldn't load festival details. Try again.");
      clearEditor();
      setTab('list');
    } finally {
      setEditorLoading(false);
    }
  };

  const afterEditSave = async (id: string, notice?: ScheduleNotice) => {
    const n = changes.total;
    await openEditor(id);
    toast(notice ? describeScheduleNotice(notice) : `Saved ${plural(n, 'change')}.`, 'success');
    await loadFestivals();
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
      if (editingId) {
        const res = await api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${editingId}`, {
          ...formData,
          expectedUpdatedAt: formData.updatedAt,
          notify: notifyPickers,
        });
        await afterEditSave(editingId, res?.scheduleNotice);
      } else {
        const created = await api.post<{ id?: string }>('/admin/festivals', formData);
        toast('Festival created as a draft. Only admins can see it.', 'success');
        await loadFestivals();
        if (created?.id) {
          await openEditor(created.id);
        } else {
          clearEditor();
          setTab('list');
        }
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
    if (!editingId) return;
    setRemovalBusy(true);
    try {
      const done = await withReauth(
        async () => {
          const res = await api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${editingId}`, {
            ...formData,
            expectedUpdatedAt: formData.updatedAt,
            confirmRemovals: true,
            notify: notifyPickers,
          });
          return { notice: res?.scheduleNotice };
        },
        askPassword,
      );
      if (done === null) return;
      setPendingRemoval(null);
      await afterEditSave(editingId, done.notice);
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
      await loadFestivals();
    } catch (err: unknown) {
      toastError(err, "Couldn't delete festival. Try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRestore = async (item: ArchivedFestival) => {
    try {
      const { published } = await restoreFestival(item.id);
      toast(published ? `${item.name} is restored.` : `${item.name} is restored as a draft.`, 'success');
      await Promise.all([loadFestivals(), loadArchived()]);
    } catch (err: unknown) {
      toastError(err, "Couldn't restore festival. Try again.");
    }
  };

  const startCreate = () => {
    clearEditor();
    setTab('create');
  };

  const openImport = (target: { id: string; name: string } | null) => {
    clearEditor();
    setImportTarget(target);
    setTab('import');
  };

  // Hands the festival to the map editor; the editor reloads when the map closes.
  const openMap = (id: string) => {
    setFormData({});
    setOriginal(null);
    setIssues([]);
    setMapEditingId(id);
  };

  const closeMap = () => {
    setMapEditingId(null);
    if (editingId) openEditor(editingId);
  };

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    if (t === 'create') startCreate();
    else {
      clearEditor();
      setTab(t);
    }
  };

  const handleCancel = () => {
    clearEditor();
    setTab('list');
  };

  const filteredFestivals = festivals.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.location ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading && tab === 'list') {
    return <div className="text-center py-12 text-text-muted">Loading festivals…</div>;
  }

  // Map editor takes over the panel when active — it loads the festival itself
  // and persists the geo edits, then returns here on close.
  if (mapEditingId) {
    return <FestivalMapEditor festivalId={mapEditingId} onClose={closeMap} />;
  }

  const toggleClass = (active: boolean) =>
    cn(
      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-accent-aqua/20 text-accent-aqua' : 'text-text-secondary hover:text-text-primary',
    );

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-glass-border">
        {(['list', 'create', 'import'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => confirmLeave(() => switchTab(t))}
            className={cn(
              'px-4 py-2 font-medium text-sm transition-colors border-b-2',
              tab === t
                ? 'border-accent-aqua text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t === 'list' ? 'Festivals' : t === 'create' ? (editingId ? 'Edit festival' : 'New festival') : 'Import lineup'}
          </button>
        ))}
      </div>

      {/* Festivals List */}
      {tab === 'list' && (
        <div>
          <div className="mb-3 flex gap-2">
            <button type="button" aria-pressed={view === 'live'} onClick={() => showView('live')} className={toggleClass(view === 'live')}>
              Live
            </button>
            <button
              type="button"
              aria-pressed={view === 'archived'}
              onClick={() => showView('archived')}
              className={toggleClass(view === 'archived')}
            >
              Archived
            </button>
          </div>
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              aria-label="Search festivals by name or location"
              placeholder="Search festivals…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
            />
            <button
              onClick={() => confirmLeave(startCreate)}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium whitespace-nowrap"
            >
              + Create New
            </button>
          </div>

          {view === 'archived' &&
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
                    <button
                      onClick={() => handleRestore(item)}
                      className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ))}

          {view === 'live' &&
            (filteredFestivals.length === 0 ? (
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
                    className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 flex items-center justify-between hover:bg-bg-card/80 transition-colors"
                  >
                    <div className="flex-1">
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmLeave(() => openEditor(festival.id))}
                        className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => confirmLeave(() => openImport({ id: festival.id, name: festival.name }))}
                        className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                      >
                        Import
                      </button>
                      <button
                        onClick={() => confirmLeave(() => openMap(festival.id))}
                        className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                      >
                        Map
                      </button>
                      <button
                        onClick={() => handleDelete(festival.id)}
                        className="px-3 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}

      {/* Create/Edit Form */}
      {tab === 'create' && editorLoading && <div className="text-center py-12 text-text-muted">Loading festival…</div>}
      {tab === 'create' && !editorLoading && (
        <div className="space-y-4">
          {editingId && (
            <FestivalStatusPanel
              festivalId={editingId}
              name={formData.name || 'this festival'}
              meta={meta}
              dirty={changes.total > 0}
              onPublished={() => {
                openEditor(editingId);
                loadFestivals();
              }}
              onImport={() =>
                confirmLeave(() => openImport({ id: editingId, name: formData.name || 'this festival' }))
              }
              onEditMap={() => confirmLeave(() => openMap(editingId))}
            />
          )}
          <FestivalEditForm
            key={`${editingId ?? 'new'}-${discardCount}`}
            formData={formData}
            setFormData={setFormData}
            editingId={editingId}
            notifyPickers={notifyPickers}
            onNotifyPickersChange={setNotifyPickers}
            initialExpandedDays={initialExpandedDays}
            changes={changes}
            issues={issues}
            saving={saving}
            onSave={handleSave}
            onDiscard={() => {
              setFormData(original ?? {});
              setIssues([]);
              setDiscardCount((n) => n + 1);
            }}
            onCancel={() => confirmLeave(handleCancel)}
          />
        </div>
      )}

      {/* Import */}
      {tab === 'import' && importTarget && (
        <LineupImport
          key={importTarget.id}
          festivalId={importTarget.id}
          festivalName={importTarget.name}
          onDone={() => {
            loadFestivals();
          }}
        />
      )}
      {tab === 'import' && !importTarget && (
        <label className="block text-sm text-text-primary">
          Choose a festival
          <select
            className="mt-2 w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary"
            value=""
            onChange={(e) => {
              const f = festivals.find((x) => x.id === e.target.value);
              if (f) setImportTarget({ id: f.id, name: f.name });
            }}
          >
            <option value="">Select…</option>
            {festivals.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
      {guardDialog}
      {reauthDialog}
    </div>
  );
}
