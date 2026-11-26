// Flat ESLint config for the Expo app. Uses the Expo preset (RN + TS rules).
const expoConfig = require('eslint-config-expo/flat');
const { entries } = require('./design-ratchet.allowlist.json');

// DP-12 drift ratchet. Files in design-ratchet.allowlist.json are exempt here and counted
// by scripts/ci/design-ratchet.mjs, so their counts may fall but never rise.
// Route files such as app/set/[setId].tsx hold glob characters.
const globEscape = (file) => file.replace(/[[\]{}()*?!]/g, '\\$&');
const RATCHET_MESSAGE = "Use useTokens(), typeStyle() or an icon size token. Today's offenders sit in design-ratchet.allowlist.json and may not grow.";
const HEX = String.raw`(^|[^&\w])#[0-9a-fA-F]{3,8}([^\w]|$)`;
const RATCHET_RESTRICTED = [
  { selector: `Literal[value=/${HEX}/]`, message: `Hex colour literal. ${RATCHET_MESSAGE}` },
  { selector: `TemplateElement[value.raw=/${HEX}/]`, message: `Hex colour literal. ${RATCHET_MESSAGE}` },
  { selector: "ObjectExpression > Property[key.name='fontSize'][shorthand=false]", message: `fontSize outside hooks/useTokens.ts. ${RATCHET_MESSAGE}` },
  { selector: "ObjectExpression > Property[key.name='fontFamily'][shorthand=false]", message: `fontFamily outside hooks/useTokens.ts. ${RATCHET_MESSAGE}` },
  {
    selector: "JSXOpeningElement[name.name='Ionicons'] > JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal[raw=/^[0-9]/]",
    message: `Numeric Ionicons size. ${RATCHET_MESSAGE}`,
  },
];

module.exports = [
  ...expoConfig,
  {
    rules: {
      // DOM-only rule: React Native <Text> renders raw apostrophes/quotes and
      // does NOT decode HTML entities (&apos; would show literally), so this
      // is inappropriate for RN.
      'react/no-unescaped-entities': 'off',
      // Hook rules are errors: every current violation was fixed or carries a
      // one-line `eslint-disable-next-line ... -- reason`. The React Compiler
      // readiness rules (eslint-plugin-react-hooks 7.x) stay on even though Festie
      // does not enable the Compiler, so new effects cannot reintroduce the
      // set-state-in-effect and ref patterns that were cleaned up.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      // mobile-import-guard: a package that only @festie/shared depends on
      // (e.g. socket.io-client) resolves locally via hoisting but fails CI's
      // mobile typecheck with TS2307. Import it through @festie/shared instead.
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      ...new Set(entries.map((e) => globEscape(e.file))),
      '**/*.test.{ts,tsx}',
      '__tests__/**',
      // Token source and fixed-artwork posters.
      'hooks/useTokens.ts',
      'components/**/*Poster.tsx',
    ],
    rules: { 'no-restricted-syntax': ['error', ...RATCHET_RESTRICTED] },
  },
  {
    // AppSwitch is the one file that may wrap the raw React Native Switch.
    ignores: ['components/AppSwitch.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Switch'],
              message: 'Use components/AppSwitch: it sets the theme track and the iOS off colour.',
            },
          ],
        },
      ],
    },
  },
  {
    // expo-notifications 58 re-exports AndroidImportance through
    // `export * from './NotificationChannelManager.types'`, which
    // eslint-plugin-import cannot follow, so import/namespace reports the enum
    // as missing. It exists at runtime and in the types; `tsc` verifies it.
    files: ['hooks/useMobilePush.ts', 'hooks/useOngoingNotification.ts'],
    rules: { 'import/namespace': 'off' },
  },
  {
    // `vendor/*` is generated, verbatim third-party source (see
    // scripts/vendor-map-runtime.mjs) — linting it would only ever report on code
    // we do not own. No rule is relaxed for app source.
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'android/*',
      'ios/*',
      'maestro/*',
      'scripts/*',
      'vendor/*',
      'expo-env.d.ts',
    ],
  },
];
