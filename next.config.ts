import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets several dev servers run side by side from one checkout.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // "Sales" was renamed "Outbound": keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/sales", destination: "/outbound", permanent: false },
      { source: "/sales/new", destination: "/outbound/orders/new", permanent: false },
      { source: "/sales/outflow/new", destination: "/outbound/new", permanent: false },
      { source: "/sales/customers", destination: "/outbound/customers", permanent: false },
      { source: "/sales/:id", destination: "/outbound/orders/:id", permanent: false },
    ];
  },
};
export default nextConfig;
