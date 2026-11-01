import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { useAuthStore } from '@festie/shared/stores';
import { useInvitePreview } from '@festie/shared/hooks';
import { describeInvitePreview, inviteStatusMessage, type InviteStatus } from '@festie/shared/utils';
import type { InvitePreview } from '@festie/shared/types';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import DisplayWords from './DisplayWords';

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    padding: t.spacing[4],
    marginBottom: t.spacing[6],
  },
  eyebrow: {
    ...typeStyle('caption', 600),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: t.spacing[1],
  },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  detail: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    marginTop: t.spacing[1],
  },
}));

/**
 * Shows who started the invite: crew name, spots left, festival and dates. Renders
 * nothing without a code or while loading, so it is safe on every auth screen.
 */
export default function InviteCard({
  code,
  onStatus,
}: {
  code: string | null;
  onStatus?: (status: InviteStatus, preview: InvitePreview | null) => void;
}) {
  const styles = useStyles();
  const user = useAuthStore((s) => s.user);
  const { status, preview } = useInvitePreview(code);

  useEffect(() => {
    onStatus?.(status, preview);
    // onStatus is a state setter in the only caller that passes it; excluding it avoids loops on identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, preview]);

  if (!code || status === 'loading') return null;

  if (status !== 'ready' || !preview) {
    return (
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.detail}>{inviteStatusMessage(status, !!user)}</Text>
      </View>
    );
  }

  const { title, stateLine, festivalLine, ownerLine } = describeInvitePreview(preview);
  const lines = [stateLine, festivalLine, ownerLine].filter((l): l is string => !!l);
  return (
    <View style={styles.card} accessible accessibilityLabel={['Crew invitation', title, ...lines].join('. ')}>
      <Text style={styles.eyebrow}>You're invited</Text>
      <Text style={styles.title}>
        <DisplayWords text={title} fontSize={styles.title.fontSize} />
      </Text>
      {lines.map((line) => (
        <Text key={line} style={styles.detail}>
          {line}
        </Text>
      ))}
    </View>
  );
}
