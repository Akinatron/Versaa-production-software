import type { NextConfig } from "next";

// NEXT_DIST_DIR lets several dev servers run side by side from one checkout.
const nextConfig: NextConfig = process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {};
export default nextConfig;
