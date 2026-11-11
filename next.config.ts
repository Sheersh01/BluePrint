import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Optional: fewer parallel build workers when the machine is short on RAM, e.g. BUILD_CPUS=2 npm run build
  ...(process.env.BUILD_CPUS ? { experimental: { cpus: Number(process.env.BUILD_CPUS) } } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
