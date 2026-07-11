import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The isolated parser worker loads PDF.js' native Node ESM implementation.
  // Externalizing it prevents Next.js from rewriting worker initialization.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
