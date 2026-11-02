import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, Alert, Share } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  withReauth,
  setAdminRole,
  createResetLink,
  bulkForceLogout,
  api,
  type AdminUserRow,
} from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { useAdminUserList } from '@festie/shared/hooks';
import {
  maskEmail,
  roleChangeCopy,
  resetLinkCopy,
  resetLinkReadyMessage,
  bulkConfirmCopy,
  summarizeBulkResults,
  toggleSelection,
  SELECTION_LIMIT_MESSAGE,
} from '@festie/shared/utils';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { ConfirmDialog, LabeledTextInput, SelectionBar, useReauthPrompt } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — User management (native mirror of packages/web AdminUsers.tsx).
 *
 * Lives under app/admin/ so the root AuthGate (seg[0] === 'admin') guards it;
 * a non-admin who deep-links here is bounced to the tabs by that gate, and we
 * also render an "Admins only" EmptyState as a belt-and-braces fallback. The
 * native Stack header (headerShown) supplies the back chevron that returns to
 * /admin — pushed non-tab screens use the platform header per ScreenHeader's
 * adoption rule.
 *
 * Uses the shared admin client (@festie/shared/services) and useAdminUserList.
 * Endpoints resolve under /api/v1:
 *   GET    /admin/users?search&cursor&limit  → paged list; search is server-side and
 *                                              "Load more" fetches the next page
 *   GET    /admin/users/:id                  → detail (user-detail.tsx)
 *   POST   /admin/users/:id/roles            { role: 'admin' }   → grant admin
 *   DELETE /admin/users/:id/roles/admin                          → revoke admin
 *   POST   /admin/users/:id/reset-link                           → one-time reset link
 *   PUT    /admin/users/:id/reset-password   { newPassword }     → admin reset
 *   DELETE /admin/users/:id                                      → delete user
 *   POST   /admin/bulk/force-logout                              → bulk force-logout
 *
 * EVERY destructive write (grant/revoke admin, reset link, reset password,
 * delete, force-logout) is gated behind ConfirmDialog before the call fires.
 */

// Discriminated confirm intents — the parent owns the dialog state and which
// mutation the confirm button will run, mirroring the web ConfirmDialog wiring.
type PendingAction =
  | { kind: 'toggle-admin'; user: AdminUserRow; grant: boolean }
  | { kind: 'reset-link'; user: AdminUserRow }
  | { kind: 'reset-password'; user: AdminUserRow; newPassword: string }
  | { kind: 'force-logout' }
  | { kind: 'delete'; user: AdminUserRow };

export default function AdminUsersScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const router = useRouter();
  const { users, total, hasMore, loading, loadingMore, error, search, setSearch, loadMore, refresh, patchUser, removeUser } =
    useAdminUserList({ enabled: isAdmin });
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limited, setLimited] = useState(false);

  // Which user's inline action panel (reset-password form) is expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  // Pending destructive intent + in-flight guard for the ConfirmDialog.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const { askPassword: askReauthPassword, reauthDialog } = useReauthPrompt();

  const leaveSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setLimited(false);
  }, []);

  const onToggleSelect = useCallback(
    (id: string) => {
      const { next, limited: hitLimit } = toggleSelection(selected, id);
      setSelected(next);
      setLimited(hitLimit);
    },
    [selected],
  );

  // ── Open the reset-password panel for a user (collapse others) ──────────
  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setNewPassword('');
    setPwError(null);
  }, []);

  // ── Stage a destructive intent into the ConfirmDialog ───────────────────
  const requestToggleAdmin = useCallback((user: AdminUserRow) => {
    const grant = !user.roles.includes('admin');
    setPending({ kind: 'toggle-admin', user, grant });
  }, []);

  const requestResetPassword = useCallback(
    (user: AdminUserRow) => {
      const pw = newPassword;
      if (pw.length < 8) {
        setPwError('Password must be at least 8 characters.');
        return;
      }
      setPwError(null);
      setPending({ kind: 'reset-password', user, newPassword: pw });
    },
    [newPassword],
  );

  const requestResetLink = useCallback((user: AdminUserRow) => {
    setPending({ kind: 'reset-link', user });
  }, []);

  const requestDelete = useCallback((user: AdminUserRow) => {
    setPending({ kind: 'delete', user });
  }, []);

  // ── Run the confirmed mutation, then reconcile local state ──────────────
  const runPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    // withReauth returns null both on cancel and for an empty response, so track cancel here.
    let cancelled = false;
    const askPassword = async () => {
      const password = await askReauthPassword();
      if (password === null) cancelled = true;
      return password;
    };
    try {
      if (pending.kind === 'toggle-admin') {
        const { user, grant } = pending;
        await withReauth(() => setAdminRole(user.id, grant), askPassword);
        if (cancelled) {
          setPending(null);
          return;
        }
        patchUser(user.id, {
          roles: grant ? [...user.roles, 'admin'] : user.roles.filter((r) => r !== 'admin'),
        });
        setPending(null);
        Alert.alert(grant ? 'Admin granted' : 'Admin revoked', `@${user.username} ${grant ? 'now has' : 'no longer has'} admin access.`);
      } else if (pending.kind === 'reset-link') {
        const { user } = pending;
        const { resetUrl, username, expiresAt } = await createResetLink(user.id);
        setPending(null);
        await Share.share({ message: resetUrl });
        Alert.alert('Reset link ready', resetLinkReadyMessage(username, expiresAt));
      } else if (pending.kind === 'force-logout') {
        const ids = [...selected];
        const done = await withReauth(() => bulkForceLogout(ids), askPassword);
        if (cancelled || !done) {
          setPending(null);
          return;
        }
        setPending(null);
        leaveSelectMode();
        Alert.alert('Force-logout', summarizeBulkResults('force-logout', done.results));
      } else if (pending.kind === 'reset-password') {
        const { user, newPassword: pw } = pending;
        await withReauth(
          () => api.put<unknown>(`/admin/users/${user.id}/reset-password`, { newPassword: pw }),
          askPassword,
        );
        if (cancelled) {
          setPending(null);
          return;
        }
        setPending(null);
        setExpandedId(null);
        setNewPassword('');
        Alert.alert('Password reset', `A new password has been set for @${user.username}.`);
      } else {
        const { user } = pending;
        await withReauth(() => api.delete<unknown>(`/admin/users/${user.id}`), askPassword);
        if (cancelled) {
          setPending(null);
          return;
        }
        removeUser(user.id);
        if (expandedId === user.id) setExpandedId(null);
        setPending(null);
        Alert.alert('User deleted', `@${user.username} has been removed.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      // Keep the dialog open on failure so the admin can retry or cancel.
      Alert.alert('Action failed', msg);
    } finally {
      setBusy(false);
    }
  }, [pending, expandedId, askReauthPassword, patchUser, removeUser, selected, leaveSelectMode]);

  // Confirm-dialog copy derived from the staged intent.
  const confirm = useMemo(() => {
    if (!pending) return null;
    if (pending.kind === 'toggle-admin') {
      return { ...roleChangeCopy(pending.user.username, pending.grant), destructive: true };
    }
    if (pending.kind === 'reset-link') {
      return { ...resetLinkCopy(pending.user.username), destructive: false };
    }
    if (pending.kind === 'force-logout') {
      return { ...bulkConfirmCopy('force-logout', selected.size), destructive: true };
    }
    if (pending.kind === 'reset-password') {
      return {
        title: `Reset password for @${pending.user.username}?`,
        message:
          'This sets a new password and signs the user out of all sessions. Share the new password with them securely.',
        confirmLabel: 'Reset Password',
        destructive: true,
      };
    }
    return {
      title: `Delete @${pending.user.username}?`,
      message: 'This permanently removes their account, picks, and crew memberships. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    };
  }, [pending, selected.size]);

  const renderIdentity = (user: AdminUserRow, isUserAdmin: boolean, isSelf: boolean) => (
    <>
      <View style={styles.nameLine}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {user.username}
        </Text>
        {isSelf ? (
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>You</Text>
          </View>
        ) : null}
        {isUserAdmin ? (
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.rowHint} numberOfLines={1}>
        {revealedId === user.id && user.email ? user.email : maskEmail(user.email)}
        {user.emailVerified ? ' · Verified' : ' · Not verified'}
      </Text>
    </>
  );

  // Non-admins never see the data — the AuthGate bounces them, but render a
  // clear fallback in case this mounts before the redirect lands.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'Users' }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Users',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel={selectMode ? 'Done selecting' : 'Select users'}
            >
              <Text style={styles.headerButtonText}>{selectMode ? 'Done' : 'Select'}</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {loading && users.length === 0 && search === '' ? (
        <LoadingState label="Loading users" />
      ) : error && users.length === 0 ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load users"
          message={error}
          action={{ label: 'Try again', onPress: refresh }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) + (selected.size > 0 ? 96 : 0) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading && users.length > 0 && search === ''}
              onRefresh={refresh}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          <LabeledTextInput
            label="Search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search by username or email…"
            autoCapitalize="none"
            accessibilityLabel="Search users by username or email"
          />

          <Text style={styles.rowHint}>Users ({total})</Text>

          {users.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="No users found"
              message={`No users match "${search.trim()}". Search covers every user.`}
            />
          ) : (
            <View style={styles.card}>
              {users.map((user, i) => {
                const isUserAdmin = user.roles.includes('admin');
                const expanded = expandedId === user.id;
                const isSelf = user.id === currentUserId;
                return (
                  <View key={user.id} style={[i < users.length - 1 && styles.rowDivider]}>
                    <View style={styles.row}>
                      {selectMode ? (
                        <TouchableOpacity
                          style={styles.rowBody}
                          disabled={isSelf}
                          onPress={() => onToggleSelect(user.id)}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Select ${user.username}`}
                          accessibilityState={{ checked: selected.has(user.id), disabled: isSelf }}
                        >
                          <View style={styles.selectLine}>
                            {!isSelf ? (
                              <Ionicons
                                name={selected.has(user.id) ? 'checkbox' : 'square-outline'}
                                size={22}
                                color={selected.has(user.id) ? t.colors.accent.aqua : t.colors.text.placeholder}
                              />
                            ) : null}
                            {renderIdentity(user, isUserAdmin, isSelf)}
                          </View>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.rowBody}
                          onPress={() => router.push(`/admin/user-detail?id=${encodeURIComponent(user.id)}`)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open details for ${user.username}`}
                        >
                          {renderIdentity(user, isUserAdmin, isSelf)}
                        </TouchableOpacity>
                      )}
                      {user.email && !selectMode ? (
                        <TouchableOpacity
                          style={styles.showButton}
                          onPress={() => setRevealedId((prev) => (prev === user.id ? null : user.id))}
                          accessibilityRole="button"
                          accessibilityLabel={revealedId === user.id ? `Hide email for ${user.username}` : `Show email for ${user.username}`}
                        >
                          <Text style={styles.headerButtonText}>{revealedId === user.id ? 'Hide' : 'Show'}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {!selectMode ? (
                        <TouchableOpacity
                          style={styles.expandButton}
                          onPress={() => toggleExpanded(user.id)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={expanded ? `Hide actions for ${user.username}` : `Manage ${user.username}`}
                          accessibilityState={{ expanded }}
                        >
                          <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-forward'}
                            size={18}
                            color={t.colors.text.placeholder}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {expanded ? (
                      <View style={styles.actions}>
                        {!isSelf ? (
                          <Button
                            label={isUserAdmin ? 'Revoke Admin' : 'Grant Admin'}
                            variant="secondary"
                            size="sm"
                            icon="shield-checkmark-outline"
                            onPress={() => requestToggleAdmin(user)}
                            accessibilityLabel={isUserAdmin ? `Revoke admin from ${user.username}` : `Grant admin to ${user.username}`}
                          />
                        ) : null}

                        <Button
                          label="Share reset link"
                          variant="secondary"
                          size="sm"
                          icon="link-outline"
                          onPress={() => requestResetLink(user)}
                          accessibilityLabel={`Share reset link for ${user.username}`}
                        />

                        <View style={styles.resetBlock}>
                          <LabeledTextInput
                            label="New password"
                            value={newPassword}
                            onChangeText={(v) => {
                              setNewPassword(v);
                              if (pwError) setPwError(null);
                            }}
                            placeholder="At least 8 characters"
                            hint="Sets a new password and signs the user out everywhere."
                            error={pwError}
                            autoCapitalize="none"
                            maxLength={200}
                            accessibilityLabel={`New password for ${user.username}`}
                          />
                          <Button
                            label="Set password yourself"
                            variant="secondary"
                            size="sm"
                            icon="key-outline"
                            onPress={() => requestResetPassword(user)}
                            accessibilityLabel={`Reset password for ${user.username}`}
                          />
                        </View>

                        {!isSelf ? (
                          <Button
                            label="Delete User"
                            variant="danger"
                            size="sm"
                            icon="trash-outline"
                            onPress={() => requestDelete(user)}
                            accessibilityLabel={`Delete ${user.username}`}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {users.length > 0 ? (
            <View style={styles.footer}>
              <Text style={styles.rowHint}>
                Showing {users.length} of {total}
              </Text>
              {hasMore ? (
                <Button
                  label="Load more"
                  variant="secondary"
                  size="sm"
                  onPress={() => void loadMore()}
                  loading={loadingMore}
                  style={styles.touch}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      <SelectionBar
        count={selected.size}
        actionLabel="Force-logout"
        onAction={() => setPending({ kind: 'force-logout' })}
        onClear={() => {
          setSelected(new Set());
          setLimited(false);
        }}
        busy={busy}
        note={limited ? SELECTION_LIMIT_MESSAGE : null}
      />
      <ConfirmDialog
        visible={!!pending && !busy}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel ?? 'Confirm'}
        destructive={confirm?.destructive ?? true}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
      {reauthDialog}
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
    paddingTop: t.spacing[4],
    gap: t.spacing[3],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Aqua, not coral: "admin" is a role/status, not a danger state. Coral is
  // reserved for danger/SOS (one-accent rule), and the Account screen's own
  // ADMIN badge is aqua — this list badge was an inconsistent misuse.
  adminBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  adminBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  expandButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    paddingTop: t.spacing[1],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  headerButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  showButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  footer: {
    alignItems: 'center',
    gap: t.spacing[2],
  },
  touch: {
    minHeight: 44,
  },
  resetBlock: {
    gap: t.spacing[3],
  },
}));
