// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COPY } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import PlanLinkPanel from '../components/PlanLinkPanel';
import PlanQRShare from '../components/PlanQRShare';
import PlanQRScan from '../components/PlanQRScan';
import SmsHandoff from '../components/SmsHandoff';

// ── Share picks (link + M5 P2P) ───────────────────────────────────────────────
// One screen, four ways to get a friend onto the same plan:
//   • Link     — revocable online link to your picks (PlanLinkPanel)
//   • Show QR  — render your plan as a QR for a friend to scan (PlanQRShare)
//   • Scan QR  — scan a friend's plan into your local cache (PlanQRScan)
//   • Text meeting point — last-resort SMS handoff of the meeting point (SmsHandoff)
// The last three consume the shared, versioned planSnapshot codec / meeting-point
// data and need no internet. `?tab=` picks the starting tab; default is Show QR.

type Tab = 'link' | 'show' | 'scan' | 'text';

const TABS: { key: Tab; testID: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'link', testID: 'plan-share-tab-link', label: 'Link', icon: 'link-outline' },
  { key: 'show', testID: 'plan-share-tab-show', label: 'Show QR', icon: 'qr-code' },
  { key: 'scan', testID: 'plan-share-tab-scan', label: 'Scan QR', icon: 'scan' },
  { key: 'text', testID: 'plan-share-tab-text', label: 'Text meeting point', icon: 'chatbubble-ellipses' },
];

export default function PlanShareScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(TABS.some((x) => x.key === tabParam) ? (tabParam as Tab) : 'show');

  const selectTab = (key: Tab) => {
    if (key !== tab) {
      haptics.select();
    }
    setTab(key);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: COPY.picks.share, headerShown: true }} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabBar}
      >
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              testID={item.testID}
              style={[styles.tab, active && styles.tabActive]}
              activeOpacity={0.7}
              onPress={() => selectTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={active ? t.colors.text.onLightAccent : t.colors.text.secondary}
              />
              <Text
                style={[styles.tabText, active && styles.tabTextActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.body}>
        {tab === 'link' ? <PlanLinkPanel /> : null}
        {tab === 'show' ? <PlanQRShare /> : null}
        {tab === 'scan' ? <PlanQRScan /> : null}
        {tab === 'text' ? <SmsHandoff /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  tabScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  tabBar: {
    flexDirection: 'row',
    gap: t.spacing[2],
    padding: t.spacing[3],
  },
  tab: {
    flexDirection: 'row',
    paddingHorizontal: t.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    minHeight: 44,
  },
  tabActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  tabText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  tabTextActive: {
    color: t.colors.text.onLightAccent,
  },
  body: {
    flex: 1,
  },
}));
