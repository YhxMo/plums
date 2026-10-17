import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";

// typescript-eslint 8.71.2 excludes TypeScript 7 from its peer range, so TS/TSX
// are not linted: tsc covers types and check-boundaries covers layering, but
// Hooks rules currently run only on JS/JSX until a compatible parser exists.
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
      "**/*.{ts,tsx}",
    ],
  },
  js.configs.recommended,
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
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["modules/sdk/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../extension-host",
            "../extension-host/**",
            "../shell",
            "../shell/**",
            "../../src",
            "../../src/**",
          ],
        },
      ],
    },
  },
  {
    files: ["extensions/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../../src",
            "../../src/**",
            "../../modules/shell",
            "../../modules/shell/**",
            "../../modules/extension-host",
            "../../modules/extension-host/**",
          ],
        },
      ],
    },
  },
];
