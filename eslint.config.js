const expoConfig = require('eslint-config-expo/flat');

/**
 * Layering rules (see docs/ARCHITECTURE.md, "Intended architecture").
 * They only apply to folders that exist or will exist; they do not affect today's code.
 */
const noFrameworkInDomain = {
  group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*', '@expo/*', 'react-i18next'],
  message: 'src/domain must be pure TypeScript: no React, React Native or Expo imports.',
};
const noDbInUi = {
  group: ['**/db', '**/db/**'],
  message: 'UI code must not import src/db directly; go through a feature service or repository interface.',
};

module.exports = [
  ...expoConfig,
  { ignores: ['dist/*', '.expo/*'] },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noFrameworkInDomain] }] },
  },
  {
    files: ['src/screens/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noDbInUi] }] },
  },
];
