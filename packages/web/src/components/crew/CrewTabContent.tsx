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
import { CREW_TABS, type CrewTabKey } from '@festie/shared/utils/navigation';
import type { CrewMember } from '@festie/shared/types';
import { sectionHeading } from '../../lib/styles';

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
  onLeaveCrew?: () => void;
  onDeleteCrew?: () => void;
  maxMembers?: number;
  /** Raiser to aim the Find tab's map at (from an SOS banner or push). */
  focusSosUserId?: string;
  /** Crew-wide rows (faces, invite, Home Base) that open the Find tab, so the tab bar stays under the header. */
  findLead?: React.ReactNode;
}

// Plan and Compare lead somewhere else; Create poll below is the one filled action on the tab.
const NAV_ROW =
  'flex items-center gap-2 py-2 px-4 min-h-11 rounded-xl border border-border bg-bg-card text-text-primary hover:border-border-light transition-colors duration-(--duration-med) ease-(--ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

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
  onLeaveCrew,
  onDeleteCrew,
  maxMembers,
  focusSosUserId,
  findLead,
}: CrewTabContentProps) {
  return (
    <div
      className="crew-tab-panel animate-[card-in_var(--duration-med)_var(--ease-out)_both] motion-reduce:!animate-none"
      key={tab}
      role="tabpanel"
      id="crew-tab-panel"
      aria-labelledby={`crew-tab-${tab}`}
    >
      {/* The page h1 is the crew name; this keeps the section headings below from skipping a level. */}
      <h2 className="sr-only">{CREW_TABS.find((entry) => entry.key === tab)?.label}</h2>
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
          onLeaveCrew={onLeaveCrew}
          onDeleteCrew={onDeleteCrew}
          maxMembers={maxMembers}
        />
      )}
      {tab === 'find' && (
        <div className="space-y-4">
          {findLead}
          <MeetingPointsTab crewId={crewId} currentUserId={currentUserId} focusSosUserId={focusSosUserId} isOwner={isOwner} />
          <section aria-labelledby="crew-activity-heading" className="space-y-3 pt-4">
            <h3 id="crew-activity-heading" className={sectionHeading}>
              Activity
            </h3>
            <ActivityTab crewId={crewId} />
          </section>
        </div>
      )}
      {tab === 'plan' && (
        <div className="space-y-4">
          <Link to="/crew-plan" aria-label="View your crew's plan" className={NAV_ROW}>
            <CalendarClock className="w-4 h-4 flex-shrink-0 text-accent-aqua" aria-hidden="true" />
            <span className="text-sm font-semibold">Crew plan</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0 text-text-muted" aria-hidden="true" />
          </Link>
          <Link to="/compare" aria-label="Compare crew schedules" className={NAV_ROW}>
            <Columns3 className="w-4 h-4 flex-shrink-0 text-accent-aqua" aria-hidden="true" />
            <span className="text-sm font-semibold">Compare schedules</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0 text-text-muted" aria-hidden="true" />
          </Link>
          <section aria-labelledby="crew-polls-heading" className="space-y-3">
            <h3 id="crew-polls-heading" className={sectionHeading}>
              Polls
            </h3>
            <PollsTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
          </section>
          <section aria-labelledby="crew-packing-heading" className="space-y-3">
            <h3 id="crew-packing-heading" className={sectionHeading}>
              Packing
            </h3>
            <PackingTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
          </section>
          <section aria-labelledby="crew-rides-heading" className="space-y-3">
            <h3 id="crew-rides-heading" className={sectionHeading}>
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
