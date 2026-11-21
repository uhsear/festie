import {
  View,
  ScrollView,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Crew, CrewMember, User } from '@festie/shared/types';
import { useTokens } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import SectionLabel from '../SectionLabel';
import CrewExpenses from '../CrewExpenses';
import { useRef, type ReactElement, type ReactNode } from 'react';
import { useStyles } from './styles';

interface CrewMoneyTabProps {
  crew: Crew;
  crewRefreshControl: ReactElement;
  hasUnsettledBalance: boolean;
  inviteCard: ReactNode;
  members: CrewMember[];
  tabBodyStyle: StyleProp<ViewStyle>;
  tabScrollStyle: StyleProp<ViewStyle>;
  user: User;
}

export default function CrewMoneyTab({
  crew,
  crewRefreshControl,
  hasUnsettledBalance,
  inviteCard,
  members,
  tabBodyStyle,
  tabScrollStyle,
  user,
}: CrewMoneyTabProps) {
  const styles = useStyles();
  const t = useTokens();
  const reduceMotion = useReduceMotion();
  const moneyScrollRef = useRef<ScrollViewInstance>(null);
  const expensesY = useRef(0);
  return (
    <ScrollView
      ref={moneyScrollRef}
      style={tabBodyStyle}
      contentContainerStyle={tabScrollStyle}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={crewRefreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      {inviteCard}
      <View style={styles.sectionLabelRow}>
        <SectionLabel>Expenses</SectionLabel>
        {hasUnsettledBalance ? (
          <View style={styles.unsettledDot} accessibilityLabel="You have an unsettled balance" />
        ) : null}
      </View>
      <View
        onLayout={(e) => {
          expensesY.current = e.nativeEvent.layout.y;
        }}
      >
        <CrewExpenses
          crewId={crew.id}
          members={members}
          currentUserId={user.id}
          onFormShown={(y) =>
            moneyScrollRef.current?.scrollTo({
              y: Math.max(0, expensesY.current + y - t.spacing[2]),
              animated: !reduceMotion,
            })
          }
        />
      </View>
    </ScrollView>
  );
}
