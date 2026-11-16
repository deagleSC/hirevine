import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hirevine/ui"],
  // Linting runs as its own task (turbo lint) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/candidates", destination: "/?for=jobseekers", permanent: true }];
  },
};

export default nextConfig;
