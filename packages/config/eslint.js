// Shared flat ESLint config. Usage in an app's eslint.config.mjs:
//   import { config } from "@hirevine/config/eslint";
//   export default config({ next: true, candidateApp: true });
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export function config({ next = false, candidateApp = false } = {}) {
  return tseslint.config(
    { ignores: [".next/**", ".next-e2e/**", "test-results/**", "playwright-report/**", "node_modules/**", "dist/**", "**/schema.d.ts", "next-env.d.ts"] },
    ...tseslint.configs.recommended,
    {
      plugins: { "react-hooks": reactHooks },
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        // The apps never query the database; every read and write goes through the API.
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.property.name='from'][callee.object.name=/supabase/i]",
            message: "Apps never query the database directly. Use the API client.",
          },
          {
            selector: "CallExpression[callee.property.name='from'][callee.object.callee.name=/supabase/i]",
            message: "Apps never query the database directly. Use the API client.",
          },
        ],
      },
    },
    ...(next
      ? [
          {
            plugins: { "@next/next": nextPlugin },
            rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
          },
        ]
      : []),
    ...(candidateApp
      ? [
          {
            rules: {
              "no-restricted-imports": [
                "error",
                {
                  patterns: [
                    {
                      group: ["@xyflow/*", "reactflow", "recharts", "recharts/*"],
                      message: "Keep the candidate app light: no React Flow or Recharts.",
                    },
                  ],
                },
              ],
            },
          },
        ]
      : []),
  );
}
