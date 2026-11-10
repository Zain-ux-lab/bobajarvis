import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // the dev-mode badge sat on top of the drawer label
  cacheComponents: true,
  partialPrefetching: true,
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
