import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Switch } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApiClientError,
  commitLineupImport,
  formatImportCounts,
  previewLineupImport,
  type LineupImportResult,
} from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import Button from '../../components/Button';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Lineup import. The native mirror of the web admin LineupImport
 * (packages/web/src/components/admin/LineupImport.tsx): paste CSV/TSV, then the
 * server previews every row (stage, day, status) before anything is written:
 *   POST /admin/festivals/:id/import-lineup  { text, format: 'auto', dryRun: true }
 * and the commit posts the same text with { updateExisting }.
 *
 * The import adds new sets and, when "Update sets that match" is on, updates the
 * stage and times of sets that already exist (same artist and day). Matched sets
 * keep their ids, so picks survive. It never replaces the lineup and never deletes.
 *
 * No business logic lives here: parsing, matching and validation are server-side,
 * the calls and copy are in @festie/shared/services. This screen is the native UI only.
 *
 * Route: /admin/lineup-import?id=<festivalId>. Lives under app/admin/ so the
 * root AuthGate (seg[0] === 'admin') guards it. The commit is gated behind
 * ConfirmDialog before the api call fires. Back-navigates to '/admin'.
 */
export default function LineupImportScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id: festivalId } = useLocalSearchParams<{ id?: string }>();

  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<LineupImportResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultError, setResultError] = useState(false);

  // Safe dismiss: a cold deep link has no back stack, so router.back() would
  // strand the user on a blank screen. Fall back to the admin root.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/admin');
    }
  }, [router]);

  // Editing the pasted text makes the previewed rows stale, so drop them.
  const handleTextChange = useCallback((v: string) => {
    setImportText(v);
    setPreview(null);
  }, []);

  const handlePreview = useCallback(async (nextUpdateExisting: boolean) => {
    if (!festivalId) return;
    setWorking(true);
    setResultMessage(null);
    setResultError(false);
    try {
      setPreview(await previewLineupImport(festivalId, importText, { updateExisting: nextUpdateExisting }));
    } catch (err: unknown) {
      setPreview(null);
      setResultMessage(err instanceof Error ? err.message : 'Preview failed. Try again.');
      setResultError(true);
    } finally {
      setWorking(false);
    }
  }, [festivalId, importText]);

  // The row statuses depend on this flag, so preview again with the new value.
  const handleUpdateExistingChange = useCallback(
    (value: boolean) => {
      setUpdateExisting(value);
      void handlePreview(value);
    },
    [handlePreview],
  );

  const handleClear = useCallback(() => {
    setImportText('');
    setPreview(null);
    setResultMessage(null);
    setResultError(false);
  }, []);

  const handleImport = useCallback(async () => {
    setConfirmVisible(false);
    if (!festivalId || !preview) return;
    setWorking(true);
    setResultMessage(null);
    setResultError(false);
    try {
      const result = await commitLineupImport(festivalId, importText, { updateExisting });
      handleClear();
      setResultMessage(`Imported ${result.imported} new sets and updated ${result.updated}.`);
    } catch (err: unknown) {
      // A rejected commit carries the same row report, so show what to fix.
      const rejected = err instanceof ApiClientError ? (err.details?.preview as LineupImportResult | undefined) : undefined;
      if (rejected) setPreview(rejected);
      setResultMessage(err instanceof Error ? err.message : 'Import failed.');
      setResultError(true);
    } finally {
      setWorking(false);
    }
  }, [festivalId, preview, importText, updateExisting, handleClear]);

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const blocked = !!preview && (preview.counts.error > 0 || preview.errors.length > 0);
  const hasWork = !!preview && (preview.counts.new > 0 || (updateExisting && preview.counts.update > 0));
  const canImport = hasWork && !blocked && !working;
  const importLabel = preview
    ? `Import ${preview.counts.new} new${updateExisting ? `, update ${preview.counts.update}` : ''}`
    : 'Import';

  // Non-admins never reach the data; AuthGate already guards the segment, but
  // mirror the index screen's defensive empty state in case of a direct render.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Import lineup" subtitle="Admin" icon="cloud-upload-outline" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  // No festival id in the route — there is nothing to import into.
  if (!festivalId) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Import lineup" subtitle="Admin" icon="cloud-upload-outline" />
        <EmptyState
          icon="alert-circle-outline"
          title="No festival selected"
          message="Open this screen from a festival to import its lineup."
          action={{ label: 'Back to admin', onPress: goBack }}
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Import lineup"
        subtitle="Paste CSV/TSV and preview"
        icon="cloud-upload-outline"
        right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
      />

      <FlatList
        data={rows}
        keyExtractor={(item, i) => `${item.line}-${i}`}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {/* Paste area + column reference */}
            <View style={styles.card}>
              <Text style={styles.helpTitle}>Columns</Text>
              <Text style={styles.helpMono}>artist, stage, day, start, end, link</Text>
              <Text style={styles.helpNote}>
                Header optional. Day can be a label, a date (YYYY-MM-DD) or a number.
              </Text>
            </View>

            <LabeledTextInput
              label="CSV / TSV data"
              value={importText}
              onChangeText={handleTextChange}
              placeholder="Paste CSV or TSV data here…"
              autoCapitalize="none"
              multiline
              hint="Stages and days must already exist in this festival."
            />

            <View style={styles.actionsRow}>
              <Button
                label="Preview"
                variant="secondary"
                icon="eye-outline"
                onPress={() => void handlePreview(updateExisting)}
                loading={working}
                loadingLabel="Working"
                disabled={importText.trim().length === 0 || working}
                style={styles.flexBtn}
              />
              {preview ? (
                <Button
                  label="Clear"
                  variant="ghost"
                  icon="close-outline"
                  onPress={handleClear}
                  style={styles.flexBtn}
                />
              ) : null}
            </View>

            {/* Import result (success or failure) */}
            {resultMessage ? (
              <View style={[styles.banner, resultError ? styles.bannerError : styles.bannerOk]}>
                <Text style={[styles.bannerText, resultError && styles.bannerTextError]}>
                  {resultMessage}
                </Text>
              </View>
            ) : null}

            {/* Festival-level problems from the server */}
            {preview && preview.errors.length > 0 ? (
              <>
                <SectionLabel>Issues found</SectionLabel>
                <View style={[styles.card, styles.errorCard]}>
                  {preview.errors.map((e, i) => (
                    <Text key={i} style={styles.errorLine}>
                      • {e}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}

            {preview ? (
              <>
                <SectionLabel>Preview</SectionLabel>
                <Text style={styles.countsLine}>{formatImportCounts(preview.counts)}</Text>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Update sets that match (keeps everyone's picks)</Text>
                  <Switch
                    value={updateExisting}
                    onValueChange={handleUpdateExistingChange}
                    disabled={working}
                    accessibilityLabel="Update sets that match"
                  />
                </View>
                {preview.missing.length > 0 ? (
                  <Text style={styles.helpNote}>
                    {preview.missing.length} sets in this festival are not in your file. Import never deletes sets.
                    Remove them in the editor if you need to.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const isError = item.status === 'error';
          return (
            <View
              style={[styles.card, isError && styles.errorCard, index < rows.length - 1 && styles.previewSpacer]}
              accessibilityRole="text"
              accessibilityLabel={`Line ${item.line}, ${item.artist}, ${item.status}`}
            >
              <View style={styles.previewRow}>
                <Text style={styles.previewArtist} numberOfLines={1}>
                  {item.artist || `Line ${item.line}`}
                </Text>
                <View style={[styles.stagePill, isError && styles.statusPillError]}>
                  <Text style={[styles.stagePillText, isError && styles.errorLine]} numberOfLines={1}>
                    {item.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.previewMeta} numberOfLines={1}>
                Line {item.line} · {item.stageName ?? 'No stage'} · {item.dayLabel ?? 'No day'}
                {item.startTime ? ` · ${item.startTime}` : ''}
                {item.endTime ? `–${item.endTime}` : ''}
              </Text>
              {item.message ? <Text style={styles.errorLine}>{item.message}</Text> : null}
            </View>
          );
        }}
        ListEmptyComponent={
          preview && !working ? (
            <EmptyState
              icon="document-text-outline"
              title="No rows found"
              message="Nothing was read from the pasted data. Check the header row and try again."
            />
          ) : undefined
        }
        ListFooterComponent={
          preview ? (
            <View style={styles.footer}>
              {blocked ? <Text style={styles.errorLine}>Fix the rows marked in red, then preview again.</Text> : null}
              <Button
                label={importLabel}
                icon="cloud-upload-outline"
                loading={working}
                loadingLabel="Importing"
                disabled={!canImport}
                onPress={() => setConfirmVisible(true)}
              />
            </View>
          ) : undefined
        }
      />

      {/* Confirm before the write. The import adds and updates; it never deletes. */}
      <ConfirmDialog
        visible={confirmVisible}
        title="Import lineup?"
        message={preview ? formatImportCounts(preview.counts) : ''}
        confirmLabel="Import"
        onConfirm={() => void handleImport()}
        onCancel={() => setConfirmVisible(false)}
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
    gap: t.spacing[3],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[1],
  },
  helpTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  helpMono: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginBottom: t.spacing[2],
  },
  helpNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  countsLine: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
  },
  toggleLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    flex: 1,
  },
  statusPillError: {
    borderColor: t.colors.accent.coral,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  flexBtn: {
    flex: 1,
  },
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
  errorCard: {
    borderColor: t.colors.accent.coral,
    gap: t.spacing[1],
  },
  errorLine: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  previewSpacer: {
    marginBottom: t.spacing[2],
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  previewArtist: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  previewMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  stagePill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    maxWidth: 160,
    flexShrink: 0,
  },
  stagePillText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  footer: {
    marginTop: t.spacing[3],
    gap: t.spacing[2],
  },
}));
