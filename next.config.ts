import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["rss-parser", "docx", "pdf-lib"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
