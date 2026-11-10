import { config } from "@hirevine/config/eslint";

export default [
  ...config(),
  {
    // Vendored from the AI Elements registry (registry.ai-sdk.dev). Kept as upstream ships it
    // so it can be refreshed; only these style rules differ from ours.
    files: ["src/ai-elements/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
