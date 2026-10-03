import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  // Photo / invoice uploads go through server actions.
  experimental: {
    proxyClientMaxBodySize: "25mb",
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
