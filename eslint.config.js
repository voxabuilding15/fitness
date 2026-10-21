const expoConfig = require('eslint-config-expo/flat');

/**
 * Layering and isolation rules (see docs/ARCHITECTURE.md).
 *  - src/domain is pure TypeScript (no React / React Native / Expo).
 *  - UI code (screens, components, routes) never imports src/db directly.
 *  - Node built-ins (node:sqlite, node:fs, ...) are test-only: src/db/testing and src/__tests__.
 *  - expo-sqlite is imported only by the three db files that adapt it.
 * `no-restricted-imports` is one rule per file, so each group below lists the full set that applies to it.
 */
const noNodeBuiltins = {
  group: ['node:*'],
  message: 'Node built-ins are for tests only (src/db/testing, src/__tests__); never import them from app code.',
};
const noExpoSqlite = {
  group: ['expo-sqlite', 'expo-sqlite/*'],
  message: 'Only src/db/expoSqliteModule.ts (the guarded lazy loader) and the type-only users expoSqliteDriver.ts / expoBackup.ts may reference expo-sqlite.',
};
const noFrameworkInDomain = {
  group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*', '@expo/*', 'react-i18next'],
  message: 'src/domain must be pure TypeScript: no React, React Native or Expo imports.',
};
const noDbInDomain = { group: ['**/db', '**/db/**'], message: 'src/domain must not depend on src/db (it defines the interfaces that src/db implements).' };
const noDbInUi = {
  group: ['**/db', '**/db/**'],
  message: 'UI code must not import src/db directly; use the repositories exposed through context/DatabaseContext.',
};
const restrict = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });
// A top-level import of expo-sqlite throws at app start when the native module is missing; require() of it is only allowed in the guarded loader.
const noExpoSqliteRequire = {
  'no-restricted-syntax': ['error', { selector: "CallExpression[callee.name='require'][arguments.0.value=/^expo-sqlite/]", message: 'Load expo-sqlite only through src/db/expoSqliteModule.ts (guarded lazy loader).' }],
};

const SRC = ['src/**/*.{ts,tsx}'];
const TEST_ONLY = ['src/db/testing/**', 'src/__tests__/**'];
const EXPO_SQLITE_FILES = ['src/db/expoSqliteModule.ts', 'src/db/expoSqliteDriver.ts', 'src/db/expoBackup.ts']; // the loader + the type-only users

module.exports = [
  ...expoConfig,
  { ignores: ['dist/*', '.expo/*'] },
  { files: SRC, ignores: [...TEST_ONLY, ...EXPO_SQLITE_FILES], rules: { ...restrict(noNodeBuiltins, noExpoSqlite), ...noExpoSqliteRequire } },
  { files: EXPO_SQLITE_FILES, rules: restrict(noNodeBuiltins) },
  { files: ['src/domain/**/*.{ts,tsx}'], ignores: TEST_ONLY, rules: restrict(noFrameworkInDomain, noDbInDomain, noNodeBuiltins) },
  {
    files: ['src/screens/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: restrict(noDbInUi, noNodeBuiltins, noExpoSqlite),
  },
];
