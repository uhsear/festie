import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, AccessibilityInfo, Platform } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import type { CrewRideOffer } from '@festie/shared/types';
import {
  isPending,
  QUEUED_WRITE_MESSAGE,
  resolveFestivalTimeZone,
  rideDayOptions,
  rideDepartIso,
  rideDirectionLabel,
  ridePassengersLine,
  rideSeatAction,
  rideSeatsLine,
  rideTimeLabel,
  rideTimeParts,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useUndoableRemove } from '../hooks/useUndoableRemove';
import Button from './Button';
import EmptyState from './EmptyState';
import CrewSyncMarker from './CrewSyncMarker';
import { festivalForCrew } from '../lib/crewFestival';

type Direction = 'to_festival' | 'home';
const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'to_festival', label: 'To the festival' },
  { value: 'home', label: 'Heading home' },
];

/** `HH:MM` as a Date on an arbitrary day, for the native picker's `value`. */
function timeToDate(time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h ?? 12, m ?? 0);
}

/** A picked Date as `HH:MM` (24h). */
function dateToTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `HH:MM` (24h) to "2:00 PM", for the time button. */
function timeText(time: string): string {
  return timeToDate(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface CrewRidesProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew carpool / ride board (M2 logistics) — a shared "who's driving" board.
 * Offline-native: reads/writes go through the crewStore, so an offer posted with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as packing). Each row is a ride OFFER — driver, direction, seats,
 * where they're leaving from and when (festival time). Members take or leave a
 * seat; the poster or the owner edits the ride. The screen owns loading.
 */
export default function CrewRides({ crewId, currentUserId, isOwner }: CrewRidesProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();

  const offers = useCrewStore((s) => s.rideOffers);
  const createRideOffer = useCrewStore((s) => s.createRideOffer);
  const updateRideOffer = useCrewStore((s) => s.updateRideOffer);
  const deleteRideOffer = useCrewStore((s) => s.deleteRideOffer);
  const takeRideSeat = useCrewStore((s) => s.takeRideSeat);
  const leaveRideSeat = useCrewStore((s) => s.leaveRideSeat);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const members = crewMembers.length ? crewMembers : (activeCrew?.members ?? []);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  // The schedule tab's festival can differ from the crew's: frame times only when it matches.
  const crewFestival = festivalForCrew(activeCrew, currentFestival);
  const timeZone = resolveFestivalTimeZone(crewFestival);
  const dayOptions = crewFestival ? rideDayOptions(festivalDays, timeZone) : [];
  const myMember = members.find((m) => m.userId === currentUserId);
  const myName = myMember?.name || myMember?.username || '';

  const { hiddenIds, remove } = useUndoableRemove(
    (id) => deleteRideOffer(crewId, id),
    "Couldn't remove the ride. Try again.",
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('to_festival');
  const [dayDate, setDayDate] = useState('');
  const [time, setTime] = useState('');
  const [showIosTime, setShowIosTime] = useState(false);
  const [seatBusyId, setSeatBusyId] = useState<string | null>(null);
  const [driver, setDriver] = useState('');
  const [seats, setSeats] = useState('');
  const [departFrom, setDepartFrom] = useState('');
  const [departAt, setDepartAt] = useState('');
  const [note, setNote] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [focusedField, setFocusedField] = useState<'driver' | 'seats' | 'from' | 'at' | 'note' | null>(null);

  const reset = () => {
    setDriver('');
    setSeats('');
    setDepartFrom('');
    setDepartAt('');
    setNote('');
    setDirection('to_festival');
    setDayDate('');
    setTime('');
    setShowIosTime(false);
    setEditingId(null);
    setShowForm(false);
  };

  const openCreate = () => {
    reset();
    setDriver(myName);
    setShowForm(true);
  };

  const openEdit = (offer: CrewRideOffer) => {
    reset();
    setEditingId(offer.id);
    setDriver(offer.driver ?? '');
    setSeats(typeof offer.seats === 'number' ? String(offer.seats) : '');
    setDepartFrom(offer.depart_from ?? '');
    setDepartAt(offer.depart_at ?? '');
    setNote(offer.note ?? '');
    if (offer.direction) setDirection(offer.direction);
    const parts = offer.depart_time ? rideTimeParts(offer.depart_time, timeZone) : null;
    if (parts) {
      setDayDate(parts.date);
      setTime(parts.time);
    }
    setShowForm(true);
  };

  const pickTime = () => {
    if (Platform.OS === 'ios') {
      setShowIosTime((v) => !v);
      return;
    }
    DateTimePickerAndroid.open({
      value: timeToDate(time || '12:00'),
      mode: 'time',
      onChange: (_evt, selected) => {
        if (selected) setTime(dateToTime(selected));
      },
    });
  };

  const handleSubmit = async () => {
    if (createBusy) return;
    const d = driver.trim();
    const from = departFrom.trim();
    const at = departAt.trim();
    const n = note.trim();
    const rawSeats = seats.trim() ? Number(seats.trim()) : null;
    // Clamp to a non-negative integer (mirrors web's min=0/max=99); the input
    // already strips non-digits, this is defense-in-depth so we never POST a
    // negative or fractional seat count to the backend.
    const seatsNum = rawSeats != null && Number.isFinite(rawSeats) ? Math.max(0, Math.floor(rawSeats)) : null;
    if (!d && !from && !at && !n && seatsNum == null) return;
    // With a festival frame the day + time become a real instant; without one the free-text "When" stays.
    const departTime = crewFestival && dayDate && time ? rideDepartIso(dayDate, time, timeZone) : null;
    setCreateBusy(true);
    try {
      const request = {
        driver: d || null,
        seats: seatsNum,
        departFrom: from || null,
        departAt: at || null,
        note: n || null,
        direction,
        ...(departTime ? { departTime } : {}),
      };
      if (editingId) {
        await updateRideOffer(crewId, editingId, request);
        haptics.success();
      } else {
        const created = await createRideOffer(crewId, request);
        // Queued offline: the row shows "Not sent yet"; never celebrate it as sent.
        if (isPending(created)) AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
        else haptics.success();
      }
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleSeat = async (offer: CrewRideOffer, action: 'take' | 'leave') => {
    if (seatBusyId === offer.id) return;
    haptics.select();
    setSeatBusyId(offer.id);
    try {
      if (action === 'take') await takeRideSeat(crewId, offer.id, currentUserId);
      else await leaveRideSeat(crewId, offer.id, currentUserId);
    } catch {
      // Error surfaced via the crew store; the store rolled the seat count back.
    } finally {
      setSeatBusyId(null);
    }
  };

  const handleDelete = (offer: CrewRideOffer) => {
    haptics.tap();
    remove(offer.id, offer.driver ? `${offer.driver}'s ride` : 'the ride');
  };

  const visibleOffers = offers.filter((o) => !hiddenIds.has(o.id));
  const canCreate = !!driver.trim() || !!departFrom.trim() || !!departAt.trim() || !!note.trim() || !!seats.trim();

  return (
    <View style={styles.container}>
      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{editingId ? 'Edit ride' : 'New ride'}</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel ride form"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, focusedField === 'driver' && styles.inputFocused]}
            placeholder="Who's driving?"
            placeholderTextColor={t.colors.text.placeholder}
            value={driver}
            onChangeText={setDriver}
            maxLength={100}
            onFocus={() => setFocusedField('driver')}
            onBlur={() => setFocusedField((f) => (f === 'driver' ? null : f))}
            accessibilityLabel="Driver"
          />
          <View style={styles.chipRow}>
            {DIRECTIONS.map((d) => (
              <TouchableOpacity
                key={d.value}
                style={[styles.chip, direction === d.value && styles.chipOn]}
                onPress={() => setDirection(d.value)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: direction === d.value }}
                accessibilityLabel={d.label}
              >
                <Text style={[styles.chipText, direction === d.value && styles.chipTextOn]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, focusedField === 'seats' && styles.inputFocused]}
            placeholder="Open seats"
            placeholderTextColor={t.colors.text.placeholder}
            value={seats}
            onChangeText={(text) => setSeats(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            onFocus={() => setFocusedField('seats')}
            onBlur={() => setFocusedField((f) => (f === 'seats' ? null : f))}
            accessibilityLabel="Open seats"
          />
          <TextInput
            style={[styles.input, focusedField === 'from' && styles.inputFocused]}
            placeholder="Leaving from"
            placeholderTextColor={t.colors.text.placeholder}
            value={departFrom}
            onChangeText={setDepartFrom}
            maxLength={200}
            onFocus={() => setFocusedField('from')}
            onBlur={() => setFocusedField((f) => (f === 'from' ? null : f))}
            accessibilityLabel="Leaving from"
          />
          {crewFestival && dayOptions.length ? (
            <>
              <View style={styles.chipRow}>
                {dayOptions.map((d) => (
                  <TouchableOpacity
                    key={d.date}
                    style={[styles.chip, dayDate === d.date && styles.chipOn]}
                    onPress={() => setDayDate(d.date)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: dayDate === d.date }}
                    accessibilityLabel={`Day ${d.label}`}
                  >
                    <Text style={[styles.chipText, dayDate === d.date && styles.chipTextOn]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.input}
                onPress={pickTime}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={time ? `Time ${timeText(time)}` : 'Pick a time'}
              >
                <Text style={time ? styles.timeText : styles.timePlaceholder}>{time ? timeText(time) : 'Time'}</Text>
              </TouchableOpacity>
              {Platform.OS === 'ios' && showIosTime ? (
                <DateTimePicker
                  value={timeToDate(time || '12:00')}
                  mode="time"
                  display="spinner"
                  onChange={(_evt, selected) => {
                    if (selected) setTime(dateToTime(selected));
                  }}
                />
              ) : null}
            </>
          ) : (
            <TextInput
              style={[styles.input, focusedField === 'at' && styles.inputFocused]}
              placeholder="When (Fri 2pm)"
              placeholderTextColor={t.colors.text.placeholder}
              value={departAt}
              onChangeText={setDepartAt}
              maxLength={100}
              onFocus={() => setFocusedField('at')}
              onBlur={() => setFocusedField((f) => (f === 'at' ? null : f))}
              accessibilityLabel="Depart time"
            />
          )}
          <TextInput
            style={[styles.input, focusedField === 'note' && styles.inputFocused]}
            placeholder="Note"
            placeholderTextColor={t.colors.text.placeholder}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            onFocus={() => setFocusedField('note')}
            onBlur={() => setFocusedField((f) => (f === 'note' ? null : f))}
            accessibilityLabel="Note"
          />
          <Button
            label={editingId ? 'Save ride' : 'Post ride'}
            loading={createBusy}
            loadingLabel={editingId ? 'Saving…' : 'Posting…'}
            disabled={!canCreate}
            onPress={handleSubmit}
            accessibilityLabel={editingId ? 'Save ride' : 'Post ride'}
          />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={openCreate}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Post a ride"
        >
          <Ionicons name="car-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Post a ride</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {visibleOffers.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No rides yet"
          message="Offer a ride, or ask for one."
          action={{ label: 'Offer a ride', onPress: openCreate }}
        />
      ) : (
        visibleOffers.map((offer, idx) => {
          // A queued create has no server id yet, so it cannot be removed.
          const canRemove = !isPending(offer) && (offer.created_by === currentUserId || isOwner);
          const title = offer.driver || 'Ride offer';
          const canEdit = !isPending(offer) && (offer.created_by === currentUserId || isOwner);
          const seatAction = isPending(offer) ? 'none' : rideSeatAction(offer, currentUserId);
          const directionLabel = rideDirectionLabel(offer.direction);
          const passengers = ridePassengersLine(offer, members, currentUserId);
          const meta = [rideTimeLabel(offer, timeZone), rideSeatsLine(offer), offer.depart_from]
            .filter(Boolean)
            .join(' · ');
          // R22 staggered reveal — cap the stagger; reduce-motion safe.
          const entering = reduceMotion ? undefined : FadeInDown.delay(Math.min(idx, 9) * 40).duration(220);
          return (
            <Animated.View key={offer.id} entering={entering} style={styles.itemRow}>
              <View style={styles.iconBadge}>
                <Ionicons name="car" size={16} color={t.colors.accent.aqua} />
              </View>
              <View style={styles.itemBody}>
                <Text style={styles.itemLabel} numberOfLines={2}>
                  {title}
                </Text>
                {directionLabel ? <Text style={styles.directionChip}>{directionLabel}</Text> : null}
                {meta ? (
                  <Text style={styles.itemMeta} numberOfLines={2}>
                    {meta}
                  </Text>
                ) : null}
                {passengers ? (
                  <Text style={styles.itemMeta} numberOfLines={2}>
                    {passengers}
                  </Text>
                ) : null}
                {offer.note ? (
                  <Text style={styles.itemNote} numberOfLines={2}>
                    {offer.note}
                  </Text>
                ) : null}
                {seatAction === 'take' || seatAction === 'leave' || seatAction === 'full' ? (
                  <TouchableOpacity
                    onPress={() => seatAction !== 'full' && handleSeat(offer, seatAction)}
                    disabled={seatAction === 'full' || seatBusyId === offer.id}
                    style={styles.seatButton}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: seatAction === 'full' }}
                    accessibilityLabel={
                      seatAction === 'take'
                        ? `Take a seat: ${title}`
                        : seatAction === 'leave'
                          ? `Leave ride: ${title}`
                          : 'Full'
                    }
                  >
                    <Text style={seatAction === 'full' ? styles.actionTextMuted : styles.actionText}>
                      {seatAction === 'take' ? 'Take a seat' : seatAction === 'leave' ? 'Leave ride' : 'Full'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <CrewSyncMarker item={offer} />
              </View>
              {canEdit ? (
                <TouchableOpacity
                  onPress={() => openEdit(offer)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ride: ${title}`}
                >
                  <Ionicons name="create-outline" size={16} color={t.colors.text.secondary} />
                </TouchableOpacity>
              ) : null}
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => handleDelete(offer)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ride: ${title}`}
                >
                  <Ionicons name="trash-outline" size={16} color={t.colors.accent.coral} />
                </TouchableOpacity>
              ) : null}
            </Animated.View>
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
    alignItems: 'flex-start',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  iconBadge: {
    width: 24,
    height: 24,
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  itemMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  itemNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  chipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  chipTextOn: {
    color: t.colors.accent.aqua,
  },
  timeText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  timePlaceholder: {
    ...typeStyle('body'),
    color: t.colors.text.placeholder,
  },
  directionChip: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  seatButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  actionText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  actionTextMuted: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
}));
