import React from 'react';
import { BellRing, Check, Lock } from 'lucide-react';
import {
  decisionSetId,
  fmtZonedClock,
  isPollClosed,
  pollDecision,
  pollNonVoterIds,
  pollPercent,
  tallyPoll,
  voterNamesLine,
  type CrewMember,
  type CrewPoll,
} from '@festie/shared';
import PollOptionButton from './PollOptionButton';
import SyncMarker from './SyncMarker';

export interface PollItemProps {
  poll: CrewPoll;
  index: number;
  currentUserId: string;
  isOwner: boolean;
  isVotePending: boolean;
  isClosePending: boolean;
  members: CrewMember[];
  timeZone?: string;
  /** Current profile's picks by set id. */
  picks: Record<string, unknown>;
  onVote: (pollId: string, optionIndex: number) => void;
  onClose: (pollId: string) => void;
  onNudge: (pollId: string) => void;
  /** Omitted when the crew's festival is not the current one. */
  onAddToPicks?: (setId: string) => void;
}

export default function PollItem({
  poll,
  index,
  currentUserId,
  isOwner,
  isVotePending,
  isClosePending,
  members,
  timeZone,
  picks,
  onVote,
  onClose,
  onNudge,
  onAddToPicks,
}: PollItemProps) {
  const tally = tallyPoll(poll, currentUserId);
  const closed = isPollClosed(poll);
  const decision = pollDecision(poll, tally);
  const setId = closed ? decisionSetId(poll, decision) : null;
  const pending = poll._optimistic === true;
  const endMs = Date.parse((closed ? (poll.closed_at ?? poll.closes_at) : poll.closes_at) ?? '');
  const endLine = Number.isNaN(endMs) ? null : `${closed ? 'Ended' : 'Ends'} ${fmtZonedClock(endMs, timeZone)}`;
  const canManage = !pending && !closed && (poll.created_by === currentUserId || isOwner);
  const nonVoters = pollNonVoterIds(
    poll,
    members.map((m) => m.userId),
  ).filter((id) => id !== currentUserId);
  const person = (n: number) => (n === 1 ? 'person' : 'people');

  return (
    <div
      className="stagger-item rounded-lg bg-bg-card border border-border p-3 space-y-2"
      style={{ '--i': Math.min(index, 6) } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-text-primary">{poll.question}</h4>
          {(poll.multi_answer || endLine) && (
            <p className="text-xs text-text-muted">{[poll.multi_answer ? 'Pick any' : null, endLine].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <span className="text-xs text-text-secondary flex-shrink-0">{tally.voterCount} voted</span>
      </div>
      <SyncMarker item={poll} />

      {closed && decision.kind !== 'none' && (
        <p className="flex items-center gap-1.5 text-sm text-accent-aqua">
          <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> {decision.text}
        </p>
      )}
      {closed && decision.kind === 'none' && <p className="text-sm text-text-muted">{decision.text}</p>}

      <div className="space-y-2">
        {poll.options.map((text, i) => (
          <PollOptionButton
            key={`${poll.id}-${i}`}
            pollId={poll.id}
            optionIndex={i}
            text={text}
            pct={pollPercent(tally.counts[i] ?? 0, tally.voterCount)}
            isMine={tally.myIndexes.includes(i)}
            isWinning={(tally.counts[i] ?? 0) === Math.max(0, ...tally.counts) && (tally.counts[i] ?? 0) > 0}
            isPending={isVotePending || pending}
            voterLine={voterNamesLine(tally.voters[i] ?? [], members)}
            disabled={closed}
            onVote={onVote}
          />
        ))}
      </div>

      {setId && onAddToPicks && (
        picks[setId] ? (
          <p className="text-xs text-text-muted">In your picks</p>
        ) : (
          <button
            onClick={() => onAddToPicks(setId)}
            className="min-h-11 text-sm text-accent-aqua hover:opacity-80"
          >
            Add to my picks
          </button>
        )
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-x-4">
          <button
            onClick={() => onClose(poll.id)}
            disabled={isClosePending}
            className="min-h-11 flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" /> End poll
          </button>
          {poll.nudged_at ? (
            <span className="text-xs text-text-muted">Reminder sent</span>
          ) : (
            nonVoters.length > 0 && (
              <button
                onClick={() => onNudge(poll.id)}
                className="min-h-11 flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary"
              >
                <BellRing className="w-3.5 h-3.5" aria-hidden="true" /> Remind {nonVoters.length} {person(nonVoters.length)}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
