import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Keyboard,
  Alert,
  RefreshControl,
  AppState,
  Share,
  AccessibilityInfo,
  useWindowDimensions,
  Platform,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalStore, useFestivalModeStore, useUIStore } from '@festie/shared/stores';
import { useActiveCrew, useCrewSections } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import {
  buildJoinUrl,
  formatInviteExpiry,
  inviteShareMessage,
  parseInviteCode,
  crewCopy,
  festivalLabel,
  handOverCandidates,
  memberCountLabel,
  deleteCrewConfirmMessage,
  leaveCrewConfirmMessage,
  removeMemberConfirmMessage,
  isCrewOwner,
  DEFAULT_CREW_TAB,
  parseCrewTab,
  openPollIds,
  openPollCount,
  hasUnsettledBalance,
  balanceCents,
} from '@festie/shared/utils';
import type { Crew, CrewMember, CrewOverlap, FestivalSet } from '@festie/shared/types';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import Button from '../../components/Button';
import ScreenHeader from '../../components/ScreenHeader';
import CrewSwitcherSheet from '../../components/CrewSwitcherSheet';
import FestivalChoiceSheet from '../../components/FestivalChoiceSheet';
import HandOverSheet from '../../components/HandOverSheet';
import CrewTabBar, { type CrewTabKey } from '../../components/CrewTabBar';
import { festivalForCrew } from '../../lib/crewFestival';
import { nextJoinSelect } from '../../lib/crewJoinSelect';
import InviteQRSheet from '../../components/InviteQRSheet';
import FreshnessChip from '../../components/FreshnessChip';
import { LowPowerIndicator } from '../../components/LowPowerControls';
import { useStyles } from '../../components/crew/styles';
import CrewGuestState from '../../components/crew/CrewGuestState';
import CrewLoadingState from '../../components/crew/CrewLoadingState';
import CrewJoiningState from '../../components/crew/CrewJoiningState';
import CrewLoadErrorState from '../../components/crew/CrewLoadErrorState';
import CrewNoCrewView from '../../components/crew/CrewNoCrewView';
import CrewInviteCard from '../../components/crew/CrewInviteCard';
import CrewMembersTab from '../../components/crew/CrewMembersTab';
import CrewPlanTab from '../../components/crew/CrewPlanTab';
import CrewFindTab from '../../components/crew/CrewFindTab';
import CrewMoneyTab from '../../components/crew/CrewMoneyTab';

/** Mirrors IOS_NATIVE_TAB_BAR_HEIGHT in (tabs)/index.tsx: the native iOS tab bar overlays content. */
const IOS_NATIVE_TAB_BAR_HEIGHT = 49;

// How often to retry a failed crew load while the error is showing.
const CREW_ERROR_RETRY_MS = 30_000;

export default function CrewScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  // On tablet-width screens, inset the content so menu items and member rows
  // don't stretch edge-to-edge into an uncomfortably wide single column.
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const tabletInset = useMemo(() => (isTablet ? { paddingHorizontal: t.spacing[6] } : null), [isTablet, t.spacing]);

  // Bottom padding via the shared inset hook (single source of truth for the
  // home-indicator cushion). Crew is a TAB screen — the tab bar in (tabs)/_layout
  // already absorbs the safe-area inset, so we pass includeSafeArea:false to add
  // only the visible cushion and avoid double-padding the last row.
  // NativeTabs floats above screen content on iOS, so shrink each scroll body by
  // the tab bar + home indicator (as the Schedule tab does). Without it the last
  // Manage control, Delete crew, sat under the tab bar and could not be reached.
  const insets = useSafeAreaInsets();
  const tabBodyStyle = useMemo(
    () => [styles.flex1, { marginBottom: Platform.OS === 'ios' ? IOS_NATIVE_TAB_BAR_HEIGHT + insets.bottom : 0 }],
    [styles.flex1, insets.bottom],
  );
  const listBottomPad = useListBottomInset({ includeSafeArea: false });
  const memberBottomPad = useListBottomInset({ base: t.spacing[4], includeSafeArea: false });
  const memberListStyle = useMemo(
    () => [styles.memberList, tabletInset, { paddingBottom: memberBottomPad }],
    [styles.memberList, tabletInset, memberBottomPad],
  );
  const formScrollStyle = useMemo(
    () => [styles.formScroll, tabletInset, { paddingBottom: listBottomPad }],
    [styles.formScroll, tabletInset, listBottomPad],
  );
  // Per-tab scroll padding for the non-Members tabs (Plan / Logistics / Money).
  const tabScrollStyle = useMemo(
    () => [styles.tabScroll, tabletInset, { paddingBottom: listBottomPad }],
    [styles.tabScroll, tabletInset, listBottomPad],
  );

  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const polls = useCrewStore((s) => s.polls);
  const packingItems = useCrewStore((s) => s.packingItems);
  const rideOffers = useCrewStore((s) => s.rideOffers);
  const expenseBalances = useCrewStore((s) => s.expenseBalances);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const updateCrew = useCrewStore((s) => s.updateCrew);
  const leaveCrew = useCrewStore((s) => s.leaveCrew);
  const deleteCrew = useCrewStore((s) => s.deleteCrew);
  const kickMember = useCrewStore((s) => s.kickMember);
  const transferOwnership = useCrewStore((s) => s.transferOwnership);
  const forceAddByUsername = useCrewStore((s) => s.forceAddByUsername);
  const handOverAndLeave = useCrewStore((s) => s.handOverAndLeave);
  const regenerateInvite = useCrewStore((s) => s.regenerateInvite);
  const loadOverlap = useCrewStore((s) => s.loadOverlap);
  const setError = useCrewStore((s) => s.setError);

  const reformCrew = useCrewStore((s) => s.reformCrew);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const festivals = useFestivalStore((s) => s.festivals);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);

  // Festival low-power mode gates battery-hungry features (live-location
  // auto-share). Read from the shared store; the toggle lives on the festival
  // mode screen and can be turned off from the Find tab.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  const router = useRouter();

  const [inviteCode, setInviteCode] = useState('');
  const inviteInputRef = useRef<TextInputInstance>(null);
  // Owner-only totem editor (in the Manage footer). Opens prefilled from the
  // active crew; `null` while closed so we can re-seed on open.
  const [totemEditOpen, setTotemEditOpen] = useState(false);
  const [editTotemEmoji, setEditTotemEmoji] = useState('');
  const [editTotemName, setEditTotemName] = useState('');
  const [totemBusy, setTotemBusy] = useState(false);
  const [inviteQrOpen, setInviteQrOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [showOverlap, setShowOverlap] = useState(false);
  const [forceAddOpen, setForceAddOpen] = useState(false);
  const [forceAddName, setForceAddName] = useState('');
  const [forceAddBusy, setForceAddBusy] = useState(false);
  const [reformBusy, setReformBusy] = useState(false);
  const [reformChoice, setReformChoice] = useState<{ sourceCrewId: string; options: { id: string; label: string }[] } | null>(null);
  const [managingMemberId, setManagingMemberId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherMode, setSwitcherMode] = useState<'list' | 'join'>('list');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [handOverOpen, setHandOverOpen] = useState(false);
  const [handOverBusy, setHandOverBusy] = useState(false);
  // Short success line in the crew chrome. Cleared after 4s.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedShown = useRef<string | null>(null);
  // P1-2: which crew section tab is showing. Find / Members / Plan / Money.
  // Day-of first: Find (SOS, status, live location, meeting points) opens by default.
  const [crewTab, setCrewTab] = useState<CrewTabKey>(DEFAULT_CREW_TAB);

  // DC2: a raise-SOS affordance on /find and /map deep-links here with
  // ?tab=find so the user lands on the Find pane where CrewSos lives.
  const {
    tab: tabParam,
    joined: joinedParam,
    sheet: sheetParam,
    start: startParam,
  } = useLocalSearchParams<{ tab?: string; joined?: string; sheet?: string; start?: string }>();

  // Loads crews and selects the first one; status drives the loading/error/none branches.
  const { status, retry } = useActiveCrew();

  // Reset the transient sub-feature UI whenever the active crew changes. Done
  // with the render-time "previous value" pattern (keyed off the crew id) rather
  // than a setState-in-effect, so the reset lands in the same render the crew
  // changes and before the ?tab deep-link effect below re-applies any tab.
  const [prevCrewId, setPrevCrewId] = useState(activeCrew?.id);
  if (activeCrew?.id !== prevCrewId) {
    setPrevCrewId(activeCrew?.id);
    setShowOverlap(false);
    setForceAddOpen(false);
    setForceAddName('');
    setCrewTab(DEFAULT_CREW_TAB);
    setTotemEditOpen(false);
    setRenameOpen(false);
    setHandOverOpen(false);
  }

  // DC2: honor a deep-linked ?tab=... (e.g. the find/map SOS shortcut lands on
  // the Find pane). Runs after the crew-change reset since it keys on the param.
  // parseCrewTab also maps old keys (logistics, ...) so old links still work.
  // The param is cleared once applied, so a later link with the same ?tab (a
  // second join landing on Members) changes the value and applies again.
  useEffect(() => {
    if (!tabParam) return;
    const next = parseCrewTab(tabParam);
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven: apply the deep-linked ?tab exactly when the URL param changes; not derivable as render state since the user can still switch tabs afterward
      setCrewTab(next);
    }
    router.setParams({ tab: undefined });
  }, [tabParam, router]);

  const showNotice = useCallback(
    (text: string) => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice(text);
      haptics.success();
      AccessibilityInfo.announceForAccessibility(text);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    },
    [haptics],
  );
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Join landing: /(tabs)/crew?joined=<crewId> says so once.
  useEffect(() => {
    if (!joinedParam) {
      joinedShown.current = null;
      return;
    }
    if (!activeCrew || activeCrew.id !== joinedParam) return;
    if (joinedShown.current === joinedParam) return;
    joinedShown.current = joinedParam;
    showNotice(crewCopy.joined(activeCrew.name));
    router.setParams({ joined: undefined });
  }, [joinedParam, activeCrew, showNotice, router]);

  // Joining while in another crew: if that crew is still the active one, switch to the joined crew
  // so the notice above can show and the screen is not left on the wrong crew.
  const joinSelected = useRef<string | null>(null);
  useEffect(() => {
    const next = nextJoinSelect({ joinedParam, crewLoading, activeCrewId: activeCrew?.id, crewIds: crews.map((c) => c.id), selected: joinSelected.current });
    joinSelected.current = next.selected;
    if (next.select) selectCrew(next.select).catch((err) => Sentry.captureException(err));
  }, [joinedParam, crewLoading, activeCrew?.id, crews, selectCrew]);

  // /(tabs)/crew?sheet=join opens the Crews sheet in Join mode, once per link:
  // the param is cleared so a later activeCrew change cannot reopen it.
  const hasActiveCrew = !!activeCrew;
  useEffect(() => {
    if (sheetParam !== 'join' || !hasActiveCrew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven: open the sheet exactly when the deep-link param arrives
    setSwitcherMode('join');
    setSwitcherOpen(true);
    router.setParams({ sheet: undefined });
  }, [sheetParam, hasActiveCrew, router]);

  // /(tabs)/crew?start=create|join (from the intro) focuses the matching no-crew field,
  // once per link. The param is latched first because the first render can show
  // "No crew yet" before the crew load swaps in the skeleton and unmounts the form.
  const [pendingStart, setPendingStart] = useState<'create' | 'join' | null>(null);
  useEffect(() => {
    if (!user || (startParam !== 'create' && startParam !== 'join')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latches the route param once, then clears it
    setPendingStart(startParam);
    router.setParams({ start: undefined });
  }, [user, startParam, router]);
  useEffect(() => {
    if (!pendingStart || status === 'loading' || status === 'error' || status === 'joining') return;
    // Create focuses via CreateCrewForm's autoFocus prop, which reads pendingStart.
    if (pendingStart === 'join' && status === 'none') inviteInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the latched param after the crew status settles
    setPendingStart(null);
  }, [pendingStart, status]);

  // The five crew sections load with bounded retry (429/5xx/network). A failure
  // that outlasts the retries is re-tried on screen focus, app foreground, or Try again.
  // Offline, the section loaders fail by design and the cached crew is on screen
  // under the "Showing offline data" chip, so the failure is not shown as a fault.
  const offlineMode = useUIStore((s) => s.offlineMode);
  const { error: loadedSectionsError, reload: reloadCrewSections } = useCrewSections(activeCrew?.id);
  const sectionLoadError = offlineMode ? null : loadedSectionsError;
  const sectionsFailed = !!sectionLoadError;
  useFocusEffect(
    useCallback(() => {
      // A stale failure (e.g. from the invite screen) must not greet the user on return.
      setError(null);
      if (sectionsFailed) reloadCrewSections();
      // Only re-run on focus, not when the error flips, or a failed retry would loop.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on focus only; sectionsFailed flipping would loop a failed retry
    }, [reloadCrewSections, setError]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && sectionsFailed) reloadCrewSections();
    });
    return () => sub.remove();
  }, [sectionsFailed, reloadCrewSections]);

  // Pull-to-refresh: re-fetch the crew list and the active crew (members,
  // polls, meeting points, expenses all reload off selectCrew + the effect).
  const handleRefresh = useCallback(() => {
    loadCrews().catch((err) => Sentry.captureException(err));
    if (activeCrew) {
      selectCrew(activeCrew.id).catch((err) => Sentry.captureException(err));
      reloadCrewSections();
    }
  }, [loadCrews, activeCrew, selectCrew, reloadCrewSections]);

  // Error states clear only on a new load, so a rate limit or a dropped connection
  // left "Couldn't load" / "Failed to load" on screen until a force-stop. Retry
  // every 30 s while the error shows, and restart the wait when the network returns.
  const hasLoadError = status === 'error' || sectionsFailed;
  const reloadAfterError = useCallback(() => {
    if (status === 'error') retry();
    else reloadCrewSections();
  }, [status, retry, reloadCrewSections]);
  useEffect(() => {
    if (!hasLoadError || offlineMode) return;
    const timer = setInterval(reloadAfterError, CREW_ERROR_RETRY_MS);
    return () => clearInterval(timer);
  }, [hasLoadError, offlineMode, reloadAfterError]);

  // Fast set lookup by id for overlap labels.
  const setsById = useMemo(() => {
    const map = new Map<string, FestivalSet>();
    for (const s of sets ?? []) map.set(s.id, s);
    return map;
  }, [sets]);

  // Owner-only totem save (rename the crew's rally marker). Opens the editor
  // seeded from the active crew, then PUTs name + emoji via the shared store.
  const openTotemEditor = (c: Crew) => {
    setEditTotemEmoji(c.totem_emoji ?? '');
    setEditTotemName(c.totem_name ?? '');
    setTotemEditOpen(true);
  };

  const handleSaveTotem = async (crewId: string) => {
    if (totemBusy) return;
    Keyboard.dismiss();
    setError(null);
    setTotemBusy(true);
    try {
      // Send empty strings (not omitted) so clearing a field actually clears
      // the totem server-side.
      await updateCrew(crewId, {
        totemEmoji: editTotemEmoji.trim(),
        totemName: editTotemName.trim(),
      });
      setTotemEditOpen(false);
    } catch (err) {
      Sentry.captureException(err);
      // Error is set in the store.
    } finally {
      setTotemBusy(false);
    }
  };

  const handleSaveRename = async (crewId: string) => {
    const trimmed = renameText.trim();
    if (renameBusy || !trimmed) return;
    Keyboard.dismiss();
    setError(null);
    setRenameBusy(true);
    try {
      await updateCrew(crewId, { name: trimmed });
      setRenameOpen(false);
      showNotice(crewCopy.renamed);
    } catch (err) {
      Sentry.captureException(err);
      // Error is set in the store.
    } finally {
      setRenameBusy(false);
    }
  };

  const handleJoin = () => {
    Keyboard.dismiss();
    const code = parseInviteCode(inviteCode);
    if (!code) {
      setError("That code doesn't look right. Codes have 6 letters and numbers.");
      return;
    }
    setError(null);
    setInviteCode('');
    // The join screen shows the preview and the single Join button.
    router.push(`/join/${code}`);
  };

  const handleShareInvite = useCallback((code: string, crewName: string) => {
    // festie.us/join/CODE is a server-rendered invite page (routes/pages.ts) that
    // opens the app when installed, instead of the machiney /api/v1/crews/join URL.
    const url = buildJoinUrl(code);
    Share.share({
      message: inviteShareMessage(crewName, url),
      url,
    }).catch((err) => Sentry.captureException(err));
  }, []);

  const handleRegenerate = (crewId: string) => {
    Alert.alert('Regenerate invite code', 'The current code will stop working. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Regenerate',
        style: 'destructive',
        onPress: async () => {
          setRegenBusy(true);
          try {
            await regenerateInvite(crewId);
            showNotice(crewCopy.inviteRegenerated);
          } catch (err) {
            Sentry.captureException(err);
            // Error is set in the store.
          } finally {
            setRegenBusy(false);
          }
        },
      },
    ], { cancelable: true });
  };

  // Reform the active crew for another festival. Crews are festival-scoped, so
  // this creates a NEW crew in the chosen festival and brings the prior roster
  // across (members already in that festival are auto-added; the rest get the
  // invite link). Presents the eligible target festivals as an action sheet.
  const performReform = useCallback(
    async (sourceCrewId: string, targetFestivalId: string, festivalName: string) => {
      setReformBusy(true);
      try {
        const res = await reformCrew(sourceCrewId, targetFestivalId);
        const added = res.reform?.autoAdded?.length ?? 0;
        const invited = res.reform?.invited?.length ?? 0;
        Alert.alert(
          'Crew reformed',
          `Started fresh for ${festivalName}. ${added} member${added === 1 ? '' : 's'} added.` +
            (invited > 0 ? ` Share the invite link with the other ${invited} to bring them across.` : ''),
        );
      } catch (err) {
        Alert.alert("Couldn't reform crew", mapErrorToUserMessage(err, 'Try again.'));
      } finally {
        setReformBusy(false);
      }
    },
    [reformCrew],
  );

  const handleReform = useCallback(
    (sourceCrewId: string, sourceFestivalId: string | undefined) => {
      const open = () => {
        const options = festivals.filter((f) => f.id !== sourceFestivalId);
        if (options.length === 0) {
          Alert.alert('No other festivals', 'There are no other festivals to reform this crew for yet.');
          return;
        }
        setReformChoice({ sourceCrewId, options: options.map((f) => ({ id: f.id, label: f.name })) });
      };
      if (festivals.length === 0) {
        loadFestivals()
          .then(open)
          .catch(() => Alert.alert("Couldn't load festivals", 'Try again.'));
      } else {
        open();
      }
    },
    [festivals, loadFestivals],
  );

  const handleToggleOverlap = async (crewId: string) => {
    // The crew's lineup is not the one the Schedule tab loaded, so only the compare screen can name its sets.
    if (activeCrew?.festivalId && activeCrew.festivalId !== currentFestival?.id) {
      router.push('/crew-compare');
      return;
    }
    if (showOverlap) {
      setShowOverlap(false);
      return;
    }
    const festivalId = activeCrew?.festivalId ?? currentFestival?.id;
    if (!festivalId) {
      Alert.alert('No festival selected', 'Pick a festival before comparing schedules.');
      return;
    }
    setOverlapBusy(true);
    setOverlapError(null);
    try {
      await loadOverlap(crewId, festivalId);
      setShowOverlap(true);
    } catch (e) {
      setError(null);
      setOverlapError(mapErrorToUserMessage(e, 'Couldn’t load schedule overlap'));
    } finally {
      setOverlapBusy(false);
    }
  };

  const handleKick = (crewId: string, member: CrewMember) => {
    const crewName = crews.find((c) => c.id === crewId)?.name ?? 'this crew';
    Alert.alert('Remove member', removeMemberConfirmMessage(member.name || 'this member', crewName), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await kickMember(crewId, member.userId);
            showNotice(crewCopy.removed(member.name || 'member'));
          } catch (err) {
            Sentry.captureException(err);
            // Error is set in the store.
          }
        },
      },
    ], { cancelable: true });
  };

  const handleTransfer = (crewId: string, member: CrewMember) => {
    Alert.alert(
      'Transfer ownership',
      `Make ${member.name || 'this member'} the crew owner? You will become a regular member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make owner',
          style: 'default',
          onPress: async () => {
            try {
              await transferOwnership(crewId, member.userId);
              showNotice(crewCopy.transferred(member.name || 'Member'));
            } catch (err) {
              Sentry.captureException(err);
              // Error is set in the store.
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleForceAdd = async (crewId: string) => {
    const trimmed = forceAddName.trim();
    if (!trimmed || forceAddBusy) return;
    Keyboard.dismiss();
    setForceAddBusy(true);
    try {
      const username = await forceAddByUsername(crewId, trimmed);
      setForceAddName('');
      setForceAddOpen(false);
      showNotice(crewCopy.added(username));
    } catch (err) {
      Sentry.captureException(err);
      // Error is set in the store.
    } finally {
      setForceAddBusy(false);
    }
  };

  const handleLeave = (crewId: string) => {
    const crewName = crews.find((c) => c.id === crewId)?.name ?? 'this crew';
    Alert.alert('Leave crew', leaveCrewConfirmMessage(crewName), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave crew',
        style: 'destructive',
        onPress: () => {
          leaveCrew(crewId)
            .then(() => showNotice(crewCopy.left(crewName)))
            .catch((err) => Sentry.captureException(err));
        },
      },
    ], { cancelable: true });
  };

  const handleDelete = (crewId: string, crewName: string, memberCount: number) => {
    Alert.alert('Delete crew', deleteCrewConfirmMessage(crewName, memberCount), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete crew',
        style: 'destructive',
        onPress: () => {
          deleteCrew(crewId)
            .then(() => showNotice(crewCopy.deleted(crewName)))
            .catch((err) => Sentry.captureException(err));
        },
      },
    ], { cancelable: true });
  };

  const handleOwnerLeave = (crewId: string, crewName: string, members: CrewMember[], selfId: string) => {
    if (handOverCandidates(members, selfId).length === 0) {
      handleDelete(crewId, crewName, members.length);
      return;
    }
    setHandOverOpen(true);
  };

  const handleHandOver = async (crew: Crew, members: CrewMember[], newOwnerId: string) => {
    if (handOverBusy) return;
    const name = members.find((m) => m.userId === newOwnerId)?.name || 'Member';
    setError(null);
    setHandOverBusy(true);
    try {
      const result = await handOverAndLeave(crew.id, newOwnerId);
      setHandOverOpen(false);
      if (result === 'left') showNotice(crewCopy.handedOverAndLeft(crew.name, name));
      else setError(crewCopy.handOverPartial(crew.name, name));
    } catch (err) {
      Sentry.captureException(err);
      // Error is set in the store.
      setHandOverOpen(false);
    } finally {
      setHandOverBusy(false);
    }
  };

  // Opening Plan or Money marks the Crew tab badge as seen.
  const markCrewBadgeSeen = useUIStore((s) => s.markCrewBadgeSeen);
  useEffect(() => {
    if (!activeCrew || !user) return;
    if (crewTab === 'plan') markCrewBadgeSeen(activeCrew.id, { pollIds: openPollIds(polls) });
    else if (crewTab === 'money') {
      markCrewBadgeSeen(activeCrew.id, {
        balanceCents: balanceCents(expenseBalances.find((b) => b.userId === user.id)?.balance),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids, not the whole objects
  }, [crewTab, activeCrew?.id, polls, expenseBalances, user?.id, markCrewBadgeSeen]);

  if (!user) return <CrewGuestState />;

  // Initial load — no crews fetched yet. Show a skeleton that matches the crew
  // chrome + member-row geometry instead of a bare spinner, so the layout
  // doesn't jump when data lands. (Cached crews render immediately and skip
  // this branch entirely — this is the cold-start case only.)
  if (status === 'loading') return <CrewLoadingState tabletInset={tabletInset} />;

  if (status === 'joining') return <CrewJoiningState />;

  if (status === 'error') return <CrewLoadErrorState retry={retry} />;


  // No crews: show create / join forms.
  if (!activeCrew) {
    return (
      <CrewNoCrewView
        error={error}
        formScrollStyle={formScrollStyle}
        handleJoin={handleJoin}
        inviteCode={inviteCode}
        inviteInputRef={inviteInputRef}
        notice={notice}
        pendingStart={pendingStart}
        setInviteCode={setInviteCode}
        tabBodyStyle={tabBodyStyle}
      />
    );
  }

  // Active crew: header, invite code, switcher, members + admin, overlap, actions.
  const crew: Crew = activeCrew;
  const members: CrewMember[] = crewMembers.length ? crewMembers : (crew.members ?? []);

  // Current user's role within this crew drives which admin controls show.
  const isOwner = isCrewOwner(crew, members, user.id);
  const crewFestival = festivalForCrew(crew, currentFestival);
  const inviteExpiry = formatInviteExpiry(crew.inviteExpiresAt);
  const countText = memberCountLabel(members.length, crew.maxMembers);
  const headerSubtitle = crewFestival ? `${festivalLabel(crewFestival)} · ${countText}` : countText;

  const overlapEntries: CrewOverlap[] = Object.values(crewOverlap)
    .filter((o) => o.memberCount > 0)
    .sort((a, b) => b.memberCount - a.memberCount);

  // Badge counts derived from already-loaded crew data (no extra fetch):
  // open polls = polls not yet closed; unsettled = current user has a
  // non-zero expense balance (owes or is owed).
  const openPolls = openPollCount(polls);
  const myBalance = expenseBalances.find((b) => b.userId === user.id)?.balance ?? 0;
  const unsettled = hasUnsettledBalance(myBalance);

  // Plan-tab at-a-glance counts (derived from already-loaded crew data, no extra
  // fetch): how many packing items still need a claimer, and how many rides are
  // on the board. Surfaced as small aqua count pills next to the section labels
  // so the crew sees what's outstanding without expanding each list.
  const packingLeft = packingItems.filter((i) => !i.claimed).length;
  const packingDone = packingItems.length > 0 && packingLeft === 0;
  const rideCount = rideOffers.length;

  // Shared pull-to-refresh control (only one tab renders at a time).
  const crewRefreshControl = (
    <RefreshControl
      refreshing={crewLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  const inviteCard =
    members.length <= 1 && crew.inviteCode ? (
      <CrewInviteCard crew={crew} handleShareInvite={handleShareInvite} setInviteQrOpen={setInviteQrOpen} />
    ) : null;

  return (
    // KAV is dropped: behavior='padding' is a no-op on Android and
    // behavior='height' doesn't scroll the focused field into view when it's
    // deep in the list (totem editor / force-add / expense inputs).
    // automaticallyAdjustKeyboardInsets on each scroll body handles both
    // platforms correctly (same pattern as account.tsx / app/set/[setId].tsx).
    <View style={styles.screen} testID="crew-screen">
      <ScreenHeader
        title={crew.name}
        subtitle={headerSubtitle}
        icon="people"
        right={
          <TouchableOpacity
            testID="crew-action-switcher"
            style={styles.switcherButton}
            onPress={() => {
              setSwitcherMode('list');
              setSwitcherOpen(true);
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Your crews. Switch, create or join"
          >
            <Text style={styles.switcherButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Crews
            </Text>
            <Ionicons name="chevron-down" size={t.iconSize.compact} color={t.colors.accent.aqua} />
          </TouchableOpacity>
        }
      />

      <CrewSwitcherSheet
        visible={switcherOpen}
        initialMode={switcherMode}
        onClose={() => setSwitcherOpen(false)}
      />

      <FestivalChoiceSheet
        visible={reformChoice !== null}
        title="Reform crew"
        message="Choose a festival to start this crew fresh for. Members already in that festival are added automatically; share the invite link with everyone else."
        options={reformChoice?.options ?? []}
        onSelect={(id) => {
          const choice = reformChoice;
          setReformChoice(null);
          const target = choice?.options.find((o) => o.id === id);
          if (choice && target) performReform(choice.sourceCrewId, id, target.label);
        }}
        onClose={() => setReformChoice(null)}
      />

      <HandOverSheet
        visible={handOverOpen}
        crewName={crew.name}
        candidates={handOverCandidates(members, user.id)}
        busy={handOverBusy}
        onConfirm={(id) => handleHandOver(crew, members, id)}
        onClose={() => setHandOverOpen(false)}
      />

      {crew.inviteCode ? (
        <InviteQRSheet
          visible={inviteQrOpen}
          crewName={crew.name}
          code={crew.inviteCode}
          onClose={() => setInviteQrOpen(false)}
        />
      ) : null}

      {/* Persistent crew chrome — one status row (totem, freshness, SOS) and
          the crew switcher. The invite card is setup, so it scrolls inside each
          tab body; the code strip lives in the Members header. */}
      <View style={[styles.crewChrome, tabletInset]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sectionLoadError ? (
          <>
            <Text style={styles.error}>{sectionLoadError}</Text>
            <Button label="Try again" variant="secondary" size="sm" onPress={reloadCrewSections} />
          </>
        ) : null}

        <View style={styles.crewMetaRow}>
          {/* Crew totem (rally marker) rides in the meta row so the pinned
              header stays one row tall. Renders only when set. */}
          {crew.totem_emoji || crew.totem_name ? (
            <View style={styles.totemChip} accessibilityLabel={`Crew totem ${crew.totem_name ?? ''}`.trim()}>
              {crew.totem_emoji ? <Text style={styles.totemChipEmoji}>{crew.totem_emoji}</Text> : null}
              {crew.totem_name ? (
                <Text style={styles.totemChipName} numberOfLines={1}>
                  {crew.totem_name}
                </Text>
              ) : null}
            </View>
          ) : null}
          <FreshnessChip surface="crew" />
          <LowPowerIndicator />
          {/* Always-visible SOS entry: the full SOS panel lives in the Logistics
              tab, so this chip jumps there rather than duplicating the raise
              flow — safety must be reachable from every crew tab. */}
          {/* Hidden on Logistics: the Find tab already shows Send SOS. */}
          {crewTab !== 'find' ? (
            <TouchableOpacity
              testID="crew-action-sos"
              style={styles.sosChip}
              onPress={() => setCrewTab('find')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Open crew safety to send an SOS"
            >
              <Ionicons name="alert-circle" size={t.iconSize.compact} color={t.colors.text.onAccent} />
              <Text style={styles.sosChipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>SOS</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {notice ? (
          <Text
            style={styles.notice}
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {notice}
          </Text>
        ) : null}
      </View>

      {/* P1-2 — segmented crew tab bar (web parity). The screen's many sections
          become Members / Plan / Logistics / Money tabs instead of one long
          scroll; every prior section is still reachable inside a tab. */}
      <CrewTabBar
        activeTab={crewTab}
        onTabChange={(tab) => {
          setError(null);
          setCrewTab(tab);
        }}
        badges={{ plan: openPolls, money: unsettled }}
      />

      {crewTab === 'members' ? (
        <CrewMembersTab
          crew={crew}
          crewFestival={crewFestival}
          crewRefreshControl={crewRefreshControl}
          editTotemEmoji={editTotemEmoji}
          editTotemName={editTotemName}
          festivalDays={festivalDays}
          forceAddBusy={forceAddBusy}
          forceAddName={forceAddName}
          forceAddOpen={forceAddOpen}
          handleDelete={handleDelete}
          handleForceAdd={handleForceAdd}
          handleKick={handleKick}
          handleLeave={handleLeave}
          handleOwnerLeave={handleOwnerLeave}
          handleReform={handleReform}
          handleRegenerate={handleRegenerate}
          handleSaveRename={handleSaveRename}
          handleSaveTotem={handleSaveTotem}
          handleShareInvite={handleShareInvite}
          handleTransfer={handleTransfer}
          inviteCard={inviteCard}
          inviteExpiry={inviteExpiry}
          isOwner={isOwner}
          managingMemberId={managingMemberId}
          memberListStyle={memberListStyle}
          members={members}
          openTotemEditor={openTotemEditor}
          reformBusy={reformBusy}
          regenBusy={regenBusy}
          renameBusy={renameBusy}
          renameOpen={renameOpen}
          renameText={renameText}
          setEditTotemEmoji={setEditTotemEmoji}
          setEditTotemName={setEditTotemName}
          setForceAddName={setForceAddName}
          setForceAddOpen={setForceAddOpen}
          setInviteQrOpen={setInviteQrOpen}
          setManagingMemberId={setManagingMemberId}
          setRenameOpen={setRenameOpen}
          setRenameText={setRenameText}
          setTotemEditOpen={setTotemEditOpen}
          tabBodyStyle={tabBodyStyle}
          totemBusy={totemBusy}
          totemEditOpen={totemEditOpen}
          user={user}
        />
      ) : crewTab === 'plan' ? (
        <CrewPlanTab
          crew={crew}
          crewRefreshControl={crewRefreshControl}
          handleToggleOverlap={handleToggleOverlap}
          inviteCard={inviteCard}
          isOwner={isOwner}
          openPollCount={openPolls}
          overlapBusy={overlapBusy}
          overlapEntries={overlapEntries}
          overlapError={overlapError}
          packingDone={packingDone}
          packingLeft={packingLeft}
          rideCount={rideCount}
          setsById={setsById}
          showOverlap={showOverlap}
          tabBodyStyle={tabBodyStyle}
          tabScrollStyle={tabScrollStyle}
          user={user}
        />
      ) : crewTab === 'find' ? (
        <CrewFindTab
          crew={crew}
          crewFestival={crewFestival}
          crewRefreshControl={crewRefreshControl}
          festivalDays={festivalDays}
          inviteCard={inviteCard}
          isOwner={isOwner}
          lowPowerMode={lowPowerMode}
          tabBodyStyle={tabBodyStyle}
          tabScrollStyle={tabScrollStyle}
          user={user}
        />
      ) : (
        <CrewMoneyTab
          crew={crew}
          crewRefreshControl={crewRefreshControl}
          hasUnsettledBalance={unsettled}
          inviteCard={inviteCard}
          members={members}
          tabBodyStyle={tabBodyStyle}
          tabScrollStyle={tabScrollStyle}
          user={user}
        />
      )}
    </View>
  );
}