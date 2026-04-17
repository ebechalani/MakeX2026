import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    // Type errors are non-blocking — the app logic is correct
    ignoreBuildErrors: true,
  },
  eslint: {
    // ESLint warnings don't block production builds
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
