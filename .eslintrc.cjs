/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["@typescript-eslint"],
  // "preview" holds static design mockups (not app code; nothing under src/ imports it).
  ignorePatterns: ["dist", "node_modules", ".eslintrc.cjs", "scripts/*.mjs", "*.config.js", "*.config.ts", "preview"],
  rules: {
    // Defense-in-depth: never allow raw HTML injection sinks. The DOM builder is
    // safe-by-construction (textContent only); these bans keep it that way.
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-restricted-properties": [
      "error",
      { object: "document", property: "write", message: "document.write is banned (XSS sink)." },
      { property: "innerHTML", message: "innerHTML is banned; use the textContent-safe DOM builder." },
      { property: "outerHTML", message: "outerHTML is banned; use the textContent-safe DOM builder." },
      { property: "insertAdjacentHTML", message: "insertAdjacentHTML is banned; use the DOM builder." },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "NewExpression[callee.name='Function']",
        message: "new Function is banned (code-injection sink).",
      },
      {
        selector:
          "AssignmentExpression[left.property.name='innerHTML'], AssignmentExpression[left.property.name='outerHTML']",
        message: "Assigning innerHTML/outerHTML is banned; use the textContent-safe DOM builder.",
      },
    ],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
};
