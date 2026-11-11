import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '**/coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Invariant: money-moving PayPal calls are reachable only through the rules-engine executor.
    files: ['apps/api/**/*.ts'],
    ignores: ['apps/api/src/payments/**', 'apps/api/src/paypal/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/paypal/spend', '**/paypal/spend.js'],
              message: 'Money-moving PayPal calls may only be imported by payments/executor.ts (money-safety.md).',
            },
            {
              group: ['**/paypal/payouts', '**/paypal/payouts.js'],
              message: 'sendPayout moves money, so only payments/executor.ts may import it (money-safety.md).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
