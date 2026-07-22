import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (node server.js)
  output: "standalone",
  experimental: {
    serverActions: {
      // Standard ist 1 MB - zu klein fuer Dokument-Uploads
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
