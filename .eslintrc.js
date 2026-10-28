module.exports = {
    root: true,
    env: {
        node: true,
        browser: true
    },
    'extends': [
        'eslint:recommended',
        'plugin:prettier/recommended' // Run Prettier as an ESLint rule (includes eslint-config-prettier)
    ],
    rules: {
        'prettier/prettier': 'error', // Show Prettier formatting errors as ESLint errors
        'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',

        // Best Practices
        'eqeqeq': 'error',
        'no-invalid-this': 'error',
        'no-return-assign': 'error',
        'no-unused-expressions': ['error', { 'allowTernary': true }],
        'no-useless-concat': 'error',
        'no-useless-return': 'error',
        "no-multi-spaces": ["error", { "exceptions": { "ImportDeclaration": false,  "VariableDeclarator": true } }],
        // Variable
        'init-declarations': 'error',
        'no-use-before-define': 'error',

        // Stylistic Issues
        'array-bracket-newline': ['error', { 'multiline': true, 'minItems': null }],
        'array-bracket-spacing': 'error',
        'brace-style': ["error", "1tbs", { "allowSingleLine": true }],
        'block-spacing': 'error',
        'comma-dangle': ['error','never'],
        'comma-spacing': 'error',
        'comma-style': 'error',
        'computed-property-spacing': 'error',
        'func-call-spacing': 'error',
        'implicit-arrow-linebreak': ['error', 'beside'],
        "indent": [0, "tab"],
        "no-tabs": 0,
        'keyword-spacing': 'error',
        'multiline-ternary': ['error', 'never'],
        'no-lonely-if': 'error',
        'no-mixed-operators': 'error',
        'no-multiple-empty-lines': ['error', { 'max': 12, 'maxEOF': 0 }],
        'no-unneeded-ternary': 'error',
        'no-whitespace-before-property': 'error',
        'nonblock-statement-body-position': 'error',
        'object-property-newline': ["error", { "allowAllPropertiesOnSameLine": true }],
        "operator-linebreak": [2, "none"],
        'quote-props': ['error', 'consistent'],
        // 'semi': ['error', 'never'],
        'semi-spacing': 'error',
        'space-before-blocks': 'error',
        'space-before-function-paren': ['off', {
            anonymous: 'always',
            named: 'never',
            asyncArrow: 'always'
        }],
        'space-in-parens': 'error',
        'space-infix-ops': 'error',
        'space-unary-ops': 'error',

        // ES6
        'arrow-spacing': 'error',
        'no-confusing-arrow': 'error',
        'no-duplicate-imports': 'error',
        'no-var': 'error',
        'object-shorthand': 'error',
        'prefer-const': 'error',
        'prefer-template': 'error'
    },
    parserOptions: {
        sourceType: 'module'
    }
}
