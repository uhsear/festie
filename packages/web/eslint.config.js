// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { readFileSync } from 'node:fs';

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

// DP-12 drift ratchet: hex, rgb( and text-[Npx] in component code. Files in
// design-ratchet.allowlist.json are exempt here and counted by scripts/ci/design-ratchet.mjs.
const RATCHET_MESSAGE = "Use a theme token (see DESIGN.md). Today's offenders sit in design-ratchet.allowlist.json and may not grow.";
const RATCHET_RESTRICTED = [
  { selector: 'Literal[value=/(^|[^&\\w])#[0-9a-fA-F]{3,8}([^\\w]|$)/]', message: `Hex colour literal. ${RATCHET_MESSAGE}` },
  { selector: 'TemplateElement[value.raw=/(^|[^&\\w])#[0-9a-fA-F]{3,8}([^\\w]|$)/]', message: `Hex colour literal. ${RATCHET_MESSAGE}` },
  { selector: 'Literal[value=/(^|[^\\w])rgba?\\(/]', message: `rgb() colour literal. ${RATCHET_MESSAGE}` },
  { selector: 'TemplateElement[value.raw=/(^|[^\\w])rgba?\\(/]', message: `rgb() colour literal. ${RATCHET_MESSAGE}` },
  { selector: 'Literal[value=/(^|[^\\w])text-\\[[0-9]/]', message: `Arbitrary text size. ${RATCHET_MESSAGE}` },
  { selector: 'TemplateElement[value.raw=/(^|[^\\w])text-\\[[0-9]/]', message: `Arbitrary text size. ${RATCHET_MESSAGE}` },
];
const RATCHET_ALLOWLIST = JSON.parse(readFileSync(new URL('./design-ratchet.allowlist.json', import.meta.url), 'utf8'))
  .entries.map((e) => e.file);

const SWITCH_FILES = ['src/components/ui/Switch.tsx', 'src/components/crew/MeetingPointsTab.tsx', 'src/components/crew/MeetingPointForm.tsx'];
const POSTER_FILES = ['src/components/features/ScheduleImagePoster.tsx'];

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
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED, ...RATCHET_RESTRICTED, SWITCH_RESTRICTED],
    },
  },
  {
    // A later flat-config block replaces the rule options, so the base rules repeat here.
    files: SWITCH_FILES,
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED, ...RATCHET_RESTRICTED] },
  },
  {
    // Share posters are fixed artwork that renders the same in both themes.
    files: POSTER_FILES,
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, SWITCH_RESTRICTED] },
  },
  {
    // Allowlisted offenders (see design-ratchet.allowlist.json). Later blocks win, so this
    // repeats the base rules without the ratchet selectors.
    files: [
      ...new Set(RATCHET_ALLOWLIST.filter((f) => /\.tsx?$/.test(f)).map((f) => f.replace(/[[\]{}()*?!]/g, '\\$&'))),
      'src/**/*.{test,spec,stories}.{ts,tsx}',
      'src/**/__tests__/**',
    ],
    ignores: [...SWITCH_FILES, ...POSTER_FILES],
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED, SWITCH_RESTRICTED] },
  },
  {
    files: SWITCH_FILES,
    rules: { 'no-restricted-syntax': ['error', ...BASE_RESTRICTED, ...RAW_COLOUR_RESTRICTED] },
  },
  storybook.configs['flat/recommended'],
);
