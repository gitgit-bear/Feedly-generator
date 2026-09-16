import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "rss-parser",
    "docx",
    "pdf-lib",
    "jszip",
    "@pdf-lib/fontkit",
    "puppeteer-core",
    "@sparticuz/chromium-min",
  ],
  outputFileTracingIncludes: {
    "/api/report": ["./templates/**/*", "./vendor/**/*", "./scripts/**/*"],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
