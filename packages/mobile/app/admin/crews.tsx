import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  addCrewMember,
  api,
  fetchAdminCrews,
  fetchCrewMembers,
  removeCrewMember,
  type AdminCrewMember,
  type AdminCrewRow,
  type AdminUserRow,
} from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { filterAdminCrews, removeMemberCopy } from '@festie/shared/utils';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { ConfirmDialog, UserPicker } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Crew management. The native mirror of the web admin crew console
 * (packages/web/src/components/admin/AdminCrews.tsx). No business logic lives
 * here — calls go through @festie/shared/services; parsing/validation is
 * server-side.
 *
 * Surfaces, against the same endpoints the web console uses:
 *   GET    /admin/crews                     → crew rows (memberCount, creator, invite code)
 *   GET    /admin/crews/:id/members         → member rows (userId/username/role)
 *   DELETE /admin/crews/:id                 → delete a crew entirely
 *   DELETE /admin/crews/:id/members/:userId → remove one member (never the owner)
 *   POST   /crews/:id/members body { userId } → add any user to the crew
 *
 * EVERY destructive write (delete crew, remove member) is gated behind
 * ConfirmDialog before the api call fires — the same destructive-confirm
 * discipline as the rest of the admin write surface.
 *
 * Route: /admin/crews. Lives under app/admin/ so the root AuthGate
 * (seg[0] === 'admin') guards it. Back-navigates to '/admin'.
 */

type ConfirmKind = 'delete-crew' | 'remove-member';
interface ConfirmState {
  kind: ConfirmKind;
  title: string;
  message: string;
  confirmLabel: string;
}

interface RemoveTarget {
  crewId: string;
  userId: string;
  username: string;
}

function crewSubLine(c: AdminCrewRow): string {
  const count = c.memberCount;
  const creator = c.creatorUsername ? `Created by @${c.creatorUsername}` : 'Created by a deleted user';
  const date = new Date(c.createdAt).toLocaleDateString();
  return `${count} member${count === 1 ? '' : 's'} · ${creator} · ${c.festivalName ?? 'Archived festival'} · ${date}`;
}

export default function AdminCrewsScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [crews, setCrews] = useState<AdminCrewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersByCrew, setMembersByCrew] = useState<Record<string, AdminCrewMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});
  const [pickerCrewId, setPickerCrewId] = useState<string | null>(null);

  // The pending destructive action + what it targets. The parent owns the
  // ConfirmDialog visibility, mirroring the lineup-import + Account inline edits.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const [banner, setBanner] = useState<{ text: string; error: boolean } | null>(null);

  // Safe dismiss: a cold deep link has no back stack, so router.back() would
  // strand the user on a blank screen. Fall back to the admin root.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/admin');
    }
  }, [router]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const crewRows = await fetchAdminCrews();
      setCrews(Array.isArray(crewRows) ? crewRows : []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag.
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
  }, [isAdmin, load]);

  const loadCrewMembers = useCallback(
    async (crewId: string, force = false) => {
      if (membersByCrew[crewId] && !force) return; // cached: re-expand is instant
      setMembersLoading((prev) => ({ ...prev, [crewId]: true }));
      try {
        const result = await fetchCrewMembers(crewId);
        setMembersByCrew((prev) => ({ ...prev, [crewId]: Array.isArray(result) ? result : [] }));
      } catch {
        setBanner({ text: "Couldn't load members. Try again.", error: true });
      } finally {
        setMembersLoading((prev) => ({ ...prev, [crewId]: false }));
      }
    },
    [membersByCrew],
  );

  const toggleExpand = useCallback(
    (crewId: string) => {
      if (expandedId === crewId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(crewId);
      void loadCrewMembers(crewId);
    },
    [expandedId, loadCrewMembers],
  );

  const filteredCrews = useMemo(() => filterAdminCrews(crews, search), [crews, search]);

  // ── Destructive-action requests (open the confirm) ───────────────
  const requestDeleteCrew = useCallback((crew: AdminCrewRow) => {
    const links = `${crew.memberCount} member link${crew.memberCount === 1 ? '' : 's'}`;
    setConfirmTargetId(crew.id);
    setRemoveTarget(null);
    setConfirm({
      kind: 'delete-crew',
      title: `Delete ${crew.name}?`,
      message: `This removes the crew and all ${links}. Members lose access to shared picks. This can't be undone.`,
      confirmLabel: 'Delete',
    });
  }, []);

  const requestRemoveMember = useCallback((crew: AdminCrewRow, member: AdminCrewMember) => {
    setConfirmTargetId(null);
    setRemoveTarget({ crewId: crew.id, userId: member.userId, username: member.username });
    setConfirm({ kind: 'remove-member', ...removeMemberCopy(member.username, crew.name) });
  }, []);

  const addMember = useCallback(
    async (user: AdminUserRow) => {
      const crew = crews.find((c) => c.id === pickerCrewId);
      if (!crew) return;
      await addCrewMember(crew.id, user.id);
      setCrews((prev) => prev.map((c) => (c.id === crew.id ? { ...c, memberCount: c.memberCount + 1 } : c)));
      void loadCrewMembers(crew.id, true);
      setBanner({ text: `Added @${user.username} to ${crew.name}.`, error: false });
      setPickerCrewId(null);
    },
    [crews, pickerCrewId, loadCrewMembers],
  );

  // ── Confirmed actions (fire the api call) ────────────────────────
  const runConfirmed = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    setBanner(null);
    try {
      if (confirm.kind === 'delete-crew' && confirmTargetId) {
        const name = crews.find((c) => c.id === confirmTargetId)?.name || 'crew';
        await api.delete<void>(`/admin/crews/${confirmTargetId}`);
        setCrews((prev) => prev.filter((c) => c.id !== confirmTargetId));
        if (expandedId === confirmTargetId) setExpandedId(null);
        setBanner({ text: `Deleted ${name}.`, error: false });
      } else if (confirm.kind === 'remove-member' && removeTarget) {
        const { crewId, userId, username } = removeTarget;
        const crewName = crews.find((c) => c.id === crewId)?.name || 'crew';
        await removeCrewMember(crewId, userId);
        setMembersByCrew((prev) => ({ ...prev, [crewId]: (prev[crewId] ?? []).filter((m) => m.userId !== userId) }));
        setCrews((prev) => prev.map((c) => (c.id === crewId ? { ...c, memberCount: Math.max(0, c.memberCount - 1) } : c)));
        setBanner({ text: `Removed @${username} from ${crewName}.`, error: false });
      }
      setConfirm(null);
      setConfirmTargetId(null);
      setRemoveTarget(null);
    } catch (err: unknown) {
      setBanner({ text: err instanceof Error ? err.message : 'Action failed. Try again.', error: true });
    } finally {
      setBusy(false);
    }
  }, [confirm, confirmTargetId, removeTarget, crews, expandedId]);

  const cancelConfirm = useCallback(() => {
    if (busy) return;
    setConfirm(null);
    setConfirmTargetId(null);
    setRemoveTarget(null);
  }, [busy]);

  // ── Non-admin guard (AuthGate already bounces; mirror defensively) ─
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crews" subtitle="Admin" icon="people-outline" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Crews"
          subtitle="Members and invite codes"
          icon="people-outline"
          right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
        />
        <LoadingState label="Loading crews" />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Crews"
          subtitle="Members and invite codes"
          icon="people-outline"
          right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
        />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load crews"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => { setLoading(true); void load().finally(() => setLoading(false)); } }}
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  const pickerCrew = crews.find((c) => c.id === pickerCrewId);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Crews"
        subtitle="Members and invite codes"
        icon="people-outline"
        right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
      />

      <FlatList
        data={filteredCrews}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {banner ? (
              <View style={[styles.banner, banner.error ? styles.bannerError : styles.bannerOk]}>
                <Text style={[styles.bannerText, banner.error && styles.bannerTextError]}>{banner.text}</Text>
              </View>
            ) : null}

            <SectionLabel>Crews ({filteredCrews.length})</SectionLabel>

            <TextInput
              style={[styles.search, searchFocused && styles.searchFocused]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by crew, creator, festival or invite code…"
              placeholderTextColor={t.colors.text.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              accessibilityLabel="Search crews by name, creator, festival or invite code"
            />
          </View>
        }
        renderItem={({ item: crew }) => {
          const isExpanded = expandedId === crew.id;
          const members = membersByCrew[crew.id];
          const isLoadingMembers = !!membersLoading[crew.id];
          return (
            <View style={[styles.card, styles.crewCard]}>
              <View style={styles.crewHead}>
                <View style={styles.crewMeta}>
                  <Text style={styles.crewName} numberOfLines={1}>
                    {crew.name}
                  </Text>
                  <Text style={styles.crewSub} numberOfLines={3}>
                    {crewSubLine(crew)}
                  </Text>
                </View>
              </View>
              <View style={styles.crewActions}>
                <Button
                  label={isExpanded ? 'Hide' : 'View'}
                  variant="secondary"
                  size="sm"
                  icon={isExpanded ? 'chevron-up' : 'people-outline'}
                  onPress={() => toggleExpand(crew.id)}
                  style={styles.flexBtn}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  size="sm"
                  icon="trash-outline"
                  onPress={() => requestDeleteCrew(crew)}
                  style={styles.flexBtn}
                />
              </View>

              {isExpanded ? (
                <View style={styles.membersBlock}>
                  {crew.inviteCode ? (
                    <Text style={styles.memberHint} selectable>
                      Invite code {crew.inviteCode}
                    </Text>
                  ) : null}
                  <Text style={styles.membersHeading}>Members</Text>
                  {isLoadingMembers && !members ? (
                    <Text style={styles.memberHint}>Loading members…</Text>
                  ) : !members || members.length === 0 ? (
                    <Text style={styles.memberHint}>No members.</Text>
                  ) : (
                    members.map((m) => (
                      <View key={m.userId} style={styles.memberRow}>
                        <Ionicons name="person-circle-outline" size={t.iconSize.md} color={t.colors.text.muted} />
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.username || m.userId}
                        </Text>
                        {m.role === 'owner' ? (
                          <Text style={styles.memberRole}>· Owner</Text>
                        ) : (
                          <Button
                            label="Remove"
                            variant="ghost"
                            size="sm"
                            onPress={() => requestRemoveMember(crew, m)}
                            style={styles.removeBtn}
                            accessibilityLabel={`Remove ${m.username}`}
                          />
                        )}
                      </View>
                    ))
                  )}
                  <Button
                    label="Add member"
                    variant="secondary"
                    size="sm"
                    icon="person-add-outline"
                    onPress={() => setPickerCrewId(crew.id)}
                    style={styles.addBtn}
                  />
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No crews found"
            message={search.trim() ? 'Try adjusting your search.' : 'No crews have been created yet.'}
          />
        }
      />

      {/* Destructive confirm — gates delete-crew / remove-member. */}
      <ConfirmDialog
        visible={!!confirm && !busy}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.confirmLabel || ''}
        destructive
        onConfirm={() => void runConfirmed()}
        onCancel={cancelConfirm}
      />
      <UserPicker
        visible={!!pickerCrewId}
        onClose={() => setPickerCrewId(null)}
        title={`Add a member to ${pickerCrew?.name ?? 'crew'}`}
        existingUserIds={(pickerCrewId ? membersByCrew[pickerCrewId] : undefined)?.map((m) => m.userId) ?? []}
        fullMessage={
          pickerCrew && pickerCrew.memberCount >= pickerCrew.maxMembers
            ? `This crew is full (${pickerCrew.maxMembers} members).`
            : null
        }
        onPick={addMember}
      />

      <Stack.Screen options={{ headerShown: false }} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  headerBlock: {
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  // Search ----------------------------------------------------------------
  search: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.input,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  searchFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  // Crew card -------------------------------------------------------------
  crewCard: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  crewHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crewMeta: {
    flex: 1,
    gap: t.spacing[1],
  },
  crewName: {
    ...typeStyle('title', 600),
    color: t.colors.text.primary,
  },
  crewSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  crewActions: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  flexBtn: {
    flex: 1,
  },
  // Members ---------------------------------------------------------------
  membersBlock: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
    gap: t.spacing[2],
  },
  membersHeading: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  memberHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  memberName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  memberRole: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  removeBtn: {
    minHeight: 44,
  },
  addBtn: {
    minHeight: 44,
  },
  // Banner ----------------------------------------------------------------
  banner: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  bannerOk: {
    backgroundColor: t.colors.bg.secondary,
    borderColor: t.colors.accent.aqua,
  },
  bannerError: {
    backgroundColor: t.colors.bg.secondary,
    borderColor: t.colors.accent.coral,
  },
  bannerText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  bannerTextError: {
    color: t.colors.text.danger,
  },
}));
