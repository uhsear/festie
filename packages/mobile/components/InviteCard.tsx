import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { describeInvite, fetchInvitePreview, type InvitePreview } from '../lib/pendingInvite';
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

type State = { status: 'loading' } | { status: 'ready'; preview: InvitePreview } | { status: 'invalid' };

/**
 * Shows a guest who invited them: crew name, inviter and member count. Renders
 * nothing without a code or while loading, so it is safe on every auth screen.
 */
export default function InviteCard({
  code,
  onStatus,
}: {
  code: string | null;
  onStatus?: (s: 'ready' | 'invalid') => void;
}) {
  const styles = useStyles();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetchInvitePreview(code)
      .then((preview) => {
        if (cancelled) return;
        setState({ status: 'ready', preview });
        onStatus?.('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'invalid' });
        onStatus?.('invalid');
      });
    return () => {
      cancelled = true;
    };
    // onStatus is a state setter in the only caller; excluding it avoids refetching on identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!code || state.status === 'loading') return null;

  if (state.status === 'invalid') {
    return (
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.detail}>
          This invite link has expired or is no longer valid. Ask the crew owner for a new link.
        </Text>
      </View>
    );
  }

  const { title, detail } = describeInvite(state.preview);
  return (
    <View style={styles.card} accessible accessibilityLabel={`Crew invitation. ${title}. ${detail}`}>
      <Text style={styles.eyebrow}>You are invited</Text>
      <Text style={styles.title}>
        <DisplayWords text={title} fontSize={styles.title.fontSize} />
      </Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}
