import { View, Text, TouchableOpacity } from 'react-native';
import { crewCopy } from '@festie/shared/utils';
import type { Crew } from '@festie/shared/types';
import { MAX_FONT_SCALE } from '../../hooks/useTokens';
import Button from '../Button';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';

interface CrewInviteCardProps {
  crew: Crew;
  handleShareInvite: (code: string, crewName: string) => void;
  setInviteQrOpen: Dispatch<SetStateAction<boolean>>;
}

export default function CrewInviteCard({
  crew,
  handleShareInvite,
  setInviteQrOpen,
}: CrewInviteCardProps) {
  const styles = useStyles();
  return (
    <View style={styles.inviteCard}>
      <Text style={styles.inviteCardTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {crewCopy.inviteCardTitle}
      </Text>
      <Text style={styles.inviteCardBody} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {crewCopy.inviteCardBody(crew.name)}
      </Text>
      <View style={styles.forceAddRow}>
        <Button
          label="Share invite link"
          onPress={() => handleShareInvite(crew.inviteCode!, crew.name)}
          accessibilityLabel="Share invite link"
          style={styles.flexButton}
        />
        <TouchableOpacity
          style={[styles.outlineButton, styles.flexButton]}
          onPress={() => setInviteQrOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Show QR code"
        >
          <Text style={styles.outlineButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Show QR code
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
