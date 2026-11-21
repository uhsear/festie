// Flat ESLint config for the Expo app. Uses the Expo preset (RN + TS rules).
const expoConfig = require('eslint-config-expo/flat');

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
