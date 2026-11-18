import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  artistTitle,
  changeEverywhereText,
  changedArtistFrom,
  listFestivalArtists,
  runSpotifyBackfill,
  updateArtist,
} from '@festie/shared/services';
import type { AdminArtistRow, ArtistChanges } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { backfillSummary, isSafeExternalUrl, platformLabel } from '@festie/shared/utils';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin: the Artists screen for one festival. Lists the artists on its sets and announced names,
 * rows with no links first. Tap a row to add or remove a link or change the note. An edit changes
 * every festival that lists the artist, past ones too, so the first save of an artist on other
 * festivals asks "Change it everywhere?". Each row saves on its own. It is a separate screen from
 * the festival editor, so a backfill can never reload an editor that holds unsaved edits.
 *
 *   ?id=<festivalId>  (required)
 */

type Notice = { text: string; names?: string[]; error?: boolean };
interface Draft {
  addLink: string;
  label: string;
  removed: string[];
}

const HEADER_TITLE = 'Artists';
const emptyDraft = (artist: AdminArtistRow): Draft => ({ addLink: '', label: artist.label, removed: [] });
const hasChanges = (artist: AdminArtistRow, draft: Draft) =>
  draft.addLink.trim() !== '' || draft.removed.length > 0 || draft.label.trim() !== artist.label;

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function FestivalArtistsScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const festivalId = typeof id === 'string' && id.length > 0 ? id : null;

  const [artists, setArtists] = useState<AdminArtistRow[] | null>(null);
  const [loading, setLoading] = useState(!!festivalId);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [noLinksOnly, setNoLinksOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  // Key of the running request: 'all' or 'save:<artistId>'.
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    if (!festivalId) return;
    setLoadError(false);
    try {
      setArtists(await listFestivalArtists(festivalId));
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

  const shown = useMemo(() => (artists ?? []).filter((a) => !noLinksOnly || a.linkCount === 0), [artists, noLinksOnly]);
  const linked = (artists ?? []).filter((a) => a.linkCount > 0).length;
  const confirming = (artists ?? []).find((a) => a.id === confirmId) ?? null;

  const draftOf = (artist: AdminArtistRow) => drafts[artist.id] ?? emptyDraft(artist);
  const patchDraft = (artist: AdminArtistRow, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [artist.id]: { ...draftOf(artist), ...patch } }));

  const replaceArtist = (artistId: string, next: AdminArtistRow) => {
    setArtists((list) => (list ?? []).map((a) => (a.id === artistId ? next : a)));
    setDrafts((d) => ({ ...d, [artistId]: emptyDraft(next) }));
  };

  const save = async (artist: AdminArtistRow) => {
    const draft = draftOf(artist);
    const changes: ArtistChanges = {};
    if (draft.addLink.trim()) changes.addLink = draft.addLink.trim();
    if (draft.removed.length > 0) changes.removeLinks = draft.removed;
    if (draft.label.trim() !== artist.label) changes.label = draft.label.trim();
    setAsked((s) => new Set(s).add(artist.id));
    setBusy(`save:${artist.id}`);
    setNotice(null);
    try {
      const saved = await updateArtist(artist.id, artist.updatedAt, changes);
      replaceArtist(artist.id, { ...artist, ...saved.artist });
      setNotice({ text: `Saved ${artist.name}.` });
    } catch (err) {
      const current = changedArtistFrom(err);
      if (current) {
        replaceArtist(artist.id, { ...artist, ...current });
        setNotice({
          text: `Someone changed ${current.name} while you were editing. Here is the new version. Apply your change again.`,
          error: true,
        });
      } else {
        setNotice({ text: errorText(err, "Couldn't save. Try again."), error: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const requestSave = (artist: AdminArtistRow) => {
    if (artist.alsoOn > 0 && !asked.has(artist.id)) setConfirmId(artist.id);
    else void save(artist);
  };

  const findMissing = async () => {
    if (!festivalId) return;
    setBusy('all');
    setNotice(null);
    try {
      const result = await runSpotifyBackfill(festivalId);
      setNotice({ text: backfillSummary(result), names: result.unmatched });
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
          message="Open the admin festival list, then choose Artists."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <LoadingState label="Loading artists" />
      </View>
    );
  }

  if (loadError || !artists) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: HEADER_TITLE, headerShown: true }} />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load artists"
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
        <Text style={styles.coverage}>
          {`${linked} of ${artists.length} ${artists.length === 1 ? 'artist has' : 'artists have'} a link.`}
        </Text>

        <View style={styles.toolbar}>
          {([false, true] as const).map((only) => (
            <TouchableOpacity
              key={String(only)}
              onPress={() => setNoLinksOnly(only)}
              style={[styles.chip, noLinksOnly === only ? styles.chipActive : null]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: noLinksOnly === only }}
            >
              <Text style={[styles.chipText, noLinksOnly === only ? styles.chipTextActive : null]}>
                {only ? 'No links' : 'On this festival'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => setFindOpen(true)}
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

        {shown.length === 0 ? (
          <Text style={styles.emptyHint}>{noLinksOnly ? 'Every artist has a link.' : 'No artists yet.'}</Text>
        ) : (
          shown.map((artist) => {
            const open = openId === artist.id;
            const draft = draftOf(artist);
            const links = Object.entries(artist.links);
            const saving = busy === `save:${artist.id}`;
            return (
              <View key={artist.id} style={styles.card}>
                <TouchableOpacity
                  onPress={() => setOpenId(open ? null : artist.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${artistTitle(artist)}, ${open ? 'collapse' : 'edit'}`}
                >
                  <Text style={styles.setName}>{artistTitle(artist)}</Text>
                  <Text style={styles.stageName}>
                    {links.length === 0 ? 'No links' : links.map(([platform]) => platformLabel(platform)).join(', ')}
                    {artist.alsoOn > 0 ? ` · Also on ${artist.alsoOn} ${artist.alsoOn === 1 ? 'festival' : 'festivals'}` : ''}
                  </Text>
                </TouchableOpacity>

                {open ? (
                  <View style={styles.artistBlock}>
                    {links.map(([platform, url]) => {
                      const removed = draft.removed.includes(platform);
                      return (
                        <View key={platform} style={styles.statusRow}>
                          {isSafeExternalUrl(url) ? (
                            <TouchableOpacity
                              onPress={() => void Linking.openURL(url)}
                              accessibilityRole="link"
                              accessibilityLabel={`Open ${artist.name} on ${platformLabel(platform)}`}
                            >
                              <Text style={[styles.linkText, removed ? styles.struck : null]}>{platformLabel(platform)}</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={styles.statusText}>{platformLabel(platform)}</Text>
                          )}
                          <TouchableOpacity
                            onPress={() =>
                              patchDraft(artist, {
                                removed: removed ? draft.removed.filter((p) => p !== platform) : [...draft.removed, platform],
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`${removed ? 'Keep' : 'Remove'} ${platformLabel(platform)} link for ${artist.name}`}
                          >
                            <Text style={styles.linkText}>{removed ? 'Keep' : 'Remove'}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    <LabeledTextInput
                      label={`Add link for ${artist.name}`}
                      value={draft.addLink}
                      onChangeText={(text) => patchDraft(artist, { addLink: text })}
                      placeholder="Paste a link. Festie detects the platform."
                      keyboardType="url"
                      autoCapitalize="none"
                      editable={busy === null}
                    />
                    {artist.sameName || artist.label ? (
                      <LabeledTextInput
                        label={`Note to tell ${artist.name} apart`}
                        value={draft.label}
                        onChangeText={(text) => patchDraft(artist, { label: text })}
                        placeholder="For example UK or Berlin"
                        maxLength={40}
                        editable={busy === null}
                      />
                    ) : null}
                    <TouchableOpacity
                      onPress={() => requestSave(artist)}
                      disabled={busy !== null || !hasChanges(artist, draft)}
                      style={[styles.secondaryBtn, busy !== null || !hasChanges(artist, draft) ? styles.btnDisabled : null]}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Save ${artist.name}`}
                      accessibilityState={{ busy: saving, disabled: busy !== null || !hasChanges(artist, draft) }}
                    >
                      <Text style={styles.secondaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirming !== null}
        title="Change everywhere?"
        message={confirming ? changeEverywhereText(confirming.name, confirming.alsoOn) : ''}
        confirmLabel="Change everywhere"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          const target = confirming;
          setConfirmId(null);
          if (target) void save(target);
        }}
      />
      <ConfirmDialog
        visible={findOpen}
        title="Find missing Spotify links?"
        message="Festie searches Spotify for artists on this festival only that have no Spotify link and adds the best match. Artists on other festivals are skipped. Links you already have stay as they are."
        confirmLabel="Search Spotify"
        onCancel={() => setFindOpen(false)}
        onConfirm={() => {
          setFindOpen(false);
          void findMissing();
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
  struck: {
    textDecorationLine: 'line-through',
  },
}));
