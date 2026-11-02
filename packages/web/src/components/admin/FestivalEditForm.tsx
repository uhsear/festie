import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  describeShiftResult,
  filterLineup,
  groupIssues,
  issueKey,
  joinArtistNames,
  listTimeZones,
  shiftSetTimes,
} from '@festie/shared/utils';
import type { FestivalIssue } from '@festie/shared/utils';
import type { Artist } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import DayEditor, { Day } from './DayEditor';
import { Stage } from './SetEditor';

export interface Festival {
  id?: string;
  name?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  b2bSeparator?: string;
  /** Optional IANA zone — anchors set status + reminders in the festival's zone. */
  timeZone?: string | null;
  updatedAt?: string;
  stages?: Stage[];
  days?: Day[];
  [key: string]: unknown;
}

export interface FestivalEditFormProps {
  formData: Partial<Festival>;
  setFormData: (next: Partial<Festival>) => void;
  editingId: string | null;
  notifyPickers: boolean;
  onNotifyPickersChange: (v: boolean) => void;
  initialExpandedDays?: Set<string>;
  changes: { total: number; changedSetIds: Set<string>; newSetIds: Set<string> };
  issues: FestivalIssue[];
  saving: boolean;
  onSave: () => void;
  /** Edit mode: reset to the loaded festival. */
  onDiscard: () => void;
  /** Leave the editor. */
  onCancel: () => void;
}

const ERROR_RING = 'ring-2 ring-accent-coral';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Edit form for a festival's top-level fields plus its stages and days.
 *
 * Delegates per-day rendering (including artists) to DayEditor, and per-set
 * editing to SetEditor. Pure presentation over the parent's formData state —
 * API calls live in AdminFestivals.
 */
export default function FestivalEditForm({
  formData,
  setFormData,
  editingId,
  notifyPickers,
  onNotifyPickersChange,
  initialExpandedDays,
  changes,
  issues,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: FestivalEditFormProps) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(initialExpandedDays ?? new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shiftMinutes, setShiftMinutes] = useState('30');

  // Resolve index-only targets to ids so every row finds its messages under one key.
  const resolved = useMemo(
    () =>
      issues.map((i) => {
        const t = i.target;
        if (t.kind === 'set' && !t.setId) {
          const id = formData.days?.[t.dayIndex ?? -1]?.sets?.[t.setIndex ?? -1]?.id;
          return id ? { ...i, target: { ...t, setId: id } } : i;
        }
        if (t.kind === 'stage' && !t.stageId) {
          const id = formData.stages?.[t.stageIndex ?? -1]?.id;
          return id ? { ...i, target: { ...t, stageId: id } } : i;
        }
        return i;
      }),
    [issues, formData.days, formData.stages],
  );
  const byKey = useMemo(() => groupIssues(resolved), [resolved]);
  const fieldsBySet = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of resolved) {
      const { kind, setId, field } = i.target;
      if (kind === 'set' && setId && field) m.set(setId, [...(m.get(setId) ?? []), field]);
    }
    return m;
  }, [resolved]);
  const dayHasIssue = (day: Day, index: number) =>
    byKey.has(`day:${index}`) || (day.sets || []).some((st) => byKey.has(`set:${st.id}`));

  useEffect(() => {
    if (issues.length === 0) return;
    rootRef.current?.querySelector('[data-issue="true"]')?.scrollIntoView?.({ block: 'center' });
  }, [issues]);

  const jumpToIssue = (issue: FestivalIssue) => {
    const t = resolved[issues.indexOf(issue)]?.target ?? issue.target;
    const day =
      t.kind === 'day'
        ? formData.days?.[t.dayIndex ?? -1]
        : t.kind === 'set'
          ? (formData.days?.find((d) => (d.sets || []).some((st) => st.id === t.setId)) ??
            formData.days?.[t.dayIndex ?? -1])
          : undefined;
    if (day) setExpandedDays((prev) => new Set(prev).add(day.id));
    const key = issueKey(t);
    setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-issue-key="${key}"]`);
      el?.scrollIntoView?.({ block: 'center' });
      el?.querySelector<HTMLElement>('input, select')?.focus();
    }, 0);
  };

  const toggleDayExpanded = (dayId: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  // ── Stages ────────────────────────────────────────────────────
  const handleAddStage = () => {
    setFormData({
      ...formData,
      stages: [...(formData.stages || []), { id: `stage-${Date.now()}`, name: '', color: '#6a6a88' }],
    });
  };

  const handleRemoveStage = (stageId: string) => {
    setFormData({
      ...formData,
      stages: formData.stages?.filter((s) => s.id !== stageId),
    });
  };

  const handleStageName = (index: number, value: string) => {
    const updated = (formData.stages || []).map((s, i) => (i === index ? { ...s, name: value } : s));
    setFormData({ ...formData, stages: updated });
  };

  const handleStageColor = (index: number, value: string) => {
    const updated = (formData.stages || []).map((s, i) => (i === index ? { ...s, color: value } : s));
    setFormData({ ...formData, stages: updated });
  };

  // ── Days ──────────────────────────────────────────────────────
  const handleAddDay = () => {
    setFormData({
      ...formData,
      days: [...(formData.days || []), { id: `day-${Date.now()}`, label: '', date: '', sets: [] }],
    });
  };

  const handleRemoveDay = (dayId: string) => {
    setFormData({
      ...formData,
      days: formData.days?.filter((d) => d.id !== dayId),
    });
  };

  const handleDayLabel = (dayId: string, value: string) => {
    const updated = (formData.days || []).map((d) => (d.id === dayId ? { ...d, label: value } : d));
    setFormData({ ...formData, days: updated });
  };

  const handleDayDate = (dayId: string, value: string) => {
    const updated = (formData.days || []).map((d) => (d.id === dayId ? { ...d, date: value } : d));
    setFormData({ ...formData, days: updated });
  };

  // ── Sets (nested under each day) ──────────────────────────────
  const handleAddSet = (dayId: string) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? {
            ...d,
            sets: [
              {
                id: `set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                artist: '',
                stageId: formData.stages?.[0]?.id || '',
                startTime: '',
                endTime: '',
                artists: [],
              },
              ...(d.sets || []),
            ],
          }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const handleRemoveSet = (dayId: string, setId: string) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId ? { ...d, sets: (d.sets || []).filter((s) => s.id !== setId) } : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const handleSetField = (dayId: string, setId: string, field: string, value: string | null) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? {
            ...d,
            sets: (d.sets || []).map((s) => (s.id === setId ? { ...s, [field]: value } : s)),
          }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  // Rejoin every B2B set, or the server reads an untouched "Kai b2b Mira" under the new separator as one artist.
  const handleSeparator = (b2bSeparator: string) => {
    const days = formData.days?.map((d) => ({
      ...d,
      sets: (d.sets || []).map((s) =>
        s.artists?.length ? { ...s, artist: joinArtistNames(s.artists.map((a) => a.name), b2bSeparator) } : s,
      ),
    }));
    setFormData({ ...formData, b2bSeparator, ...(days && { days }) });
  };

  const handleSetArtists = (dayId: string, setId: string, artists: Artist[]) => {
    const artist = joinArtistNames(
      artists.map((a) => a.name),
      formData.b2bSeparator,
    );
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? { ...d, sets: (d.sets || []).map((s) => (s.id === setId ? { ...s, artists, artist } : s)) }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  // ── Selection and bulk shift ──────────────────────────────────
  const toggleSelect = (setId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      return next;
    });

  const selectAll = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const handleShift = () => {
    const minutes = Number(shiftMinutes);
    const ids = [...selected];
    const totals = { shifted: 0, skipped: 0, crossedDayStart: 0 };
    try {
      const days = (formData.days || []).map((d) => {
        const r = shiftSetTimes(d.sets || [], ids, minutes);
        totals.shifted += r.shifted;
        totals.skipped += r.skipped;
        totals.crossedDayStart += r.crossedDayStart;
        return { ...d, sets: r.sets };
      });
      setFormData({ ...formData, days });
    } catch {
      // shiftSetTimes throws only its RangeError for a bad minute count.
      toast('Shift must be a whole number of minutes between -720 and 720.', 'error');
      return;
    }
    toast(describeShiftResult(totals, minutes), 'info');
    setSelected(new Set());
  };

  const filtering = query.trim() !== '';
  const total = changes.total;
  const nameIssues = byKey.get('festival:name') ?? [];

  return (
    <div ref={rootRef} className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div data-issue-key="festival:name" data-issue={nameIssues.length ? 'true' : undefined}>
          <label htmlFor="festival-name" className="block text-sm font-medium text-text-primary mb-2">
            Festival Name
          </label>
          <input
            id="festival-name"
            type="text"
            placeholder="Festival Name"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            aria-invalid={nameIssues.length ? true : undefined}
            className={`w-full px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua ${nameIssues.length ? ERROR_RING : ''}`}
          />
          {nameIssues.map((m, i) => (
            <p key={i} className="mt-1 text-xs text-accent-coral">
              {m}
            </p>
          ))}
        </div>
        <div>
          <label htmlFor="festival-location" className="block text-sm font-medium text-text-primary mb-2">
            Location
          </label>
          <input
            id="festival-location"
            type="text"
            placeholder="Location"
            value={formData.location || ''}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
          Time zone
          <select
            aria-label="Festival time zone"
            value={formData.timeZone || ''}
            onChange={(e) => setFormData({ ...formData, timeZone: e.target.value || null })}
            className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          >
            <option value="" disabled>
              Choose a time zone…
            </option>
            {/* listTimeZones merges in the festival's current value so a custom zone isn't lost. */}
            {listTimeZones(formData.timeZone).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <span>Set times, countdowns and reminders use this zone.</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
          B2B separator
          <input
            type="text"
            maxLength={10}
            placeholder="b2b"
            aria-label="B2B separator"
            value={formData.b2bSeparator || ''}
            onChange={(e) => handleSeparator(e.target.value)}
            className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <span>Joins B2B artist names, for example b2b, vs or &amp;.</span>
        </label>
      </div>

      {/* Stages */}
      <div className="border-t border-glass-border pt-4">
        <h2 className="type-label text-text-primary mb-3">Stages</h2>
        <div className="space-y-2">
          {(formData.stages || []).map((stage, i) => {
            const stageIssues = byKey.get(`stage:${stage.id}`) ?? byKey.get(`stage#${i}`) ?? [];
            return (
              <div
                key={stage.id}
                data-issue-key={`stage:${stage.id}`}
                data-issue={stageIssues.length ? 'true' : undefined}
              >
                <div className="flex gap-2 items-end">
                  <input
                    type="text"
                    placeholder="Stage name"
                    aria-label="Stage name"
                    aria-invalid={stageIssues.length ? true : undefined}
                    value={stage.name}
                    onChange={(e) => handleStageName(i, e.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua ${stageIssues.length ? ERROR_RING : ''}`}
                  />
                  <input
                    type="color"
                    value={stage.color}
                    onChange={(e) => handleStageColor(i, e.target.value)}
                    className="w-12 h-10 rounded-lg cursor-pointer"
                  />
                  <button
                    onClick={() => handleRemoveStage(stage.id)}
                    className="px-2 py-2 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
                  >
                    Remove
                  </button>
                </div>
                {stageIssues.map((m, k) => (
                  <p key={k} className="mt-1 text-xs text-accent-coral">
                    {m}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
        <button
          onClick={handleAddStage}
          className="mt-3 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
        >
          + Add Stage
        </button>
      </div>

      {/* Days */}
      <div className="border-t border-glass-border pt-4">
        <h2 className="type-label text-text-primary mb-3">Days &amp; Artists</h2>
        <input
          type="search"
          placeholder="Filter by artist or stage"
          aria-label="Filter by artist or stage"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3 w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg-primary/60 border border-glass-border p-2 text-sm text-text-primary">
            <span>{selected.size} selected</span>
            <input
              type="number"
              aria-label="Minutes to shift"
              step={5}
              min={-720}
              max={720}
              value={shiftMinutes}
              onChange={(e) => setShiftMinutes(e.target.value)}
              className="w-24 px-2 py-1 rounded bg-bg-primary border border-glass-border text-sm"
            />
            <button
              type="button"
              onClick={handleShift}
              className="px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
            >
              Shift times
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 rounded-lg bg-bg-primary border border-glass-border text-sm"
            >
              Clear
            </button>
          </div>
        )}
        <div className="space-y-3">
          {(formData.days || []).map((day, dayIndex) => {
            const visibleSets = filterLineup(day.sets || [], formData.stages || [], query);
            const expanded =
              expandedDays.has(day.id) || dayHasIssue(day, dayIndex) || (filtering && visibleSets.length > 0);
            return (
              <div
                key={day.id}
                data-issue-key={`day:${dayIndex}`}
                data-issue={byKey.has(`day:${dayIndex}`) ? 'true' : undefined}
              >
                <DayEditor
                  day={day}
                  stages={formData.stages || []}
                  separator={formData.b2bSeparator}
                  issues={byKey.get(`day:${dayIndex}`) ?? []}
                  issueMap={byKey}
                  issueFields={fieldsBySet}
                  changedSetIds={changes.changedSetIds}
                  newSetIds={changes.newSetIds}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onSelectAll={selectAll}
                  visibleSets={visibleSets}
                  filterQuery={query}
                  isExpanded={expanded}
                  onToggleExpand={() => toggleDayExpanded(day.id)}
                  onLabelChange={(v) => handleDayLabel(day.id, v)}
                  onDateChange={(v) => handleDayDate(day.id, v)}
                  onRemoveDay={() => handleRemoveDay(day.id)}
                  onAddSet={() => handleAddSet(day.id)}
                  onRemoveSet={(setId) => handleRemoveSet(day.id, setId)}
                  onSetField={(setId, field, value) => handleSetField(day.id, setId, field, value)}
                  onSetArtists={(setId, artists) => handleSetArtists(day.id, setId, artists)}
                />
              </div>
            );
          })}
        </div>
        <button
          onClick={handleAddDay}
          className="mt-3 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
        >
          + Add Day
        </button>
      </div>

      {issues.length > 0 && (
        <div role="alert" className="rounded-lg border border-accent-coral p-3 space-y-1">
          <p className="text-sm font-medium text-accent-coral">Fix these before saving</p>
          {issues.map((issue, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jumpToIssue(issue)}
              className="block text-left text-xs text-text-primary hover:underline"
            >
              {issue.message}
            </button>
          ))}
        </div>
      )}

      {editingId && (
        <div className="flex items-start gap-3 border-t border-glass-border pt-4 text-sm text-text-primary">
          <input
            id="festival-notify-pickers"
            type="checkbox"
            checked={notifyPickers}
            onChange={(e) => onNotifyPickersChange(e.target.checked)}
            className="mt-1"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="festival-notify-pickers" className="font-medium">
              Tell people whose picks changed
            </label>
            <span className="text-xs text-text-muted">
              Sends one alert to each person who picked a set you moved or removed.
            </span>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 flex items-center gap-2 justify-end border-t border-glass-border bg-bg-card pt-4">
        {editingId && (
          <span className="mr-auto text-sm text-text-muted">
            {total > 0 ? `${plural(total, 'unsaved change')}` : 'All changes saved'}
          </span>
        )}
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
        >
          Cancel
        </button>
        {editingId && total > 0 && (
          <button
            onClick={onDiscard}
            className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
          >
            Discard
          </button>
        )}
        <button
          onClick={onSave}
          disabled={saving || (!!editingId && total === 0)}
          className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : editingId ? `Save ${plural(total, 'change')}` : 'Create festival'}
        </button>
      </div>
    </div>
  );
}
