// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output: `dist/` is the web export, `.expo/` holds typed-routes
    // declarations and the lint/metro caches. Neither is hand-written.
    ignores: ['dist/*', '.expo/*'],
  },
  {
    // Build/tooling scripts run under Node, not React Native. The Expo preset
    // only declares RN globals (plus `globals.node` for metro.config.js), so
    // declare the Node-only globals these scripts use; everything else they
    // touch (`process`, `console`, `require`, `module`) is already declared.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
]);
