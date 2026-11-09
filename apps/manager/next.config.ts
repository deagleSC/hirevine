import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hirevine/ui", "@hirevine/api-client"],
  // Linting runs as its own task (turbo lint) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
