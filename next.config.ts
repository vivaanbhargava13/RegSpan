import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdf-parse loads pdfjs-dist's native Node ESM implementation dynamically.
  // Externalizing both prevents webpack from rewriting pdf.js initialization.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
