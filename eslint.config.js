// Flat ESLint config (eslint v10).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules', '.output', '.wxt', 'dist', 'stats*', 'coverage', 'docs/design'],
  },
  js.configs.recommended,
  // Type-checked tier: mechanizes the promise discipline this codebase
  // maintains by hand (no-floating-promises etc.) — worth it in a repo
  // where an unhandled rejection in the worker is a silent failure.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config files at the root aren't part of the TS project.
    files: ['*.js', '*.mjs', '*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
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
