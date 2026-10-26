const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
        fetch: "readonly",
        AbortController: "readonly"
      }
    },
    rules: {
      // Keep runtime safety: catch undefined vars before deploy
      "no-undef": "error",

      // Reduce noise for this repo; keep lint focused on runtime safety
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-useless-catch": "off"
    }
  }
];

