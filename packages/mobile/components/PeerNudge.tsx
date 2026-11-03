// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * PeerNudge.tsx — "Looking for you": one push to a crewmate from the compass.
 * Online-only (never queued) and it never carries a location. The server holds
 * the real 5-minute limit; the shared hook only stops a double tap.
 */
import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { useNudge } from '@festie/shared/hooks';
import { FIND_FRIEND_COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';

interface PeerNudgeProps {
  crewId: string | null;
  userId: string;
  name: string;
}

export default function PeerNudge({ crewId, userId, name }: PeerNudgeProps) {
  const styles = useStyles();
  const haptics = useHaptics();
  const { send, status, message } = useNudge(crewId, userId, name);

  useEffect(() => {
    if (status === 'sent') haptics.success();
  }, [status, haptics]);

  return (
    <View style={styles.wrap}>
      <Button
        label={FIND_FRIEND_COPY.nudge}
        variant="secondary"
        icon="megaphone-outline"
        accessibilityLabel={FIND_FRIEND_COPY.nudgeA11y(name)}
        onPress={() => void send()}
        disabled={status === 'sending' || status === 'sent' || !crewId}
        loading={status === 'sending'}
      />
      <Text style={styles.caption}>{FIND_FRIEND_COPY.nudgeHint(name)}</Text>
      <Text
        style={styles.caption}
        accessibilityLiveRegion="polite"
        accessibilityRole={status === 'error' ? 'alert' : undefined}
      >
        {message ?? ''}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
    alignItems: 'center',
    paddingHorizontal: t.spacing[5],
  },
  caption: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
}));
