import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { lineupImportApi } from '@festie/shared/services';
import {
  LINEUP_IMPORT_FIELDS,
  LINEUP_IMPORT_LIMITS,
  LINEUP_SAMPLE_CSV,
  buildResultCsv,
  defaultMapping,
  defaultUpdateExisting,
  groupPlanRows,
  importBlocked,
  looksLikeHeader,
  mappingProblems,
  parseLineupTable,
  parseNameList,
  planSummary,
  toImportRows,
  withArtistChoice,
  updateOffBanner,
  type LineupColumnMapping,
  type LineupGroupKey,
  type LineupImportCommitResult,
  type LineupImportField,
  type LineupImportHistoryItem,
  type LineupImportPlan,
  type LineupImportPlanRow,
  type LineupImportRow,
  type LineupImportUndoResult,
} from '@festie/shared/utils';
import { useAuthStore } from '@festie/shared/stores';
import ScreenHeader from '../../components/ScreenHeader';
import AppSwitch from '../../components/AppSwitch';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import Button from '../../components/Button';
import { ConfirmDialog, LabeledTextInput, ModalSelect, type SelectOption } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Lineup import. The native mirror of the web admin LineupImport
 * (packages/web/src/components/admin/LineupImport.tsx), in four steps:
 *   source -> match columns -> preview -> result
 * The pasted table is parsed and mapped on the device (@festie/shared), then the
 * server plans every row before anything is written:
 *   POST /admin/festivals/:id/import-lineup/preview  { rows, updateExisting, createMissing }
 *   POST /admin/festivals/:id/import-lineup          (commit, same body)
 *
 * An import adds new sets and creates missing stages and days. With "Update sets
 * that match" on, it also updates sets with the same artist and day. It never
 * replaces the lineup and never deletes. The newest import can be undone from
 * Import history, and Announce lineup sends the push and email on demand.
 *
 * No business logic lives here: parsing, mapping and copy are in
 * @festie/shared/utils, planning and writes are server-side.
 *
 * Route: /admin/lineup-import?id=<festivalId>. Lives under app/admin/ so the
 * root AuthGate (seg[0] === 'admin') guards it. The commit is gated behind
 * ConfirmDialog before the api call fires. Back-navigates to '/admin'.
 */

type Step = 'source' | 'map' | 'preview' | 'result';
type Filter = 'all' | LineupGroupKey;

/** One FlatList entry of the review screen: a group heading or a row of that group. */
type ReviewItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; row: LineupImportPlanRow; group: LineupGroupKey };

const RULES = [
  "A column you don't map is left alone. An empty cell in a mapped column clears that value, so an empty time becomes TBA.",
  'Imports never delete sets.',
  'Sets that start after midnight and before 6 AM belong to the night before. Put a 1 AM Saturday set on Friday.',
  "Write a B2B set as 'Kai b2b Mira'. Each artist gets their own link.",
  'No day, stage or time? Those rows join the announced lineup. Paste one name per line and choose "Check as a list of names".',
];

const NOT_MAPPED = '-1';
const columnLetter = (i: number) => String.fromCharCode(65 + (i % 26));
const FIELD_LABEL: Record<string, string> = {
  artist: 'Artist',
  day: 'Day',
  date: 'Date (YYYY-MM-DD)',
  stage: 'Stage',
  startTime: 'Start',
  endTime: 'End',
  link: 'Link',
};
const STATUS_LABEL = { new: 'New', changed: 'Will change', unchanged: 'Unchanged', error: 'Error' } as const;
const dateTime = (iso: string) => new Date(iso).toLocaleString();
const errMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export default function LineupImportScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id: festivalId } = useLocalSearchParams<{ id?: string }>();

  const [step, setStep] = useState<Step>('source');
  const [importText, setImportText] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [lines, setLines] = useState<number[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<LineupColumnMapping>({});
  const [importRows, setImportRows] = useState<LineupImportRow[]>([]);
  const [plan, setPlan] = useState<LineupImportPlan | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  // Whether the last checked mapping had a set_id column. Update turns on by default only when that changes.
  const checkedWithSetId = useRef<boolean | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [moveDays, setMoveDays] = useState(false);
  const [listMode, setListMode] = useState(false);
  // Rows where the admin chose "Create new" over a "Did you mean" suggestion.
  const [keepNew, setKeepNew] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [result, setResult] = useState<LineupImportCommitResult | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  const [festivalName, setFestivalName] = useState('');
  const [history, setHistory] = useState<LineupImportHistoryItem[]>([]);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [undoTarget, setUndoTarget] = useState<LineupImportHistoryItem | null>(null);
  const [announceVisible, setAnnounceVisible] = useState(false);
  const [undoKept, setUndoKept] = useState<LineupImportUndoResult['kept']>([]);

  const say = useCallback((text: string | null, isError = false) => {
    setMessage(text);
    setMessageError(isError);
  }, []);

  // Safe dismiss: a cold deep link has no back stack, so router.back() would
  // strand the user on a blank screen. Fall back to the admin root.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/admin');
    }
  }, [router]);

  const loadSide = useCallback(async () => {
    if (!festivalId) return;
    try {
      const [h, a] = await Promise.all([lineupImportApi.history(festivalId), lineupImportApi.announcement(festivalId)]);
      setHistory(h.imports);
      setFestivalName(h.festivalName || a.festivalName);
      setRecipients(a.recipients);
    } catch (err: unknown) {
      say(errMessage(err, 'Could not load import history.'), true);
    }
  }, [festivalId, say]);

  useEffect(() => {
    if (isAdmin) void loadSide();
  }, [isAdmin, loadSide]);

  const request = useCallback(
    (rows: LineupImportRow[], update: boolean, create: boolean, move: boolean) => ({
      rows,
      updateExisting: update,
      createMissing: create,
      skipSpotify: false,
      ...(move ? { moveDays: true } : {}),
    }),
    [],
  );

  const runPreview = useCallback(
    async (rows: LineupImportRow[], update: boolean, create: boolean, move: boolean) => {
      if (!festivalId) return;
      setWorking(true);
      say(null);
      try {
        setPlan(await lineupImportApi.preview(festivalId, request(rows, update, create, move)));
        setStep('preview');
      } catch (err: unknown) {
        say(errMessage(err, 'Preview failed. Try again.'), true);
      } finally {
        setWorking(false);
      }
    },
    [festivalId, request, say],
  );

  const handleNext = useCallback(() => {
    // UTF-16 length is a close lower bound on bytes; the server enforces the real body limit.
    if (importText.length > LINEUP_IMPORT_LIMITS.maxBytes) {
      say('This is larger than 200 KB. Split it and import it in parts.', true);
      return;
    }
    const parsed = parseLineupTable(importText);
    if (parsed.rows.length === 0) {
      say('Nothing was read from the pasted data.', true);
      return;
    }
    const header = looksLikeHeader(parsed.rows[0] ?? []);
    setTable(parsed.rows);
    checkedWithSetId.current = null;
    setLines(parsed.lines);
    setHasHeader(header);
    setMapping(defaultMapping(parsed.rows, header));
    say(parsed.errors.length ? parsed.errors.join(' ') : null, parsed.errors.length > 0);
    setStep('map');
  }, [importText, say]);

  const handleHeaderToggle = useCallback(
    (value: boolean) => {
      setHasHeader(value);
      setMapping(defaultMapping(table, value));
    },
    [table],
  );

  const problems = useMemo(() => mappingProblems(mapping), [mapping]);

  const handleCheckRows = useCallback(() => {
    const rows = toImportRows(table, mapping, hasHeader, lines);
    if (rows.length > LINEUP_IMPORT_LIMITS.maxRows) {
      say(
        `This file has ${rows.length} rows. The limit is ${LINEUP_IMPORT_LIMITS.maxRows}. Split the file and import it in parts.`,
        true,
      );
      return;
    }
    const hasSetId = mapping.setId !== undefined;
    const update = checkedWithSetId.current === hasSetId ? updateExisting : defaultUpdateExisting(mapping);
    checkedWithSetId.current = hasSetId;
    setListMode(false);
    setUpdateExisting(update);
    setImportRows(rows);
    void runPreview(rows, update, createMissing, moveDays);
  }, [table, lines, mapping, hasHeader, createMissing, moveDays, updateExisting, runPreview, say]);

  // A pasted list of names has no columns to match: each line becomes an announced name.
  const handleCheckList = useCallback(() => {
    if (importText.length > LINEUP_IMPORT_LIMITS.maxBytes) {
      say('This is larger than 200 KB. Split it and import it in parts.', true);
      return;
    }
    const rows = parseNameList(importText);
    if (rows.length === 0) {
      say('No names found in that data.', true);
      return;
    }
    if (rows.length > LINEUP_IMPORT_LIMITS.maxRows) {
      say(`That list has ${rows.length} names. The limit is ${LINEUP_IMPORT_LIMITS.maxRows}. Split it and import it in parts.`, true);
      return;
    }
    checkedWithSetId.current = null;
    setListMode(true);
    setUpdateExisting(false);
    setImportRows(rows);
    void runPreview(rows, false, createMissing, moveDays);
  }, [importText, createMissing, moveDays, runPreview, say]);

  const handleToggle = useCallback(
    (which: 'update' | 'create' | 'move', value: boolean) => {
      const update = which === 'update' ? value : updateExisting;
      const create = which === 'create' ? value : createMissing;
      const move = which === 'move' ? value : moveDays;
      setUpdateExisting(update);
      setCreateMissing(create);
      setMoveDays(move);
      void runPreview(importRows, update, create, move);
    },
    [updateExisting, createMissing, moveDays, importRows, runPreview],
  );

  const chooseArtist = useCallback(
    (row: number, position: number, artistId: string) => {
      if (!artistId) return;
      const next = withArtistChoice(importRows, row, position, artistId);
      setImportRows(next);
      void runPreview(next, updateExisting, createMissing, moveDays);
    },
    [importRows, updateExisting, createMissing, moveDays, runPreview],
  );

  const applySuggestion = useCallback(
    (row: number, suggestion: string) => {
      const next = importRows.map((r) => (r.row === row ? { ...r, artist: suggestion } : r));
      setImportRows(next);
      void runPreview(next, updateExisting, createMissing, moveDays);
    },
    [importRows, updateExisting, createMissing, moveDays, runPreview],
  );

  const editRow = useCallback((row: number, field: LineupImportField, value: string) => {
    setImportRows((prev) => prev.map((r) => (r.row === row ? { ...r, [field]: value } : r)));
  }, []);

  const removeRow = useCallback(
    (row: number) => {
      const next = importRows.filter((r) => r.row !== row);
      setImportRows(next);
      if (next.length === 0) {
        setPlan(null);
        setStep('source');
        return;
      }
      void runPreview(next, updateExisting, createMissing, moveDays);
    },
    [importRows, updateExisting, createMissing, moveDays, runPreview],
  );

  const handleImport = useCallback(async () => {
    setConfirmVisible(false);
    if (!festivalId) return;
    setWorking(true);
    say(null);
    try {
      const res = await lineupImportApi.commit(festivalId, request(importRows, updateExisting, createMissing, moveDays));
      setPlan(res.plan);
      if (res.committed) {
        setResult(res.result);
        setStep('result');
        void loadSide();
      } else {
        say('The lineup changed since your preview. Check the rows again.', true);
      }
    } catch (err: unknown) {
      say(errMessage(err, 'Import failed.'), true);
    } finally {
      setWorking(false);
    }
  }, [festivalId, importRows, updateExisting, createMissing, moveDays, request, loadSide, say]);

  const shareCsv = useCallback(
    async (suffix: string, makeCsv: () => string | Promise<string>, failure: string) => {
      try {
        const safeName = (festivalName || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
        const file = new File(Paths.cache, `${safeName}-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`);
        const csv = await makeCsv();
        file.create({ overwrite: true });
        file.write(csv);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
        } else {
          Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        }
      } catch (err: unknown) {
        say(errMessage(err, failure), true);
      }
    },
    [festivalName, say],
  );

  const handleShare = useCallback(async () => {
    if (!result) return;
    await shareCsv('import', () => buildResultCsv(result), 'Could not share the result file.');
  }, [result, shareCsv]);

  const handleExport = useCallback(async () => {
    if (!festivalId) return;
    await shareCsv('lineup', () => lineupImportApi.exportCsv(festivalId), 'Could not export the lineup.');
  }, [festivalId, shareCsv]);

  const handleAgain = useCallback(() => {
    setImportText('');
    setTable([]);
    setLines([]);
    setImportRows([]);
    setPlan(null);
    setResult(null);
    setListMode(false);
    setKeepNew(new Set());
    say(null);
    setStep('source');
  }, [say]);

  const handleUndo = useCallback(async () => {
    const target = undoTarget;
    setUndoTarget(null);
    if (!festivalId || !target) return;
    setWorking(true);
    try {
      const res = await lineupImportApi.undo(festivalId, target.id);
      setUndoKept(res.kept);
      say(
        `Import undone. Removed ${res.removed} sets and restored ${res.restored}.` +
          (res.removedEntries || res.restoredEntries
            ? ` Announced lineup: removed ${res.removedEntries ?? 0}, restored ${res.restoredEntries ?? 0}.`
            : '') +
          (res.kept.length ? ` ${res.kept.length} sets stayed.` : ''),
      );
      void loadSide();
    } catch (err: unknown) {
      say(errMessage(err, 'Undo failed.'), true);
    } finally {
      setWorking(false);
    }
  }, [festivalId, undoTarget, loadSide, say]);

  const handleAnnounce = useCallback(async () => {
    setAnnounceVisible(false);
    if (!festivalId) return;
    setWorking(true);
    try {
      const res = await lineupImportApi.announce(festivalId);
      say(`Announcement queued for ${res.recipients} people.`);
      void loadSide();
    } catch (err: unknown) {
      say(errMessage(err, 'Announcement failed.'), true);
    } finally {
      setWorking(false);
    }
  }, [festivalId, loadSide, say]);

  const groups = useMemo(() => (plan ? groupPlanRows(plan) : []), [plan]);
  const items = useMemo<ReviewItem[]>(
    () =>
      groups
        .filter((g) => g.rows.length > 0 && (filter === 'all' || filter === g.key))
        .flatMap((g) => [
          { kind: 'header' as const, key: `h-${g.key}`, label: g.label, count: g.rows.length },
          ...g.rows.map((row) => ({ kind: 'row' as const, key: `${g.key}-${row.row}`, row, group: g.key })),
        ]),
    [groups, filter],
  );

  const blocked = !!plan && importBlocked(plan);
  const columnOptions = useMemo<SelectOption[]>(() => {
    const headerRow = hasHeader ? (table[0] ?? []) : [];
    const sample = table[hasHeader ? 1 : 0] ?? [];
    const width = Math.max(0, ...table.map((r) => r.length));
    return [
      { label: "Don't import", value: NOT_MAPPED },
      ...Array.from({ length: width }, (_, i) => ({
        label: `Column ${columnLetter(i)}${headerRow[i] ? `: ${headerRow[i]}` : ''}${sample[i] ? ` (e.g. ${sample[i]})` : ''}`,
        value: String(i),
      })),
    ];
  }, [table, hasHeader]);

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

  const header = (
    <View style={styles.headerBlock}>
      {message ? (
        <View style={[styles.banner, messageError ? styles.bannerError : styles.bannerOk]}>
          <Text style={[styles.bannerText, messageError && styles.bannerTextError]}>{message}</Text>
        </View>
      ) : null}

      {step === 'source' ? (
        <>
          <SectionLabel>{festivalName ? `Import lineup into ${festivalName}` : 'Import lineup'}</SectionLabel>
          <LabeledTextInput
            label="Paste cells from a spreadsheet or CSV"
            value={importText}
            onChangeText={setImportText}
            placeholder="Paste cells or CSV here…"
            autoCapitalize="none"
            multiline
            hint="Up to 500 rows and 200 KB."
          />
          <View style={styles.card}>
            <Text style={styles.helpTitle}>Before you import</Text>
            {RULES.map((rule) => (
              <Text key={rule} style={styles.helpNote}>
                • {rule}
              </Text>
            ))}
          </View>
          <View style={styles.actionsRow}>
            <Button
              label="Paste sample"
              variant="ghost"
              icon="document-text-outline"
              onPress={() => setImportText(LINEUP_SAMPLE_CSV)}
              style={styles.flexBtn}
            />
            <Button
              label="Export lineup CSV"
              variant="ghost"
              icon="share-outline"
              onPress={() => void handleExport()}
              style={styles.flexBtn}
            />
            <Button
              label="Next: match columns"
              onPress={handleNext}
              disabled={importText.trim().length === 0}
              style={styles.flexBtn}
            />
          </View>
          <Button
            label="Check as a list of names"
            variant="secondary"
            onPress={handleCheckList}
            disabled={importText.trim().length === 0 || working}
          />
        </>
      ) : null}

      {step === 'map' ? (
        <>
          <SectionLabel>Match columns</SectionLabel>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>First row is a header</Text>
            <AppSwitch value={hasHeader} onValueChange={handleHeaderToggle} accessibilityLabel="First row is a header" />
          </View>
          {LINEUP_IMPORT_FIELDS.map((f) => (
            <ModalSelect
              key={f.field}
              label={f.required ? `${f.label} (required)` : f.label}
              value={String(mapping[f.field] ?? NOT_MAPPED)}
              options={columnOptions}
              onSelect={(v) =>
                setMapping((prev) => {
                  const next = { ...prev };
                  if (v === NOT_MAPPED) delete next[f.field];
                  else next[f.field] = Number(v);
                  return next;
                })
              }
            />
          ))}
          {problems.length > 0 ? (
            <View style={[styles.card, styles.errorCard]}>
              {problems.map((p) => (
                <Text key={p} style={styles.errorLine}>
                  • {p}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.actionsRow}>
            <Button label="Back" variant="ghost" onPress={() => setStep('source')} style={styles.flexBtn} />
            <Button
              label="Check rows"
              onPress={handleCheckRows}
              loading={working}
              loadingLabel="Checking"
              disabled={problems.length > 0 || working}
              style={styles.flexBtn}
            />
          </View>
        </>
      ) : null}

      {step === 'preview' && plan ? (
        <>
          <SectionLabel>Preview</SectionLabel>
          <View style={styles.chipRow}>
            {groups.map((g) => (
              <View
                key={g.key}
                style={[styles.stagePill, (g.key === 'errors' || g.key === 'needsChoice') && g.rows.length > 0 && styles.statusPillError]}
              >
                <Text style={styles.stagePillText}>{`${g.label} ${g.rows.length}`}</Text>
              </View>
            ))}
            {plan.counts.skipped > 0 ? (
              <View style={styles.stagePill}>
                <Text style={styles.stagePillText}>{`Skipped ${plan.counts.skipped}`}</Text>
              </View>
            ) : null}
          </View>
          {plan.newStages.length > 0 ? (
            <Text style={styles.helpNote}>New stages: {plan.newStages.map((s) => s.name).join(', ')}</Text>
          ) : null}
          {plan.newDays.length > 0 ? (
            <Text style={styles.helpNote}>
              New days: {plan.newDays.map((d) => `${d.label} (${d.date})`).join(', ')}
            </Text>
          ) : null}
          {updateOffBanner(plan.counts, updateExisting) ? (
            <View style={styles.card}>
              <Text style={styles.helpNote}>{updateOffBanner(plan.counts, updateExisting)}</Text>
              <Button
                label="Turn on Update"
                variant="secondary"
                onPress={() => handleToggle('update', true)}
                disabled={working}
              />
            </View>
          ) : null}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              Update sets that match. Sets match by artist and day. When this is off, matching sets stay as they are.
            </Text>
            <AppSwitch
              value={updateExisting}
              onValueChange={(v) => handleToggle('update', v)}
              disabled={working}
              accessibilityLabel="Update sets that match"
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Create new stages and days</Text>
            <AppSwitch
              value={createMissing}
              onValueChange={(v) => handleToggle('create', v)}
              disabled={working}
              accessibilityLabel="Create new stages and days"
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              Move sets to the day in the file. For rows with a set id. When this is off, a row with another day is
              skipped and the other rows still import.
            </Text>
            <AppSwitch
              value={moveDays}
              onValueChange={(v) => handleToggle('move', v)}
              disabled={working}
              accessibilityLabel="Move sets to the day in the file"
            />
          </View>
          {plan.problems.length > 0 ? (
            <View style={[styles.card, styles.errorCard]}>
              {plan.problems.map((p, i) => (
                <Text key={i} style={styles.errorLine}>
                  • {p}
                </Text>
              ))}
            </View>
          ) : null}
          {plan.missingFromFile.length > 0 ? (
            <View>
              <Text style={styles.helpNote}>
                {plan.missingFromFile.length} sets in this festival are not in your file. They stay as they are.
              </Text>
              {plan.missingFromFile.map((m) => (
                <Text key={m.setId} style={styles.helpNote}>
                  • {m.artist} ({m.dayLabel})
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.chipRow}>
            <Button label="All" size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onPress={() => setFilter('all')} />
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <Button
                  key={g.key}
                  label={g.label}
                  size="sm"
                  variant={filter === g.key ? 'secondary' : 'ghost'}
                  onPress={() => setFilter(g.key)}
                />
              ))}
          </View>
        </>
      ) : null}

      {step === 'result' && result ? (
        <>
          <SectionLabel>Result</SectionLabel>
          <View style={[styles.banner, styles.bannerOk]}>
            <Text style={styles.bannerText}>
              Import done. Added {result.created} sets, updated {result.updated}, created {result.newStages} stages and{' '}
              {result.newDays} days.
              {result.announced || result.announcedUpdated
                ? ` Announced lineup: ${result.announced ?? 0} added, ${result.announcedUpdated ?? 0} updated.`
                : ''}
              {result.skipped > 0 ? ` Skipped ${result.skipped} ${result.skipped === 1 ? 'row' : 'rows'} that name another day.` : ''}
            </Text>
          </View>
          {result.rows.some((x) => x.status === 'skipped') ? (
            <View style={styles.card}>
              <Text style={styles.helpTitle}>Skipped rows</Text>
              {result.rows
                .filter((x) => x.status === 'skipped')
                .map((x) => (
                  <Text key={x.row} style={styles.helpNote}>
                    {`Row ${x.row}, ${x.artist}: ${x.message}`}
                  </Text>
                ))}
            </View>
          ) : null}
          {result.warnings.length > 0 ? (
            <View style={styles.card}>
              {result.warnings.map((w, i) => (
                <Text key={i} style={styles.helpNote}>
                  • {w}
                </Text>
              ))}
            </View>
          ) : null}
          <Button
            label="Share result CSV"
            icon="share-outline"
            variant="secondary"
            onPress={() => void handleShare()}
          />
          <View style={styles.actionsRow}>
            <Button label="Import another file" variant="ghost" onPress={handleAgain} style={styles.flexBtn} />
            <Button label="Done" onPress={goBack} style={styles.flexBtn} />
          </View>
        </>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {step === 'preview' && plan ? (
        <>
          {blocked ? (
            <Text style={styles.errorLine}>
              {plan.counts.error > 0
                ? `Fix or remove the ${plan.counts.error} ${plan.counts.error === 1 ? 'row' : 'rows'} with errors to continue.`
                : 'Fix the problems above to continue.'}
            </Text>
          ) : null}
          <View style={styles.actionsRow}>
            <Button
              label="Check again"
              variant="secondary"
              onPress={() => void runPreview(importRows, updateExisting, createMissing, moveDays)}
              disabled={working}
              style={styles.flexBtn}
            />
            <Button
              label="Approve"
              icon="cloud-upload-outline"
              loading={working}
              loadingLabel="Working"
              disabled={blocked || working}
              onPress={() => setConfirmVisible(true)}
              style={styles.flexBtn}
            />
          </View>
          <Button label="Back" variant="ghost" onPress={() => setStep(listMode ? 'source' : 'map')} />
        </>
      ) : null}

      <SectionLabel>Import history</SectionLabel>
      {history.length === 0 ? <Text style={styles.helpNote}>No imports yet.</Text> : null}
      {history.map((h) => (
        <View key={h.id} style={styles.card}>
          <Text style={styles.previewArtist}>
            {dateTime(h.createdAt)}
            {h.createdBy ? ` by ${h.createdBy}` : ''}
          </Text>
          <Text style={styles.previewMeta}>
            Added {h.counts.created} · Updated {h.counts.updated} · {h.counts.newStages} stages · {h.counts.newDays} days
            {h.counts.announced || h.counts.announcedUpdated
              ? ` · Announced ${h.counts.announced ?? 0} added, ${h.counts.announcedUpdated ?? 0} updated`
              : ''}
          </Text>
          {h.undoneAt ? <Text style={styles.helpNote}>Undone {dateTime(h.undoneAt)}</Text> : null}
          {h.canUndo ? (
            <Button
              label="Undo import"
              size="sm"
              variant="secondary"
              onPress={() => setUndoTarget(h)}
              disabled={working}
            />
          ) : null}
        </View>
      ))}
      {undoKept.length > 0 ? (
        <View style={styles.card}>
          {undoKept.map((k) => (
            <Text key={k.setId} style={styles.helpNote}>
              • {k.artist}: {k.reason === 'picked' ? 'picked by someone' : 'edited since the import'}
            </Text>
          ))}
        </View>
      ) : null}

      <SectionLabel>Announce lineup</SectionLabel>
      <Text style={styles.helpNote}>
        Send a push and an email to people who went to an earlier edition of {festivalName || 'this festival'}. Editions
        match when the name is the same apart from the year.
      </Text>
      <Button
        label={`Announce to ${recipients ?? 0} people`}
        icon="megaphone-outline"
        variant="secondary"
        disabled={!recipients || working}
        onPress={() => setAnnounceVisible(true)}
      />
      {recipients === 0 ? <Text style={styles.helpNote}>No one to notify right now.</Text> : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Import lineup"
        subtitle="Paste, match, check, approve"
        icon="cloud-upload-outline"
        right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
      />

      <FlatList
        data={step === 'preview' ? items : []}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderItem={({ item: entry }) => {
          if (entry.kind === 'header') {
            return <SectionLabel>{`${entry.label} (${entry.count})`}</SectionLabel>;
          }
          const item = entry.row;
          // The Warnings group repeats rows from the outcome groups, so it shows the warnings only.
          if (entry.group === 'warnings') {
            return (
              <View style={[styles.card, styles.previewSpacer]} accessibilityLabel={`Row ${item.row}, ${item.artists.join(' b2b ')}, warnings`}>
                <Text style={styles.previewArtist} numberOfLines={1}>
                  {item.artists.join(' b2b ') || `Row ${item.row}`}
                </Text>
                {item.warnings.map((w) => (
                  <Text key={w} style={styles.helpNote}>
                    {w}
                  </Text>
                ))}
              </View>
            );
          }
          const isError = item.status === 'error';
          const source = importRows.find((r) => r.row === item.row);
          const errorFields = [
            ...new Set(item.errors.filter((e) => e.code !== 'needs_choice').map((e) => e.field)),
          ].filter((f): f is Exclude<typeof f, 'row'> => f !== 'row');
          return (
            <View
              style={[styles.card, isError && styles.errorCard, styles.previewSpacer]}
              accessibilityLabel={`Row ${item.row}, ${item.artists.join(' b2b ')}, ${item.status}`}
            >
              <View style={styles.previewRow}>
                <Text style={styles.previewArtist} numberOfLines={1}>
                  {item.artists.join(' b2b ') || `Row ${item.row}`}
                </Text>
                <View style={[styles.stagePill, isError && styles.statusPillError]}>
                  <Text style={[styles.stagePillText, isError && styles.errorLine]} numberOfLines={1}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
              </View>
              <Text style={styles.previewMeta} numberOfLines={1}>
                Row {item.row} · {item.stageName ?? 'No stage'} · {item.dayLabel ?? (item.target === 'announced' ? 'Announced' : 'No day')}
                {item.startTime ? ` · ${item.startTime}` : ''}
                {item.endTime ? `–${item.endTime}` : ''}
              </Text>
              {item.changes.map((c) => (
                <Text key={c} style={styles.helpNote}>
                  {c}
                </Text>
              ))}
              {item.warnings.map((w) => (
                <Text key={w} style={styles.helpNote}>
                  {w}
                </Text>
              ))}
              {item.errors.map((e, i) => (
                <Text key={i} style={styles.errorLine}>
                  {e.message}
                </Text>
              ))}
              {(item.resolutions ?? []).map((x, i) =>
                x.outcome === 'needs_choice' ? (
                  <ModalSelect
                    key={`${x.name}-${i}`}
                    label={`Which ${x.name}?`}
                    value=""
                    options={[
                      { label: 'Choose an artist', value: '' },
                      ...(x.candidates ?? []).map((c) => ({
                        label: `${x.name} (${c.label || 'no note'})${c.hint ? ` ${c.hint}` : ''}`,
                        value: c.id,
                      })),
                    ]}
                    onSelect={(v) => chooseArtist(item.row, i, v)}
                  />
                ) : x.outcome === 'did_you_mean' && x.suggestion && !keepNew.has(item.row) ? (
                  <View key={`${x.name}-${i}`} style={styles.actionsRow}>
                    <Button
                      label={`Use ${x.suggestion}`}
                      size="sm"
                      variant="secondary"
                      onPress={() => applySuggestion(item.row, x.suggestion!)}
                      style={styles.flexBtn}
                    />
                    <Button
                      label="Create new"
                      size="sm"
                      variant="ghost"
                      onPress={() => setKeepNew((prev) => new Set(prev).add(item.row))}
                      style={styles.flexBtn}
                    />
                  </View>
                ) : null,
              )}
              {isError && source ? (
                <>
                  {errorFields.map((field) => (
                    <LabeledTextInput
                      key={field}
                      label={FIELD_LABEL[field] ?? field}
                      value={source[field] ?? ''}
                      onChangeText={(v) => editRow(item.row, field, v)}
                      autoCapitalize="none"
                    />
                  ))}
                  <Button label="Remove row" size="sm" variant="ghost" onPress={() => removeRow(item.row)} />
                </>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          step === 'preview' && !working ? (
            <EmptyState icon="document-text-outline" title="No rows here" message="No rows match this filter." />
          ) : undefined
        }
      />

      {/* Confirm before the write. The import adds and updates; it never deletes. */}
      <ConfirmDialog
        visible={confirmVisible}
        title="Approve import?"
        message={`${plan ? planSummary(plan.counts, updateExisting) : ''} You can undo this import from Import history.`}
        confirmLabel="Import"
        onConfirm={() => void handleImport()}
        onCancel={() => setConfirmVisible(false)}
      />
      <ConfirmDialog
        visible={!!undoTarget}
        title="Undo this import?"
        message="This removes the sets it added and puts back the sets it changed. Sets that people picked, or that someone edited after the import, stay."
        confirmLabel="Undo import"
        destructive
        onConfirm={() => void handleUndo()}
        onCancel={() => setUndoTarget(null)}
      />
      <ConfirmDialog
        visible={announceVisible}
        title="Announce the lineup?"
        message={`This sends one push and one email to ${recipients ?? 0} people. Each person gets it once for this festival.`}
        confirmLabel="Announce"
        onConfirm={() => void handleAnnounce()}
        onCancel={() => setAnnounceVisible(false)}
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
  helpNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
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
