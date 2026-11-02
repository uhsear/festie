import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiClientError, fetchAdminUserDetail, type AdminUserDetail } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { maskEmail, PRIVATE_VIEW_NOTICE, timeAgoFromIso } from '@festie/shared/utils';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — read-only user detail. Opening it writes one `user.private_data.viewed`
 * audit row on the server, so the screen says so and offers no write action.
 * Endpoint: GET /admin/users/:id (via fetchAdminUserDetail).
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: AdminUserDetail };

export default function AdminUserDetailScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [showEmail, setShowEmail] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', detail: await fetchAdminUserDetail(id) });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong. Try again.' });
    }
  }, [id]);

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: the load sets loading, then the result.
    void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'User' }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  const body = () => {
    if (state.kind === 'loading') return <LoadingState label="Loading user" />;
    if (state.kind === 'not-found') {
      return <EmptyState icon="person-outline" title="This user no longer exists." />;
    }
    if (state.kind === 'error') {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load this user"
          message={state.message}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      );
    }
    const { user, festivals, crews, activity } = state.detail;
    const rows: [string, string][] = [
      ['Email status', user.emailVerified ? 'Verified' : 'Not verified'],
      ['Joined', new Date(user.createdAt).toLocaleDateString()],
      ['Last active', user.lastActiveAt ? timeAgoFromIso(user.lastActiveAt) : 'No active session'],
      ['Public schedule', user.publicSchedule ? 'On' : 'Off'],
      ['Role', user.roles.includes('admin') ? 'Admin' : 'Member'],
    ];
    return (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>@{user.username}</Text>
          {user.displayName ? <Text style={styles.value}>{user.displayName}</Text> : null}
          <Text style={styles.caption}>{PRIVATE_VIEW_NOTICE}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.detailRow}>
            <Text style={styles.label}>Email</Text>
            <Text style={[styles.value, styles.flex]} numberOfLines={1}>
              {showEmail && user.email ? user.email : maskEmail(user.email)}
            </Text>
            {user.email ? (
              <TouchableOpacity
                style={styles.showButton}
                onPress={() => setShowEmail((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showEmail ? 'Hide email' : 'Show email'}
              >
                <Text style={styles.link}>{showEmail ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.detailRow}>
              <Text style={styles.label}>{label}</Text>
              <Text style={[styles.value, styles.flex]}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Festivals ({festivals.length})</Text>
        <View style={styles.card}>
          {festivals.length === 0 ? <Text style={styles.empty}>Not in any festival yet.</Text> : null}
          {festivals.map((f) => (
            <View key={`${f.festivalId}-${f.joinedAt}`} style={styles.listRow}>
              <Text style={styles.value}>{f.festivalName ?? 'Archived festival'}</Text>
              <Text style={styles.caption}>
                {f.picks} {f.picks === 1 ? 'pick' : 'picks'}
                {f.profileName ? ` · as ${f.profileName}` : ''}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Crews ({crews.length})</Text>
        <View style={styles.card}>
          {crews.length === 0 ? <Text style={styles.empty}>Not in any crew.</Text> : null}
          {crews.map((c) => (
            <View key={c.id} style={styles.listRow}>
              <Text style={styles.value}>{c.name}</Text>
              <Text style={styles.caption}>
                {c.festivalName ?? 'Archived festival'} · {c.role === 'owner' ? 'Owner' : 'Member'} · {c.memberCount}{' '}
                {c.memberCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Recent activity</Text>
        <View style={styles.card}>
          {activity.length === 0 ? <Text style={styles.empty}>No activity in the last 90 days.</Text> : null}
          {activity.map((a) => (
            <View key={a.id} style={styles.listRow}>
              <Text style={styles.value}>{a.friendlyAction}</Text>
              <Text style={styles.caption}>
                {a.actorUsername ?? 'system'} · {a.targetLabel ?? '—'} · {timeAgoFromIso(a.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'User' }} />
      {body()}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.bg.primary },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[4],
    gap: t.spacing[3],
  },
  header: { gap: t.spacing[1] },
  title: { ...typeStyle('title', 700), color: t.colors.text.primary },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    minHeight: 44,
  },
  listRow: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    gap: t.spacing[1],
  },
  flex: { flex: 1 },
  label: { ...typeStyle('caption'), color: t.colors.text.secondary, width: 110 },
  value: { ...typeStyle('body'), color: t.colors.text.primary },
  caption: { ...typeStyle('caption'), color: t.colors.text.muted },
  empty: { ...typeStyle('caption'), color: t.colors.text.muted, padding: t.spacing[4] },
  sectionTitle: { ...typeStyle('label', 600), color: t.colors.text.primary },
  link: { ...typeStyle('label', 600), color: t.colors.accent.aqua },
  showButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
}));
