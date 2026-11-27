import React, { useRef } from 'react';
import { Users, MapPin, CalendarClock, Banknote } from 'lucide-react';
import { CREW_TABS, type CrewTabKey } from '@festie/shared/utils';
import { useRovingTabs } from '@/hooks/useRovingTabs';
import { cn } from '@/lib/utils';
import CountBadge from '@/components/ui/CountBadge';

const TAB_ICONS: Record<CrewTabKey, React.ReactNode> = {
  find: <MapPin className="w-4 h-4 shrink-0 max-[359px]:hidden" aria-hidden="true" />,
  members: <Users className="w-4 h-4 shrink-0 max-[359px]:hidden" aria-hidden="true" />,
  plan: <CalendarClock className="w-4 h-4 shrink-0 max-[359px]:hidden" aria-hidden="true" />,
  money: <Banknote className="w-4 h-4 shrink-0 max-[359px]:hidden" aria-hidden="true" />,
};

interface CrewTabBarProps {
  activeTab: CrewTabKey;
  onTabChange: (tab: CrewTabKey) => void;
  /**
   * Per-tab badge content rendered after the label. A number renders a small
   * count pill; `true` renders a dot indicator. Falsy values render nothing.
   */
  badges?: Partial<Record<CrewTabKey, number | boolean>>;
}

export default function CrewTabBar({ activeTab, onTabChange, badges }: CrewTabBarProps) {
  const tablistRef = useRef<HTMLDivElement>(null);
  useRovingTabs(tablistRef);
  return (
    <div ref={tablistRef} className="grid grid-cols-4 gap-1 min-w-0 w-full" role="tablist" aria-label="Crew tabs">
      {CREW_TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={activeTab === t.key}
          id={`crew-tab-${t.key}`}
          aria-controls="crew-tab-panel"
          onClick={() => onTabChange(t.key)}
          className={cn(
            'min-w-0 justify-center px-1.5 py-1.5 min-h-11 rounded-md flex items-center gap-1 text-xs font-medium whitespace-nowrap',
            'transition-[scale,background-color,border-color,color] duration-(--duration-med) ease-out press-scale',
            activeTab === t.key
              ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
              : 'bg-bg-card text-text-secondary border border-border hover:border-border-light',
          )}
        >
          {TAB_ICONS[t.key]}
          {t.label}
          {(() => {
            const badge = badges?.[t.key];
            if (typeof badge === 'number' && badge > 0) {
              return (
                <CountBadge className="ml-0.5 shrink-0" aria-label={`${badge} open`}>
                  {badge}
                </CountBadge>
              );
            }
            if (badge === true) {
              return (
                <span className="ml-0.5 w-1.5 h-1.5 shrink-0 rounded-full bg-accent-aqua" aria-label="Unsettled balance" />
              );
            }
            return null;
          })()}
        </button>
      ))}
    </div>
  );
}
