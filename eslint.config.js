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
            'eqeqeq': 'warn'
        }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        // The DSH bundle is ESM in a .js file. Flat config does not read a nested
        // package.json "type": "module", so declare it here rather than ignore it.
        files: ['.dsh/**/*.js'],
        files: ['docker/context-profiles/complex-eval/**/recurring-incident/**/*.js'],
        languageOptions: {
            sourceType: 'module'
        }
    }
];
