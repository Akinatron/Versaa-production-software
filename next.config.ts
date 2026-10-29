import type { NextConfig } from "next";
import { MAX_REQUEST } from "./src/domain/uploads";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets several dev servers run side by side from one checkout.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // The desktop app (desktop/) ships a self-contained server: NEXT_OUTPUT=standalone.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Delivery notes and invoices are uploaded as photos or PDFs (up to MAX_TOTAL_MB at once).
  experimental: { serverActions: { bodySizeLimit: MAX_REQUEST }, middlewareClientMaxBodySize: MAX_REQUEST },
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
