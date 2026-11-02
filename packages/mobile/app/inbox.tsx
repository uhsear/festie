import { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useInboxStore, isInboxItemUnread, type InboxItem } from '@festie/shared/stores';
import { INBOX_COPY } from '@festie/shared/constants';
import { timeAgo } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { routeNotification } from '../lib/routeNotification';
import AppPressable from '../components/AppPressable';
import Button from '../components/Button';

export default function InboxScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const bottomPad = useListBottomInset({ base: t.spacing[10] });
  const items = useInboxStore((s) => s.items);
  const loaded = useInboxStore((s) => s.loaded);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const load = useInboxStore((s) => s.load);
  // Unread dots are judged against the marker from before this visit.
  const prevSeenAt = useRef<string | null>(useInboxStore.getState().seenAt);

  useFocusEffect(
    useCallback(() => {
      prevSeenAt.current = useInboxStore.getState().seenAt;
      void (async () => {
        await useInboxStore.getState().load();
        await useInboxStore.getState().markAllSeen();
        Notifications.setBadgeCountAsync(0).catch((e) => console.warn('inbox: badge reset failed', e));
      })();
    }, []),
  );

  const retry = <Button label={INBOX_COPY.retry} variant="ghost" onPress={() => void load()} />;

  const renderItem = ({ item }: { item: InboxItem }) => {
    const unread = isInboxItemUnread(item, prevSeenAt.current);
    const ago = timeAgo(Date.parse(item.createdAt));
    return (
      <AppPressable
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.body}. ${ago}.${unread ? ` ${INBOX_COPY.unreadA11y}.` : ''}`}
        onPress={() => routeNotification(router, { ...item.data, type: item.type })}
      >
        <View
          style={[styles.dot, !unread && styles.dotHidden]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowBody}>{item.body}</Text>
          <Text style={styles.rowTime}>{ago}</Text>
        </View>
      </AppPressable>
    );
  };

  const body =
    !loaded && loading ? (
      <ActivityIndicator style={styles.spinner} color={t.colors.accent.aqua} />
    ) : error && items.length === 0 ? (
      <View style={styles.message}>
        <Text style={styles.errorText}>{error}</Text>
        {retry}
      </View>
    ) : (
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={() => void load()}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        ListHeaderComponent={
          error ? (
            <View style={styles.message}>
              <Text style={styles.errorText}>{error}</Text>
              {retry}
            </View>
          ) : undefined
        }
        ListEmptyComponent={loaded ? <Text style={styles.footnote}>{INBOX_COPY.empty}</Text> : undefined}
        ListFooterComponent={<Text style={styles.footnote}>{INBOX_COPY.footnote}</Text>}
      />
    );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: INBOX_COPY.title }} />
      {body}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.bg.primary },
  spinner: { marginTop: t.spacing[8] },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  rowText: { flex: 1, gap: t.spacing[1] },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
  },
  dotHidden: { opacity: 0 },
  rowTitle: { ...typeStyle('body', 600), color: t.colors.text.primary },
  rowBody: { ...typeStyle('caption'), color: t.colors.text.primary },
  rowTime: { ...typeStyle('caption'), color: t.colors.text.secondary },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border.light },
  message: { padding: t.spacing[4], gap: t.spacing[2], alignItems: 'flex-start' },
  errorText: { ...typeStyle('body'), color: t.colors.text.secondary },
  footnote: { ...typeStyle('caption'), color: t.colors.text.secondary, padding: t.spacing[4] },
}));
