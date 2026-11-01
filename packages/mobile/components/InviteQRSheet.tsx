// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildJoinUrl } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import Button from './Button';

interface InviteQRSheetProps {
  visible: boolean;
  crewName: string;
  code: string;
  onClose: () => void;
}

/** Shows the invite link as a QR code so friends standing together can join by scanning. */
export default function InviteQRSheet({ visible, crewName, code, onClose }: InviteQRSheetProps) {
  const styles = useStyles();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close QR code"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Scan to join {crewName}
          </Text>
          <View style={styles.qrCard}>
            {/* Dark on white so cameras lock fast in low festival light. */}
            <QRCode value={buildJoinUrl(code)} size={220} color="#080810" backgroundColor="#FFFFFF" ecl="M" />
          </View>
          <Text style={styles.caption} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Point a phone camera at the code.
          </Text>
          <Text
            style={styles.code}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityLabel={`Invite code ${code}`}
          >
            {code}
          </Text>
          <Button label="Close" variant="secondary" onPress={onClose} style={styles.close} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.colors.shade[9],
  },
  sheet: {
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[5],
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    padding: t.spacing[4],
    borderRadius: t.radii.default,
  },
  caption: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  code: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 4,
  },
  close: {
    alignSelf: 'stretch',
  },
}));
