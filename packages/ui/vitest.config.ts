import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@hirevine\/ui\/(components|lib|hooks)\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1/$2", import.meta.url)) }],
  },
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
