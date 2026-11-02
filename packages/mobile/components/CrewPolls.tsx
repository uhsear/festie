import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, AccessibilityInfo, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalStore, useFestivalDataStore } from '@festie/shared/stores';
import type { CrewPoll, FestivalDay, FestivalSet, PollSetRef, Stage } from '@festie/shared/types';
import {
  artistDisplayName,
  formatTime,
  getSetTimeBounds,
  isPending,
  meetWherePollOptions,
  nextVoteIndexes,
  pollClosesAt,
  POLL_END_CHOICES,
  resolveFestivalTimeZone,
  splitPolls,
  tallyPoll,
  QUEUED_WRITE_MESSAGE,
} from '@festie/shared/utils';
import type { PollEndChoice } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';
import EmptyState from './EmptyState';
import CrewPollCard from './CrewPollCard';
import { festivalForCrew } from '../lib/crewFestival';

// Lead time (minutes) for the reminder seeded when a schedule poll closes.
const SCHEDULE_POLL_REMINDER_LEAD = 15;
const MAX_OPTIONS = 4;
const EMPTY_SETS: FestivalSet[] = [];
const EMPTY_DAYS: FestivalDay[] = [];
const EMPTY_STAGES: Stage[] = [];

interface Slot {
  startTime: string;
  dayIndex: number;
  sets: FestivalSet[];
}

interface CrewPollsProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew polls — list active polls with live vote bars, vote on an option, create
 * a poll (2–4 options, matching the server schema), and end one (creator or
 * owner). Hits the shared crewStore actions; the screen owns loading.
 */
export default function CrewPolls({ crewId, currentUserId, isOwner }: CrewPollsProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const polls = useCrewStore((s) => s.polls);
  const createPoll = useCrewStore((s) => s.createPoll);
  const votePoll = useCrewStore((s) => s.votePoll);
  const closePoll = useCrewStore((s) => s.closePoll);
  const nudgePoll = useCrewStore((s) => s.nudgePoll);
  const members = useCrewStore((s) => s.crewMembers);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);

  // Festival lineup (from the persisted festival cache — works offline) powers
  // the schedule-aware composer + the close-time meeting point / reminder.
  // The schedule tab's festival can differ from the crew's: use the lineup only
  // when it belongs to this crew's festival, else offer none and seed no reminder.
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const storeSets = useFestivalStore((s) => s.sets);
  const storeDays = useFestivalStore((s) => s.days);
  const storeStages = useFestivalStore((s) => s.stages);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const crewFestival = festivalForCrew(activeCrew, currentFestival);
  const timeZone = resolveFestivalTimeZone(crewFestival);
  const sets = crewFestival ? storeSets : EMPTY_SETS;
  const days = crewFestival ? storeDays : EMPTY_DAYS;
  const stages = crewFestival ? storeStages : EMPTY_STAGES;
  const festivalId = crewFestival?.id ?? null;

  const stageName = (stageId: string): string | null => stages.find((st) => st.id === stageId)?.name ?? null;

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [createBusy, setCreateBusy] = useState(false);
  const [endChoice, setEndChoice] = useState<PollEndChoice>('none');
  const [multiAnswer, setMultiAnswer] = useState(false);
  const [decidedOpen, setDecidedOpen] = useState(false);
  const [meetHint, setMeetHint] = useState(false);
  // Per-poll in-flight set (keyed by poll id) so voting on one poll only
  // disables that poll's options — a single global flag froze every poll.
  const [votingPollIds, setVotingPollIds] = useState<Set<string>>(() => new Set());

  // ── Schedule-aware composer state ──────────────────────────────────────
  const [showSchedule, setShowSchedule] = useState(false);
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // Group the lineup into start-time slots that have a clash (≥2 sets) so the
  // crew can vote "which set at 9pm?". Sorted by day then time.
  const slots = useMemo<Slot[]>(() => {
    const byKey = new Map<string, Slot>();
    for (const set of sets) {
      if (!set.startTime || typeof set.dayIndex !== 'number') continue;
      const key = `${set.dayIndex}|${set.startTime}`;
      const slot = byKey.get(key);
      if (slot) slot.sets.push(set);
      else byKey.set(key, { startTime: set.startTime, dayIndex: set.dayIndex, sets: [set] });
    }
    return Array.from(byKey.values())
      .filter((s) => s.sets.length >= 2)
      .sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime));
  }, [sets]);

  const selectedSlot = useMemo(
    () => slots.find((s) => `${s.dayIndex}|${s.startTime}` === slotKey) ?? null,
    [slots, slotKey],
  );

  const dayLabel = (dayIndex: number) => days[dayIndex]?.label || days[dayIndex]?.date || `Day ${dayIndex + 1}`;

  const selectSlot = (slot: Slot) => {
    const key = `${slot.dayIndex}|${slot.startTime}`;
    setSlotKey(key);
    const next: Record<string, boolean> = {};
    slot.sets.forEach((set, i) => {
      next[set.id] = i < MAX_OPTIONS;
    });
    setPicked(next);
    if (!question.trim()) setQuestion(`Which set at ${formatTime(slot.startTime)}?`);
  };

  const toggleSet = (setId: string) =>
    setPicked((prev) => {
      const wouldSelect = !prev[setId];
      const count = Object.values(prev).filter(Boolean).length;
      if (wouldSelect && count >= MAX_OPTIONS) return prev;
      return { ...prev, [setId]: wouldSelect };
    });

  const chosenSets = selectedSlot ? selectedSlot.sets.filter((s) => picked[s.id]) : [];
  // P2: at MAX_OPTIONS, unchecked rows can't be added — dim + disable them so
  // the cap is visible rather than a silent dead-tap (toggleSet returns prev).
  const atMaxOptions = chosenSets.length >= MAX_OPTIONS;
  const canCreateSchedule = !!question.trim() && chosenSets.length >= 2 && chosenSets.length <= MAX_OPTIONS;

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setShowForm(false);
    setShowSchedule(false);
    setSlotKey(null);
    setPicked({});
    setEndChoice('none');
    setMultiAnswer(false);
    setMeetHint(false);
  };

  const handleCreateSchedule = async () => {
    if (!canCreateSchedule || createBusy) return;
    setCreateBusy(true);
    try {
      const opts = chosenSets.map((set) => artistDisplayName(set));
      const setRefs: (PollSetRef | null)[] = chosenSets.map((set) => {
        const bounds = getSetTimeBounds(set, days, timeZone);
        return {
          setId: set.id,
          label: artistDisplayName(set),
          stageReference: stageName(set.stageId) ?? set.stageName ?? null,
          meetAt: bounds ? new Date(bounds.startMs).toISOString() : null,
        };
      });
      const setStartMs = setRefs.reduce<number | null>((min, r) => {
        const ms = r?.meetAt ? Date.parse(r.meetAt) : NaN;
        return Number.isNaN(ms) ? min : min === null ? ms : Math.min(min, ms);
      }, null);
      const closesAt = pollClosesAt(endChoice, Date.now(), setStartMs);
      const created = await createPoll(
        crewId,
        { question: question.trim(), options: opts, closesAt, multiAnswer },
        setRefs,
      );
      // Queued offline: the card shows "Not sent yet"; never celebrate it as sent.
      if (isPending(created)) AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
      else haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const updateOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () => setOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const handleCreate = async () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2 || opts.length > 4 || createBusy) return;
    setCreateBusy(true);
    try {
      const created = await createPoll(crewId, {
        question: q,
        options: opts,
        closesAt: pollClosesAt(endChoice, Date.now()),
        multiAnswer,
      });
      if (isPending(created)) AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
      else haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleVote = async (poll: CrewPoll, optionIndex: number) => {
    const pollId = poll.id;
    if (votingPollIds.has(pollId)) return;
    haptics.select();
    setVotingPollIds((prev) => new Set(prev).add(pollId));
    try {
      await votePoll(crewId, pollId, nextVoteIndexes(poll, tallyPoll(poll, currentUserId).myIndexes, optionIndex));
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setVotingPollIds((prev) => {
        const next = new Set(prev);
        next.delete(pollId);
        return next;
      });
    }
  };

  const handleClose = (poll: CrewPoll) => {
    // A schedule poll (carries `set_refs`) gets the winning set's meeting point
    // from the server on close, plus a reminder seeded here; surface that in the confirm copy.
    const isSchedule = !!poll.set_refs?.some((r) => r != null);
    const message = isSchedule
      ? `End "${poll.question}"? Voting stops and everyone sees the result. The winning set becomes a meeting point for the whole crew, and you get a reminder 15 min before.`
      : `End "${poll.question}"? Voting stops and everyone sees the result.`;
    Alert.alert('End poll', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End poll',
        style: 'destructive',
        onPress: () => {
          closePoll(crewId, poll.id, {
            festivalId: festivalId ?? undefined,
            seedReminder: (setId, fId) =>
              useFestivalDataStore.getState().saveReminder({
                festivalId: fId,
                setId,
                minutes: SCHEDULE_POLL_REMINDER_LEAD,
              }),
          }).catch(() => {});
        },
      },
    ]);
  };

  const handleNudge = async (pollId: string) => {
    try {
      const n = await nudgePoll(crewId, pollId);
      AccessibilityInfo.announceForAccessibility(`Reminder sent to ${n} ${n === 1 ? 'person' : 'people'}`);
      haptics.success();
    } catch (err) {
      Alert.alert('Reminder not sent', err instanceof Error ? err.message : 'Try again in a moment.');
    }
  };

  const handleAddToPicks = async (setId: string) => {
    if (!festivalId) return;
    try {
      await useFestivalDataStore.getState().savePick({ festivalId, setId, priority: 'want-to-see' });
      AccessibilityInfo.announceForAccessibility('Added to your picks');
      haptics.success();
    } catch {
      // Error surfaced via the festival data store.
    }
  };

  const startMeetWhere = () => {
    const filled = meetWherePollOptions({ homeBase: activeCrew?.homeBaseLocation, meetingPoints, stages });
    setQuestion('Meet where?');
    setOptions(filled.length >= 2 ? filled : [...filled, ...Array<string>(2 - filled.length).fill('')]);
    setMeetHint(filled.length < 2);
    setShowForm(true);
  };

  const { open, decided } = splitPolls(polls);
  const renderCard = (poll: CrewPoll) => (
    <CrewPollCard
      key={poll.id}
      poll={poll}
      currentUserId={currentUserId}
      canEnd={poll.created_by === currentUserId || isOwner}
      members={members}
      timeZone={timeZone}
      picks={picks}
      voting={votingPollIds.has(poll.id)}
      onVote={(i) => handleVote(poll, i)}
      onEnd={() => handleClose(poll)}
      onNudge={() => handleNudge(poll.id)}
      onAddToPicks={festivalId ? handleAddToPicks : undefined}
    />
  );

  const endChips = (choices: typeof POLL_END_CHOICES) => (
    <>
      <Text style={styles.optionsLabel}>Ends</Text>
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {choices.map((c) => {
          const checked = endChoice === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, checked && styles.chipOn]}
              onPress={() => {
                haptics.select();
                setEndChoice(c.id);
              }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={c.label}
            >
              <Text style={[styles.chipText, checked && styles.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );

  const multiAnswerRow = (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>Allow more than one answer</Text>
      <Switch
        value={multiAnswer}
        onValueChange={setMultiAnswer}
        trackColor={{ true: t.colors.accent.aqua }}
        ios_backgroundColor={t.colors.text.muted}
        accessibilityLabel="Allow more than one answer"
      />
    </View>
  );

  const canCreate = !!question.trim() && options.map((o) => o.trim()).filter(Boolean).length >= 2;

  return (
    <View style={styles.container}>
      {showSchedule ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Schedule poll</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel schedule poll"
            >
              <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          {slots.length === 0 ? (
            <Text style={styles.empty}>
              No clashing timeslots in this lineup yet — schedule polls need two sets at the same time.
            </Text>
          ) : !selectedSlot ? (
            <>
              <Text style={styles.optionsLabel}>Pick a timeslot</Text>
              {slots.map((slot) => {
                const key = `${slot.dayIndex}|${slot.startTime}`;
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.slotRow}
                    onPress={() => selectSlot(slot)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Timeslot ${dayLabel(slot.dayIndex)} ${formatTime(slot.startTime)}, ${slot.sets.length} sets`}
                  >
                    <Ionicons name="time-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.slotText}>
                      {dayLabel(slot.dayIndex)} · {formatTime(slot.startTime)}
                    </Text>
                    <Text style={styles.slotMeta}>{slot.sets.length} sets</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <>
              {/* P3: change just the timeslot (clears slotKey) without discarding
                  the whole form — the header X resets everything. */}
              <TouchableOpacity
                onPress={() => {
                  setSlotKey(null);
                  setPicked({});
                }}
                style={styles.changeSlotRow}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Change timeslot"
              >
                <Ionicons name="chevron-back" size={t.iconSize.compact} color={t.colors.accent.aqua} />
                <Text style={styles.changeSlotText}>
                  {dayLabel(selectedSlot.dayIndex)} · {formatTime(selectedSlot.startTime)} — change
                </Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="Which set should we catch?"
                placeholderTextColor={t.colors.text.placeholder}
                value={question}
                onChangeText={setQuestion}
                maxLength={500}
                accessibilityLabel="Schedule poll question"
              />
              <Text style={styles.optionsLabel}>Options (pick 2–{MAX_OPTIONS})</Text>
              {selectedSlot.sets.map((set) => {
                const checked = !!picked[set.id];
                // P2: blocked = an unchecked row while the 4-option cap is full.
                const blocked = !checked && atMaxOptions;
                const stage = stageName(set.stageId) ?? set.stageName;
                return (
                  <TouchableOpacity
                    key={set.id}
                    style={[
                      styles.optionPickRow,
                      checked && styles.optionPickRowOn,
                      blocked && styles.optionPickRowBlocked,
                    ]}
                    onPress={() => toggleSet(set.id)}
                    disabled={blocked}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: blocked }}
                    accessibilityLabel={
                      blocked
                        ? `${artistDisplayName(set)} — max ${MAX_OPTIONS} options reached`
                        : `Include ${artistDisplayName(set)}`
                    }
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={t.iconSize.action}
                      color={checked ? t.colors.accent.aqua : t.colors.text.secondary}
                    />
                    <Text style={styles.optionPickText} numberOfLines={1}>
                      {artistDisplayName(set)}
                    </Text>
                    {stage ? <Text style={styles.slotMeta}>{stage}</Text> : null}
                  </TouchableOpacity>
                );
              })}
              {endChips(POLL_END_CHOICES)}
              {multiAnswerRow}
              <Button
                label={createBusy ? 'Creating…' : 'Create schedule poll'}
                onPress={handleCreateSchedule}
                disabled={createBusy || !canCreateSchedule}
                accessibilityLabel="Create schedule poll"
              />
              <Text style={styles.helperText}>
                The winning set becomes a crew meeting point with a {SCHEDULE_POLL_REMINDER_LEAD}-minute reminder.
              </Text>
            </>
          )}
        </View>
      ) : showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New poll</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new poll"
            >
              <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="What should we decide?"
            placeholderTextColor={t.colors.text.placeholder}
            value={question}
            onChangeText={setQuestion}
            maxLength={500}
            accessibilityLabel="Poll question"
          />
          <Text style={styles.optionsLabel}>Options (2–4)</Text>
          {options.map((o, i) => (
            <View key={`opt-${i}`} style={styles.optionInputRow}>
              <TextInput
                style={[styles.input, styles.optionInput]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={t.colors.text.placeholder}
                value={o}
                onChangeText={(v) => updateOption(i, v)}
                maxLength={200}
                accessibilityLabel={`Poll option ${i + 1}`}
              />
              {options.length > 2 ? (
                <TouchableOpacity
                  onPress={() => removeOption(i)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove option ${i + 1}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={t.colors.text.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {options.length < 4 ? (
            <TouchableOpacity
              onPress={addOption}
              style={styles.addOptionRow}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Add poll option"
            >
              <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.addOptionText}>Add option</Text>
            </TouchableOpacity>
          ) : null}
          {meetHint ? <Text style={styles.helperText}>Add a meeting point or home base to fill this in.</Text> : null}
          {endChips(POLL_END_CHOICES.filter((c) => c.id !== 'setStart'))}
          {multiAnswerRow}
          <Button
            label={createBusy ? 'Creating…' : 'Create'}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            accessibilityLabel="Create poll"
          />
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setShowForm(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create a poll"
          >
            <Ionicons name="bar-chart-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.toggleText}>Create poll</Text>
            <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setShowSchedule(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create a schedule poll"
          >
            <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.toggleText}>Which set? (from the lineup)</Text>
            <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toggle}
            onPress={startMeetWhere}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create a meet where poll"
          >
            <Ionicons name="location-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.toggleText}>Meet where?</Text>
            <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>
        </>
      )}

      {polls.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No polls yet"
          message="Ask the crew something."
          action={{ label: 'Create poll', onPress: () => setShowForm(true) }}
        />
      ) : (
        <>
          {open.map(renderCard)}
          {decided.length > 0 ? (
            <>
              <TouchableOpacity
                style={styles.decidedHeader}
                onPress={() => setDecidedOpen((v) => !v)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ expanded: decidedOpen }}
                accessibilityLabel={`Decided (${decided.length})`}
              >
                <Text style={styles.decidedHeaderText}>Decided ({decided.length})</Text>
                <Ionicons
                  name={decidedOpen ? 'chevron-up' : 'chevron-down'}
                  size={t.iconSize.compact}
                  color={t.colors.text.secondary}
                />
              </TouchableOpacity>
              {decidedOpen ? decided.map(renderCard) : null}
            </>
          ) : null}
        </>
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
  optionsLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  optionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  optionInput: {
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
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  slotText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  slotMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  optionPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  optionPickRowOn: {
    borderColor: t.colors.accent.aqua,
  },
  // P2: dim the unchecked rows once the 4-option cap is hit (disabled press).
  optionPickRowBlocked: {
    opacity: 0.4,
  },
  changeSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  changeSlotText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  optionPickText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  helperText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  addOptionText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  // Primary aqua CTAs migrated to components/Button (F8).
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  chipOn: {
    borderColor: t.colors.accent.aqua,
  },
  chipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  chipTextOn: {
    color: t.colors.accent.aqua,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  switchLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  decidedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: t.spacing[1],
  },
  decidedHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
}));
