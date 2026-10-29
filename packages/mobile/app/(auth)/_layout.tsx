import { Stack } from 'expo-router';
import { useTokens } from '../../hooks/useTokens';

export default function AuthLayout() {
  const { colors } = useTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.primary },
      }}
    />
  );
}
