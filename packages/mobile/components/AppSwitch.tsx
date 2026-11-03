import { Switch } from 'react-native';
import type { SwitchProps } from 'react-native';
import { useTokens } from '../hooks/useTokens';

export interface AppSwitchProps extends SwitchProps {
  tone?: 'aqua' | 'amber';
}

/**
 * The one Switch for the app. On iOS an off switch shows `ios_backgroundColor`,
 * not `trackColor.false`, and `text.muted` read as "on" in Stage. Both come
 * from `control.trackOff`, which clears contrast on the card in both themes.
 */
export default function AppSwitch({ tone = 'aqua', ...rest }: AppSwitchProps) {
  const t = useTokens();
  return (
    <Switch
      trackColor={{ false: t.colors.control.trackOff, true: t.colors.accent[tone] }}
      ios_backgroundColor={t.colors.control.trackOff}
      thumbColor={t.colors.text.onAccent}
      {...rest}
    />
  );
}
