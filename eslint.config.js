import js from "@eslint/js";
import globals from "globals";

// Flat config (ESLint 9). Recommended rules, run warnings-as-errors via the
// `--max-warnings 0` in the `lint` script so the gate treats any lint as a fail.
export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
      eqeqeq: "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    ignores: ["node_modules/**", ".gate/**", "coverage/**", "dist/**"],
  },
];
