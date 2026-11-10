import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hirevine/ui", "@hirevine/api-client"],
  // Linting runs as its own task (turbo lint) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // The e2e server builds into its own folder so it can run next to `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
