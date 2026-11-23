import { View } from 'react-native';
import { makeStyles } from '../hooks/useTokens';
import FreshnessChip from './FreshnessChip';
import SaveStatusChip from './SaveStatusChip';

/**
 * One status line for the Lineup and Picks header: the freshness label (offline and queued
 * states included) beside the save state. The minimum height holds the line open while either
 * chip is absent, so nothing below shifts when "Saved" appears or clears.
 */
export default function ScheduleStatusLine({ showSave }: { showSave: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <FreshnessChip surface="schedule" />
      {showSave ? <SaveStatusChip /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: t.spacing[2],
    minHeight: 32,
  },
}));
