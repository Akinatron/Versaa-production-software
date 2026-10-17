import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { logout } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = { title: "Versaa Operations" };
export const dynamic = "force-dynamic";

const LINKS = [
  ["/", "Home"],
  ["/plan", "Plan"],
  ["/runs", "Runs"],
  ["/batches", "Batches"],
  ["/orders", "Orders"],
  ["/deliveries", "Deliveries"],
  ["/stock", "Stock"],
  ["/sales", "Sales"],
  ["/trace", "Trace"],
  ["/reports", "Reports"],
  ["/settings", "Settings"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <span className="brand">Versaa</span>
            {user && (
              <>
                <div className="links">
                  {LINKS.map(([href, label]) => (
                    <Link key={href} href={href}>
                      {label}
                    </Link>
                  ))}
                </div>
                <div className="who">
                  <Link href="/team" className="small">
                    {user.name}
                  </Link>
                  <form action={logout}>
                    <button type="submit" className="link small">
                      Sign out
                    </button>
                  </form>
                </div>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
