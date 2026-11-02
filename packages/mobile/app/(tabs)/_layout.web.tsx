import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, spacing } from '@festie/shared/tokens';
import { APP_SECTIONS, type AppSectionKey } from '@festie/shared/utils';
import { useAuthStore } from '@festie/shared/stores';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useTokens } from '../../hooks/useTokens';

/**
 * Web fallback for the tab bar — NativeTabs (_layout.tsx) is native-only, but
 * `eas update` still bundles the mobile package for web, so web needs the JS
 * <Tabs>. Festie's shipped web app is the separate @festie/web SPA; this exists
 * purely to keep the mobile web bundle building.
 */
const TAB_ROUTES: Record<AppSectionKey, { name: string; icon: keyof typeof Ionicons.glyphMap }> = {
  lineup: { name: 'index', icon: 'calendar-outline' },
  myPlan: { name: 'picks', icon: 'star-outline' },
  crew: { name: 'crew', icon: 'people-outline' },
  map: { name: 'map', icon: 'map-outline' },
  more: { name: 'account', icon: 'person-outline' },
};

export default function TabLayoutWeb() {
  useRealtimeSync();
  const user = useAuthStore((s) => s.user);
  const { colors } = useTokens();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, spacing[1]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.default,
          borderTopWidth: 1,
          paddingTop: spacing[1],
          paddingBottom: tabBarBottomInset,
          height: 56 + spacing[2] + tabBarBottomInset,
        },
        tabBarActiveTintColor: colors.accent.aqua,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: { fontSize: fontSize[10], fontWeight: '600' },
      }}
    >
      {APP_SECTIONS.map(({ key, label }) => {
        const { name, icon } = TAB_ROUTES[key];
        return (
          <Tabs.Screen
            key={key}
            name={name}
            options={{
              title: key === 'more' && !user ? GUEST_PROMPT_COPY.signIn : label,
              tabBarIcon: ({ color, size }) => <Ionicons name={icon} size={size} color={color as string} />,
            }}
          />
        );
      })}
    </Tabs>
  );
}
