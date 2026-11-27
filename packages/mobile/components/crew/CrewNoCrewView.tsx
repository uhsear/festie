import {
  View,
  Text,
  TextInput,
  ScrollView,
  type TextInputInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import ScreenHeader from '../ScreenHeader';
import CreateCrewForm from '../CreateCrewForm';
import Button from '../Button';
import EmptyState from '../EmptyState';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useStyles } from './styles';

interface CrewNoCrewViewProps {
  error: string | null;
  formScrollStyle: StyleProp<ViewStyle>;
  handleJoin: () => void;
  inviteCode: string;
  inviteInputRef: RefObject<TextInputInstance | null>;
  notice: string | null;
  pendingStart: 'create' | 'join' | null;
  setInviteCode: Dispatch<SetStateAction<string>>;
  tabBodyStyle: StyleProp<ViewStyle>;
}

export default function CrewNoCrewView({
  error,
  formScrollStyle,
  handleJoin,
  inviteCode,
  inviteInputRef,
  notice,
  pendingStart,
  setInviteCode,
  tabBodyStyle,
}: CrewNoCrewViewProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
  // KAV is dropped: behavior='padding' is a no-op on Android and
  // behavior='height' doesn't scroll the focused field into view when it's
  // deep in the list. automaticallyAdjustKeyboardInsets on the scroll
  // container handles both platforms correctly (same pattern as
  // account.tsx / app/set/[setId].tsx).
  <View style={styles.screen} testID="crew-screen">
    <ScreenHeader title="Crew" subtitle="Coordinate with friends" icon="people" />
    <ScrollView
      style={tabBodyStyle}
      contentContainerStyle={formScrollStyle}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <EmptyState
        ghostRow="crew"
        title="No crew yet"
        message="Plan with your friends. Make a crew, or join one with a code."
      />

      {/* Leaving the only crew lands here, so its notice must show here too. */}
      {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {notice}
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <CreateCrewForm autoFocus={pendingStart === 'create'} />

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Join with code</Text>
        <Text style={styles.formHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          6-character code, or paste the invite link
        </Text>
        <TextInput
          ref={inviteInputRef}
          style={styles.input}
          placeholder="K7XQ2M"
          placeholderTextColor={t.colors.text.placeholder}
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={64}
          returnKeyType="done"
          onSubmitEditing={handleJoin}
          accessibilityLabel="Invite code"
        />
        <Button
          label="Join with code"
          variant="secondary"
          onPress={handleJoin}
          disabled={!inviteCode.trim()}
          accessibilityLabel="Join crew by code"
        />
      </View>
    </ScrollView>
  </View>
  );
}
