import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // e2e runs a second dev server next to a normal one; give it its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@hirevine/ui", "@hirevine/api-client"],
  // Linting runs as its own task (turbo lint) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
