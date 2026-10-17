import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Versaa Operations" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <span className="brand">Versaa</span>
            <Link href="/">Home</Link>
            <Link href="/plan">Plan</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/deliveries">Deliveries</Link>
            <Link href="/stock">Stock</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
