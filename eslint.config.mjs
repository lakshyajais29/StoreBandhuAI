import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'widget/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'warn',
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name=/^(updateOne|updateMany|findOneAndUpdate)$/] > ObjectExpression Property[key.name=/^(paidAvailable|trialAvailable)$/]",
        message: 'Only src/domain/wallet/service.js may change balances.',
      }],
    },
  },
  { files: ['src/domain/wallet/service.js'], rules: { 'no-restricted-syntax': 'off' } },
];
