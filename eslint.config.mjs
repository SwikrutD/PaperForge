// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

const typeCheckedProjects = [
  './tsconfig.json',
  './tsconfig.main.json',
  './tsconfig.renderer.json',
  './tsconfig.test.json',
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.vite/**',
      'out/**',
      'dist/**',
      'coverage/**',
      'resources/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: typeCheckedProjects,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-globals': ['error', { name: 'eval', message: 'eval is forbidden.' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Dynamic code generation is forbidden.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
    },
  },
  {
    // Main and preload run in Node/Electron privileged contexts.
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Renderer is browser-only and must never reach for Node APIs.
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx', 'src/pdf/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer must use the preload bridge instead.' },
            { name: 'fs', message: 'The renderer has no filesystem access.' },
            { name: 'node:fs', message: 'The renderer has no filesystem access.' },
            { name: 'path', message: 'The renderer has no filesystem access.' },
            { name: 'node:path', message: 'The renderer has no filesystem access.' },
          ],
        },
      ],
    },
  },
  {
    // Workers run in the window's sandbox, without a document.
    files: ['src/workers/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.config.mts', 'forge.config.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
      // JSDoc already documents these build scripts.
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
);
