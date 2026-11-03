const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['.opencode/dist/**', '.cursor/**', 'node_modules/**', '.venv/**', 'venv/**', 'coverage/**', 'workflows/**/*.workflow.*', '.claude/workflows/**']
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022
            }
        },
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'eqeqeq': 'warn',
            'prefer-const': 'warn',
            'no-var': 'warn',
            'no-console': 'off',
            'complexity': ['warn', 20],
            'max-depth': ['warn', 5],
            'max-params': ['warn', 6]
        }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        files: ['docker/context-profiles/complex-eval/**/recurring-incident/**/*.js'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        // Chrome extension: ES modules in the browser, plus the chrome.* API.
        files: ['chrome-ugc-video-generator/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2022,
                chrome: 'readonly'
            }
        }
    }
];
