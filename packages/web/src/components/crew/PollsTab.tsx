import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  useCrewStore,
  useFestivalStore,
  useFestivalDataStore,
  writeOutcomeOf,
  writeOutcomeMessage,
  splitPolls,
  nextVoteIndexes,
  tallyPoll,
  POLL_END_CHOICES,
  pollClosesAt,
  meetWherePollOptions,
  resolveFestivalTimeZone,
  type CrewPoll,
  type CrewMeetingPoint,
  type PollEndChoice,
} from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import IconButton from '../ui/IconButton';
import ConfirmDialog from '../ui/ConfirmDialog';
import PollItem from './PollItem';
import SchedulePollComposer from './SchedulePollComposer';
import { BarChart3, CalendarClock, MapPin, Plus, X } from 'lucide-react';
import { inputBase } from '../../lib/styles';

// Lead time (minutes) for the reminder seeded when a schedule poll closes —
// mirrors the festival reminder defaults.
const SCHEDULE_POLL_REMINDER_LEAD = 15;

interface Props {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

export default function PollsTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast, toastError } = useToast();
  const { select, warning } = useHaptics();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [confirmClosePollId, setConfirmClosePollId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [endChoice, setEndChoice] = useState<PollEndChoice>('none');
  const [multiAnswer, setMultiAnswer] = useState(false);
  const [showDecided, setShowDecided] = useState(false);
  const [meetHint, setMeetHint] = useState(false);

  // Close goes through the crewStore: the server picks the winner from the
  // poll's stored set_refs and creates the meeting point. saveReminder is
  // injected so crewStore stays decoupled from the festival store.
  const closePollStore = useCrewStore((s) => s.closePoll);
  const festivalId = useFestivalStore((s) => s.currentFestival?.id ?? null);
  const timeZone = useFestivalStore((s) => resolveFestivalTimeZone(s.currentFestival));
  const stages = useFestivalStore((s) => s.stages);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const members = activeCrew?.members ?? [];
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks) ?? {};
  const crewFestivalIsCurrent = !!festivalId && activeCrew?.festivalId === festivalId;

  const {
    data: polls = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<CrewPoll[]>({
    queryKey: ['polls', crewId],
    queryFn: async () => {
      const res = await api.get<{ polls: CrewPoll[] } | CrewPoll[]>(`/crews/${crewId}/polls`);
      const list = Array.isArray(res) ? res : res?.polls || [];
      return list.map((p) => ({
        ...p,
        votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number'),
      }));
    },
    enabled: !!crewId,
  });

  const createPoll = useMutation({
    mutationFn: (payload: { question: string; options: string[]; closesAt?: string; multiAnswer: boolean }) => api.post(`/crews/${crewId}/polls`, payload),
    onSuccess: (result, payload) => {
      const outcome = writeOutcomeOf(result);
      if (outcome === 'queued') {
        // Queued offline: show the poll now, marked "Not sent yet".
        const placeholder: CrewPoll = {
          ...(result as CrewPoll),
          ...payload,
          created_by: currentUserId,
          votes: [],
          _optimistic: true,
        };
        qc.setQueryData<CrewPoll[]>(['polls', crewId], (old = []) => [placeholder, ...old]);
      } else {
        qc.invalidateQueries({ queryKey: ['polls', crewId] });
      }
      toast(writeOutcomeMessage(outcome, 'Poll created'), outcome === 'queued' ? 'info' : 'success');
      reset();
    },
    onError: (e) => toastError(e, "Couldn't create poll. Try again."),
  });

  const vote = useMutation({
    mutationFn: ({ pollId, optionIndexes }: { pollId: string; optionIndexes: number[] }) =>
      api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndexes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polls', crewId] }),
    onError: (e) => {
      warning();
      toastError(e, "Couldn't submit your vote. Try again.");
    },
  });

  const close = useMutation({
    // The server creates a SCHEDULE poll's meeting point on close (from the
    // stored set_refs) for the whole crew; the store upserts it and this device
    // seeds the closer's reminder. Plain polls close exactly as before. The
    // reminder seeder is bound to the festival store's saveReminder.
    mutationFn: async (pollId: string) => {
      const knownPoints = new Set(useCrewStore.getState().meetingPoints.map((m) => m.id));
      await closePollStore(crewId, pollId, {
        festivalId: festivalId ?? undefined,
        seedReminder: (setId, fId) =>
          useFestivalDataStore.getState().saveReminder({
            festivalId: fId,
            setId,
            minutes: SCHEDULE_POLL_REMINDER_LEAD,
          }),
      });
      // closePoll upserts the new meeting point into the store; find it by id.
      return useCrewStore.getState().meetingPoints.find((m) => !knownPoints.has(m.id)) ?? null;
    },
    onSuccess: (meetingPoint) => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      toast(meetingPoint ? `Poll ended. ${meetingPoint.label} is now a meeting point.` : 'Poll ended', 'success');
    },
    onError: (e) => toastError(e, "Couldn't end poll. Try again."),
  });

  const nudge = useMutation({
    mutationFn: (pollId: string) => useCrewStore.getState().nudgePoll(crewId, pollId),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      toast(`Reminder sent to ${n} ${n === 1 ? 'person' : 'people'}.`, 'success');
    },
    onError: (e) => toastError(e, "Couldn't send the reminder. Try again."),
  });

  function addToPicks(setId: string) {
    if (!festivalId) return;
    useFestivalDataStore
      .getState()
      .savePick({ festivalId, setId, priority: 'want-to-see' })
      .then(() => toast('Added to your picks', 'success'))
      .catch((e) => toastError(e, "Couldn't add to your picks. Try again."));
  }

  async function startMeetWhere() {
    const points = await qc
      .fetchQuery({
        queryKey: ['meeting-points', crewId],
        queryFn: async () => {
          const res = await api.get<CrewMeetingPoint[] | { meetingPoints: CrewMeetingPoint[] }>(
            `/crews/${crewId}/meeting-points`,
          );
          return Array.isArray(res) ? res : res?.meetingPoints || [];
        },
      })
      .catch(() => [] as CrewMeetingPoint[]);
    const picked = meetWherePollOptions({
      homeBase: activeCrew?.homeBaseLocation,
      meetingPoints: points.map((m) => ({ label: m.label })),
      stages,
    });
    setQuestion('Meet where?');
    setOptions(picked.length >= 2 ? picked : [...picked, ...Array<string>(2 - picked.length).fill('')]);
    setMeetHint(picked.length < 2);
    setShowForm(true);
  }

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setEndChoice('none');
    setMultiAnswer(false);
    setMeetHint(false);
    setShowForm(false);
  }
  function addOpt() {
    setOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev));
  }
  function removeOpt(i: number) {
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }
  function updateOpt(i: number, v: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2 || opts.length > 4) return;
    createPoll.mutate({ question: q, options: opts, closesAt: pollClosesAt(endChoice, Date.now()), multiAnswer });
  }

  function handleVote(pollId: string, optionIndex: number) {
    const poll = polls.find((p) => p.id === pollId);
    if (!poll) return;
    select();
    const mine = tallyPoll(poll, currentUserId).myIndexes;
    vote.mutate({ pollId, optionIndexes: nextVoteIndexes(poll, mine, optionIndex) });
  }

  const { open: openPolls, decided } = splitPolls(polls);

  if (isLoading)
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  if (isError)
    return (
      <div className="px-4">
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load polls"
          description="Something went wrong loading polls."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );

  return (
    <div className="space-y-3 px-4">
      {showSchedule ? (
        <SchedulePollComposer
          crewId={crewId}
          onCreated={() => {
            // The composer writes to crewStore (carrying the set linkage); mirror
            // it into the query-driven list so it renders immediately.
            qc.invalidateQueries({ queryKey: ['polls', crewId] });
            setShowSchedule(false);
          }}
          onCancel={() => setShowSchedule(false)}
        />
      ) : !showForm ? (
        <div className="space-y-2">
          <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
            <Plus className="w-4 h-4" aria-hidden="true" /> Create Poll
          </Button>
          <Button variant="secondary" onClick={() => setShowSchedule(true)} className="w-full min-h-11">
            <CalendarClock className="w-4 h-4" aria-hidden="true" /> Which set? (from the lineup)
          </Button>
          <Button variant="secondary" onClick={startMeetWhere} className="w-full min-h-11">
            <MapPin className="w-4 h-4" aria-hidden="true" /> Meet where?
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Poll</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we decide?"
            required
          />
          <div>
            <span id="poll-options-label" className="block text-sm font-medium text-text-primary mb-2">
              Options (2–4)
            </span>
            <div className="space-y-2" role="group" aria-labelledby="poll-options-label">
              {options.map((o, i) => (
                <div key={`opt-${i}`} className="flex items-center gap-2">
                  <input
                    className={`${inputBase} flex-1 min-h-11`}
                    value={o}
                    onChange={(e) => updateOpt(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Poll option ${i + 1}`}
                    required
                  />
                  {options.length > 2 && (
                    <IconButton
                      label="Remove option"
                      variant="danger"
                      icon={<X className="w-4 h-4" />}
                      onClick={() => removeOpt(i)}
                    />
                  )}
                </div>
              ))}
            </div>
            {options.length < 4 && (
              <button
                type="button"
                onClick={addOpt}
                className="min-h-11 mt-2 text-sm text-accent-aqua hover:opacity-80 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> Add option
              </button>
            )}
            {meetHint && (
              <p className="mt-1 text-xs text-text-muted">Add a meeting point or home base to fill this in.</p>
            )}
          </div>
          <div>
            <span id="poll-ends-label" className="block text-sm font-medium text-text-primary mb-2">
              Ends
            </span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="poll-ends-label">
              {POLL_END_CHOICES.filter((c) => c.id !== 'setStart').map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={endChoice === c.id}
                  onClick={() => setEndChoice(c.id)}
                  className={`min-h-11 px-3 rounded-full border text-sm ${
                    endChoice === c.id ? 'border-accent-aqua text-accent-aqua' : 'border-glass-border text-text-secondary'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 min-h-11 text-sm text-text-primary">
            <input type="checkbox" checked={multiAnswer} onChange={(e) => setMultiAnswer(e.target.checked)} />
            Allow more than one answer
          </label>
          <Button
            type="submit"
            variant="primary"
            isLoading={createPoll.isPending}
            className="w-full min-h-11"
            disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          >
            Create
          </Button>
        </form>
      )}

      {polls.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No polls yet"
          description="Ask the crew something."
          cta={{ label: 'Create poll', onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="space-y-3">
          {openPolls.map((p, idx) => (
            <PollItem
              key={p.id}
              poll={p}
              index={idx}
              currentUserId={currentUserId}
              isOwner={isOwner}
              isVotePending={vote.isPending && vote.variables?.pollId === p.id}
              isClosePending={close.isPending && close.variables === p.id}
              members={members}
              timeZone={timeZone}
              picks={picks}
              onVote={handleVote}
              onClose={setConfirmClosePollId}
              onNudge={nudge.mutate}
              onAddToPicks={crewFestivalIsCurrent ? addToPicks : undefined}
            />
          ))}
          {decided.length > 0 && (
            <button
              type="button"
              aria-expanded={showDecided}
              onClick={() => setShowDecided((v) => !v)}
              className="min-h-11 text-sm text-text-secondary hover:text-text-primary"
            >
              Decided ({decided.length})
            </button>
          )}
          {showDecided &&
            decided.map((p, idx) => (
              <PollItem
                key={p.id}
                poll={p}
                index={idx}
                currentUserId={currentUserId}
                isOwner={isOwner}
                isVotePending={vote.isPending && vote.variables?.pollId === p.id}
                isClosePending={close.isPending && close.variables === p.id}
                members={members}
                timeZone={timeZone}
                picks={picks}
                onVote={handleVote}
                onClose={setConfirmClosePollId}
                onNudge={nudge.mutate}
                onAddToPicks={crewFestivalIsCurrent ? addToPicks : undefined}
              />
            ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmClosePollId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmClosePollId(null);
        }}
        title="End this poll?"
        description="Voting stops and everyone sees the result."
        confirmLabel="End poll"
        onConfirm={() => {
          if (confirmClosePollId) close.mutate(confirmClosePollId);
          setConfirmClosePollId(null);
        }}
      />
    </div>
  );
}
