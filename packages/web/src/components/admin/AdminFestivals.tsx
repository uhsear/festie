import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { describeRemovals, removalFromError, withReauth } from '@festie/shared/services/admin';
import { describeScheduleNotice, type ScheduleNotice } from '@festie/shared/utils';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import LineupImport from './LineupImport';
import FestivalEditForm, { Festival as FormFestival } from './FestivalEditForm';
import FestivalMapEditor from './FestivalMapEditor';
import { cn } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import { SearchX } from 'lucide-react';
import type { SetRow } from './SetEditor';

interface Festival {
  id: string;
  name: string;
  location: string;
  stageCount?: number; // from list endpoint
  dayCount?: number; // from list endpoint
  stages?: Array<{ id: string; name: string; color: string }>; // from detail endpoint
  days?: Array<{ id: string; label: string; date: string; sets: SetRow[] }>; // from detail
}

type Tab = 'list' | 'create' | 'import';

/**
 * Festival management: CRUD, CSV import/export, lineup management.
 *
 * Hosts the list/table view and "Create New" entry. The edit form itself
 * (stages, days, per-set artist rows) is split into FestivalEditForm →
 * DayEditor → SetEditor.
 */
export default function AdminFestivals() {
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notifyPickers, setNotifyPickers] = useState(true);
  const [formData, setFormData] = useState<Partial<FormFestival>>({});
  const [initialExpandedDays, setInitialExpandedDays] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; description: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // When set, the dedicated map editor is shown for this festival (Phase D). It
  // owns stage-pin + amenity authoring and persists via the same PUT path.
  const [mapEditingId, setMapEditingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();

  useEffect(() => {
    loadFestivals();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadFestivals = async () => {
    try {
      setLoading(true);
      const result = await api.get<Festival[]>('/admin/festivals');
      setFestivals(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toastError(err, "Couldn't load festivals. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const finishSave = async (created: boolean, notice?: ScheduleNotice) => {
    toast(created ? 'Festival created' : notice ? describeScheduleNotice(notice) : 'Festival updated', 'success');
    setEditingId(null);
    setNotifyPickers(true);
    setFormData({});
    setInitialExpandedDays(new Set());
    setTab('list');
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

    try {
      if (editingId) {
        const res = await api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${editingId}`, {
          ...formData,
          expectedUpdatedAt: formData.updatedAt,
          notify: notifyPickers,
        });
        await finishSave(false, res?.scheduleNotice);
      } else {
        await api.post<void>('/admin/festivals', formData);
        await finishSave(true);
      }
    } catch (err: unknown) {
      const removal = removalFromError(err);
      if (removal) {
        setPendingRemoval(describeRemovals(removal));
        return;
      }
      toastError(err, "Couldn't save festival. Try again.");
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
      await finishSave(false, done.notice);
    } catch (err: unknown) {
      setPendingRemoval(null);
      toastError(err, "Couldn't save festival. Try again.");
    } finally {
      setRemovalBusy(false);
    }
  };

  const handleDelete = (id: string) => {
    const festival = festivals.find((f) => f.id === id);
    const name = festival?.name || 'this festival';
    setConfirmDelete({
      id,
      title: `Delete ${name}?`,
      description: 'This soft-deletes the festival and hides it from users. Users with picks for it will lose access.',
    });
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

  const handleEdit = async (festival: Festival) => {
    setEditingId(festival.id);
    setNotifyPickers(true);
    setTab('create');
    // List endpoint returns only summary (stageCount, dayCount). Fetch full
    // festival to get nested stages[] and days[] for the edit form.
    try {
      const full = await api.get<Festival>(`/festivals/${festival.id}`);
      const days = full.days || [];
      setFormData({
        ...full,
        stages: full.stages || [],
        days,
      });
      // Auto-expand all days so artists are visible immediately
      setInitialExpandedDays(new Set(days.map((d) => d.id)));
    } catch (err: unknown) {
      toastError(err, "Couldn't load festival details. Try again.");
      setFormData(festival as Partial<FormFestival>);
    }
  };

  const handleCancel = () => {
    setTab('list');
    setEditingId(null);
    setFormData({});
    setInitialExpandedDays(new Set());
  };

  const filteredFestivals = festivals.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.location.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading && tab === 'list') {
    return <div className="text-center py-12 text-text-muted">Loading festivals…</div>;
  }

  // Map editor takes over the panel when active — it loads the festival itself
  // and persists the geo edits, then returns here on close.
  if (mapEditingId) {
    return <FestivalMapEditor festivalId={mapEditingId} onClose={() => setMapEditingId(null)} />;
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-glass-border">
        {(['list', 'create', 'import'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === 'create') {
                setEditingId(null);
                setFormData({});
                setInitialExpandedDays(new Set());
              }
            }}
            className={cn(
              'px-4 py-2 font-medium text-sm transition-colors border-b-2',
              tab === t
                ? 'border-accent-aqua text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t === 'list' ? 'Festivals' : t === 'create' ? 'Create/Edit' : 'Import Lineup'}
          </button>
        ))}
      </div>

      {/* Festivals List */}
      {tab === 'list' && (
        <div>
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
              onClick={() => {
                setEditingId(null);
                setFormData({});
                setInitialExpandedDays(new Set());
                setTab('create');
              }}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium whitespace-nowrap"
            >
              + Create New
            </button>
          </div>

          {filteredFestivals.length === 0 ? (
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
                    <h2 className="text-base font-semibold text-text-primary">{festival.name}</h2>
                    <p className="text-sm text-text-muted">
                      {festival.location} · {festival.stageCount ?? festival.stages?.length ?? 0} stages ·{' '}
                      {festival.dayCount ?? festival.days?.length ?? 0} days
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(festival)}
                      className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setMapEditingId(festival.id)}
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
          )}
        </div>
      )}

      {/* Create/Edit Form */}
      {tab === 'create' && (
        <FestivalEditForm
          formData={formData}
          setFormData={setFormData}
          editingId={editingId}
          notifyPickers={notifyPickers}
          onNotifyPickersChange={setNotifyPickers}
          initialExpandedDays={initialExpandedDays}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}

      {/* Import */}
      {tab === 'import' && editingId && (
        <LineupImport
          festivalId={editingId}
          onSuccess={() => {
            loadFestivals();
            setTab('list');
          }}
        />
      )}
      {tab === 'import' && !editingId && (
        <p className="text-center text-[var(--color-text-muted)] py-8">Select a festival to import a lineup.</p>
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
      {reauthDialog}
    </div>
  );
}
