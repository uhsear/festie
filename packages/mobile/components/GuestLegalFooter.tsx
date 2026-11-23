import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ACCOUNT_COPY, GUEST_LEGAL_COPY, SUPPORT_EMAIL } from '@festie/shared/constants';
import { makeStyles, typeStyle } from '../hooks/useTokens';

const SITE = 'https://festie.us';

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[4],
  },
  link: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textDecorationLine: 'underline',
  },
  dot: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));

export async function openPage(path: string) {
  const url = `${SITE}${path}`;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch (err) {
    console.warn('guest footer: in-app browser failed', err);
    Linking.openURL(url).catch((e) => console.warn('guest footer: browser fallback failed', e));
  }
}

/** Privacy, Terms and Help for signed-out visitors. Privacy opens the in-app policy screen. */
export default function GuestLegalFooter() {
  const styles = useStyles();
  const router = useRouter();
  const { ariaLabel, privacy, terms, help, termsPath, helpHref } = GUEST_LEGAL_COPY;
  const items = [
    { label: privacy, hint: 'Opens the privacy policy', onPress: () => router.push('/privacy') },
    { label: terms, hint: 'Opens the terms of service in a browser', onPress: () => void openPage(termsPath) },
    {
      label: help,
      hint: 'Opens an email to support',
      // No mail account set up: show the address instead of a dead tap (same fallback as Account).
      onPress: () =>
        Linking.openURL(helpHref).catch(() =>
          Alert.alert(ACCOUNT_COPY.contactSupport, ACCOUNT_COPY.contactSupportNoMail(SUPPORT_EMAIL)),
        ),
    },
  ];
  return (
    <View style={styles.row} accessibilityLabel={ariaLabel} testID="guest-legal-footer">
      {items.map((item, i) => (
        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {i > 0 ? (
            <Text style={styles.dot} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              ·
            </Text>
          ) : null}
          <TouchableOpacity
            style={styles.link}
            onPress={item.onPress}
            accessibilityRole="link"
            accessibilityLabel={item.label}
            accessibilityHint={item.hint}
          >
            <Text style={styles.linkText}>{item.label}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
