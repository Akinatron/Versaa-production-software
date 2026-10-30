import Link from "next/link";
import { db } from "@/db/client";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../../components/flash";
import { saveSalesOrder } from "../../actions";
import { activeProducts, customerList, todayIso } from "../../data";
import { PageHeader } from "../../../components/ui/header";
import { GuardedForm } from "../../../components/unsaved-guard";
import { NumberInput } from "../../../components/ui/number-input";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [products, customers, avail] = await Promise.all([activeProducts(), customerList(), finishedAvailability(db())]);
  const free = new Map(avail.map((a) => [a.productId, a.available]));

  return (
    <>
      <PageHeader
        back={{ href: "/outbound", label: "Outbound" }}
        title="New sales order"
        lead="Holds the jars until you deliver. Stock goes down on delivery."
      />
      <Flash params={params} />
      <GuardedForm action={saveSalesOrder}>
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        <div className="card grid">
          <div>
            <label htmlFor="customerId">Customer</label>
            <select id="customerId" name="customerId" defaultValue={params.customer ?? ""}>
              <option value="">None, I&apos;ll write a destination</option>
              {customers
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <div className="small">
              <Link href="/outbound/customers?back=/outbound/orders/new">Add a customer</Link>
            </div>
          </div>
          <div>
            <label htmlFor="destination">Or a destination (free text)</label>
            <input id="destination" name="destination" type="text" placeholder="e.g. Saturday market Utrecht" />
            <div className="small muted">Choose a customer, write a destination, or both. One of them is required.</div>
          </div>
          <div>
            <label htmlFor="reference">Customer reference (optional)</label>
            <input id="reference" name="reference" type="text" placeholder="their order number" />
          </div>
          <div>
            <label htmlFor="orderedOn">Order date (required)</label>
            <input id="orderedOn" name="orderedOn" type="date" required defaultValue={todayIso()} />
          </div>
          <div>
            <label htmlFor="deliverBy">Deliver by (optional)</label>
            <input id="deliverBy" name="deliverBy" type="date" />
          </div>
        </div>
        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Jars</th>
                <th>Price per jar (optional)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  <td>
                    <select name={`product_${i}`} defaultValue="" aria-label="Product">
                      <option value="">Choose…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({free.get(p.id)?.toString() ?? "0"} free now)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberInput whole name={`jars_${i}`} aria-label="Jars" />
                  </td>
                  <td>
                    <NumberInput name={`price_${i}`} aria-label="Price per jar" placeholder="€" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Rows without a product are ignored. Add a price only if agreed; revenue is calculated only from prices recorded here. You can order more than is
            free now (jars still to be made); the order shows “not enough jars” until there are.
          </p>
        </div>
        <div className="savebar">
          <button type="submit">Save order</button>
        </div>
      </GuardedForm>
    </>
  );
}
