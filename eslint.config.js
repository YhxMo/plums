import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

// tsc covers types and scripts/check-boundaries.mjs covers import layering;
// ESLint adds syntax-level TypeScript rules and the React Hooks rules.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.cache/**",
      "**/.dev-data/**",
      "**/dist/**",
      "release/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "test-results/**",
      "playwright-report/**",
      "evidence/raw/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Build scripts, configs and tests also run in Node.
    files: ["scripts/**", "tests/**", "*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
