import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, runSpotifyBackfill, saveSetLink } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { backfillSummary, isHttpsUrl, linkCoverage, linkCoverageText, setLinkRows } from '@festie/shared/utils';
import type { LooseFestivalDetail, SetLinkRow } from '@festie/shared/utils';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin: Spotify links for one festival. Lists every set and artist with its
 * Spotify link, lets an admin paste a link per artist, search Spotify again for
 * one set, or find every missing link. It is a separate screen from the festival
 * editor, so a backfill can never reload an editor that holds unsaved edits.
 *
 *   ?id=<festivalId>  (required)
 */

type Notice = { text: string; names?: string[]; error?: boolean };

const HEADER_TITLE = 'Spotify links';
const draftKey = (setId: string, index: number) => `${setId}:${index}`;

// Shows a saved link on the row without a reload (the server already stored it).
function withSavedLink(detail: LooseFestivalDetail, setId: string, index: number, url: string | null) {
  return {
    ...detail,
    days: (detail.days ?? []).map((day) => ({
      ...day,
      sets: (day.sets ?? []).map((set) => {
        if (set.id !== setId) return set;
        if (set.artists && set.artists.length > 0) {
          return {
            ...set,
            artists: set.artists.map((a, i) => {
              if (i !== index) return a;
              const { spotify: _drop, ...rest } = a.links ?? {};
              return { ...a, links: url ? { ...rest, spotify: url } : rest };
            }),
          };
        }
        return { ...set, linkUrl: url };
      }),
    })),
  };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function FestivalLinksScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const festivalId = typeof id === 'string' && id.length > 0 ? id : null;

  const [detail, setDetail] = useState<LooseFestivalDetail | null>(null);
  const [loading, setLoading] = useState(!!festivalId);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [missingOnly, setMissingOnly] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Key of the running request: 'all', 'search:<setId>' or 'save:<setId>:<index>'.
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    if (!festivalId) return;
    setLoadError(false);
    try {
      const full = await api.get<LooseFestivalDetail>(`/festivals/${encodeURIComponent(festivalId)}`);
      setDetail(full);
      setDrafts({});
    } catch {
      setLoadError(true);
    }
  }, [festivalId]);

  useEffect(() => {
    if (!isAdmin || !festivalId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: nothing to fetch for non-admins / missing id; clear the initial loading flag.
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
  }, [isAdmin, festivalId, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const rows = useMemo(() => (detail ? setLinkRows(detail) : []), [detail]);
  const coverage = useMemo(() => linkCoverage(rows), [rows]);
  const visibleRows = useMemo(
    () => (missingOnly ? rows.filter((r) => r.artists.some((a) => !a.spotifyUrl)) : rows),
    [rows, missingOnly],
  );
  const days = useMemo(() => {
    const groups: { label: string; rows: SetLinkRow[] }[] = [];
    for (const row of visibleRows) {
      const last = groups[groups.length - 1];
      if (last && last.label === row.dayLabel) last.rows.push(row);
      else groups.push({ label: row.dayLabel, rows: [row] });
    }
    return groups;
  }, [visibleRows]);

  const saveLink = async (row: SetLinkRow, index: number, current: string | null) => {
    if (!festivalId) return;
    const value = (drafts[draftKey(row.setId, index)] ?? current ?? '').trim();
    if (value && !isHttpsUrl(value)) {
      setNotice({ text: 'Paste a link that starts with https://', error: true });
      return;
    }
    setBusy(`save:${row.setId}:${index}`);
    try {
      await saveSetLink(festivalId, row.setId, value || null, index);
      setDetail((d) => (d ? withSavedLink(d, row.setId, index, value || null) : d));
      setDrafts((d) => {
        const { [draftKey(row.setId, index)]: _done, ...rest } = d;
        return rest;
      });
      setNotice({ text: 'Link saved.' });
    } catch (err) {
      setNotice({ text: errorText(err, "Couldn't save the link. Try again."), error: true });
    } finally {
      setBusy(null);
    }
  };

  const backfill = async (opts: { setIds: string[]; force: boolean } | undefined, key: string, row?: SetLinkRow) => {
    if (!festivalId) return;
    setBusy(key);
    setNotice(null);
    try {
      const result = await runSpotifyBackfill(festivalId, opts);
      if (row) {
        const name = row.artists.map((a) => a.name).join(' & ');
        setNotice({ text: result.updated > 0 ? `Linked ${name}.` : `No Spotify match for ${name}.` });
      } else {
        setNotice({ text: backfillSummary(result), names: result.unmatched });
      }
      await load();
    } catch (err) {
      setNotice({ text: errorText(err, "Couldn't search Spotify. Try again."), error: true });
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  if (!festivalId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <EmptyState
          icon="musical-notes-outline"
          title="No festival selected"
          message="Open the admin festival list, then choose Links."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <LoadingState label="Loading Spotify links" />
      </View>
    );
  }

  if (loadError || !detail) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load festival"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </View>
    );
  }

  const searchingAll = busy === 'all';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(t.spacing[8], insets.bottom + t.spacing[6]) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.colors.accent.aqua}
            colors={[t.colors.accent.aqua]}
            progressBackgroundColor={t.colors.bg.secondary}
          />
        }
      >
        <Text style={styles.coverage}>{linkCoverageText(coverage)}</Text>

        <View style={styles.toolbar}>
          {([false, true] as const).map((only) => (
            <TouchableOpacity
              key={String(only)}
              onPress={() => setMissingOnly(only)}
              style={[styles.chip, missingOnly === only ? styles.chipActive : null]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: missingOnly === only }}
            >
              <Text style={[styles.chipText, missingOnly === only ? styles.chipTextActive : null]}>
                {only ? 'Missing only' : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => setConfirmOpen(true)}
          disabled={busy !== null}
          style={[styles.primaryBtn, busy !== null ? styles.btnDisabled : null]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ busy: searchingAll, disabled: busy !== null }}
        >
          {searchingAll ? <ActivityIndicator size="small" color={t.colors.text.onLightAccent} /> : null}
          <Text style={styles.primaryBtnText}>{searchingAll ? 'Searching Spotify…' : 'Find missing links'}</Text>
        </TouchableOpacity>

        {notice ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeText, notice.error ? styles.noticeError : null]}>{notice.text}</Text>
            {notice.names?.map((name) => (
              <Text key={name} style={styles.noticeName}>
                {`• ${name}`}
              </Text>
            ))}
          </View>
        ) : null}

        {days.length === 0 ? (
          <Text style={styles.emptyHint}>{missingOnly ? 'Every artist has a link.' : 'No sets yet.'}</Text>
        ) : (
          days.map((day) => (
            <View key={day.label} style={styles.dayGroup}>
              <SectionLabel>{day.label}</SectionLabel>
              {day.rows.map((row) => {
                const setName = row.artists.map((a) => a.name).join(' & ');
                const searching = busy === `search:${row.setId}`;
                return (
                  <View key={row.setId} style={styles.card}>
                    <Text style={styles.setName}>{setName}</Text>
                    {row.stageName ? <Text style={styles.stageName}>{row.stageName}</Text> : null}
                    {row.artists.map((artist) => {
                      const value = drafts[draftKey(row.setId, artist.index)] ?? artist.spotifyUrl ?? '';
                      const removing = !value.trim() && !!artist.spotifyUrl;
                      const saving = busy === `save:${row.setId}:${artist.index}`;
                      return (
                        <View key={artist.index} style={styles.artistBlock}>
                          <View style={styles.statusRow}>
                            <Text style={styles.statusText}>{artist.spotifyUrl ? 'Linked' : 'No link'}</Text>
                            {artist.spotifyUrl ? (
                              <TouchableOpacity
                                onPress={() => void Linking.openURL(artist.spotifyUrl!)}
                                accessibilityRole="link"
                                accessibilityLabel={`Open ${artist.name} in Spotify`}
                              >
                                <Text style={styles.linkText}>Open in Spotify</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                          <LabeledTextInput
                            label={`Spotify link for ${artist.name}`}
                            value={value}
                            onChangeText={(text) =>
                              setDrafts((d) => ({ ...d, [draftKey(row.setId, artist.index)]: text }))
                            }
                            placeholder="https://open.spotify.com/artist/…"
                            keyboardType="url"
                            autoCapitalize="none"
                            editable={busy === null}
                          />
                          <TouchableOpacity
                            onPress={() => void saveLink(row, artist.index, artist.spotifyUrl)}
                            disabled={busy !== null}
                            style={[styles.secondaryBtn, busy !== null ? styles.btnDisabled : null]}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityState={{ busy: saving, disabled: busy !== null }}
                          >
                            <Text style={styles.secondaryBtnText}>{removing ? 'Remove link' : 'Save link'}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      onPress={() => void backfill({ setIds: [row.setId], force: true }, `search:${row.setId}`, row)}
                      disabled={busy !== null}
                      style={[styles.secondaryBtn, busy !== null ? styles.btnDisabled : null]}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Search again for ${setName}`}
                      accessibilityState={{ busy: searching, disabled: busy !== null }}
                    >
                      <Text style={styles.secondaryBtnText}>{searching ? 'Searching Spotify…' : 'Search again'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmOpen}
        title="Find missing Spotify links?"
        message={`Festie searches Spotify for the ${coverage.total - coverage.linked} artists without a link and adds the best match. Links you already have stay as they are.`}
        confirmLabel="Search Spotify"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void backfill(undefined, 'all');
        }}
      />
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
    paddingTop: t.spacing[3],
    gap: t.spacing[3],
  },
  coverage: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  toolbar: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  chipText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  chipTextActive: {
    color: t.colors.text.onLightAccent,
  },
  primaryBtn: {
    minHeight: 48,
    flexDirection: 'row',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...typeStyle('body', 600),
    color: t.colors.text.onLightAccent,
  },
  secondaryBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  noticeText: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  noticeError: {
    color: t.colors.accent.coral,
  },
  noticeName: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  dayGroup: {
    gap: t.spacing[2],
  },
  setName: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  stageName: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  artistBlock: {
    gap: t.spacing[2],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  linkText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
}));
