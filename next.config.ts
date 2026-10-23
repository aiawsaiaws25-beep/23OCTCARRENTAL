import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets QA's Playwright dev server (NEXT_DIST_DIR=.next-qa) run beside other dev servers:
  // Next allows one `next dev` per distDir. Default is unchanged.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Licence (5 MB) and damage-photo uploads go through Server Actions.
      bodySizeLimit: "10mb",
    },
  },
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
