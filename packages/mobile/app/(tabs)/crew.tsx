import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Keyboard,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
  AccessibilityInfo,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalStore, useFestivalModeStore } from '@festie/shared/stores';
import { useCrew } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import {
  setLabel,
  buildJoinUrl,
  formatInviteExpiry,
  inviteShareMessage,
  parseInviteCode,
  crewCopy,
  festivalLabel,
  handOverCandidates,
  memberAvatarUrl,
  memberCountLabel,
  FESTIE_ORIGIN,
  deleteCrewConfirmMessage,
  leaveCrewConfirmMessage,
  removeMemberConfirmMessage,
  DEFAULT_CREW_TAB,
  parseCrewTab,
} from '@festie/shared/utils';
import type { Crew, CrewMember, CrewOverlap, FestivalSet } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, useLargeText, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import Button from '../../components/Button';
import ScreenHeader from '../../components/ScreenHeader';
import Avatar from '../../components/Avatar';
import CreateCrewForm from '../../components/CreateCrewForm';
import CrewSwitcherSheet from '../../components/CrewSwitcherSheet';
import HandOverSheet from '../../components/HandOverSheet';
import CrewTabBar, { type CrewTabKey } from '../../components/CrewTabBar';
import EmptyState from '../../components/EmptyState';
import SectionLabel from '../../components/SectionLabel';
import { Skeleton } from '../../components/Skeleton';
import CrewHomeBase from '../../components/CrewHomeBase';
import CrewPhotoLink from '../../components/CrewPhotoLink';
import CrewPolls from '../../components/CrewPolls';
import CrewMeetingPoints from '../../components/CrewMeetingPoints';
import CrewStatus from '../../components/CrewStatus';
import { festivalForCrew } from '../../lib/crewFestival';
import CrewPacking from '../../components/CrewPacking';
import CrewRides from '../../components/CrewRides';
import CrewExpenses from '../../components/CrewExpenses';
import CrewActivity from '../../components/CrewActivity';
import CrewLiveLocation from '../../components/CrewLiveLocation';
import CrewSos from '../../components/CrewSos';
import InviteQRSheet from '../../components/InviteQRSheet';
import FreshnessChip from '../../components/FreshnessChip';
import { LowPowerIndicator } from '../../components/LowPowerControls';

export default function CrewScreen() {
  const t = useTokens();
  const largeText = useLargeText();
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
  const loadPolls = useCrewStore((s) => s.loadPolls);
  const loadMeetingPoints = useCrewStore((s) => s.loadMeetingPoints);
  const loadPacking = useCrewStore((s) => s.loadPacking);
  const loadRides = useCrewStore((s) => s.loadRides);
  const loadExpenses = useCrewStore((s) => s.loadExpenses);
  const setError = useCrewStore((s) => s.setError);

  const reformCrew = useCrewStore((s) => s.reformCrew);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const festivals = useFestivalStore((s) => s.festivals);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);

  // Festival low-power mode gates battery-hungry features (live-location
  // auto-share). Read from the shared store; the toggle itself lives on the
  // Now & Next screen.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  // Per-set crew picks (shared hook) — used to enrich the overlap UI without
  // an extra endpoint round-trip.
  const { getCrewScopedOtherPicks } = useCrew();
  const router = useRouter();

  const [inviteCode, setInviteCode] = useState('');
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
  const [sectionLoadError, setSectionLoadError] = useState<string | null>(null);
  const [showOverlap, setShowOverlap] = useState(false);
  const [forceAddOpen, setForceAddOpen] = useState(false);
  const [forceAddName, setForceAddName] = useState('');
  const [forceAddBusy, setForceAddBusy] = useState(false);
  const [reformBusy, setReformBusy] = useState(false);
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
  // mpLat/mpLng: tap-to-create coords deep-linked from the map's long-press —
  // forwarded to CrewMeetingPoints to prefill+open its create form.
  const {
    tab: tabParam,
    mpLat: mpLatParam,
    mpLng: mpLngParam,
    joined: joinedParam,
    sheet: sheetParam,
  } = useLocalSearchParams<{ tab?: string; mpLat?: string; mpLng?: string; joined?: string; sheet?: string }>();
  const prefillCoords = useMemo(() => {
    const lat = mpLatParam != null ? Number(mpLatParam) : NaN;
    const lng = mpLngParam != null ? Number(mpLngParam) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [mpLatParam, mpLngParam]);

  // Load the user's crews once on mount.
  useEffect(() => {
    if (user?.id && crews.length === 0) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, crews.length, loadCrews]);

  // Auto-select the first crew when none is active yet.
  useEffect(() => {
    if (user?.id && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0]!.id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]);

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

  // Load polls + meeting points for the active crew (best-effort). These five
  // loaders all write the SAME shared store `error` field, so firing them
  // concurrently let a later failure silently clobber an earlier one (e.g. a
  // packing failure went invisible if polls failed after it). Promise.allSettled
  // + a local aggregate message reports every failed section instead of just
  // whichever loader lost the race last.
  const loadCrewSections = useCallback(
    async (id: string) => {
      const [polls, meetingPoints, packing, rides, expenses] = await Promise.allSettled([
        loadPolls(id),
        loadMeetingPoints(id),
        loadPacking(id),
        loadRides(id),
        loadExpenses(id),
      ]);
      const failed = [
        polls.status === 'rejected' && 'polls',
        meetingPoints.status === 'rejected' && 'meeting points',
        packing.status === 'rejected' && 'packing',
        rides.status === 'rejected' && 'rides',
        expenses.status === 'rejected' && 'expenses',
      ].filter((name): name is string => name !== false);
      setSectionLoadError(failed.length ? `Failed to load: ${failed.join(', ')}` : null);
    },
    [loadPolls, loadMeetingPoints, loadPacking, loadRides, loadExpenses],
  );

  useEffect(() => {
    const id = activeCrew?.id;
    if (!id) return;
    loadCrewSections(id).catch(() => {});
  }, [activeCrew?.id, loadCrewSections]);

  // Pull-to-refresh: re-fetch the crew list and the active crew (members,
  // polls, meeting points, expenses all reload off selectCrew + the effect).
  const handleRefresh = useCallback(() => {
    loadCrews().catch(() => {});
    if (activeCrew) {
      selectCrew(activeCrew.id).catch(() => {});
      loadCrewSections(activeCrew.id).catch(() => {});
    }
  }, [loadCrews, activeCrew, selectCrew, loadCrewSections]);

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
    } catch {
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
    } catch {
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
    }).catch(() => {});
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
          } catch {
            // Error is set in the store.
          } finally {
            setRegenBusy(false);
          }
        },
      },
    ]);
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
          `Started fresh for ${festivalName}. ${added} member${added === 1 ? '' : 's'} added; ` +
            `share the invite code with the other ${invited} to bring them across.`,
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
        Alert.alert(
          'Reform crew',
          'Choose a festival to start this crew fresh for. Members already in that festival are added ' +
            'automatically; share the invite link with everyone else.',
          [
            ...options.slice(0, 10).map((f) => ({
              text: f.name,
              onPress: () => performReform(sourceCrewId, f.id, f.name),
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ],
        );
      };
      if (festivals.length === 0) {
        loadFestivals()
          .then(open)
          .catch(() => Alert.alert("Couldn't load festivals", 'Try again.'));
      } else {
        open();
      }
    },
    [festivals, loadFestivals, performReform],
  );

  const handleToggleOverlap = async (crewId: string) => {
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
          } catch {
            // Error is set in the store.
          }
        },
      },
    ]);
  };

  const handleTransfer = (crewId: string, member: CrewMember) => {
    Alert.alert(
      'Transfer ownership',
      `Make ${member.name || 'this member'} the crew owner? You will become a regular member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            try {
              await transferOwnership(crewId, member.userId);
              showNotice(crewCopy.transferred(member.name || 'Member'));
            } catch {
              // Error is set in the store.
            }
          },
        },
      ],
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
    } catch {
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
          leaveCrew(crewId).catch(() => {});
        },
      },
    ]);
  };

  const handleDelete = (crewId: string, crewName: string, memberCount: number) => {
    Alert.alert('Delete crew', deleteCrewConfirmMessage(crewName, memberCount), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete crew',
        style: 'destructive',
        onPress: () => {
          deleteCrew(crewId).catch(() => {});
        },
      },
    ]);
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
    } catch {
      // Error is set in the store.
      setHandOverOpen(false);
    } finally {
      setHandOverBusy(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.screen} testID="crew-screen">
        <ScreenHeader title="Crew" icon="people" />
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in required"
          message="Log in to coordinate with your crew."
          action={{ label: 'Sign in', onPress: () => router.push('/(auth)/login') }}
        />
      </View>
    );
  }

  // Initial load — no crews fetched yet. Show a skeleton that matches the crew
  // chrome + member-row geometry instead of a bare spinner, so the layout
  // doesn't jump when data lands. (Cached crews render immediately and skip
  // this branch entirely — this is the cold-start case only.)
  if (crewLoading && crews.length === 0 && !activeCrew) {
    return (
      <View style={styles.screen} testID="crew-screen">
        <ScreenHeader title="Crew" icon="people" />
        <View
          style={[styles.crewChrome, tabletInset]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your crews"
        >
          <Skeleton height={44} radius={t.radii.default} />
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={styles.skeletonRowBody}>
                  <Skeleton width="55%" height={14} radius={t.radii.xs} />
                  <Skeleton width="32%" height={10} radius={t.radii.xs} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // No active crew: show create / join forms.
  if (!activeCrew) {
    return (
      // KAV is dropped: behavior='padding' is a no-op on Android and
      // behavior='height' doesn't scroll the focused field into view when it's
      // deep in the list. automaticallyAdjustKeyboardInsets on the scroll
      // container handles both platforms correctly (same pattern as
      // account.tsx / app/set/[setId].tsx).
      <View style={styles.screen} testID="crew-screen">
        <ScreenHeader title="Crew" subtitle="Coordinate with friends" icon="people" />
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={formScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <EmptyState
            illustration="noCrew"
            title="No crew yet"
            message="Plan with your friends. Make a crew, or join one with a code."
          />

          {/* Leaving the only crew lands here, so its notice must show here too. */}
          {notice ? (
            <Text style={styles.notice} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {notice}
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <CreateCrewForm />

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Join by code</Text>
            <Text style={styles.formHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              6-character code, or paste the invite link
            </Text>
            <TextInput
              style={styles.input}
              placeholder="K7XQ2M"
              placeholderTextColor={t.colors.text.placeholder}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={64}
              returnKeyType="done"
              onSubmitEditing={handleJoin}
              accessibilityLabel="Invite code"
            />
            <TouchableOpacity
              style={[styles.outlineButton, !inviteCode.trim() && styles.buttonDisabled]}
              onPress={handleJoin}
              disabled={!inviteCode.trim()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Join crew by code"
            >
              <Text style={styles.outlineButtonText}>Join by Code</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Active crew: header, invite code, switcher, members + admin, overlap, actions.
  const crew: Crew = activeCrew;
  const members: CrewMember[] = crewMembers.length ? crewMembers : (crew.members ?? []);

  // Current user's role within this crew drives which admin controls show.
  const myMembership = members.find((m) => m.userId === user.id);
  const isOwner = crew.owner === user.id || myMembership?.role === 'owner';
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
  const openPollCount = polls.filter((p) => !p.closed).length;
  const myBalance = expenseBalances.find((b) => b.userId === user.id)?.balance ?? 0;
  const hasUnsettledBalance = Math.abs(myBalance) > 0.01;

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
          the crew switcher. The invite code is setup, so it lives in the
          Members tab to keep this pinned header short. */}
      <View style={[styles.crewChrome, tabletInset]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sectionLoadError ? <Text style={styles.error}>{sectionLoadError}</Text> : null}

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

        {members.length <= 1 && crew.inviteCode ? (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteCardTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {crewCopy.inviteCardTitle}
            </Text>
            <Text style={styles.inviteCardBody} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {crewCopy.inviteCardBody(crew.name)}
            </Text>
            <View style={styles.forceAddRow}>
              <Button
                label="Share invite link"
                onPress={() => handleShareInvite(crew.inviteCode!, crew.name)}
                accessibilityLabel="Share invite link"
                style={styles.flexButton}
              />
              <TouchableOpacity
                style={[styles.outlineButton, styles.flexButton]}
                onPress={() => setInviteQrOpen(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Show QR code"
              >
                <Text style={styles.outlineButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  Show QR code
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>

      {/* P1-2 — segmented crew tab bar (web parity). The screen's many sections
          become Members / Plan / Logistics / Money tabs instead of one long
          scroll; every prior section is still reachable inside a tab. */}
      <CrewTabBar
        activeTab={crewTab}
        onTabChange={setCrewTab}
        badges={{ plan: openPollCount, money: hasUnsettledBalance }}
      />

      {crewTab === 'members' ? (
        <FlatList
          style={styles.flex1}
          data={members}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={memberListStyle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshControl={crewRefreshControl}
          renderItem={({ item }) => {
            const rowIsOwner = item.role === 'owner' || item.userId === crew.owner;
            const displayName = item.name || 'Member';
            const isSelf = item.userId === user.id;
            // Owners may manage other members (kick + transfer). Force-add and
            // these controls hit admin-gated shared store actions.
            const canManage = isOwner && !rowIsOwner && !isSelf;
            return (
              <View style={[styles.memberRow, largeText && styles.memberRowWrap]}>
                <Avatar name={displayName} image={memberAvatarUrl(item, FESTIE_ORIGIN)} size="md" />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={2}>
                    {displayName}
                    {isSelf ? ' (you)' : ''}
                  </Text>
                  {rowIsOwner ? <Text style={styles.memberRole}>Owner</Text> : null}
                </View>
                {canManage ? (
                  <View style={[styles.memberActions, largeText && styles.memberActionsWrap]}>
                    <TouchableOpacity
                      onPress={() => handleTransfer(crew.id, item)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Transfer ownership to ${displayName}`}
                    >
                      {/* swap-horizontal reads as "hand over / transfer"; the
                          star glyph is reserved for the Owner badge so the two
                          aren't visually conflated. */}
                      <Ionicons name="swap-horizontal" size={18} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleKick(crew.id, item)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${displayName} from crew`}
                    >
                      <Ionicons name="person-remove-outline" size={18} color={t.colors.text.danger} />
                    </TouchableOpacity>
                  </View>
                ) : rowIsOwner ? (
                  <View accessible accessibilityLabel="Owner">
                    <Ionicons name="star" size={16} color={t.colors.aquaAlpha[40]} />
                  </View>
                ) : null}
              </View>
            );
          }}
          ListHeaderComponent={
            <View style={styles.membersHeader}>
              {crew.inviteCode ? (
                <View style={styles.inviteBar}>
                  <Ionicons name="key-outline" size={16} color={t.colors.accent.aqua} />
                  <Text style={styles.inviteLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>Invite code</Text>
                  <Text style={styles.inviteCode} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Invite code ${crew.inviteCode}`}>
                    {crew.inviteCode}
                  </Text>
                  {inviteExpiry ? (
                    <Text style={styles.inviteExpiry} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {inviteExpiry === 'Expired' && !isOwner
                        ? 'Expired. Ask the crew owner for a new link.'
                        : inviteExpiry}
                    </Text>
                  ) : null}
                  <View style={[styles.inviteActions, largeText && styles.inviteActionsWrap]}>
                    <TouchableOpacity
                      testID="crew-action-share-invite"
                      onPress={() => handleShareInvite(crew.inviteCode!, crew.name)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Share invite link"
                    >
                      <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="crew-action-show-invite-qr"
                      onPress={() => setInviteQrOpen(true)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Show QR code"
                    >
                      <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                    {isOwner ? (
                      <TouchableOpacity
                        testID="crew-action-regenerate-invite"
                        onPress={() => handleRegenerate(crew.id)}
                        disabled={regenBusy}
                        style={styles.iconButton}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Regenerate invite code"
                      >
                        {regenBusy ? (
                          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
                        ) : (
                          <Ionicons name="refresh" size={16} color={t.colors.accent.aqua} />
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="person-outline"
              title="No members yet"
              message="Share your invite code to bring friends in."
              action={
                crew.inviteCode
                  ? { label: 'Share invite', onPress: () => handleShareInvite(crew.inviteCode!, crew.name) }
                  : undefined
              }
            />
          }
          ListFooterComponent={
            <View style={styles.tabFooter}>
              <SectionLabel>Manage</SectionLabel>

              {/* Reform this crew for another festival (M3). */}
              <TouchableOpacity
                testID="crew-action-reform"
                style={styles.overlapToggle}
                onPress={() => handleReform(crew.id, crew.festivalId)}
                disabled={reformBusy}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Reform this crew for another festival"
              >
                <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.overlapToggleText}>
                  {reformBusy ? 'Reforming…' : 'Reform for another festival'}
                </Text>
                {reformBusy ? (
                  <ActivityIndicator size="small" color={t.colors.accent.aqua} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
                )}
              </TouchableOpacity>

              {/* Owner-only crew totem editor (rally marker: emoji + name). */}
              {isOwner ? (
                totemEditOpen ? (
                  <View style={styles.forceAddBox}>
                    <Text style={styles.formLabel}>Crew totem</Text>
                    <View style={styles.totemFieldRow}>
                      <TextInput
                        style={[styles.input, styles.totemEmojiInput]}
                        placeholder="Emoji"
                        placeholderTextColor={t.colors.text.placeholder}
                        value={editTotemEmoji}
                        onChangeText={setEditTotemEmoji}
                        maxLength={16}
                        autoCorrect={false}
                        accessibilityLabel="Crew totem emoji"
                      />
                      <TextInput
                        style={[styles.input, styles.totemNameInput]}
                        placeholder="Totem name"
                        placeholderTextColor={t.colors.text.placeholder}
                        value={editTotemName}
                        onChangeText={setEditTotemName}
                        maxLength={40}
                        returnKeyType="done"
                        onSubmitEditing={() => handleSaveTotem(crew.id)}
                        accessibilityLabel="Crew totem name"
                      />
                    </View>
                    <View style={styles.forceAddRow}>
                      <TouchableOpacity
                        style={[styles.outlineButton, styles.flexButton]}
                        onPress={() => setTotemEditOpen(false)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel totem edit"
                      >
                        <Text style={styles.outlineButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <Button
                        label={totemBusy ? 'Saving…' : 'Save totem'}
                        onPress={() => handleSaveTotem(crew.id)}
                        disabled={totemBusy}
                        accessibilityLabel="Save crew totem"
                        style={styles.flexButton}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="crew-action-edit-totem"
                    style={styles.overlapToggle}
                    onPress={() => openTotemEditor(crew)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit crew totem"
                  >
                    <Ionicons name="flag-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.overlapToggleText}>
                      {crew.totem_emoji || crew.totem_name ? 'Edit crew totem' : crewCopy.addTotem}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
                  </TouchableOpacity>
                )
              ) : null}
              {isOwner && !totemEditOpen ? <Text style={styles.formHint}>{crewCopy.totemExplainer}</Text> : null}

              {/* Rename (owner). */}
              {isOwner ? (
                renameOpen ? (
                  <View style={styles.forceAddBox}>
                    <Text style={styles.formLabel}>Crew name</Text>
                    <TextInput
                      style={styles.input}
                      value={renameText}
                      onChangeText={setRenameText}
                      maxLength={60}
                      returnKeyType="done"
                      onSubmitEditing={() => handleSaveRename(crew.id)}
                      accessibilityLabel="Crew name"
                    />
                    <View style={styles.forceAddRow}>
                      <TouchableOpacity
                        style={[styles.outlineButton, styles.flexButton]}
                        onPress={() => setRenameOpen(false)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel rename"
                      >
                        <Text style={styles.outlineButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <Button
                        label={renameBusy ? 'Saving…' : 'Save'}
                        onPress={() => handleSaveRename(crew.id)}
                        disabled={renameBusy || !renameText.trim() || renameText.trim() === crew.name}
                        accessibilityLabel="Save crew name"
                        style={styles.flexButton}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="crew-action-rename"
                    style={styles.overlapToggle}
                    onPress={() => {
                      setRenameText(crew.name);
                      setRenameOpen(true);
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Rename crew"
                  >
                    <Ionicons name="pencil-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.overlapToggleText}>Rename crew</Text>
                    <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
                  </TouchableOpacity>
                )
              ) : null}

              {/* Force-add by username (admin-gated server-side). Shown to admins only. */}
              {user.isAdmin ? (
                forceAddOpen ? (
                  <View style={styles.forceAddBox}>
                    <Text style={styles.formLabel}>Username</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="username"
                      placeholderTextColor={t.colors.text.placeholder}
                      value={forceAddName}
                      onChangeText={setForceAddName}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={() => handleForceAdd(crew.id)}
                      accessibilityLabel="Username to add"
                    />
                    <View style={styles.forceAddRow}>
                      <TouchableOpacity
                        style={[styles.outlineButton, styles.flexButton]}
                        onPress={() => {
                          setForceAddOpen(false);
                          setForceAddName('');
                        }}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel force-add"
                      >
                        <Text style={styles.outlineButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <Button
                        label={forceAddBusy ? 'Adding…' : 'Add'}
                        onPress={() => handleForceAdd(crew.id)}
                        disabled={forceAddBusy || !forceAddName.trim()}
                        accessibilityLabel="Confirm force-add"
                        style={styles.flexButton}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="crew-action-force-add"
                    style={styles.overlapToggle}
                    onPress={() => setForceAddOpen(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Add member by username (admin)"
                  >
                    <Ionicons name="person-add-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.overlapToggleText}>Add member by username (admin)</Text>
                  </TouchableOpacity>
                )
              ) : null}

              <View style={styles.footerActions}>
                <TouchableOpacity
                  testID="crew-action-leave"
                  style={styles.dangerButton}
                  onPress={() =>
                    isOwner ? handleOwnerLeave(crew.id, crew.name, members, user.id) : handleLeave(crew.id)
                  }
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Leave crew"
                >
                  <Ionicons name="exit-outline" size={16} color={t.colors.text.danger} />
                  <Text style={styles.dangerButtonText}>Leave crew</Text>
                </TouchableOpacity>
              </View>
              {isOwner ? (
                <View style={styles.footerActions}>
                  <TouchableOpacity
                    testID="crew-action-delete"
                    style={styles.dangerButton}
                    onPress={() => handleDelete(crew.id, crew.name, members.length)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Delete crew"
                  >
                    <Ionicons name="trash-outline" size={16} color={t.colors.text.danger} />
                    <Text style={styles.dangerButtonText}>Delete crew</Text>
                  </TouchableOpacity>
                  <Text style={styles.formHint}>Deletes the crew for everyone.</Text>
                </View>
              ) : null}
            </View>
          }
        />
      ) : crewTab === 'plan' ? (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* Everyday primary: the offline-native "what's my crew's plan"
              digest. Emphasized (aqua-tinted fill + border) so the most-used
              action carries more weight than the rest of the tab. Coral is
              reserved for danger/SOS, so these nav actions are aqua. */}
          <TouchableOpacity
            testID="crew-action-plan"
            style={[styles.overlapToggle, styles.overlapTogglePrimary]}
            onPress={() => router.push('/crew-plan')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="View your crew's plan"
          >
            <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapTogglePrimaryText}>Crew plan</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* Schedule compare / overlap toggle. */}
          <TouchableOpacity
            testID="crew-action-overlap"
            style={styles.overlapToggle}
            onPress={() => handleToggleOverlap(crew.id)}
            disabled={overlapBusy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={showOverlap ? 'Hide schedule overlap' : 'Compare crew schedules'}
          >
            <Ionicons name="git-compare-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>
              {overlapBusy ? 'Loading overlap…' : showOverlap ? 'Hide schedule overlap' : 'Compare schedules'}
            </Text>
            {overlapBusy ? (
              <ActivityIndicator size="small" color={t.colors.accent.aqua} />
            ) : (
              <Ionicons name={showOverlap ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.accent.aqua} />
            )}
          </TouchableOpacity>

          {overlapError ? (
            <TouchableOpacity
              style={styles.overlapErrorRow}
              onPress={() => handleToggleOverlap(crew.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry loading schedule overlap"
            >
              <Ionicons name="cloud-offline-outline" size={16} color={t.colors.text.danger} />
              <Text style={styles.overlapErrorText}>{overlapError}</Text>
              <Text style={styles.overlapRetryText}>Retry</Text>
            </TouchableOpacity>
          ) : null}

          {showOverlap ? (
            overlapEntries.length === 0 ? (
              <Text style={styles.overlapEmpty}>No shared picks yet — overlap appears once members add sets.</Text>
            ) : (
              <View style={styles.overlapList}>
                {overlapEntries.map((o) => {
                  const picks = getCrewScopedOtherPicks(o.setId);
                  const mustCount = picks.filter((p) => p.priority === 'must').length;
                  return (
                    <View key={o.setId} style={styles.overlapRow}>
                      <View style={styles.overlapInfo}>
                        <Text style={styles.overlapSet} numberOfLines={1}>
                          {setLabel(setsById.get(o.setId), o.setId)}
                        </Text>
                        <Text style={styles.overlapMeta}>
                          {o.memberCount} {o.memberCount === 1 ? 'member' : 'members'}
                          {mustCount > 0 ? ` · ${mustCount} must-see` : ''}
                        </Text>
                      </View>
                      <View style={styles.overlapBadge}>
                        {/* DC25: 13 is off-grid; snap to iconSize.xs (12). */}
                        <Ionicons name="people" size={12} color={t.colors.accent.aqua} />
                        <Text style={styles.overlapBadgeText}>{o.memberCount}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )
          ) : null}

          {/* Full side-by-side compare matrix (members × sets). */}
          <TouchableOpacity
            testID="crew-action-compare-grid"
            style={styles.overlapToggle}
            onPress={() => router.push('/crew-compare')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open full compare grid"
          >
            <Ionicons name="grid-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>Full compare grid</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* P2P plan handoff — discoverable from the Plan cluster so users
              find it before they need it. QR / SMS works with no signal. */}
          <TouchableOpacity
            testID="crew-action-share-plan-planning"
            style={styles.overlapToggle}
            onPress={() => router.push('/plan-share')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share your plan — QR or SMS handoff, works offline"
          >
            <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
            <View style={styles.overlapToggleLabelStack}>
              <Text style={styles.overlapToggleText}>Share plan</Text>
              <Text style={styles.overlapToggleHint}>QR / SMS handoff, works offline</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          <View style={styles.sectionLabelRow}>
            <SectionLabel>Polls</SectionLabel>
            {openPollCount > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{openPollCount}</Text>
              </View>
            ) : null}
          </View>
          <CrewPolls crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

          {/* DC4: Packing + Rides are pre-festival planning, so they live in
              Plan (moved out of the mid-festival "Find" cluster). The count
              pills give an at-a-glance "what's outstanding" without expanding. */}
          <View style={styles.sectionLabelRow}>
            <SectionLabel>Packing</SectionLabel>
            {packingDone ? (
              <View style={styles.donePill} accessibilityLabel="All packing items claimed">
                <Ionicons name="checkmark" size={12} color={t.colors.accent.aqua} />
                <Text style={styles.donePillText} maxFontSizeMultiplier={MAX_FONT_SCALE}>All packed</Text>
              </View>
            ) : packingLeft > 0 ? (
              <View
                style={styles.countBadge}
                accessibilityLabel={`${packingLeft} packing ${packingLeft === 1 ? 'item' : 'items'} unclaimed`}
              >
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{packingLeft}</Text>
              </View>
            ) : null}
          </View>
          <CrewPacking crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

          <View style={styles.sectionLabelRow}>
            <SectionLabel>Rides</SectionLabel>
            {rideCount > 0 ? (
              <View
                style={styles.countBadge}
                accessibilityLabel={`${rideCount} ${rideCount === 1 ? 'ride' : 'rides'} on the board`}
              >
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{rideCount}</Text>
              </View>
            ) : null}
          </View>
          <CrewRides crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />
        </ScrollView>
      ) : crewTab === 'find' ? (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* DC2: SOS must be reachable without any scroll — top of the pane,
              always visible the instant the Find tab opens. */}
          <CrewSos crewId={crew.id} currentUserId={user.id} />

          <TouchableOpacity
            testID="crew-action-map"
            style={styles.overlapToggle}
            onPress={() => router.navigate('/(tabs)/map')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open the map with your crew and meeting points"
          >
            <Ionicons name="map-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>Open map</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* Live location toggle sits below the SOS button. In low-power mode
              the battery-hungry live-location share is paused (gated by the
              shared festival low-power flag); a chip explains why. */}
          <CrewStatus crewId={crew.id} currentUserId={user.id} />

          <SectionLabel>Live location</SectionLabel>
          <View style={styles.liveSafetyBlock}>
            {lowPowerMode ? (
              <View style={styles.lowPowerPaused}>
                <LowPowerIndicator />
                <Text style={styles.lowPowerPausedText}>
                  Live location is paused to save battery. Turn off low-power mode on the Now & Next screen to share
                  again.
                </Text>
              </View>
            ) : (
              <CrewLiveLocation crewId={crew.id} />
            )}
          </View>

          <SectionLabel>Meeting points</SectionLabel>
          <CrewMeetingPoints
            crewId={crew.id}
            currentUserId={user.id}
            isOwner={isOwner}
            festival={crewFestival}
            days={crewFestival ? festivalDays : undefined}
            prefillCoords={prefillCoords}
          />

          <CrewHomeBase crewId={crew.id} location={crew.homeBaseLocation} time={crew.homeBaseTime} isOwner={isOwner} />

          {/* M5 P2P plan handoff — QR / scan / SMS when signal is dead. */}
          <TouchableOpacity
            testID="crew-action-share-plan"
            style={styles.overlapToggle}
            onPress={() => router.push('/plan-share')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share your plan with a friend (QR or text)"
          >
            <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>Share plan (QR / text)</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          <CrewPhotoLink crewId={crew.id} photoAlbumUrl={crew.photoAlbumUrl} />

          <SectionLabel>Activity</SectionLabel>
          <CrewActivity crewId={crew.id} />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.sectionLabelRow}>
            <SectionLabel>Expenses</SectionLabel>
            {hasUnsettledBalance ? (
              <View style={styles.unsettledDot} accessibilityLabel="You have an unsettled balance" />
            ) : null}
          </View>
          <CrewExpenses crewId={crew.id} members={members} currentUserId={user.id} />
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  // Bind each scroll body (Members FlatList + the Plan/Logistics/Money
  // ScrollViews + the no-crew form) to the screen's remaining height. Without
  // flex:1 they size to content, overflow past the bottom tab bar (member rows
  // "overlapping" the nav) and let the fixed chrome / CrewTabBar above expand to
  // fill the slack — which is why a tab's controls looked oversized on the
  // shorter Plan/Logistics panes. flex:1 makes the body absorb the slack and
  // scroll internally instead.
  flex1: {
    flex: 1,
  },
  formScroll: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
  // Persistent crew chrome (identity / invite / switcher) above the tab bar.
  crewChrome: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
    paddingBottom: t.spacing[2],
  },
  // Members-tab header: the invite bar (setup) moved out of the pinned chrome.
  membersHeader: {
    marginBottom: t.spacing[3],
  },
  // Header meta row: freshness badge + low-power indicator.
  crewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  // Compact always-visible SOS entry, right-aligned in the header meta row.
  // coralStrong bg + white text mirrors the Button danger pattern; jumps to the
  // Logistics tab where the full CrewSos panel renders.
  sosChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[3],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosChipText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
  // Crew totem chip shown in the header (emoji + name rally marker).
  totemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  totemChipEmoji: {
    ...typeStyle('label'),
  },
  totemChipName: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  // Totem create/edit fields: a narrow emoji box + a flexible name box.
  totemFieldRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  totemEmojiInput: {
    width: 64,
    textAlign: 'center',
  },
  totemNameInput: {
    flex: 1,
  },
  // Live-location block when low-power mode pauses the share.
  lowPowerPaused: {
    gap: t.spacing[2],
  },
  lowPowerPausedText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Scroll content for the Plan / Logistics / Money tabs.
  tabScroll: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[1],
    gap: t.spacing[3],
  },
  // Members-tab footer (Manage cluster + danger actions).
  tabFooter: {
    gap: t.spacing[3],
    marginTop: t.spacing[4],
  },
  error: {
    ...typeStyle('body'),
    color: t.colors.text.danger,
    textAlign: 'center',
  },
  formGroup: {
    gap: t.spacing[2],
  },
  formLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  formHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  // Primary aqua CTAs migrated to components/Button (F8).
  outlineButton: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  outlineButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  flexButton: {
    flex: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[2],
    // Guarantee a >=44pt touch target (WCAG / Apple HIG) for these small
    // (16-18px) icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: t.spacing[2],
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  inviteActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  inviteActionsWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  inviteLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  inviteExpiry: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  inviteCode: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    marginLeft: 'auto',
    letterSpacing: 2,
  },
  switcherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  switcherButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  notice: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  inviteCard: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  inviteCardTitle: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  inviteCardBody: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  overlapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapToggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  overlapToggleLabelStack: {
    flex: 1,
    flexDirection: 'column',
    gap: 1,
  },
  overlapToggleHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Emphasized variant for the everyday-primary action (Crew plan): aqua-tinted
  // fill + aqua border so it carries more weight than the plain toolbox rows,
  // without becoming a loud solid-aqua CTA.
  overlapTogglePrimary: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  overlapTogglePrimaryText: {
    ...typeStyle('label', 700),
    color: t.colors.accent.aqua,
    flex: 1,
  },
  overlapEmpty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  overlapErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapErrorText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flex: 1,
  },
  overlapRetryText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  overlapList: {
    gap: t.spacing[2],
  },
  overlapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  overlapSet: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  overlapMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  overlapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  overlapBadgeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  forceAddBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  forceAddRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  memberList: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[3],
  },
  // Cold-start skeleton (mirrors the member-row geometry so nothing jumps).
  skeletonList: {
    gap: t.spacing[3],
    marginTop: t.spacing[3],
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  skeletonRowBody: {
    flex: 1,
    gap: t.spacing[2],
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing[1],
  },
  countBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  // "All packed" affordance — a calm aqua confirmation pill (not coral; this is
  // a positive done-state, not an alarm) shown when nothing is left to claim.
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
    marginBottom: t.spacing[1],
  },
  donePillText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  unsettledDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
    marginBottom: t.spacing[1],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    // Match AccountScreen's row floor so every member row keeps a >=44pt
    // touch target even when the name wraps to a single short line.
    minHeight: 56,
    // Hairline-divider idiom: flat row separated by a single-pixel bottom
    // border rather than individually boxed cards.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border.default,
  },
  memberRowWrap: {
    flexWrap: 'wrap',
  },
  memberInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  memberName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  memberRole: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  memberActionsWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  liveSafetyBlock: {
    gap: t.spacing[3],
    marginBottom: t.spacing[2],
  },
  footerActions: {
    marginTop: t.spacing[4],
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  dangerButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
}));
