import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

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
      globals: Object.fromEntries(
        [
          "AbortController",
          "AbortSignal",
          "Buffer",
          "DOMException",
          "TextDecoder",
          "TextEncoder",
          "URL",
          "URLSearchParams",
          "clearInterval",
          "clearTimeout",
          "console",
          "document",
          "fetch",
          "location",
          "performance",
          "process",
          "queueMicrotask",
          "requestAnimationFrame",
          "setInterval",
          "setTimeout",
          "structuredClone",
          "window",
        ].map((name) => [name, "readonly"]),
      ),
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
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
