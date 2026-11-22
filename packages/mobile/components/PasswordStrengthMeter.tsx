import { View, Text } from 'react-native';
import { passwordStrength } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface PasswordStrengthMeterProps {
  password: string;
  username?: string | null;
  email?: string | null;
}

/** Strength bar under a new-password field. UX guidance only: the shared password policy is authoritative. */
export default function PasswordStrengthMeter({ password, username, email }: PasswordStrengthMeterProps) {
  const t = useTokens();
  const styles = useStyles();
  if (password.length === 0) return null;
  // weak to strong. All four map onto existing semantic tokens.
  const colors = [t.colors.text.danger, t.colors.accent.amber, t.colors.accent.aqua, t.colors.accent.green];
  const strength = passwordStrength(password, { username, email });
  const color = colors[Math.max(0, strength.score - 1)];
  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel={`Password strength: ${strength.label}`}>
      <View style={styles.track}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.seg, i < strength.score && { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.label, { color }]}>{strength.label}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: -t.spacing[1],
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    gap: t.spacing[1],
  },
  seg: {
    flex: 1,
    height: 4,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.border.light,
  },
  label: {
    ...typeStyle('caption'),
    minWidth: 52,
    textAlign: 'right',
  },
}));
