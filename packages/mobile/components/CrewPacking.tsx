import { useState } from 'react';
import type { ElementType } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, AccessibilityInfo } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import { duration as motionDuration } from '@festie/shared/tokens';
import type { CrewPackingItem } from '@festie/shared/types';
import { isPending, QUEUED_WRITE_MESSAGE } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useHaptics } from '../hooks/useHaptics';
import { useUndoableRemove } from '../hooks/useUndoableRemove';
import EmptyState from './EmptyState';
import Button from './Button';
import CrewSyncMarker from './CrewSyncMarker';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface CrewPackingProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew packing board (M2 logistics) — a shared "who's bringing what" checklist.
 * Offline-native: reads/writes go through the crewStore, so an item added with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as polls). Tapping the checkbox claims/unclaims an item (sets or
 * clears `brought_by` = current user). The screen owns loading.
 */
export default function CrewPacking({ crewId, currentUserId, isOwner }: CrewPackingProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();

  const items = useCrewStore((s) => s.packingItems);
  const createPackingItem = useCrewStore((s) => s.createPackingItem);
  const updatePackingItem = useCrewStore((s) => s.updatePackingItem);
  const deletePackingItem = useCrewStore((s) => s.deletePackingItem);

  const { hiddenIds, remove } = useUndoableRemove(
    (id) => deletePackingItem(crewId, id),
    "Couldn't remove the item. Try again.",
  );

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const reset = () => {
    setLabel('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    const l = label.trim();
    if (!l || createBusy) return;
    setCreateBusy(true);
    try {
      const created = await createPackingItem(crewId, { label: l });
      // Queued offline: the row shows "Not sent yet"; never celebrate it as sent.
      if (isPending(created)) AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
      else haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleToggle = async (item: CrewPackingItem) => {
    if (busyId === item.id) return;
    // Tactile tick on claim/unclaim — the checkbox feels physical.
    haptics.select();
    setBusyId(item.id);
    try {
      // Claim: mark claimed + record this user as the bringer. Un-claim: clear both.
      await updatePackingItem(crewId, item.id, {
        claimed: !item.claimed,
        broughtBy: !item.claimed ? currentUserId : null,
      });
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (item: CrewPackingItem) => {
    haptics.tap();
    remove(item.id, item.label);
  };

  const canCreate = !!label.trim();
  const visibleItems = items.filter((i) => !hiddenIds.has(i.id));

  return (
    <View style={styles.container}>
      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New item</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new packing item"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, focused && styles.inputFocused]}
            placeholder="Tent, cooler, sunscreen…"
            placeholderTextColor={t.colors.text.placeholder}
            value={label}
            onChangeText={setLabel}
            maxLength={200}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel="Packing item label"
          />
          <Button
            label="Add"
            loading={createBusy}
            loadingLabel="Adding…"
            disabled={!canCreate}
            onPress={handleCreate}
            accessibilityLabel="Add packing item"
          />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add a packing item"
        >
          <Ionicons name="bag-add-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Add packing item</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {visibleItems.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="Nothing on the list yet"
          message="Add what your crew needs to bring, like a tent, a cooler or sunscreen."
          action={{ label: 'Add item', onPress: () => setShowForm(true) }}
        />
      ) : (
        visibleItems.map((item) => {
          const mine = item.brought_by === currentUserId;
          // A queued create has no server id yet, so it cannot be removed.
          const canRemove = !isPending(item) && (item.created_by === currentUserId || isOwner);
          // DC8: items fade/reflow in and out as the crew adds/claims/removes
          // them; gated on Reduce Motion (a plain View = instant).
          const motionProps = reduceMotion
            ? {}
            : {
                entering: FadeIn.duration(motionDuration.med),
                exiting: FadeOut.duration(motionDuration.fast),
                layout: LinearTransition.duration(motionDuration.med),
              };
          // R20 swipe-to-delete fallback: react-native-gesture-handler is absent
          // from the mobile deps, so the whole row is long-pressable (= delete
          // affordance) rather than a Gesture.Pan swipe. The trash button remains
          // the always-visible primary affordance, and the checkbox keeps its own
          // tap target — a long-press on the row body cannot collide with either.
          // Pressed coral dim is the feedback (no transform/spring; reduce-motion
          // is honoured via the gated layout motionProps above).
          const RowContainer: ElementType = reduceMotion
            ? canRemove
              ? Pressable
              : View
            : canRemove
              ? AnimatedPressable
              : Animated.View;
          const pressProps = canRemove
            ? {
                onLongPress: () => handleDelete(item),
                delayLongPress: 350,
                accessibilityHint: 'Long press to remove this item',
                style: ({ pressed }: { pressed: boolean }) => [styles.itemRow, pressed && styles.itemRowPressed],
              }
            : { style: styles.itemRow };
          return (
            <RowContainer key={item.id} {...pressProps} {...motionProps}>
              <TouchableOpacity
                onPress={() => handleToggle(item)}
                disabled={busyId === item.id}
                style={[styles.checkbox, item.claimed && styles.checkboxOn]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.claimed }}
                accessibilityLabel={item.claimed ? `Unclaim ${item.label}` : `Claim ${item.label}`}
              >
                {item.claimed ? <Ionicons name="checkmark" size={16} color={t.colors.accent.aqua} /> : null}
              </TouchableOpacity>
              <View style={styles.itemBody}>
                <Text style={[styles.itemLabel, item.claimed && styles.itemLabelClaimed]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.claimed && item.brought_by ? (
                  <Text style={styles.itemMeta}>{mine ? 'Bringing it' : 'Claimed'}</Text>
                ) : null}
                <CrewSyncMarker item={item} />
              </View>
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  disabled={busyId === item.id}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.label}`}
                >
                  <Ionicons name="trash-outline" size={16} color={t.colors.accent.coral} />
                </TouchableOpacity>
              ) : null}
            </RowContainer>
          );
        })
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  toggle: {
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
  toggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
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
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  // R20 long-press affordance: a coral-tinted dim surfaces the destructive
  // intent while the row is held (no transform/spring — reduce-motion-safe).
  itemRowPressed: {
    backgroundColor: t.colors.ring.coral,
    borderColor: t.colors.accent.coral,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  itemLabelClaimed: {
    color: t.colors.text.secondary,
    textDecorationLine: 'line-through',
  },
  itemMeta: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
}));
