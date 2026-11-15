import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // The isolated parser worker loads PDF.js' native Node ESM implementation.
  // Externalizing it prevents Next.js from rewriting worker initialization.
  serverExternalPackages: ["pdfjs-dist", "@react-pdf/renderer"],
  // The worker's constructed dynamic import is invisible to automatic tracing.
  outputFileTracingIncludes: {
    "/api/findings/export/pdf": [
      "./public/brand/regspan-mark-64.png",
      "./public/fonts/report/*.ttf",
      "./public/fonts/report/*LICENSE.md",
    ],
    "/api/internal/ingest/process-job": [
      "./lib/pdfParserWorker.js",
      "./node_modules/pdfjs-dist/**/*",
    ],
  },
  allowedDevOrigins: [
    "playlist-audibly-relieve.ngrok-free.dev",
  ],
};

export default nextConfig;
