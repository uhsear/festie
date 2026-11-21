import { View } from 'react-native';
import {
  type PicksFilter,
  type PlanListItem,
  type PlanListKind,
  type PicksStats,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { useTokens } from '../../hooks/useTokens';
import { priorityIconName } from '../../lib/prioritySymbol';
import StatChip from './StatChip';
import { useStyles } from './styles';

interface PicksSummaryRowProps {
  activePlanList: "reminders" | "notes" | null;
  effectiveFilter: PicksFilter;
  noteItems: PlanListItem[];
  reminderItems: PlanListItem[];
  setFocusFilter: (next: PicksFilter) => void;
  stats: PicksStats;
  togglePlanList: (kind: PlanListKind) => void;
}

export default function PicksSummaryRow({
  activePlanList,
  effectiveFilter,
  noteItems,
  reminderItems,
  setFocusFilter,
  stats,
  togglePlanList,
}: PicksSummaryRowProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
<View style={styles.summaryRow}>
  {stats.total > 0 ? (
    <StatChip
      label="All"
      count={stats.total}
      active={effectiveFilter === 'all' && !activePlanList}
      onPress={() => setFocusFilter('all')}
    />
  ) : null}
  {stats.must > 0 ? (
    <StatChip
      label="Must"
      count={stats.must}
      color={t.colors.priority.must}
      icon={priorityIconName('must')}
      active={effectiveFilter === 'must' && !activePlanList}
      onPress={() => setFocusFilter('must')}
    />
  ) : null}
  {stats.want > 0 ? (
    <StatChip
      label="Want"
      count={stats.want}
      color={t.colors.priority.want}
      icon={priorityIconName('want-to-see')}
      active={effectiveFilter === 'want-to-see' && !activePlanList}
      onPress={() => setFocusFilter('want-to-see')}
    />
  ) : null}
  {stats.maybe > 0 ? (
    <StatChip
      label="Maybe"
      count={stats.maybe}
      color={t.colors.priority.maybe}
      icon={priorityIconName('maybe')}
      active={effectiveFilter === 'maybe' && !activePlanList}
      onPress={() => setFocusFilter('maybe')}
    />
  ) : null}
  {stats.clashes > 0 ? (
    <StatChip
      label={COPY.clash.filter}
      count={stats.clashes}
      icon="warning"
      color={t.colors.accent.coral}
      danger
      active={effectiveFilter === 'clashes' && !activePlanList}
      onPress={() => setFocusFilter('clashes')}
    />
  ) : null}
  {reminderItems.length > 0 ? (
    <StatChip
      label={COPY.planLists.reminders}
      count={reminderItems.length}
      icon="notifications-outline"
      active={activePlanList === 'reminders'}
      onPress={() => togglePlanList('reminders')}
    />
  ) : null}
  {noteItems.length > 0 ? (
    <StatChip
      label={COPY.planLists.notes}
      count={noteItems.length}
      icon="document-text-outline"
      active={activePlanList === 'notes'}
      onPress={() => togglePlanList('notes')}
    />
  ) : null}
</View>
  );
}
