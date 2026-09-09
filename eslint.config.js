import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } }, rules: {
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
  } },
];
