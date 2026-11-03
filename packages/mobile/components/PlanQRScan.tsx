// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, AppState, Linking } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import {
  decodePlanSnapshot,
  extractPlanSnapshotText,
  previewPlanImport,
  artistDisplayName,
  formatTime,
  type PlanSnapshot,
  type PlanImportPreview,
} from '@festie/shared/utils';
import { PRIORITY_LABELS } from '@festie/shared/constants';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import Button from './Button';
import EmptyState from './EmptyState';

// ── Untrusted import with preview (offline-native) ─────────────────────────
// A scanned QR string is fully untrusted, cross-device input. We hand it
// STRAIGHT to the shared codec, which size-bounds + Zod-validates it and never
// throws — we only ever act on `{ ok: true }`. We never eval/JSON.parse it
// ourselves. On success we show a preview and write NOTHING until the user taps
// Add; Undo restores the previous values. Writes go through the stores' existing setters (the same offline-queued write paths the rest of the
// app uses), so this works with no signal on either phone.

interface ScanPreview {
  snapshot: PlanSnapshot;
  preview: PlanImportPreview;
  /** Active crew the meeting point can go into; null when none or it is a duplicate. */
  meetingTarget: { id: string; name: string } | null;
}

/**
 * Compare a validated snapshot with the local plan. Writes nothing. Picks only
 * import when the snapshot's festival matches the CURRENT profile and the set id
 * exists in the loaded schedule (previewPlanImport enforces both).
 */
function buildPreview(snapshot: PlanSnapshot): ScanPreview {
  const fest = useFestivalDataStore.getState();
  const crew = useCrewStore.getState();
  const preview = previewPlanImport(snapshot, {
    currentFestivalId: fest.currentFestivalId,
    picks: fest.currentProfile?.picks as Record<string, Priority> | undefined,
    setIds: new Set((fest.sets as FestivalSet[]).map((s) => s.id)),
  });

  let meetingTarget: ScanPreview['meetingTarget'] = null;
  const mp = snapshot.meetingPoint;
  if (mp && crew.activeCrew && !preview.festivalMismatch) {
    // Epsilon-based coord compare: identical points can serialize with tiny
    // floating-point drift across devices, so strict equality would admit a
    // duplicate. ~0.0001° ≈ 11m.
    const dup = crew.meetingPoints.some(
      (p) =>
        p.label === mp.label &&
        p.latitude != null &&
        p.longitude != null &&
        Math.abs(p.latitude - mp.lat) < 0.0001 &&
        Math.abs(p.longitude - mp.lng) < 0.0001,
    );
    if (!dup) meetingTarget = { id: crew.activeCrew.id, name: crew.activeCrew.name };
  }
  return { snapshot, preview, meetingTarget };
}

/** Write the previewed picks, one coalesced offline-queued PUT per priority. Returns the real changed count. */
async function addPreviewedPicks(preview: PlanImportPreview): Promise<number> {
  const byPriority = new Map<Priority, string[]>();
  for (const { setId, priority } of preview.toAdd) {
    const list = byPriority.get(priority) ?? [];
    list.push(setId);
    byPriority.set(priority, list);
  }
  let added = 0;
  for (const [priority, setIds] of byPriority) {
    added += await useFestivalDataStore.getState().bulkSavePicks(setIds, priority);
  }
  return added;
}

async function addMeetingPoint(snapshot: PlanSnapshot, crewId: string): Promise<void> {
  const mp = snapshot.meetingPoint;
  if (!mp) return;
  await useCrewStore.getState().createMeetingPoint(crewId, {
    label: mp.label,
    location: mp.label,
    type: 'shared',
    latitude: mp.lat,
    longitude: mp.lng,
  });
}

/** "Sat 7:30 PM" style line for one set in the preview list. */
function setLine(set: FestivalSet | undefined, dayLabels: Map<number, string>): string {
  if (!set) return '';
  const day = set.dayIndex != null ? dayLabels.get(set.dayIndex) : undefined;
  return [day, formatTime(set.startTime)].filter(Boolean).join(' · ');
}

type Phase = 'scanning' | 'preview' | 'importing' | 'done' | 'error';

/**
 * Scans a plan-snapshot QR with the device camera and imports it into the local
 * cache. Treats the scanned string as untrusted (decoded by the shared codec).
 */
export default function PlanQRScan() {
  const t = useTokens();
  const styles = useStyles();

  const bottomPad = useListBottomInset();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanPreview | null>(null);
  const [added, setAdded] = useState(0);
  const [undone, setUndone] = useState(false);
  const [meetingAdded, setMeetingAdded] = useState(false);
  const sets = useFestivalDataStore((st) => st.sets) as FestivalSet[];
  const days = useFestivalDataStore((st) => st.days);
  // Guard against the camera firing the scan callback repeatedly for one code.
  const handledRef = useRef(false);

  // Returning from system Settings: re-read the permission so the scanner appears.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  const handleScanned = useCallback((result: BarcodeScanningResult) => {
    if (handledRef.current) return;
    handledRef.current = true;

    const decoded = decodePlanSnapshot(extractPlanSnapshotText(result?.data));
    if (!decoded.ok) {
      setErrorMsg(friendlyError(decoded.error));
      setPhase('error');
      return;
    }
    setScan(buildPreview(decoded.data));
    setPhase('preview');
  }, []);

  const reset = useCallback(() => {
    handledRef.current = false;
    setErrorMsg(null);
    setScan(null);
    setAdded(0);
    setUndone(false);
    setMeetingAdded(false);
    setPhase('scanning');
  }, []);

  const onAdd = useCallback(async () => {
    if (!scan) return;
    setPhase('importing');
    try {
      setAdded(await addPreviewedPicks(scan.preview));
      setPhase('done');
    } catch {
      setErrorMsg("Couldn't save the plan to this device. Try again.");
      setPhase('error');
    }
  }, [scan]);

  const onUndo = useCallback(async () => {
    if (!scan) return;
    try {
      await useFestivalDataStore.getState().restorePicks(scan.preview.previous);
      setUndone(true);
    } catch {
      setErrorMsg("Couldn't undo. Your picks are unchanged from the import.");
      setPhase('error');
    }
  }, [scan]);

  const onAddMeeting = useCallback(async () => {
    if (!scan?.meetingTarget) return;
    try {
      await addMeetingPoint(scan.snapshot, scan.meetingTarget.id);
      setMeetingAdded(true);
    } catch {
      setErrorMsg("Couldn't save the meeting point. Try again.");
      setPhase('error');
    }
  }, [scan]);

  const setById = useMemo(() => new Map(sets.map((x) => [x.id, x])), [sets]);
  const dayLabels = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of days) if (d.dayIndex != null && d.label) m.set(d.dayIndex, d.label);
    return m;
  }, [days]);

  // Permission still loading.
  if (!permission) {
    return <View style={styles.screen} />;
  }

  // Permission not granted. Once the OS will no longer prompt, only Settings can fix it.
  if (!permission.granted && !permission.canAskAgain) {
    return (
      <EmptyState
        icon="camera-outline"
        title="Camera access needed"
        message="Camera access is off for Festie. Turn it on in Settings to scan a friend's plan."
        action={{ label: 'Open Settings', onPress: () => void Linking.openSettings() }}
      />
    );
  }

  if (!permission.granted) {
    return (
      <EmptyState
        icon="camera-outline"
        title="Camera access needed"
        message="To scan a friend's plan, Festie needs your camera. Nothing is uploaded — scanning happens on-device."
        action={{ label: 'Allow camera', onPress: () => void requestPermission() }}
      />
    );
  }

  if (phase === 'error') {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="Couldn't read that code"
        message={errorMsg ?? "That doesn't look like a Festie plan. Make sure you're scanning a plan QR."}
        action={{ label: 'Try again', onPress: reset }}
      />
    );
  }

  if (phase === 'importing') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="download-outline" title="Saving plan…" message="Adding these picks to your device." />
      </View>
    );
  }

  if (phase === 'preview' && scan) {
    const { preview, snapshot, meetingTarget } = scan;
    if (preview.festivalMismatch) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title="Different festival"
          message={`This plan is for ${snapshot.festivalName}. Open that festival in Festie to add its picks.`}
          action={{ label: 'Not now', onPress: reset }}
        />
      );
    }
    const n = preview.toAdd.length;
    return (
      <ScrollView contentContainerStyle={[styles.doneContent, { paddingBottom: bottomPad }]}>
        <Text style={styles.doneTitle}>{`A friend's plan for ${snapshot.festivalName}`}</Text>
        <Text style={styles.doneSub}>{`${preview.total} sets · ${n} you haven't picked`}</Text>

        {n > 0 ? (
          <View style={styles.summaryCard}>
            {preview.toAdd.map(({ setId, priority }) => {
              const set = setById.get(setId);
              const wasPicked = preview.previous[setId] !== undefined;
              return (
                <View key={setId} style={styles.summaryRow}>
                  <Text style={styles.summaryText}>
                    {set ? artistDisplayName(set) : setId}
                    {wasPicked ? ` (upgrade to ${PRIORITY_LABELS[priority]})` : ''}
                  </Text>
                  <Text style={[styles.summaryText, styles.summaryMuted]}>{setLine(set, dayLabels)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {n > 0 ? (
          <Button
            label={`Add ${n} to my plan`}
            onPress={() => void onAdd()}
            accessibilityLabel={`Add ${n} picks to my plan`}
          />
        ) : (
          <Text style={styles.honest}>You already have all of these.</Text>
        )}
        {meetingTarget && !meetingAdded ? (
          <Button
            label={`Add meeting point to ${meetingTarget.name}`}
            icon="location-outline"
            variant="secondary"
            onPress={() => void onAddMeeting()}
          />
        ) : null}
        {meetingAdded ? <SummaryRow icon="location" label="Meeting point added to your crew" /> : null}
        <Button label="Not now" variant="ghost" onPress={reset} />
      </ScrollView>
    );
  }

  if (phase === 'done' && scan) {
    return (
      <ScrollView contentContainerStyle={[styles.doneContent, { paddingBottom: bottomPad }]}>
        <Ionicons name="checkmark-circle" size={56} color={t.colors.accent.aqua} />
        <Text style={styles.doneTitle}>{`${added} pick${added === 1 ? '' : 's'} added`}</Text>
        <Text style={styles.doneSub}>{scan.snapshot.festivalName}</Text>

        {undone ? (
          <Text style={styles.honest}>Undone. Your plan is back to how it was.</Text>
        ) : (
          <Button label="Undo" icon="arrow-undo-outline" variant="secondary" onPress={() => void onUndo()} />
        )}
        {meetingAdded ? <SummaryRow icon="location" label="Meeting point added to your crew" /> : null}

        <Text style={styles.honest}>
          Imported as a snapshot from your friend's phone. Queued changes sync when signal returns.
        </Text>

        <Button
          label="Scan another"
          icon="qr-code-outline"
          onPress={reset}
          accessibilityLabel="Scan another plan QR code"
          style={styles.scanAgain}
        />
      </ScrollView>
    );
  }

  // Scanning. Gate the camera callback on render-safe state (`phase`) rather
  // than reading handledRef.current during render (react-hooks/refs). We only
  // reach this branch while phase === 'scanning'; once a code is accepted,
  // handleScanned advances phase and this view unmounts. The ref still guards
  // against the camera firing the callback repeatedly within a single tick.
  const stillScanning = phase === 'scanning';
  return (
    <View style={styles.screen}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={stillScanning ? (e) => handleScanned(e) : undefined}
        accessibilityLabel="QR code scanner"
        accessibilityHint="Point your camera at a Festie plan QR code to scan and import picks"
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.reticle} />
        <Text style={styles.hint}>Point at your friend's plan QR</Text>
      </View>
    </View>
  );
}

function SummaryRow({ icon, label, muted }: { icon: keyof typeof Ionicons.glyphMap; label: string; muted?: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={16} color={muted ? t.colors.text.muted : t.colors.accent.coral} />
      <Text style={[styles.summaryText, muted && styles.summaryMuted]}>{label}</Text>
    </View>
  );
}

/** Map a codec error code to friendly, non-technical copy. */
function friendlyError(error: string): string {
  if (error === 'unsupported snapshot version') {
    return 'This plan was made with a newer version of Festie. Update the app and try again.';
  }
  if (error === 'input exceeds maximum size') {
    return 'That code is too big to be a Festie plan — it might be a different kind of QR.';
  }
  return "That doesn't look like a Festie plan QR. Try scanning again.";
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    // overlay.hi is rgba(255,255,255,0.95) — near-white, intentional camera
    // contrast; same semantic as onAccent for non-text surfaces (F42).
    borderColor: t.colors.overlay.hi,
    borderRadius: t.radii.default,
    backgroundColor: 'transparent',
  },
  hint: {
    ...typeStyle('label'),
    // onAccent (#fff) gives the text full contrast on the camera feed (F42).
    color: t.colors.text.onAccent,
    // shade[10] = rgba(0,0,0,0.75) — dark-app scrim; matches OfflineBanner
    // shade[9] pattern for camera/overlay surfaces (F42).
    backgroundColor: t.colors.shade[10],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    overflow: 'hidden',
  },
  doneContent: {
    padding: t.spacing[4],
    gap: t.spacing[3],
    alignItems: 'center',
  },
  doneTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  doneSub: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  summaryCard: {
    width: '100%',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  summaryText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  summaryMuted: {
    color: t.colors.text.muted,
  },
  honest: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  // CTA layout only — fill/ink/radius live in components/Button (F8).
  scanAgain: {
    paddingHorizontal: t.spacing[5],
    marginTop: t.spacing[2],
  },
}));
