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
    // workflows/** are Workflow-DSL scripts, not standalone modules: they mix ESM
    // `export const meta` with top-level `return`/`await` (the harness wraps the
    // body in an async function at run time). No standard JS parser accepts both,
    // so ESLint cannot lint them. Their only logic — the inlined cluster-core — is
    // a verbatim copy of lib/cluster.mjs, which IS linted, and the sync-guard test
    // (`workflow inlined cluster-core matches lib/cluster.mjs verbatim`) fails if
    // the copy ever drifts. Coverage is preserved without parsing the DSL.
    ignores: ["node_modules/**", ".gate/**", "coverage/**", "dist/**", "workflows/**"],
  },
];
