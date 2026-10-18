import { Suspense } from "react";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { currentUser } from "@/lib/session";
import { logout } from "./login/actions";
import { Sidebar, type NavCounts } from "./components/ui/sidebar";
import { Motion } from "./components/motion";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Versaa", template: "%s · Versaa" },
};
export const dynamic = "force-dynamic";

/** Where work is waiting, shown as counts in the menu. */
async function navCounts(): Promise<NavCounts> {
  const [row] = await db().execute<{
    production: number;
    packaging: number;
    draft_orders: number;
    on_the_way: number;
    sales: number;
  }>(sql`
    select
      (select count(*)::int from production_batches b join production_runs r on r.id = b.run_id
         where b.status in ('planned', 'in_production') and r.status in ('confirmed', 'in_progress')) as production,
      (select count(*)::int from production_batches where status in ('awaiting_packaging', 'packing')) as packaging,
      (select count(*)::int from purchase_orders where status = 'draft') as draft_orders,
      (select count(*)::int from purchase_orders where status in ('sent', 'partly_received')) as on_the_way,
      (select count(*)::int from sales_orders where status = 'pending') as sales`);
  return {
    production: row?.production ?? 0,
    packaging: row?.packaging ?? 0,
    draftOrders: row?.draft_orders ?? 0,
    onTheWay: row?.on_the_way ?? 0,
    salesToDeliver: row?.sales ?? 0,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) {
    return (
      <html lang="en">
        <body>
          <div className="auth">
            <div className="box">{children}</div>
          </div>
        </body>
      </html>
    );
  }
  const counts = await navCounts();
  return (
    <html lang="en">
      <body>
        <div className="app">
          <Sidebar
            user={{ name: user.name }}
            counts={counts}
            signOut={
              <form action={logout}>
                <button type="submit">Sign out</button>
              </form>
            }
          />
          <div className="content">
            <main>{children}</main>
            <Suspense fallback={null}>
              <Motion />
            </Suspense>
          </div>
        </div>
      </body>
    </html>
  );
}
