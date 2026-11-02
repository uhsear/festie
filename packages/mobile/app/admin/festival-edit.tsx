import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, ScrollView, Switch, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api,
  checklistFromError,
  describeRemovals,
  fetchAdminFestival,
  fetchDeleteImpact,
  issuesFromError,
  publishFestival,
  removalFromError,
  withReauth,
  type RemovalSummary,
} from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import {
  ConfirmDialog,
  LabeledTextInput,
  useReauthPrompt,
  ModalSelect,
  HexColorField,
  DateField,
  TimeField,
  isValidDate,
  isValidTime,
  ShiftTimesDialog,
  type SelectOption,
} from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';
import {
  addStage as addStageReducer,
  removeStage as removeStageReducer,
  setStageField as setStageFieldReducer,
  addDay as addDayReducer,
  removeDay as removeDayReducer,
  setDayField as setDayFieldReducer,
  toggleDay as toggleDayReducer,
  prependSet as prependSetReducer,
  sortFormSets,
  shiftDaySets,
  removeSet as removeSetReducer,
  setSetField as setSetFieldReducer,
  setSetArtistNames as setSetArtistNamesReducer,
  withoutIndex,
  type StageRow,
  type SetRow,
  type DayRow,
  type FormState,
} from './festivalEditState';
import {
  amenityCount,
  artistNamesOf,
  countFestivalChanges,
  describeScheduleNotice,
  describeDeleteImpact,
  describeShiftResult,
  festivalStatusLine,
  filterLineup,
  groupIssues,
  isPublishBlocked,
  issueKey,
  joinArtistNames,
  listTimeZones,
  pickShiftTargets,
  startsAfterMidnight,
  type ChecklistItem,
  type DeleteImpact,
  type FestivalIssue,
} from '@festie/shared/utils';
import type { ScheduleNotice } from '@festie/shared/utils';
import type { Artist, FestivalMapConfig } from '@festie/shared/types';

/**
 * Admin — Festival editor (native UI parity for the web FestivalEditForm →
 * DayEditor → SetEditor chain, packages/web/src/components/admin). Lives under
 * app/admin/ so AuthGate (seg[0]==='admin') guards it; non-admins bounce to an
 * "Admins only" empty state.
 *
 * Pure native UI over the SAME shared api.* calls and the SAME payload shape the
 * web form posts — NO native modules, NO new backend logic. Every form control
 * is a token-styled primitive from components/admin (ModalSelect / DateField /
 * TimeField / HexColorField), so the whole surface stays OTA-able.
 *
 *   ?id=<festivalId> → edit (loads via GET /admin/festivals/:id, drafts included)
 *   no id            → create; on success it opens the new draft's editor (?created=1)
 *
 * Save: POST /admin/festivals (create) or PUT /admin/festivals/:id (edit) with
 *       { name, location, timeZone, stages[], days[].sets[] }. The festival's
 *       date range is NOT a top-level field — the server derives start/end from
 *       the day dates (days[].date), matching festivalCreateSchema/festivalUpdateSchema.
 *       Sends expectedUpdatedAt so a stale form gets FESTIVAL_CHANGED instead of
 *       overwriting. A save that removes sets people picked gets CONFIRM_REMOVALS;
 *       the admin confirms, re-enters their password if asked, and it re-sends with
 *       confirmRemovals: true.
 * Delete: DELETE /admin/festivals/:id — gated behind ConfirmDialog and a password re-check.
 * Backfill: POST /admin/festivals/:id/backfill-spotify — gated behind ConfirmDialog.
 *
 * Edit saves stay on the screen and reload. Back-navigates to '/admin' on cancel / delete.
 * Publish: POST /admin/festivals/:id/publish once the server checklist has no open item.
 */

const DEFAULT_STAGE_COLOR = '#6a6a88';
const MAX_ARTISTS_PER_SET = 4;

// Local editable shapes (StageRow / SetRow / DayRow / FormState) live in
// ./festivalEditState alongside the pure tree reducers they operate on.

// Detail response from GET /admin/festivals/:id (depth=2). Loosely typed — we only
// read the fields the editor hydrates.
interface FestivalDetail {
  id: string;
  publishedAt?: string | null;
  updatedByUsername?: string | null;
  checklist?: ChecklistItem[];
  name?: string;
  location?: string;
  timeZone?: string | null;
  b2bSeparator?: string;
  updatedAt?: string;
  mapConfig?: FestivalMapConfig | null;
  stages?: { id?: string; name?: string; color?: string; latitude?: number | null; longitude?: number | null }[];
  days?: {
    id?: string;
    label?: string;
    date?: string;
    sets?: {
      id?: string;
      artist?: string;
      stageId?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      linkUrl?: string | null;
      artists?: { name?: string; links?: Record<string, string> }[];
    }[];
  }[];
}

type DetailSet = NonNullable<NonNullable<FestivalDetail['days']>[number]['sets']>[number];

const EMPTY_FORM: FormState = {
  name: '',
  location: '',
  timeZone: '',
  b2bSeparator: 'b2b',
  stages: [],
  days: [],
  mapConfig: null,
};

const NO_ISSUES: FestivalIssue[] = [];

const CHECK_PREFIX = { done: 'Done', todo: 'To do', warn: 'Warning' } as const;

function plural(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** True when a stage row carries a finite lat/lng pin. */
function stageIsPinned(s: StageRow): boolean {
  return typeof s.latitude === 'number' && typeof s.longitude === 'number';
}

/** First spotify/soundcloud link found on a set, for hydrating the link field. */
function setLink(s: DetailSet): string {
  const links = s.artists?.[0]?.links;
  return links?.spotify || links?.soundcloud || s.linkUrl || '';
}

/**
 * The artists to send for a set. Artist 1 carries the set's single Link field:
 * a changed link replaces its spotify/soundcloud link, because the server ignores
 * linkUrl whenever artists[] is sent. Empty means "send only the typed name".
 */
function artistsPayload(s: SetRow): { name: string; links: Record<string, string> }[] {
  return s.artists.map((a, i) => {
    const links = { ...(a.links ?? {}) };
    if (i === 0) {
      const link = s.linkUrl.trim();
      if (link !== (links.spotify || links.soundcloud || '')) {
        delete links.spotify;
        delete links.soundcloud;
        if (link) links.spotify = link;
      }
    }
    return { name: a.name, links };
  });
}

export default function FestivalEditScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id, created } = useLocalSearchParams<{ id?: string; created?: string }>();
  const editingId = typeof id === 'string' && id.length > 0 ? id : null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!!editingId);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'delete' | 'backfill' | null>(null);
  const [busy, setBusy] = useState(false);
  // Artist inputs per set, keyed `${dayId}:${setId}`. Drafts keep blank inputs the
  // saved artists[] drops; origins keep the artists loaded with the set so each
  // input index keeps its own links and photo.
  const [artistDrafts, setArtistDrafts] = useState<Record<string, string[]>>({});
  const artistOrigins = useRef<Record<string, Artist[]>>({});
  const [notifyPickers, setNotifyPickers] = useState(true);
  // Dirty flag: flipped by user edit handlers only (never by the initial load
  // hydration below), so Cancel can tell an untouched form from one with
  // unsaved edits. Simplest honest signal — no deep compare.
  const [touched, setTouched] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Festival version the form was loaded from; sent back as expectedUpdatedAt.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Set when the server says the save would remove picked sets; holds what to re-send.
  const [pendingRemoval, setPendingRemoval] = useState<{
    summary: RemovalSummary;
    payload: Record<string, unknown>;
  } | null>(null);
  // What the server last returned: the loaded form (for change counts), the status line and the checklist.
  const [original, setOriginal] = useState<FormState | null>(null);
  const [meta, setMeta] = useState<{ publishedAt: string | null; updatedAt?: string; updatedByUsername: string | null } | null>(
    null,
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [issues, setIssues] = useState<FestivalIssue[]>(NO_ISSUES);
  const [banner, setBanner] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [shiftDayId, setShiftDayId] = useState<string | null>(null);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const { askPassword: askReauthPassword, reauthDialog } = useReauthPrompt();
  const updateForm = useCallback((updater: (f: FormState) => FormState) => {
    setTouched(true);
    setForm(updater);
  }, []);

  const changes = useMemo(() => countFestivalChanges(original, form), [original, form]);
  const issuesByKey = useMemo(() => groupIssues(issues), [issues]);

  // Messages the server attached to one field of the stage, set or festival at `key`.
  const fieldIssues = (key: string, fields: string[]): string | null => {
    const messages = issues
      .filter((i) => issueKey(i.target) === key && i.target.field && fields.includes(i.target.field))
      .map((i) => i.message);
    return messages.length ? messages.join(' ') : null;
  };
  const stageKeys = (stage: StageRow, index: number) => [`stage:${stage.id}`, `stage#${index}`];
  const setKeys = (s: SetRow, dayIndex: number, setIndex: number) => [`set:${s.id}`, `set#${dayIndex}#${setIndex}`];
  const fieldIssuesOf = (keys: string[], fields: string[]): string | null => {
    for (const k of keys) {
      const found = fieldIssues(k, fields);
      if (found) return found;
    }
    return null;
  };

  // ── Load (edit only) ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!editingId) return;
    setLoadError(false);
    try {
      const full = (await fetchAdminFestival(editingId)) as unknown as FestivalDetail;
      const stages: StageRow[] = (full.stages || []).map((s) => ({
        id: s.id || uid('stage'),
        name: s.name || '',
        color: s.color || DEFAULT_STAGE_COLOR,
        latitude: typeof s.latitude === 'number' ? s.latitude : null,
        longitude: typeof s.longitude === 'number' ? s.longitude : null,
      }));
      const days: DayRow[] = (full.days || []).map((d) => ({
        id: d.id || uid('day'),
        label: d.label || '',
        date: d.date || '',
        sets: (d.sets || []).map((s) => ({
          id: s.id || uid('set'),
          artist: s.artist || s.artists?.[0]?.name || '',
          stageId: s.stageId || '',
          startTime: s.startTime || '',
          endTime: s.endTime || '',
          linkUrl: setLink(s),
          artists: (s.artists ?? []).flatMap((a) => (a.name ? [{ ...a, name: a.name }] : [])),
        })),
      }));
      const loaded = sortFormSets({
        name: full.name || '',
        location: full.location || '',
        timeZone: full.timeZone || '',
        b2bSeparator: full.b2bSeparator || 'b2b',
        stages,
        days,
        mapConfig: full.mapConfig ?? null,
      });
      setForm(loaded);
      setOriginal(loaded);
      setMeta({
        publishedAt: full.publishedAt ?? null,
        updatedAt: full.updatedAt,
        updatedByUsername: full.updatedByUsername ?? null,
      });
      setChecklist(full.checklist ?? []);
      setIssues(NO_ISSUES);
      setUpdatedAt(full.updatedAt ?? null);
      setArtistDrafts({});
      artistOrigins.current = {};
      // Long lineups scroll forever: open only a single day, the admin opens the rest.
      setExpandedDays(new Set(days.length === 1 ? [days[0]!.id] : []));
    } catch {
      setLoadError(true);
    }
  }, [editingId]);

  useEffect(() => {
    if (!isAdmin || !editingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins and the create path have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, editingId, load]);

  // Coming back from the map editor, pick up the pins it saved. Skipped while the
  // form has unsaved edits (reloading would discard them) and on first mount.
  const touchedRef = useRef(touched);
  useEffect(() => {
    touchedRef.current = touched;
  }, [touched]);
  const seenFirstFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seenFirstFocus.current) {
        seenFirstFocus.current = true;
        return;
      }
      if (isAdmin && editingId && !touchedRef.current) void load();
    }, [isAdmin, editingId, load]),
  );

  // ── Navigation ────────────────────────────────────────────────────────────
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  }, [router]);

  // Open the dedicated map editor for this festival. The map screen loads the
  // festival by id and persists stage pins + amenities itself, so geo authoring
  // is fully owned there (this text-form screen never needs the map). Edit-only.
  const goToMapEditor = useCallback(() => {
    if (!editingId) return;
    if (touched) {
      setFormError('Save your changes before you edit the map.');
      return;
    }
    router.push({ pathname: '/admin/festival-map', params: { id: editingId } });
  }, [router, editingId, touched]);

  // ── Stage editing ─────────────────────────────────────────────────────────
  const addStage = () =>
    updateForm((f) =>
      addStageReducer(f, { id: uid('stage'), name: '', color: DEFAULT_STAGE_COLOR, latitude: null, longitude: null }),
    );
  const removeStage = (stageId: string) => updateForm((f) => removeStageReducer(f, stageId));
  const setStageField = (stageId: string, field: 'name' | 'color', value: string) =>
    updateForm((f) => setStageFieldReducer(f, stageId, field, value));

  // ── Day editing ───────────────────────────────────────────────────────────
  const addDay = () => {
    const day: DayRow = { id: uid('day'), label: '', date: '', sets: [] };
    updateForm((f) => addDayReducer(f, day));
    setExpandedDays((prev) => new Set(prev).add(day.id));
  };
  const removeDay = (dayId: string) => updateForm((f) => removeDayReducer(f, dayId));
  const setDayField = (dayId: string, field: 'label' | 'date', value: string) =>
    updateForm((f) => setDayFieldReducer(f, dayId, field, value));
  const toggleDay = (dayId: string) => setExpandedDays((prev) => toggleDayReducer(prev, dayId));

  // ── Set editing (nested under each day) ───────────────────────────────────
  const addSet = (dayId: string) =>
    updateForm((f) =>
      prependSetReducer(f, dayId, {
        id: uid('set'),
        artist: '',
        stageId: f.stages[0]?.id || '',
        startTime: '',
        endTime: '',
        linkUrl: '',
        artists: [],
      }),
    );
  const removeSet = (dayId: string, setId: string) => updateForm((f) => removeSetReducer(f, dayId, setId));
  const setSetField = (dayId: string, setId: string, field: keyof SetRow, value: string) =>
    updateForm((f) => setSetFieldReducer(f, dayId, setId, field, value));

  // removedAt splices the origin too, so later artists keep their own links and photo.
  const editArtistNames = (dayId: string, s: SetRow, names: string[], removedAt?: number) => {
    const key = `${dayId}:${s.id}`;
    artistOrigins.current[key] ??= s.artists;
    if (removedAt !== undefined) artistOrigins.current[key] = withoutIndex(artistOrigins.current[key], removedAt);
    setArtistDrafts((prev) => ({ ...prev, [key]: names }));
    updateForm((f) => setSetArtistNamesReducer(f, dayId, s.id, artistOrigins.current[key], names));
  };

  const artistInputs = (dayId: string, s: SetRow, artistError: string | null) => {
    const names = artistDrafts[`${dayId}:${s.id}`] ?? artistNamesOf(s);
    return (
      <>
        {names.map((name, i) => (
          <View key={i}>
            <LabeledTextInput
              label={i === 0 ? 'Artist' : `B2B artist ${i + 1}`}
              value={name}
              onChangeText={(v) => editArtistNames(dayId, s, names.map((n, j) => (j === i ? v : n)))}
              placeholder="Artist name"
              autoCapitalize="words"
              error={i === 0 ? artistError : null}
            />
            {i > 0 ? (
              <TouchableOpacity
                onPress={() =>
                  editArtistNames(
                    dayId,
                    s,
                    names.filter((_, j) => j !== i),
                    i,
                  )
                }
                style={styles.removeBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${name || 'artist'}`}
              >
                <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {names.length < MAX_ARTISTS_PER_SET ? (
          <TouchableOpacity
            onPress={() => editArtistNames(dayId, s, [...names, ''])}
            style={styles.addBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add B2B artist"
          >
            <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
            <Text style={styles.addBtnText}>Add B2B artist</Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  // Stage options for the per-set ModalSelect.
  const stageOptions: SelectOption[] = form.stages.map((s) => ({
    label: s.name || 'Untitled stage',
    value: s.id,
  }));

  // Timezone options — merge the festival's current custom zone in if off-list.
  const timeZoneOptions: SelectOption[] = listTimeZones(form.timeZone).map((tz) => ({
    label: tz,
    value: tz,
  }));

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Festival name is required.');
      return;
    }
    if (!form.location.trim()) {
      setFormError('Location is required.');
      return;
    }
    if (!form.timeZone) {
      setFormError("Choose the festival's time zone. Set times, countdowns and reminders use it.");
      return;
    }
    // Block obviously-malformed dates/times before hitting the server (the
    // fields show inline errors too; this is the gate before the write fires).
    const badDate = form.days.map((d) => d.date).some((d) => d.trim() !== '' && !isValidDate(d));
    if (badDate) {
      setFormError('One or more dates are invalid. Use YYYY-MM-DD.');
      return;
    }
    const badTime = form.days
      .flatMap((d) => d.sets)
      .flatMap((s) => [s.startTime, s.endTime])
      .some((tm) => tm.trim() !== '' && tm.trim().toLowerCase() !== 'tba' && !isValidTime(tm));
    if (badTime) {
      setFormError('One or more set times are invalid. Use HH:MM (24h) or leave blank.');
      return;
    }

    // Build the SAME payload shape the web form posts: stages[] + days[].sets[].
    // Empty/"TBA" times normalize to '' (the schema accepts an empty literal).
    const normTime = (v: string) => {
      const x = v.trim();
      return x === '' || x.toLowerCase() === 'tba' ? '' : x;
    };
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      location: form.location.trim(),
      timeZone: form.timeZone ? form.timeZone : null,
      b2bSeparator: form.b2bSeparator.trim() || 'b2b',
      // Preserve stage pin coords (authored in the map editor) so saving the
      // text fields here never silently drops a stage's location. null when
      // unpinned (Phase A contract: per-stage latitude/longitude).
      stages: form.stages.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        color: s.color,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      // Round-trip the festival map-config (amenities/center/etc, authored in the
      // map editor). Sending the loaded value back keeps it on save; explicit
      // null clears it (Phase A: omit=keep, null=clear, object=replace).
      mapConfig: form.mapConfig,
      days: form.days.map((d) => ({
        id: d.id,
        label: d.label.trim(),
        date: d.date.trim(),
        sets: d.sets.map((s) => ({
          id: s.id,
          artist: s.artists.length
            ? joinArtistNames(
                s.artists.map((a) => a.name),
                form.b2bSeparator,
              )
            : s.artist.trim(),
          ...(s.artists.length ? { artists: artistsPayload(s) } : {}),
          stageId: s.stageId || null,
          startTime: normTime(s.startTime),
          endTime: normTime(s.endTime),
          linkUrl: s.linkUrl.trim() || null,
        })),
      })),
    };

    if (editingId && updatedAt) payload.expectedUpdatedAt = updatedAt;
    await send(payload, false);
  };

  // Posts the built payload. `confirmRemovals` is set only after the admin accepted
  // the removal summary, and that path needs a recent password check.
  const send = async (payload: Record<string, unknown>, confirmRemovals: boolean) => {
    const savedChanges = changes.total;
    setSaving(true);
    setIssues(NO_ISSUES);
    try {
      if (editingId) {
        const body = { ...payload, notify: notifyPickers, ...(confirmRemovals ? { confirmRemovals: true } : {}) };
        const run = () =>
          api.put<{ scheduleNotice?: ScheduleNotice } | undefined>(`/admin/festivals/${editingId}`, body);
        const res = confirmRemovals ? await withReauth(run, askReauthPassword) : await run();
        if (confirmRemovals && res === null) return; // password prompt cancelled
        // The screen closes on save and has no inline success message, so every save confirms in an alert.
        if (res?.scheduleNotice) Alert.alert(describeScheduleNotice(res.scheduleNotice));
      } else {
        const createdFestival = await api.post<{ id: string }>('/admin/festivals', payload);
        setTouched(false);
        router.replace({ pathname: '/admin/festival-edit', params: { id: createdFestival.id, created: '1' } });
        return;
      }
      setTouched(false);
      await load();
      setBanner(`Saved ${plural(savedChanges)}.`);
    } catch (err: unknown) {
      const summary = removalFromError(err);
      if (summary) {
        setPendingRemoval({ summary, payload });
      } else {
        const found = issuesFromError(err);
        setIssues(found);
        if (found.length) {
          setExpandedDays((prev) => {
            const next = new Set(prev);
            for (const issue of found) {
              const day = issue.target.dayIndex === undefined ? undefined : form.days[issue.target.dayIndex];
              if (day) next.add(day.id);
            }
            return next;
          });
          setFormError('Fix the highlighted problems, then save again.');
        } else {
          setFormError(err instanceof Error ? err.message : "Couldn't save festival. Try again.");
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Publish ───────────────────────────────────────────────────────────────
  const doPublish = async () => {
    if (!editingId) return;
    setConfirmPublish(false);
    setBusy(true);
    setFormError(null);
    try {
      await publishFestival(editingId);
      await load();
      setBanner(`${form.name} is live.`);
    } catch (err: unknown) {
      const blocked = checklistFromError(err);
      if (blocked) setChecklist(blocked);
      setFormError(err instanceof Error ? err.message : "Couldn't publish festival. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // ── Shift times ───────────────────────────────────────────────────────────
  const doShift = (dayId: string, opts: { stageId: string; fromTime: string; minutes: number }) => {
    setShiftDayId(null);
    const day = form.days.find((d) => d.id === dayId);
    if (!day) return;
    const ids = pickShiftTargets(day.sets, { stageId: opts.stageId || undefined, fromTime: opts.fromTime || undefined });
    if (ids.length === 0) {
      setBanner('No sets with a time match that stage and start.');
      return;
    }
    const shifted = shiftDaySets(form, dayId, ids, opts.minutes);
    updateForm(() => shifted.form);
    setBanner(describeShiftResult(shifted.result, opts.minutes));
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const openDelete = () => {
    if (!editingId) return;
    setImpact(null);
    setConfirm('delete');
    // No counts is fine: the dialog falls back to copy that does not need them.
    fetchDeleteImpact(editingId).then(setImpact, () => setImpact(null));
  };

  const doDelete = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      setConfirm(null);
      const done = await withReauth(async () => {
        await api.delete<void>(`/admin/festivals/${editingId}`);
        return true;
      }, askReauthPassword);
      if (done) goBack();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't delete festival. Try again.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  // ── Backfill Spotify ──────────────────────────────────────────────────────
  const doBackfill = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await api.post<void>(`/admin/festivals/${editingId}/backfill-spotify`);
      setConfirm(null);
      // Re-load so freshly-attached links hydrate the set rows.
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't backfill Spotify links. Try again.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const headerTitle = editingId ? 'Edit festival' : 'Create festival';
  const status = festivalStatusLine(meta ?? {});
  const bannerText = banner ?? (created === '1' ? 'Festival created as a draft. Only admins can see it.' : null);
  const dirty = touched || changes.total > 0;
  const canPublish = !busy && !dirty && !isPublishBlocked(checklist);
  const publishHint = dirty ? 'Save your changes first.' : isPublishBlocked(checklist) ? 'Finish the open items first.' : null;
  const warnings = checklist.filter((c) => c.status === 'warn').map((c) => c.label);
  const publishMessage =
    "Everyone can find this festival and join it. You can't turn it back into a draft." +
    (warnings.length ? ` Warnings: ${warnings.join(' ')}` : '');
  const saveLabel = !editingId
    ? 'Create festival'
    : changes.total === 0
      ? 'No changes'
      : `Save ${plural(changes.total)}`;

  // Tapping a line in the "Fix these" card opens the day it points at.
  const openIssueDay = (issue: FestivalIssue) => {
    const day = issue.target.dayIndex === undefined ? undefined : form.days[issue.target.dayIndex];
    if (day) setExpandedDays((prev) => new Set(prev).add(day.id));
  };

  // Non-admins never reach the editor (AuthGate also blocks the route).
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <LoadingState label="Loading festival" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load festival"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[8], insets.bottom + t.spacing[6]) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {bannerText ? (
            <Text style={styles.banner} accessibilityLiveRegion="polite">
              {bannerText}
            </Text>
          ) : null}

          {/* Status + publish checklist (edit only) */}
          {editingId && meta ? (
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <View style={[styles.chip, status.state === 'draft' ? styles.chipDraft : styles.chipLive]}>
                  <Text style={[styles.chipText, status.state === 'draft' ? styles.chipTextDraft : styles.chipTextLive]}>
                    {status.chip}
                  </Text>
                </View>
                {status.edited ? <Text style={styles.statusEdited}>{status.edited}</Text> : null}
              </View>
              {status.state === 'draft' ? (
                <>
                  <Text style={styles.emptyHint}>This festival is a draft. Only admins can see it.</Text>
                  <View>
                    <Text style={styles.checklistTitle} accessibilityRole="header">
                      Before you publish
                    </Text>
                    <Text style={styles.emptyHint}>Based on the last save.</Text>
                  </View>
                  {checklist.map((item) => (
                    <View key={item.key} style={styles.checkRow}>
                      <Ionicons
                        name={item.status === 'done' ? 'checkmark-circle' : item.status === 'todo' ? 'close-circle' : 'warning'}
                        size={t.iconSize.md}
                        color={
                          item.status === 'done'
                            ? t.colors.accent.aqua
                            : item.status === 'todo'
                              ? t.colors.accent.coral
                              : t.colors.accent.amber
                        }
                      />
                      <Text style={styles.checkText} accessibilityLabel={`${CHECK_PREFIX[item.status]}: ${item.label}`}>
                        {item.label}
                      </Text>
                      {item.key === 'sets' && item.status !== 'done' ? (
                        <TouchableOpacity
                          onPress={() => router.push({ pathname: '/admin/lineup-import', params: { id: editingId } })}
                          style={styles.locationBtn}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Import lineup"
                        >
                          <Text style={styles.locationBtnText}>Import lineup</Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.key === 'pins' && item.status === 'warn' ? (
                        <TouchableOpacity
                          onPress={goToMapEditor}
                          style={styles.locationBtn}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Edit map"
                        >
                          <Text style={styles.locationBtnText}>Edit map</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={() => setConfirmPublish(true)}
                    style={[styles.actionBtn, styles.saveBtn, !canPublish && styles.btnDisabled]}
                    activeOpacity={0.7}
                    disabled={!canPublish}
                    accessibilityRole="button"
                    accessibilityLabel="Publish festival"
                    accessibilityState={{ disabled: !canPublish }}
                  >
                    <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
                      Publish festival
                    </Text>
                  </TouchableOpacity>
                  {publishHint ? <Text style={styles.emptyHint}>{publishHint}</Text> : null}
                </>
              ) : null}
            </View>
          ) : null}

          {/* Festival fields */}
          <SectionLabel>Festival</SectionLabel>
          <View style={styles.card}>
            <LabeledTextInput
              label="Name"
              value={form.name}
              onChangeText={(v) => updateForm((f) => ({ ...f, name: v }))}
              placeholder="Festival name"
              autoCapitalize="words"
              error={fieldIssues('festival:name', ['name'])}
            />
            <LabeledTextInput
              label="Location"
              value={form.location}
              onChangeText={(v) => updateForm((f) => ({ ...f, location: v }))}
              placeholder="City, venue"
              autoCapitalize="words"
            />
            <ModalSelect
              label="Time zone"
              value={form.timeZone}
              options={timeZoneOptions}
              onSelect={(v) => updateForm((f) => ({ ...f, timeZone: v }))}
              placeholder="Choose a time zone…"
              searchable
              hint="Set times, countdowns and reminders use this zone."
            />
            <LabeledTextInput
              label="B2B separator"
              value={form.b2bSeparator}
              onChangeText={(v) => updateForm((f) => ({ ...f, b2bSeparator: v }))}
              placeholder="b2b"
              autoCapitalize="none"
              maxLength={10}
              hint="Joins B2B artist names, for example b2b, vs or &. Up to 10 characters."
            />
          </View>

          {/* Stages */}
          <SectionLabel>Stages</SectionLabel>
          <View style={styles.card}>
            {form.stages.length === 0 ? (
              <Text style={styles.emptyHint}>No stages yet. Add one below.</Text>
            ) : (
              form.stages.map((stage, stageIndex) => (
                <View
                  key={stage.id}
                  style={[styles.stageBlock, stageKeys(stage, stageIndex).some((k) => issuesByKey.has(k)) && styles.blockError]}
                >
                  <View style={styles.stageHeader}>
                    <Text style={styles.stageHeaderText}>Stage</Text>
                    <TouchableOpacity
                      onPress={() => removeStage(stage.id)}
                      style={styles.removeBtn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${stage.name || 'stage'}`}
                    >
                      <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                  <LabeledTextInput
                    label="Name"
                    value={stage.name}
                    onChangeText={(v) => setStageField(stage.id, 'name', v)}
                    placeholder="Main Stage"
                    autoCapitalize="words"
                    error={fieldIssuesOf(stageKeys(stage, stageIndex), ['name'])}
                  />
                  <HexColorField
                    label="Color"
                    value={stage.color}
                    onChangeText={(v) => setStageField(stage.id, 'color', v)}
                  />
                  {/* Pin status. Locations are AUTHORED on the map editor (it has
                      the actual map); here we only surface whether this stage is
                      pinned and link across to set/move it. */}
                  <View style={styles.locationRow}>
                    <Ionicons
                      name={stageIsPinned(stage) ? 'location' : 'location-outline'}
                      size={t.iconSize.sm}
                      color={stageIsPinned(stage) ? t.colors.accent.aqua : t.colors.text.muted}
                    />
                    <Text style={styles.locationText} numberOfLines={1}>
                      {stageIsPinned(stage)
                        ? `Pinned · ${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}`
                        : 'No location pinned'}
                    </Text>
                    {editingId ? (
                      <TouchableOpacity
                        onPress={goToMapEditor}
                        style={styles.locationBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Set location for ${stage.name || 'stage'} on the map`}
                      >
                        <Text style={styles.locationBtnText}>
                          {stageIsPinned(stage) ? 'Move' : 'Set location'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))
            )}
            <TouchableOpacity
              onPress={addStage}
              style={styles.addBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add stage"
            >
              <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <Text style={styles.addBtnText}>Add stage</Text>
            </TouchableOpacity>
            {/* Map editor link (edit only — the map screen loads the festival by
                id and persists stage pins + amenities itself). */}
            {editingId ? (
              <TouchableOpacity
                onPress={goToMapEditor}
                style={styles.toolBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Edit festival map"
              >
                <Ionicons name="map-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                <Text style={styles.toolBtnText}>
                  Edit map{amenityCount(form.mapConfig) > 0 ? ` · ${amenityCount(form.mapConfig)} amenities` : ''}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Days & Artists */}
          <SectionLabel>Days &amp; artists</SectionLabel>
          <View style={styles.card}>
            <LabeledTextInput
              label="Filter"
              value={filter}
              onChangeText={setFilter}
              placeholder="Artist or stage"
              autoCapitalize="none"
            />
            {form.days.length === 0 ? (
              <Text style={styles.emptyHint}>No days yet. Add one below.</Text>
            ) : (
              form.days.map((day, dayIndex) => {
                const visibleSets = filterLineup(day.sets, form.stages, filter);
                const isExpanded = expandedDays.has(day.id) || (filter.trim() !== '' && visibleSets.length > 0);
                return (
                  <View key={day.id} style={styles.dayBlock}>
                    <View style={styles.dayHeader}>
                      <TouchableOpacity
                        onPress={() => toggleDay(day.id)}
                        style={styles.chevronBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={isExpanded ? 'Collapse day' : 'Expand day'}
                        accessibilityState={{ expanded: isExpanded }}
                      >
                        <Ionicons
                          name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                          size={t.iconSize.md}
                          color={t.colors.text.secondary}
                        />
                      </TouchableOpacity>
                      <Text style={styles.dayTitle} numberOfLines={1}>
                        {day.label || 'Untitled day'}
                      </Text>
                      <Text style={styles.dayCount}>
                        {day.sets.length} {day.sets.length === 1 ? 'artist' : 'artists'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => removeDay(day.id)}
                        style={styles.removeBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${day.label || 'day'}`}
                      >
                        <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      </TouchableOpacity>
                    </View>

                    {isExpanded ? (
                      <View style={styles.dayBody}>
                        <LabeledTextInput
                          label="Label"
                          value={day.label}
                          onChangeText={(v) => setDayField(day.id, 'label', v)}
                          placeholder="Day 1 / Friday"
                          autoCapitalize="words"
                        />
                        <DateField
                          label="Date"
                          value={day.date}
                          onChangeText={(v) => setDayField(day.id, 'date', v)}
                        />

                        {day.sets.length === 0 ? (
                          <Text style={styles.emptyHint}>No artists yet. Add one below.</Text>
                        ) : visibleSets.length === 0 ? (
                          <Text style={styles.emptyHint}>No sets match &quot;{filter.trim()}&quot;.</Text>
                        ) : (
                          visibleSets.map((s) => {
                            const keys = setKeys(s, dayIndex, day.sets.indexOf(s));
                            const isNew = changes.newSetIds.has(s.id);
                            const isChanged = changes.changedSetIds.has(s.id);
                            const stageError = fieldIssuesOf(keys, ['stageId']);
                            const timeError = fieldIssuesOf(keys, ['startTime', 'endTime']);
                            return (
                            <View
                              key={s.id}
                              style={[
                                styles.setBlock,
                                (isNew || isChanged) && styles.setBlockChanged,
                                keys.some((k) => issuesByKey.has(k)) && styles.blockError,
                              ]}
                            >
                              <View style={styles.setHeader}>
                                <Text style={styles.setHeaderText}>
                                  Artist set
                                  {isNew || isChanged ? (
                                    <Text style={styles.changeCaption}>{isNew ? '  New' : '  Changed'}</Text>
                                  ) : null}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => removeSet(day.id, s.id)}
                                  style={styles.removeBtn}
                                  activeOpacity={0.7}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Remove ${s.artist || 'artist'}`}
                                >
                                  <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                                </TouchableOpacity>
                              </View>
                              {artistInputs(day.id, s, fieldIssuesOf(keys, ['artist']))}
                              <ModalSelect
                                label="Stage"
                                value={s.stageId || null}
                                options={stageOptions}
                                onSelect={(v) => setSetField(day.id, s.id, 'stageId', v)}
                                placeholder="— Stage —"
                              />
                              {stageError ? (
                                <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                                  {stageError}
                                </Text>
                              ) : null}
                              <View style={styles.datePair}>
                                <View style={styles.flex}>
                                  <TimeField
                                    label="Start"
                                    value={s.startTime}
                                    onChangeText={(v) => setSetField(day.id, s.id, 'startTime', v)}
                                    hint={
                                      startsAfterMidnight(s.startTime)
                                        ? `After midnight. Shows as part of ${day.label.trim() || "this day's"} night.`
                                        : undefined
                                    }
                                  />
                                </View>
                                <View style={styles.flex}>
                                  <TimeField
                                    label="End"
                                    value={s.endTime}
                                    onChangeText={(v) => setSetField(day.id, s.id, 'endTime', v)}
                                  />
                                </View>
                              </View>
                              {timeError ? (
                                <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                                  {timeError}
                                </Text>
                              ) : null}
                              <LabeledTextInput
                                label="Link (optional)"
                                value={s.linkUrl}
                                onChangeText={(v) => setSetField(day.id, s.id, 'linkUrl', v)}
                                placeholder="https://open.spotify.com/…"
                                autoCapitalize="none"
                                keyboardType="url"
                                hint="Spotify or SoundCloud URL."
                              />
                            </View>
                            );
                          })
                        )}
                        <TouchableOpacity
                          onPress={() => setShiftDayId(day.id)}
                          style={styles.toolBtn}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Shift times for ${day.label || 'this day'}`}
                        >
                          <Ionicons name="time-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                          <Text style={styles.toolBtnText}>Shift times</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => addSet(day.id)}
                          style={styles.addBtn}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Add artist"
                        >
                          <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
                          <Text style={styles.addBtnText}>Add artist</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
            <TouchableOpacity
              onPress={addDay}
              style={styles.addBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add day"
            >
              <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <Text style={styles.addBtnText}>Add day</Text>
            </TouchableOpacity>
          </View>

          {/* Spotify backfill (edit only) */}
          {editingId ? (
            <>
              <SectionLabel>Tools</SectionLabel>
              <View style={styles.card}>
                <TouchableOpacity
                  onPress={() => setConfirm('backfill')}
                  style={styles.toolBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Backfill Spotify links"
                >
                  <Ionicons name="musical-notes-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                  <Text style={styles.toolBtnText}>Backfill Spotify</Text>
                </TouchableOpacity>
                <Text style={styles.emptyHint}>
                  Auto-searches Spotify for each artist and attaches a link where one is found.
                </Text>
              </View>
            </>
          ) : null}

          {issues.length > 0 ? (
            <View style={[styles.card, styles.blockError]}>
              <Text style={styles.checklistTitle} accessibilityRole="header">
                Fix these before saving
              </Text>
              {issues.map((issue, i) => (
                <TouchableOpacity
                  key={`${issue.code}-${i}`}
                  onPress={() => openIssueDay(issue)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={issue.message}
                >
                  <Text style={styles.fieldError}>{issue.message}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {/* Form error */}
          {formError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          {editingId ? (
            <View style={styles.notifyRow}>
              <View style={styles.notifyBody}>
                <Text style={styles.notifyTitle}>Tell people whose picks changed</Text>
                <Text style={styles.notifyHint}>Sends one alert to each person who picked a set you moved or removed.</Text>
              </View>
              <Switch
                value={notifyPickers}
                onValueChange={setNotifyPickers}
                trackColor={{ false: t.colors.text.muted, true: t.colors.accent.aqua }}
                ios_backgroundColor={t.colors.text.muted}
                thumbColor={t.colors.text.onAccent}
                accessibilityLabel="Tell people whose picks changed"
                accessibilityState={{ checked: notifyPickers }}
              />
            </View>
          ) : null}

          {/* Primary actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => (touched ? setShowCancelConfirm(true) : goBack())}
              style={[styles.actionBtn, styles.cancelBtn]}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleSave()}
              style={[styles.actionBtn, styles.saveBtn, (saving || (!!editingId && changes.total === 0)) && styles.btnDisabled]}
              activeOpacity={0.7}
              disabled={saving || (!!editingId && changes.total === 0)}
              accessibilityRole="button"
              accessibilityLabel={saveLabel}
            >
              <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
                {saving ? 'Saving…' : saveLabel}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Destructive: delete (edit only) */}
          {editingId ? (
            <TouchableOpacity
              onPress={openDelete}
              style={styles.deleteBtn}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Delete festival"
            >
              <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
              <Text style={styles.deleteBtnText}>Delete festival</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirm === 'delete' && !busy}
        title={`Delete ${form.name.trim() || 'this festival'}?`}
        message={describeDeleteImpact(impact)}
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        destructive
        onConfirm={() => void doDelete()}
        onCancel={() => !busy && setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'backfill' && !busy}
        title="Backfill Spotify links?"
        message="Searches Spotify for every artist in this festival and attaches a link where a confident match is found. Existing links are preserved."
        confirmLabel={busy ? 'Working…' : 'Backfill'}
        destructive
        onConfirm={() => void doBackfill()}
        onCancel={() => !busy && setConfirm(null)}
      />
      <ConfirmDialog
        visible={pendingRemoval !== null}
        title="Remove sets with picks?"
        message={pendingRemoval ? describeRemovals(pendingRemoval.summary) : ''}
        confirmLabel="Remove and save"
        destructive
        onConfirm={() => {
          const pending = pendingRemoval;
          setPendingRemoval(null);
          if (pending) void send(pending.payload, true);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
      <ConfirmDialog
        visible={confirmPublish}
        title={`Publish ${form.name.trim() || 'this festival'}?`}
        message={publishMessage}
        confirmLabel="Publish"
        onConfirm={() => void doPublish()}
        onCancel={() => setConfirmPublish(false)}
      />
      <ShiftTimesDialog
        visible={shiftDayId !== null}
        stages={stageOptions}
        onCancel={() => setShiftDayId(null)}
        onConfirm={(opts) => shiftDayId && doShift(shiftDayId, opts)}
      />
      {reauthDialog}
      <ConfirmDialog
        visible={showCancelConfirm}
        title="Discard changes?"
        message="You have unsaved edits. Leaving now discards them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setShowCancelConfirm(false);
          goBack();
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[4],
  },
  datePair: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Stages -------------------------------------------------------------------
  stageBlock: {
    gap: t.spacing[3],
    paddingBottom: t.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  locationText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  locationBtn: {
    minHeight: 36,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  // Days ---------------------------------------------------------------------
  dayBlock: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 56,
  },
  chevronBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  dayCount: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  dayBody: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    padding: t.spacing[3],
    gap: t.spacing[4],
  },
  // Sets ---------------------------------------------------------------------
  setBlock: {
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  setBlockChanged: {
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent.aqua,
  },
  blockError: {
    borderColor: t.colors.accent.coral,
  },
  changeCaption: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  fieldError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  // Status card --------------------------------------------------------------
  banner: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[1],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
  },
  chipDraft: {
    borderColor: t.colors.accent.amber,
  },
  chipLive: {
    borderColor: t.colors.accent.aqua,
  },
  chipText: {
    ...typeStyle('caption', 600),
  },
  chipTextDraft: {
    color: t.colors.accent.amber,
  },
  chipTextLive: {
    color: t.colors.accent.aqua,
  },
  statusEdited: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  checklistTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  checkText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flex: 1,
    minWidth: 160,
  },
  // Buttons ------------------------------------------------------------------
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  addBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[2],
    justifyContent: 'center',
  },
  removeBtnText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.primary,
  },
  toolBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  // Actions ------------------------------------------------------------------
  formError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[1],
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[1],
  },
  notifyBody: {
    flex: 1,
  },
  notifyTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  notifyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
  },
  cancelBtn: {
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  saveBtn: {
    backgroundColor: t.colors.accent.aqua,
  },
  saveBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    marginTop: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
  },
  deleteBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.coral,
  },
}));
