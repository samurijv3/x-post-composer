// Flat ESLint config (eslint v10).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      '.output',
      '.wxt',
      'dist',
      'stats*',
      'coverage',
      'design_handoff_margin_redesign',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        chrome: 'readonly',
        browser: 'readonly',
        console: 'readonly',
        globalThis: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        indexedDB: 'readonly',
        IDBKeyRange: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
