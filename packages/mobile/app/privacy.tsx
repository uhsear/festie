import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';

/**
 * Privacy Policy screen — a self-contained native mirror of the canonical
 * static document served on web at /privacy.html.
 *
 * Draft for legal review — not legal advice.
 *
 * The web policy remains the single source of truth; this screen reproduces
 * its text word for word (effective {PUBLISH DATE}) as a typed data array so it
 * renders like the rest of the app and works offline. Emails open the mail
 * client and the Terms reference opens the web Terms of Service in an in-app
 * browser sheet.
 */

const EFFECTIVE_DATE = '{PUBLISH DATE}';
const OPERATOR_NAME = '[YOUR NAME]';
const CONTACT_EMAIL = 'privacy@festie.us';
const SERVICE_URL = 'https://festie.us';
const TERMS_URL = 'https://festie.us/terms.html';

const openEmail = () => {
  void Linking.openURL(`mailto:${CONTACT_EMAIL}`);
};

const openService = () => {
  void Linking.openURL(SERVICE_URL);
};

// Same behaviour as the sign-up screen: an in-app sheet, the system browser as fallback.
const openTerms = async () => {
  try {
    await WebBrowser.openBrowserAsync(TERMS_URL);
  } catch (err) {
    console.warn('terms: in-app browser failed', err);
    void Linking.openURL(TERMS_URL);
  }
};

interface Subsection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface PolicySection {
  title: string;
  body?: string[];
  bullets?: string[];
  subsections?: Subsection[];
}

const SUMMARY: string[] = [
  'Festie stores what you give it: your account, your picks and notes, your crews, and what you post to a crew.',
  'Your crews see your name, photo, picks, status and payment handles. People outside your crews see nothing, unless you turn on your public schedule page or send a picks link.',
  'Live location is off until you turn it on for one crew. We do not save it.',
  'We do not use tracking or advertising cookies.',
  'You can download your data or delete your account in Account at any time. Account › Privacy shows who can see what.',
];

const SECTIONS: PolicySection[] = [
  {
    title: 'Who runs Festie',
    body: [
      'Festie is run by an individual developer, [YOUR NAME]. In this policy, "we" and "us" mean [YOUR NAME]. Under EU and UK data protection law, [YOUR NAME] is the controller of your personal data.',
      'Email privacy@festie.us with any privacy question or request. Send security reports to security@festie.us. We answer privacy requests within 30 days.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      'We collect what you give us, what your device sends when you use a feature, and what your crews add. We do not buy data about you from anyone.',
    ],
    subsections: [
      {
        heading: 'Your account',
        bullets: [
          'Username: You choose it when you sign up. It is how you sign in, and other people in Festie see it.',
          'Password: We store only a scrypt hash of it, never the password itself.',
          'Date of birth: You give it when you sign up so we can check that you are 18 or older. We keep it with your account.',
          'Email address (optional): We use it to verify your address, reset your password, warn you when someone asks to change it, and send the notification emails you leave on.',
          'Display name and photo (optional): Your crews see them. We store your photo on our server.',
          'Payment handles (optional): Your Venmo, Cash App and PayPal names. Members of your crews can see them so they can pay you back. Festie never sends money and never shares these names with a payment company.',
          'Terms acceptance: when you accepted the Terms of Service, and which version.',
        ],
      },
      {
        heading: 'Festival and crew data',
        bullets: [
          'Picks and notes: the sets you pick, how much you want to see each one, and your notes.',
          'Ratings: the ratings and notes you give sets.',
          'Crews: the crews you create or join, and your role in each.',
          'What you post to a crew: statuses, expenses, polls and votes, packing items, rides and meeting points. Your crew sees them, and the crew activity feed records them.',
          'Sharing settings: whether your public schedule page is on, and the picks links you create.',
          'Calendar links: if you add a festival to your calendar, the private feed link for it.',
        ],
      },
      {
        heading: 'Location',
        bullets: [
          'Location (optional): (1) Status location: when you use your location for the ETA in a crew status, the status keeps where you were. Your crew sees it until a later status replaces it with a newer position, or until you use Stop all sharing in Account. (2) Meeting points: the place of a meeting point you create. (3) Live location: when you turn it on for a crew, that crew sees where you are until the time you pick. We do not save live location. The server holds your latest position for about two minutes so crewmates who open the app can see you.',
          'SOS: When you send an SOS, it can include one rough position, rounded to about 11 metres. Your crew sees it in the SOS alert and in the crew activity. We keep it with the crew activity until the crew or your account is deleted.',
          'When we ask: The app asks for your location only while it is open, and only when you use one of these features. It never tracks you in the background.',
          'Camera: The app uses the camera only to scan a plan QR code. The picture stays on your phone.',
        ],
      },
      {
        heading: 'Notifications and email',
        bullets: [
          'Device Tokens: the push address that your phone or browser gives us, so we can send you notifications.',
          'Notification history: the title and text of notifications we send you, so you can read them later in the app.',
          'Notification settings: which kinds of notification you want, your quiet hours and your time zone.',
        ],
      },
      {
        heading: 'Technical data',
        bullets: [
          'Security log: We record your IP address with sign-ins, sign-outs and account changes. We use it to find and stop attacks and abuse. We keep these records for one year.',
          'IP address: We also use it to limit how fast requests can arrive and to block abuse. These counters are short-lived.',
          'Sign-in sessions: a session token, when the session started and when it was last used. We store only a hash of each token.',
          'Error reports: When Festie hits an error, Sentry receives the error details and the app or browser version. Reports from our server also carry your user ID, but never your cookies or sign-in token.',
          'Usage counts: The website reports page-speed measurements. It also counts when the install prompt is shown, accepted or dismissed, with the browser type. None of this is linked to your account.',
          'Sign-up source: If you sign up from a link with a source tag, we add one to a daily count for that tag. The count holds nothing about you.',
        ],
      },
    ],
  },
  {
    title: 'How we use your data and why',
    body: [
      'We use your data only to run Festie, keep it safe and follow the law. We never use it for advertising or profiling. Under EU and UK law, each use has one of these legal bases.',
    ],
    subsections: [
      {
        heading: 'To provide Festie (contract)',
        paragraphs: [
          'We need your account, picks, crews and what you post to a crew to give you the service you signed up for. We need your date of birth to check that you can use Festie.',
        ],
      },
      {
        heading: 'With your permission (consent)',
        paragraphs: [
          'We send push notifications, use your location and turn on your public schedule page only after you choose to. You can take back your consent at any time in Account or in your device settings. This does not affect what we did before.',
        ],
      },
      {
        heading: 'To keep Festie safe and working (legitimate interests)',
        paragraphs: [
          'We keep the security log, error reports and usage counts to protect accounts, stop abuse and fix problems. We send notification emails about festivals and crews you are in, and you can turn them off at any time.',
          'We keep the full IP address in the security log because a shortened address would make attacks much harder to trace. We keep it for one year. We may share it with the police when the law requires it.',
        ],
      },
      {
        heading: 'To follow the law (legal obligation)',
        paragraphs: [
          'We keep or disclose data when the law requires it, for example to answer a valid court order.',
        ],
      },
    ],
  },
  {
    title: 'Who can see your data',
    subsections: [
      {
        heading: 'People and companies',
        bullets: [
          'Your crews: Members of a crew see your name, photo, picks, status, payment handles and what you post to that crew. Live location and status location go only to the crew you share them with.',
          'Anyone with a link: If you turn on your public schedule page, anyone with its link can see your picks. It is off by default. A picks link you send works the same way for one festival. These pages tell search engines not to list them.',
          'Our service providers: the companies in the next section, only to run Festie for us.',
          'Police and courts: only when the law requires it.',
          'A new owner: If Festie is sold or merged, your data passes to the new owner under this policy, and we tell you first.',
        ],
      },
      {
        heading: 'Nobody else',
        paragraphs: [
          'We do not sell your personal information. We do not share it for cross-context behavioral advertising.',
        ],
      },
    ],
  },
  {
    title: 'Service providers',
    body: [
      'These companies process data for us. Each one gets only what it needs to do its job.',
    ],
    subsections: [
      {
        heading: 'Cloudflare',
        bullets: [
          'Purpose: Carries all traffic to and from Festie and protects it from attacks.',
          'Data processed: IP addresses and request details.',
          'Privacy policy: https://www.cloudflare.com/privacy/',
        ],
      },
      {
        heading: 'Firebase Cloud Messaging (Google)',
        bullets: [
          'Purpose: Delivers push notifications to Android phones and web browsers.',
          'Data processed: Device tokens and the notification content.',
          'Privacy policy: https://firebase.google.com/support/privacy',
        ],
      },
      {
        heading: 'Apple Push Notification service',
        bullets: [
          'Purpose: Delivers push notifications to iPhones. Our server connects to Apple directly.',
          'Data processed: The iPhone device token and the notification content.',
          'Privacy policy: https://www.apple.com/legal/privacy/',
        ],
      },
      {
        heading: 'Sentry (Functional Software, Inc.)',
        bullets: [
          'Purpose: Error reports, so we can find and fix crashes.',
          'Data processed: Error details, app or browser version, and on server errors your user ID.',
          'Privacy policy: https://sentry.io/privacy/',
        ],
      },
      {
        heading: 'Resend',
        bullets: [
          'Purpose: Sends our emails.',
          'Data processed: Your email address, your username and the content of the email.',
          'Privacy policy: https://resend.com/legal/privacy-policy',
        ],
      },
      {
        heading: 'GitHub (Microsoft)',
        bullets: [
          'Purpose: Stores encrypted copies of our database off site.',
          'Data processed: Encrypted backup files only. We encrypt each backup before it leaves our server, so GitHub cannot read it. We keep a limited number of backups and delete older ones.',
          'Privacy policy: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
        ],
      },
      {
        heading: 'Spotify',
        bullets: [
          'Purpose: We look up artist names, photos and genres for festival lineups.',
          'Data processed: Artist names only. No information about you is sent to Spotify.',
          'Privacy policy: https://www.spotify.com/legal/privacy-policy/',
        ],
      },
      {
        heading: 'Services your device contacts directly',
        paragraphs: [
          'Some parts of Festie load straight from other services. Those services see your IP address and what your device asks for.',
        ],
        bullets: [
          'OpenFreeMap: the map tiles on festival and crew maps.',
          'Google Fonts: the fonts on the website.',
          "Spotify: artist photos, and the Spotify player when you open it on a set. Spotify's own privacy policy applies to the player.",
        ],
      },
      {
        heading: 'Services that get no data about you',
        paragraphs: [
          "Our server looks up festival venues with OpenStreetMap Nominatim and festival weather with Open-Meteo. It sends them only the festival's place, never anything about you.",
        ],
      },
    ],
  },
  {
    title: 'Email',
    body: [
      'We send two kinds of email, and only when you have given us an address.',
    ],
    bullets: [
      'Account email: verifying your address, resetting your password, and a security alert when someone asks to change your email. These are needed to run your account.',
      'Notification email: your festival wrap-up is ready, a festival lineup is out, or a crew you were in formed again. Each one names the setting that controls it and links to where you turn it off.',
      'No advertising: We do not send advertising email, and we never give your address to anyone to market to you.',
    ],
  },
  {
    title: 'Cookies, device storage and tracking',
    subsections: [
      {
        heading: 'What we store',
        paragraphs: [
          "The website uses one HTTP-only cookie to keep you signed in. The app keeps its sign-in token in your phone's secure storage. Both keep your settings and a copy of your festival data on your device, so Festie works offline.",
        ],
      },
      {
        heading: 'No tracking',
        paragraphs: [
          'We do not use tracking or advertising cookies. We do not track you across other apps or websites, and we do not use advertising IDs.',
        ],
      },
      {
        heading: 'Do Not Track and Global Privacy Control',
        paragraphs: [
          'We do not track you or sell your data, so these browser signals have nothing to turn off. Festie treats every visitor as if the signal were on.',
        ],
      },
      {
        heading: 'No cookie banner',
        paragraphs: [
          'The sign-in cookie is strictly necessary to run the service, so the website does not need a cookie banner.',
        ],
      },
    ],
  },
  {
    title: 'How long we keep data',
    bullets: [
      'Your account and what you post: until you delete your account, plus the 30-day grace period below.',
      'Live location: about two minutes on the server, and never in our database.',
      'SOS position: with the crew activity, until the crew or your account is deleted.',
      'Security log: one year.',
      'Sign-in sessions: A website session ends 24 hours after you sign in. The app renews its session with a refresh token that lasts up to 90 days.',
      'Notification history: while your account exists. The inbox shows the newest 50.',
      'Backups: Encrypted backups rotate on a fixed schedule. Data you delete leaves the backups when the last backup that holds it is deleted.',
    ],
    subsections: [
      {
        heading: 'When you delete your account',
        paragraphs: [
          'In Account, choose Delete account and confirm with your password. You are signed out everywhere, your devices stop getting notifications and your festival plans are hidden from others at once.',
          "If you sign in again within 30 days, your account comes back. After 30 days we delete your account and its data for good. A crew you created passes to its longest-standing member, or is deleted if you were the only member. An expense another member paid and split with you stays in that crew's records.",
        ],
      },
    ],
  },
  {
    title: 'Your rights and choices',
    body: [
      'Everyone gets these rights, wherever you live. Most of them work in the app, without emailing us.',
    ],
    subsections: [
      {
        heading: 'Right of access',
        paragraphs: [
          'In Account › Your data, choose Download my data. You get a JSON file with your account, picks and notes, crews, ratings, expenses, poll votes, packing items, rides, meeting points, crew statuses (with any status location), devices, sessions and notification settings. You can download it once a day.',
        ],
      },
      {
        heading: 'Right of rectification',
        paragraphs: [
          'You can change your display name, photo, email and payment handles in Account at any time. Your username cannot be changed.',
        ],
      },
      {
        heading: 'Right to erasure',
        paragraphs: [
          'Delete your account in the app or at https://festie.us/account. The section above says what happens next. If you cannot sign in, email privacy@festie.us.',
        ],
      },
      {
        heading: 'Right to data portability',
        paragraphs: [
          'The file from Download my data is JSON, a common machine-readable format, so you can keep it or move it to another service.',
        ],
      },
      {
        heading: 'Control what you share',
        paragraphs: [
          'Turn off notification types, set quiet hours, stop live location, turn off your public schedule page, or use Stop all sharing in Account › Privacy. You can also turn off location, notifications and photo access for Festie in your device settings.',
        ],
      },
      {
        heading: 'Right to object and to restrict processing',
        paragraphs: [
          'You can object to a use based on our legitimate interests, or ask us to limit how we use your data. Email privacy@festie.us. We stop unless we have strong legitimate grounds or need the data for a legal claim.',
        ],
      },
      {
        heading: 'How we handle requests',
        paragraphs: [
          'We answer within 30 days. Before we act on an emailed request, we check that it comes from the account owner, usually from the email address on the account. Someone you authorise can ask for you, with your signed permission. Using a right never costs you anything, and we never treat you differently for it.',
        ],
      },
      {
        heading: 'Appeals',
        paragraphs: [
          'If we turn down a request, reply to our answer to appeal. We decide an appeal within 45 days and explain the result. If you still disagree, you can contact your state attorney general or your data protection authority.',
        ],
      },
    ],
  },
  {
    title: 'EU and UK users',
    bullets: [
      'Your rights: Under the GDPR and the UK GDPR you can ask for access, rectification, erasure, restriction and data portability, object to processing, and take back your consent at any time. The section above says how.',
      'Automated decisions: We make no decisions about you by automated means that have legal or similarly significant effects.',
      "Complaints: You can complain to the data protection authority where you live or work. In the UK, that is the Information Commissioner's Office (https://ico.org.uk). We would like the chance to help first at privacy@festie.us.",
      "International transfers: Festie's server is in the United States, and most of our providers process data there. For data from the EU or UK, we rely on the Standard Contractual Clauses (with the UK addendum) in our providers' data processing terms, or on the EU-US Data Privacy Framework where a provider is certified.",
      'What you must give: A username, a password and your date of birth are needed to create an account. Everything else is optional.',
    ],
  },
  {
    title: 'US state privacy rights',
    body: [
      "This section covers the California Consumer Privacy Act, as amended by the California Privacy Rights Act, and similar laws in Virginia, Colorado, Connecticut, Utah, Texas, Oregon and other states. We give these rights to everyone, even where a law does not apply to a service of Festie's size.",
    ],
    subsections: [
      {
        heading: 'Categories we collect',
        bullets: [
          'Identifiers: username, email address, IP address and device tokens.',
          'Customer records: display name, photo and payment handles.',
          'Age: date of birth.',
          'Internet activity: the security log, error reports and sign-in sessions.',
          'Precise geolocation: status location, meeting points, live location and SOS position, only when you choose to share them.',
          'Content you create: picks, notes, ratings and what you post to a crew.',
          'Inferences: none. We build no profile of you.',
        ],
      },
      {
        heading: 'Sources and purposes',
        paragraphs: [
          'We get this data from you, from your device when you use a feature, and from your crew members, for example when they split an expense with you. We use it to run Festie, keep it secure, fix problems and follow the law.',
        ],
      },
      {
        heading: 'Disclosures',
        paragraphs: [
          'We disclose personal information for business purposes only to the service providers listed above, under terms that limit their use of it.',
        ],
      },
      {
        heading: 'No sale or sharing',
        paragraphs: [
          'We do not sell personal information, and we do not share it for cross-context behavioral advertising. We have not done either in the past 12 months. We have no actual knowledge of selling or sharing the data of anyone under 16.',
        ],
      },
      {
        heading: 'Sensitive personal information',
        paragraphs: [
          'Precise geolocation and your sign-in details count as sensitive. We use them only to provide Festie, and we use precise geolocation only after you choose to share it. We do not use sensitive data to infer anything about you.',
        ],
      },
      {
        heading: 'Your rights under these laws',
        paragraphs: [
          'You can ask to know what we collect and why, get a copy, delete it, correct it, and opt out of sale, sharing, targeted advertising and profiling. We do none of those last four, so there is nothing to opt out of. We will not discriminate against you for using any right. Use Download my data and Delete account in the app, or email privacy@festie.us.',
        ],
      },
    ],
  },
  {
    title: 'Age requirement and children',
    body: [
      'You must be 18 or older to use Festie. We check your date of birth when you sign up and do not create an account for anyone under 18.',
      'Festie is not directed to children under 13, and we do not knowingly collect data from them.',
      'If we learn that an account belongs to someone under 18, we close the account and delete its data. If you think a child is using Festie, email privacy@festie.us.',
    ],
  },
  {
    title: 'Security',
    bullets: [
      'Encryption: All traffic to and from Festie uses HTTPS. Backups are encrypted before they leave our server.',
      'Passwords and tokens: We store passwords only as scrypt hashes, and sign-in tokens only as SHA-256 hashes.',
      'Protection: Requests are rate limited, all input is checked, and the website uses a strict Content Security Policy.',
      'Breaches: No system is perfectly secure. If a breach puts your data at risk, we will tell you and the authorities as the law requires.',
    ],
  },
  {
    title: 'App stores',
    body: [
      "Festie's App Store and Google Play listings link to this policy. You can delete your account inside the app (Account, then Delete account) or on the web at https://festie.us/account.",
    ],
  },
  {
    title: 'Changes to this policy',
    body: [
      'The effective date at the top shows when this policy last changed. Before a change that affects how we use your data takes effect, we tell you in the app or by email. If a change needs your consent, we ask for it first.',
    ],
  },
  {
    title: 'Other documents',
    body: [
      'Our Terms of Service set the rules for using Festie.',
    ],
  },
  {
    title: 'Contact',
    body: [
      'Email privacy@festie.us with questions or requests about this policy or your data. We answer within 30 days.',
    ],
  },
];

function Bullet({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function ContactCard() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.contactCard}>
      <View style={styles.contactRow}>
        <Text style={styles.contactLabel}>Run by</Text>
        <Text style={styles.contactValue}>{OPERATOR_NAME}</Text>
      </View>
      <TouchableOpacity
        style={styles.contactRow}
        onPress={openEmail}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={`Email ${CONTACT_EMAIL}`}
      >
        <Text style={styles.contactLabel}>Email</Text>
        <View style={styles.contactLinkRow}>
          <Ionicons name="mail-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.contactLink}>{CONTACT_EMAIL}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.contactRow}
        onPress={openService}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={`Open ${SERVICE_URL}`}
      >
        <Text style={styles.contactLabel}>Service</Text>
        <View style={styles.contactLinkRow}>
          <Ionicons name="globe-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.contactLink}>{SERVICE_URL}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

export default function PrivacyScreen() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset({ base: t.spacing[10] });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Privacy Policy', headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.effective}>Effective {EFFECTIVE_DATE}</Text>
        <View style={styles.contactCard}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            In short
          </Text>
          {SUMMARY.map((line, i) => (
            <Bullet key={i} text={line} />
          ))}
        </View>
        {SECTIONS.map((section, index) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {`${index + 1}. ${section.title}`}
            </Text>

            {section.body?.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}

            {/* The operator box mirrors the web's bordered contact box. */}
            {index === 0 ? <ContactCard /> : null}

            {section.bullets?.map((bullet, i) => (
              <Bullet key={i} text={bullet} />
            ))}

            {section.subsections?.map((sub) => (
              <View key={sub.heading} style={styles.subsection}>
                <Text style={styles.subHeading}>{sub.heading}</Text>
                {sub.paragraphs?.map((paragraph, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {paragraph}
                  </Text>
                ))}
                {sub.bullets?.map((bullet, i) => (
                  <Bullet key={i} text={bullet} />
                ))}
              </View>
            ))}

            {/* Tappable Terms link for the Other documents section. */}
            {section.title === 'Other documents' ? (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={() => void openTerms()}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel="Read the Terms of Service"
              >
                <Ionicons name="document-text-outline" size={18} color={t.colors.accent.aqua} />
                <Text style={styles.linkText}>Terms of Service</Text>
                <Ionicons name="open-outline" size={16} color={t.colors.accent.aqua} />
              </TouchableOpacity>
            ) : null}

            {/* Contact box for the final Contact section. */}
            {section.title === 'Contact' ? <ContactCard /> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    paddingTop: t.spacing[4],
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[5],
  },
  effective: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  section: {
    gap: t.spacing[3],
  },
  sectionTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  subsection: {
    gap: t.spacing[2],
    paddingTop: t.spacing[1],
  },
  subHeading: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  paragraph: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
  },
  bulletText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flex: 1,
  },
  contactCard: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  contactRow: {
    gap: t.spacing[1],
  },
  contactLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  contactValue: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  contactLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  contactLink: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
  linkText: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
    flex: 1,
  },
}));
