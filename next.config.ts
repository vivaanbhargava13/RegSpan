import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // The isolated parser worker loads PDF.js' native Node ESM implementation.
  // Externalizing it prevents Next.js from rewriting worker initialization.
  serverExternalPackages: ["pdfjs-dist"],
  // The worker's constructed dynamic import is invisible to automatic tracing.
  outputFileTracingIncludes: {
    "/api/internal/ingest/process-job": [
      "./lib/pdfParserWorker.js",
      "./node_modules/pdfjs-dist/**/*",
    ],
  },
};

export default nextConfig;
