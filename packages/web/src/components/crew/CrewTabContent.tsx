import React from 'react';
import { Link } from '@tanstack/react-router';
import { Columns3, CalendarClock, ChevronRight } from 'lucide-react';
import MembersTab from './MembersTab';
import MeetingPointsTab from './MeetingPointsTab';
import PollsTab from './PollsTab';
import PackingTab from './PackingTab';
import RidesTab from './RidesTab';
import ExpensesTab from './ExpensesTab';
import ActivityTab from './ActivityTab';
import type { CrewTabKey } from '@festie/shared/utils';
import type { CrewMember } from '@festie/shared/types';

interface CrewTabContentProps {
  tab: CrewTabKey;
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
  adminAddBusy: boolean;
  members: CrewMember[];
  ownerId?: string;
  onForceAdd: () => void;
  onTransferOwnership: (member: CrewMember) => void;
  onKick?: (member: CrewMember) => void;
  onDestroyCrew?: () => void;
  /** Raiser to aim the Find tab's map at (from an SOS banner or push). */
  focusSosUserId?: string;
}

const SECTION_HEADING = 'px-1 text-xs font-semibold uppercase tracking-wide text-text-muted';

export default function CrewTabContent({
  tab,
  crewId,
  currentUserId,
  isOwner,
  isAdmin,
  adminAddBusy,
  members,
  ownerId,
  onForceAdd,
  onTransferOwnership,
  onKick,
  onDestroyCrew,
  focusSosUserId,
}: CrewTabContentProps) {
  return (
    <div
      className="crew-tab-panel animate-[card-in_200ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
      key={tab}
      role="tabpanel"
      id="crew-tab-panel"
      aria-labelledby={`crew-tab-${tab}`}
    >
      {tab === 'members' && (
        <MembersTab
          members={members}
          ownerId={ownerId}
          isAdmin={isAdmin}
          adminAddBusy={adminAddBusy}
          onForceAdd={onForceAdd}
          isOwner={isOwner}
          currentUserId={currentUserId}
          onTransferOwnership={onTransferOwnership}
          onKick={onKick}
          onDestroyCrew={onDestroyCrew}
        />
      )}
      {tab === 'find' && (
        <>
          <MeetingPointsTab crewId={crewId} currentUserId={currentUserId} focusSosUserId={focusSosUserId} isOwner={isOwner} />
          <section aria-labelledby="crew-activity-heading" className="space-y-3 pt-4">
            <h3 id="crew-activity-heading" className={SECTION_HEADING}>
              Activity
            </h3>
            <ActivityTab crewId={crewId} />
          </section>
        </>
      )}
      {tab === 'plan' && (
        <div className="space-y-4">
          <Link
            to="/crew-plan"
            aria-label="View your crew's plan"
            className="flex items-center gap-2 py-2 px-4 min-h-11 rounded-full bg-accent-aqua text-[var(--text-on-light-accent)] hover:bg-[var(--color-accent-aqua-hover)] transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            <CalendarClock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Crew plan</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0" aria-hidden="true" />
          </Link>
          <Link
            to="/compare"
            aria-label="Compare crew schedules"
            className="flex items-center gap-2 py-2 px-4 min-h-11 rounded-full bg-transparent border border-accent-aqua/50 text-accent-aqua hover:bg-[var(--color-aqua-a08)] transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            <Columns3 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Compare schedules</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0" aria-hidden="true" />
          </Link>
          <section aria-labelledby="crew-polls-heading" className="space-y-3">
            <h3 id="crew-polls-heading" className={SECTION_HEADING}>
              Polls
            </h3>
            <PollsTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
          </section>
          <section aria-labelledby="crew-packing-heading" className="space-y-3">
            <h3 id="crew-packing-heading" className={SECTION_HEADING}>
              Packing
            </h3>
            <PackingTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
          </section>
          <section aria-labelledby="crew-rides-heading" className="space-y-3">
            <h3 id="crew-rides-heading" className={SECTION_HEADING}>
              Rides
            </h3>
            <RidesTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
          </section>
        </div>
      )}
      {tab === 'money' && <ExpensesTab crewId={crewId} members={members} currentUserId={currentUserId} />}
    </div>
  );
}
