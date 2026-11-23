import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@festie/shared';
import { ApiClientError, mapErrorToUserMessage } from '@festie/shared/services/api';
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
  type FestivalScope,
} from '@festie/shared/services/festivalAdmin';
import {
  clearEditBackup,
  createManageFestival,
  describeAlertConfirm,
  describeStaleSave,
  loadEditBackup,
  saveEditBackup,
  type ManageOrganization,
} from '@festie/shared/services/organizer';
import { describeVersionDifferences } from '@festie/shared/utils/festivalAdmin';
import { getLineupInterest, getSetEngagement, type LineupInterestCounts, type SetEngagementMap } from '@festie/shared/services';
import {
  updateAdminFestival,
  createAdminFestival,
  deleteAdminFestival,
  type AdminFestivalDetail,
  type ArchivedFestival,
} from '@festie/shared/services/festivalAdmin';
import type { EditableFestival, FestivalIssue } from '@festie/shared/utils';
import {
  bulkConfirmCopy,
  countFestivalChanges,
  describeDeleteImpact,
  describeScheduleNotice,
  SELECTION_LIMIT_MESSAGE,
  sortLineup,
  summarizeBulkResults,
  toggleSelection,
  type ScheduleNotice,
} from '@festie/shared/utils';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import LineupImport from './LineupImport';
import FestivalEditForm, { Festival as FormFestival } from './FestivalEditForm';
import FestivalMapEditor from './FestivalMapEditor';
import FestivalStatusPanel, { FestivalMeta } from './FestivalStatusPanel';
import ManageFestivalList from '../manage/ManageFestivalList';
import { FestivalModeContext } from './festivalModeContext';
import AdminFestivalPreview from './AdminFestivalPreview';
import SelectionBar from './SelectionBar';
import AdminFestivalSubTabs, { type OpenView } from './AdminFestivalSubTabs';
import ArchivedFestivalRow from './ArchivedFestivalRow';
import FestivalListRow from './FestivalListRow';
import FestivalArtists from './FestivalArtists';
import FestivalAnnouncements from './FestivalAnnouncements';
import ManageInterest from '../manage/ManageInterest';
import { cn } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import { ArrowLeft, Plus, SearchX } from 'lucide-react';
import { useAdminSearch, type AdminSearch } from './useAdminSearch';
import { ADMIN_QUERY_OPTIONS, adminKeys, useAdminFestivals, useManageFestivals, useReviewQueue } from './adminQueries';
import type { Day } from './DayEditor';

type ListView = 'live' | 'archived';

const SEARCH_URL_DELAY_MS = 300;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/**
 * Festival management: CRUD, CSV import/export, lineup management.
 *
 * Hosts the list view, the new-festival form and the open-festival editor. Which one shows,
 * and the search text, live in the URL (`festival`, `view`, `q`), so refresh, Back and shared
 * links reopen the same view. The edit form itself (stages, days, per-set artist rows) is
 * split into FestivalEditForm → DayEditor → SetEditor.
 */
export interface AdminFestivalsProps {
  /**
   * `organizer` is the /manage page of an organization member (plan-v3 5.5): the same editor over the organizer
   * API, with the admin-only controls left out. Admins never pass it.
   */
  mode?: 'admin' | 'organizer';
  /** Organizer mode: the member's organizations from GET /manage/me. */
  organizations?: ManageOrganization[];
  /** Organizer mode: the organization a new festival starts in, when the member picked one in the switcher. */
  defaultOrgId?: string;
}

const NO_ORGANIZATIONS: ManageOrganization[] = [];
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';

export default function AdminFestivals({ mode = 'admin', organizations = NO_ORGANIZATIONS, defaultOrgId }: AdminFestivalsProps = {}) {
  const organizer = mode === 'organizer';
  const scope: FestivalScope = organizer ? 'manage' : 'admin';
  const [{ festival: festivalId, view: urlView, q, preview: previewId }, setAdminSearch] = useAdminSearch(
    organizer ? '/manage' : '/admin',
  );
  const queryClient = useQueryClient();
  const organizerPlatformOn = useAuthStore((state) => state.user?.organizerPlatform !== false);
  const festivalsQuery = useAdminFestivals(!organizer);
  const manageQuery = useManageFestivals(organizer);
  const waitingIds = new Set((useReviewQueue(!organizer && organizerPlatformOn).data?.requests ?? []).map((r) => r.festivalId));
  const festivals = festivalsQuery.data ?? [];
  const [archived, setArchived] = useState<ArchivedFestival[]>([]);
  const [listView, setListView] = useState<ListView>('live');
  const [notifyPickers, setNotifyPickers] = useState(true);
  const [formData, setFormData] = useState<Partial<FormFestival>>({});
  const [original, setOriginal] = useState<Partial<FormFestival> | null>(null);
  const [meta, setMeta] = useState<FestivalMeta>({});
  const [issues, setIssues] = useState<FestivalIssue[]>([]);
  const [saving, setSaving] = useState(false);
  // The save response is the only place the server reports a weak venue match; it is not stored.
  const [venueGuessedFor, setVenueGuessedFor] = useState<string | null>(null);
  // Bumped by Discard to remount the form: SetEditor keeps artist-name drafts in local state.
  const [discardCount, setDiscardCount] = useState(0);
  const [initialExpandedDays, setInitialExpandedDays] = useState<Set<string>>(new Set());
  // The box keeps what was typed (the URL value is trimmed); the URL follows after a pause.
  const [searchQuery, setSearchQuery] = useState(q ?? '');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; description: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // When set, the Artists panel takes over the panel for this festival.
  const [artistsTarget, setArtistsTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-set picks and reminders for the festival being edited.
  const [engagement, setEngagement] = useState<SetEngagementMap | undefined>(undefined);
  const [engagementError, setEngagementError] = useState(false);
  const [interestCounts, setInterestCounts] = useState<LineupInterestCounts | undefined>(undefined);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  // A verified organization confirms the head count before a save tells people their picks changed (plan-v3 6.2).
  const [pendingAlert, setPendingAlert] = useState<{ text: string } | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [selectionNote, setSelectionNote] = useState<string | undefined>();
  // The festival id whose saved data is in the form. Null means the form is not seeded yet.
  const [seededId, setSeededId] = useState<string | null>(null);
  // A navigation that waits one render so the unsaved-changes guard sees a clean form.
  const [pendingNav, setPendingNav] = useState<AdminSearch | null>(null);
  // Organizer mode: the organization a new festival goes to, and a banner that keeps the form on screen (409s).
  const [newOrgId, setNewOrgId] = useState('');
  // 'stale' (409) keeps the form and offers Show their version; 'restore' offers the edits kept on this device.
  const [banner, setBanner] = useState<{ kind: 'stale' | 'owner' | 'restore'; text: string } | null>(null);
  const [theirVersion, setTheirVersion] = useState<string[] | null>(null);
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();

  // What is on screen: the list, the new-festival form (`edit`, no id) or an open festival.
  const requestedView: OpenView | null = festivalId ? (urlView ?? 'edit') : urlView === 'edit' ? 'edit' : null;

  const detail = useQuery({
    queryKey: adminKeys.festival(festivalId ?? ''),
    queryFn: () => fetchAdminFestival(festivalId!, scope),
    enabled: !!festivalId,
    refetchOnMount: 'always',
    ...ADMIN_QUERY_OPTIONS,
  });

  // Organizer mode: the organization of the open festival (or of a new one) decides what the form allows.
  const eligibleOrgs = organizations.filter((o) => o.role === 'owner' && o.status !== 'suspended');
  const targetOrgId = newOrgId || eligibleOrgs.find((o) => o.id === defaultOrgId)?.id || eligibleOrgs[0]?.id || '';
  // The festival GET does not carry its organization, so an open festival takes it from the member's festival
  // list. With one organization there is no doubt.
  const openOrgId = manageQuery.data?.find((f) => f.id === festivalId)?.organizationId;
  const formOrg = organizer
    ? organizations.find((o) => o.id === (festivalId ? (openOrgId ?? (organizations.length === 1 ? organizations[0]?.id : undefined)) : targetOrgId))
    : undefined;
  // An open festival whose organization is not known yet shows no editor: the admin controls must never flash up.
  const orgUnknown = organizer && !!festivalId && !formOrg;
  const orgMissing = orgUnknown && !manageQuery.isPending;
  const orgRole = formOrg?.role;
  const verifiedOwner = organizer && orgRole === 'owner' && formOrg?.verified === true;
  // A verified organization's save alerts at once, so its members get the checkbox an admin has.
  const verifiedMember = organizer && formOrg?.verified === true;
  // A viewer, or a member of a suspended organization, reads only (plan-v3 5.5 and 5.6).
  const canWrite = !organizer || (orgRole !== 'viewer' && formOrg?.status !== 'suspended');
  const openView: OpenView | null = !canWrite && requestedView ? 'edit' : requestedView;
  const editing = openView === 'edit';

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
    // A new organizer festival starts in the browser's time zone (plan-v3 5.1 step 6).
    setFormData(organizer ? { timeZone: browserTimeZone() } : {});
    setOriginal(null);
    setMeta({});
    setIssues([]);
    setBanner(null);
    setInitialExpandedDays(new Set());
    setEngagement(undefined);
    setEngagementError(false);
    setInterestCounts(undefined);
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
    const {
      checklist,
      publishedAt,
      updatedByUsername,
      publishRequestedAt,
      publishReviewNote,
      ...full
    }: AdminFestivalDetail = detail.data;
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
    setMeta({
      publishedAt,
      updatedAt: full.updatedAt,
      updatedByUsername,
      checklist,
      publishRequestedAt,
      publishReviewNote,
      slug: full.slug,
    });
    setBanner(null);
    setIssues([]);
    setInitialExpandedDays(new Set(days.length === 1 && days[0] ? [days[0].id] : []));
    setEngagement(undefined);
    setEngagementError(false);
    // Pick counts load beside the festival; a failure only hides the counts. An organizer gets no counts until
    // the aggregate rules of plan-v3 section 4 exist, so nothing is requested.
    if (!organizer) getSetEngagement(festivalId).then(setEngagement, () => setEngagementError(true));
    // Marks are a published-festival feature. A failure only hides the column, so it needs no message.
    setInterestCounts(undefined);
    if (!organizer && publishedAt && Array.isArray(full.lineup) && full.lineup.length > 0) {
      getLineupInterest(festivalId).then((res) => setInterestCounts(res.counts), () => setInterestCounts(undefined));
    }
    setTheirVersion(null);
    const kept = organizer ? loadEditBackup(window.localStorage, festivalId) : null;
    if (kept) {
      const at = new Date(kept.savedAt);
      const when = Number.isNaN(at.getTime()) ? '' : ` from ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      setBanner({ kind: 'restore', text: `Your edits${when} were kept on this device when someone else saved first.` });
    }
    setSeededId(festivalId);
  }, [festivalId, editing, seededId, detail.data, detail.isFetching, organizer]);

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

  // The whole lineup can be large (JSON_LIMIT is 256 kb), so a save resends it only when it changed.
  // A PUT without `lineup` keeps the stored list.
  const festivalBody = () => {
    const { lineup, ...rest } = formData;
    const changed =
      countFestivalChanges({ lineup: original?.lineup } as EditableFestival, { lineup } as EditableFestival).total > 0;
    return changed ? { ...rest, lineup } : rest;
  };

  const handleSave = () => save();

  // `confirmed` is a verified organization's yes to the head count of the people the save would alert.
  const save = async (confirmed = false) => {
    if (!formData.name || !formData.location) {
      toast('Name and location are required', 'error');
      return;
    }
    if (!formData.timeZone) {
      toast("Choose the festival's time zone. Set times, countdowns and reminders use it.", 'error');
      return;
    }

    if (organizer && !festivalId && !targetOrgId) {
      toast('Choose the organization this festival belongs to.', 'error');
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      if (festivalId) {
        if (verifiedMember && notifyPickers && !confirmed) {
          const dry = await updateAdminFestival(
            festivalId,
            { ...festivalBody(), expectedUpdatedAt: formData.updatedAt, notify: true, dryRun: true },
            scope,
          );
          const notice = dry?.scheduleNotice;
          if (notice?.notified) {
            setPendingAlert({ text: describeAlertConfirm(notice.people, dry?.runsLeft) });
            return;
          }
        }
        const res = await updateAdminFestival(
          festivalId,
          {
            ...festivalBody(),
            expectedUpdatedAt: formData.updatedAt,
            // An unverified organization's alert is held for an admin, so the server needs the request to hold it.
            notify: organizer && !verifiedMember ? true : notifyPickers,
          },
          scope,
        );
        setVenueGuessedFor(res?.venueGuessed ? festivalId : null);
        clearEditBackup(window.localStorage, festivalId);
        await afterEditSave(res?.scheduleNotice);
      } else {
        const created = organizer
          ? await createManageFestival({ ...formData, organizationId: targetOrgId })
          : await createAdminFestival(formData);
        setVenueGuessedFor(created?.venueGuessed && created.id ? created.id : null);
        toast(
          organizer
            ? 'Festival created as a draft. Only your team and Festie can see it.'
            : 'Festival created as a draft. Only admins can see it.',
          'success',
        );
        await refreshAdmin();
        go(created?.id ? { tab: 'festivals', festival: created.id, view: 'edit' } : { tab: 'festivals' });
      }
    } catch (err: unknown) {
      // The form keeps its values: only a banner appears, and Reload is the member's choice (plan-v3 5.6, 5.9).
      if (organizer && festivalId && err instanceof ApiClientError && err.code === 'FESTIVAL_CHANGED') {
        // The edits go to local storage first, so a reload that reseeds the form cannot lose them (plan-v3 5.9).
        saveEditBackup(window.localStorage, festivalId, formData);
        setTheirVersion(null);
        setBanner({ kind: 'stale', text: describeStaleSave(err.details) });
        return;
      }
      const removal = removalFromError(err);
      if (removal && organizer && orgRole !== 'owner') {
        setBanner({
          kind: 'owner',
          text: `Attendees already picked these sets. An owner of ${formOrg?.name ?? 'your organization'} must confirm the removal.`,
        });
        return;
      }
      if (removal) {
        setPendingRemoval(describeRemovals(removal, notifyPickers));
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
        const res = await updateAdminFestival(
          festivalId,
          {
            ...festivalBody(),
            expectedUpdatedAt: formData.updatedAt,
            confirmRemovals: true,
            notify: organizer && !verifiedMember ? true : notifyPickers,
          },
          scope,
        );
        return { notice: res?.scheduleNotice };
      }, askPassword, { retryWrongPassword: true });
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

  const nameOf = (id: string) =>
    (organizer ? manageQuery.data : festivals)?.find((f) => f.id === id)?.name || 'this festival';

  const handleDelete = async (id: string) => {
    const name = nameOf(id);
    let description = describeDeleteImpact(null, scope);
    try {
      description = describeDeleteImpact(await fetchDeleteImpact(id, scope), scope);
    } catch (err: unknown) {
      console.warn('Could not load delete impact', err);
    }
    setConfirmDelete({ id, title: `Delete ${name}?`, description });
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    const name = nameOf(id);
    setDeleteBusy(true);
    try {
      const done = await withReauth(async () => {
        await deleteAdminFestival(id, scope);
        return true;
      }, askPassword, { retryWrongPassword: true });
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
      const done = await withReauth(() => bulkArchiveFestivals(ids), askPassword, { retryWrongPassword: true });
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

  if (previewId) return <AdminFestivalPreview festivalId={previewId} scope={scope} />;

  if (artistsTarget) {
    return (
      <FestivalArtists festivalId={artistsTarget.id} festivalName={artistsTarget.name} onClose={() => setArtistsTarget(null)} />
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
      {organizer ? 'Back to my festivals' : 'Back to festivals'}
    </button>
  );

  const savedName = detail.data?.name || formData.name || 'this festival';

  const reloadAfterNotice = () => {
    setBanner(null);
    void reloadEditor();
  };

  // What differs between the festival as saved now and the member's copy. It changes nothing.
  const showTheirVersion = async () => {
    if (!festivalId) return;
    try {
      const latest = await fetchAdminFestival(festivalId, scope);
      const lines = describeVersionDifferences(latest as unknown as EditableFestival, formData as EditableFestival);
      setTheirVersion(lines.length > 0 ? lines : ['Their version matches your copy.']);
    } catch (err: unknown) {
      toastError(err, "Couldn't load their version. Try again.");
    }
  };

  // Puts the kept edits back into the form, on top of the version that is saved now.
  const restoreEdits = () => {
    if (!festivalId) return;
    const kept = loadEditBackup(window.localStorage, festivalId);
    if (kept) setFormData((prev) => ({ ...(kept.form as Partial<FormFestival>), updatedAt: prev.updatedAt }));
    clearEditBackup(window.localStorage, festivalId);
    setBanner(null);
  };

  const dropKeptEdits = () => {
    if (festivalId) clearEditBackup(window.localStorage, festivalId);
    setBanner(null);
  };

  const renderEditor = () => (
    <div className="space-y-4">
      {organizer && formOrg && (
        <p className="text-sm text-text-secondary">
          {formOrg.name}. You are {formOrg.role === 'owner' ? 'an owner' : `${formOrg.role === 'editor' ? 'an' : 'a'} ${formOrg.role}`}.
          {orgRole === 'viewer' && ' You can look at this festival but not change it.'}
        </p>
      )}
      {organizer && formOrg?.status === 'suspended' && (
        <p role="alert" className="rounded-lg border border-accent-amber p-3 text-sm text-accent-amber">
          Your organization&apos;s access is paused. Your live festivals stay visible to attendees.{' '}
          <a href="mailto:support@festie.us" className="underline">
            Contact Festie
          </a>
        </p>
      )}
      {organizer && !festivalId && eligibleOrgs.length > 1 && (
        <div>
          <label htmlFor="new-festival-org" className="block text-sm font-medium text-text-primary mb-2">
            Organization
          </label>
          <select
            id="new-festival-org"
            value={targetOrgId}
            onChange={(e) => setNewOrgId(e.target.value)}
            className="w-full px-4 py-2 min-h-11 rounded-lg bg-bg-card border border-glass-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          >
            {eligibleOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {banner && (
        <div role="alert" className="rounded-lg border border-accent-coral p-3 text-sm text-text-primary space-y-2">
          <p>{banner.text}</p>
          {banner.kind === 'stale' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={reloadAfterNotice} className="px-3 py-1.5 min-h-11 rounded-lg bg-accent-aqua text-bg-primary text-sm font-medium">
                Reload
              </button>
              <button type="button" onClick={() => void showTheirVersion()} className="px-3 py-1.5 min-h-11 rounded-lg border border-glass-border text-sm text-text-primary">
                Show their version
              </button>
            </div>
          )}
          {banner.kind === 'restore' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={restoreEdits} className="px-3 py-1.5 min-h-11 rounded-lg bg-accent-aqua text-bg-primary text-sm font-medium">
                Restore my edits
              </button>
              <button type="button" onClick={dropKeptEdits} className="px-3 py-1.5 min-h-11 rounded-lg border border-glass-border text-sm text-text-primary">
                Discard them
              </button>
            </div>
          )}
          {banner.kind === 'owner' && (
            <p className="text-xs text-text-muted">Your edits are still in the form. Ask an owner of your organization to make this change.</p>
          )}
          {banner.kind === 'stale' && theirVersion && (
            <div className="space-y-1 text-sm text-text-secondary">
              <p className="font-medium text-text-primary">Their version compared with yours</p>
              <ul className="list-disc list-inside">
                {theirVersion.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {festivalId && (
        <FestivalStatusPanel
          festivalId={festivalId}
          name={savedName}
          meta={meta}
          dirty={changes.total > 0}
          onPublished={() => void reloadEditor()}
          onImport={() => leave({ tab: 'festivals', festival: festivalId, view: 'import' })}
          onEditMap={() => leave({ tab: 'festivals', festival: festivalId, view: 'map' })}
          organizer={
            organizer && formOrg
              ? { role: formOrg.role, orgName: formOrg.name, orgStatus: formOrg.status, verified: formOrg.verified }
              : undefined
          }
        />
      )}
      {festivalId && !organizer && <FestivalAnnouncements festivalId={festivalId} festivalName={savedName} />}
      {festivalId && organizer && orgRole === 'owner' && !!meta.publishedAt && formOrg?.status === 'active' && (
        <FestivalAnnouncements festivalId={festivalId} festivalName={savedName} scope="manage" pushAllowed={formOrg.verified} />
      )}
      {festivalId && verifiedOwner && !!meta.publishedAt && <ManageInterest festivalId={festivalId} days={original?.days} />}
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
        venueGuessed={!!festivalId && venueGuessedFor === festivalId}
        mode={organizer ? 'organizer' : 'admin'}
        readOnly={!canWrite}
        identityLocked={organizer && !!meta.publishedAt && formOrg?.verified !== true}
        alertsOn={verifiedMember}
        savedDays={original?.days}
        savedLineup={original?.lineup}
        engagement={engagement}
        engagementError={engagementError}
        festivals={festivals}
        interestCounts={interestCounts}
        onSave={handleSave}
        onDiscard={() => {
          if (festivalId) clearEditBackup(window.localStorage, festivalId);
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
    const missing = orgMissing || (detail.error instanceof ApiClientError && detail.error.status === 404);
    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-heading text-text-primary">{festivalId ? savedName : 'New festival'}</h2>
          {organizer && festivalId && !detail.isError && (
            <button
              type="button"
              onClick={() => leave({ preview: festivalId })}
              className="inline-flex items-center min-h-11 px-3 rounded-lg border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors"
            >
              Preview
            </button>
          )}
        </div>
        {festivalId && !detail.isError && (
          <AdminFestivalSubTabs
            current={openView}
            views={canWrite ? undefined : ['edit']}
            onSelect={(v) => {
              // An import or a map save changes what the checklist reads, so Details loads the festival again.
              if (v === 'edit') void queryClient.invalidateQueries({ queryKey: adminKeys.festival(festivalId) });
              leave({ tab: 'festivals', festival: festivalId, view: v });
            }}
          />
        )}
        {festivalId && (detail.isError || orgMissing) ? (
          missing ? (
            <EmptyState
              icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
              title={
                organizer
                  ? 'This festival is not available to your account. You may have been removed from its team.'
                  : "This festival doesn't exist or was deleted."
              }
              cta={{ label: organizer ? 'Back to my festivals' : 'Back to festivals', onClick: () => go({ tab: 'festivals' }) }}
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
          <FestivalMapEditor festivalId={festivalId} onClose={closeMap} onEditFestival={closeMap} scope={scope} />
        ) : openView === 'import' && festivalId ? (
          <LineupImport
            key={festivalId}
            festivalId={festivalId}
            festivalName={savedName}
            onDone={() => void refreshAdmin()}
            scope={scope}
            canAnnounce={verifiedOwner && formOrg?.status === 'active'}
          />
        ) : !seeded || orgUnknown ? (
          <div className="text-center py-12 text-text-muted">Loading festival…</div>
        ) : (
          <FestivalModeContext.Provider value={organizer ? 'organizer' : 'admin'}>{renderEditor()}</FestivalModeContext.Provider>
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
        <ConfirmDialog
          open={pendingAlert !== null}
          onOpenChange={(o) => !o && setPendingAlert(null)}
          title="Tell people about this change?"
          description={pendingAlert?.text ?? ''}
          confirmLabel="Save and tell them"
          busy={saving}
          onConfirm={() => {
            setPendingAlert(null);
            void save(true);
          }}
        />
        {reauthDialog}
      </div>
    );
  }

  if (organizer) {
    return (
      <div className="space-y-6">
        <ManageFestivalList
          query={manageQuery}
          organizations={organizations}
          onOpen={(id) => setAdminSearch({ festival: id })}
          onNew={() => setAdminSearch({ view: 'edit' })}
          onDelete={(id) => void handleDelete(id)}
        />
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
                <ArchivedFestivalRow key={item.id} item={item} onRestore={() => handleRestore(item)} />
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
                <FestivalListRow
                  key={festival.id}
                  festival={festival}
                  waitingForReview={waitingIds.has(festival.id)}
                  selected={selected.has(festival.id)}
                  onToggleSelected={() => toggleSelected(festival.id)}
                  onOpen={(view) => setAdminSearch({ tab: 'festivals', festival: festival.id, view })}
                  onArtists={() => setArtistsTarget({ id: festival.id, name: festival.name })}
                  onDelete={() => handleDelete(festival.id)}
                />
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
