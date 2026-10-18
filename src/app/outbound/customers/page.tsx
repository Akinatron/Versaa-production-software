import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { Flash } from "../../components/flash";
import { saveCustomer } from "../actions";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const back = params.back?.startsWith("/outbound") ? params.back : "";
  const customers = [
    ...(await db().execute<{
      id: string;
      name: string;
      contact: string | null;
      notes: string | null;
      orders: number;
      last: string | null;
    }>(sql`
      select c.id, c.name, c.contact, c.notes,
        (select count(*)::int from sales_orders o where o.customer_id = c.id and o.status <> 'cancelled') as orders,
        (select max(f.occurred_on)::text from outflows f where f.customer_id = c.id and f.deleted_at is null) as last
      from customers c order by c.name`)),
  ];

  return (
    <>
      <PageHeader
        back={{
          href: back || "/outbound",
          label: back ? "Back to the form" : "Outbound",
        }}
        title="Customers"
      />
      <Flash params={params} />

      {back ? (
        <>
          <h2>Add a customer</h2>
          <form action={saveCustomer} className="card grid">
            <input type="hidden" name="back" value={back} />
            <div>
              <label htmlFor="name">Name (required)</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div>
              <label htmlFor="contact">Contact (optional)</label>
              <input id="contact" name="contact" type="text" placeholder="phone, e-mail or address" />
            </div>
            <div>
              <label htmlFor="notes">Notes (optional)</label>
              <input id="notes" name="notes" type="text" />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className={back ? undefined : "secondary"}>
                Add customer
              </button>
              {back && <div className="small muted">You&apos;ll go back to the form you came from.</div>}
            </div>
          </form>

          <h2>All customers</h2>
          <div className="card scroll">
            {customers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No customers yet.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Notes</th>
                    <th className="num">Orders</th>
                    <th>Last jars sent</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.contact ?? "—"}</td>
                      <td>{c.notes ?? "—"}</td>
                      <td className="num">{c.orders}</td>
                      <td>{c.last ? fmtDate(c.last) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <h2>All customers</h2>
          <div className="card scroll">
            {customers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No customers yet.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Notes</th>
                    <th className="num">Orders</th>
                    <th>Last jars sent</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.contact ?? "—"}</td>
                      <td>{c.notes ?? "—"}</td>
                      <td className="num">{c.orders}</td>
                      <td>{c.last ? fmtDate(c.last) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <h2>Add a customer</h2>
          <form action={saveCustomer} className="card grid">
            <input type="hidden" name="back" value={back} />
            <div>
              <label htmlFor="name">Name (required)</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div>
              <label htmlFor="contact">Contact (optional)</label>
              <input id="contact" name="contact" type="text" placeholder="phone, e-mail or address" />
            </div>
            <div>
              <label htmlFor="notes">Notes (optional)</label>
              <input id="notes" name="notes" type="text" />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className={back ? undefined : "secondary"}>
                Add customer
              </button>
              {back && <div className="small muted">You&apos;ll go back to the form you came from.</div>}
            </div>
          </form>
        </>
      )}
    </>
  );
}
