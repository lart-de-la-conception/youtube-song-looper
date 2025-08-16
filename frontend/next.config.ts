import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip ESLint during production builds so dev/test-only lint rules
  // (e.g., in __tests__) don't block `next build`. Keep linting via
  // `npm run lint` locally or CI.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
