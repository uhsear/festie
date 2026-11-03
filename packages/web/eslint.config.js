// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Enforce the global z-index ladder: no raw high z-index in className.
// Local micro-stacking (z-[1]..z-[9], two-digit) is allowed; anything
// >=100 belongs to a global layer and must use a ladder token, e.g.
// z-[var(--z-sticky|dropdown|overlay|modal|toast|cookie|top)].
const BASE_RESTRICTED = [
  {
    selector: 'Literal[value=/z-\\[[0-9]{3,}\\]/]',
    message:
      'Raw high z-index in className. Use a z-ladder token: z-[var(--z-sticky|dropdown|overlay|modal|toast|cookie|top)] (defined in theme.css).',
  },
  {
    // priority-must (#ff3366) is the bright brand coral — safe only for
    // borders/glows/large display. As a BACKGROUND FILL behind light text
    // it is 3.55:1 and fails WCAG AA. Use bg-accent-coral-strong (#c01d3a,
    // ~6:1) for filled danger/must; keep priority-must for borders/glows.
    selector: 'Literal[value=/bg-(\\[var\\(--color-priority-must\\)\\]|priority-must)(?![-\\w/])/]',
    message:
      'priority-must (#ff3366) as a background fill fails WCAG AA behind light text. Use bg-accent-coral-strong for filled danger/must; keep priority-must for borders/glows only.',
  },
];

// T60: raw Stage aqua and raw hex classes ignore the Daylight theme.
const AQUA_MESSAGE = 'Raw Stage aqua ignores the Daylight theme. Use var(--color-aqua-aNN) or text-accent-aqua.';
const RAW_COLOUR_RESTRICTED = [
  { selector: 'Literal[value=/rgba\\(0, ?(232, ?208|212, ?170)/]', message: AQUA_MESSAGE },
  { selector: 'TemplateElement[value.raw=/rgba\\(0, ?(232, ?208|212, ?170)/]', message: AQUA_MESSAGE },
  {
    selector: 'Literal[value=/-\\[#[0-9a-fA-F]{3,8}\\]/]',
    message: 'Raw hex colour class. Use a theme token from theme.generated.css.',
  },
];

const SWITCH_RESTRICTED = {
  selector: "JSXAttribute[name.name='role'][value.value='switch']",
  message: 'Use components/ui/Switch, which carries the AA track token and the 44 px target.',
};

export default tseslint.config(
  // Base recommended rules
  js.configs.recommended, // TypeScript recommended rules (includes parser setup)
  ...tseslint.configs.recommended, // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'vite.config.ts'],
  }, // Frontend TypeScript/TSX files
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Accessibility (prevention-side): catch a11y defects at author/lint time.
      // Adopted as the recommended ruleset; the config is dark-only single-accent,
      // so these guard semantics (labels, roles, keyboard handlers), not styling.
      ...jsxA11y.flatConfigs.recommended.rules,
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Match the project's existing rule style from the root config
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['debug', 'error', 'warn'] }],
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'warn',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-async-promise-executor': 'error',
      'no-return-await': 'warn',
      'no-template-curly-in-string': 'warn',
      'require-atomic-updates': 'warn',
      // Match root config: pre-existing empty blocks as warnings, not blockers
      'no-empty': 'warn',
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED, SWITCH_RESTRICTED],
    },
  },
  {
    // A later flat-config block replaces the rule options, so the base rules repeat here.
    files: ['src/components/ui/Switch.tsx', 'src/components/crew/MeetingPointsTab.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED] },
  },
  {
    // Share posters are fixed artwork that renders the same in both themes.
    files: ['src/components/features/ScheduleImagePoster.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, SWITCH_RESTRICTED] },
  },
  storybook.configs['flat/recommended'],
);
