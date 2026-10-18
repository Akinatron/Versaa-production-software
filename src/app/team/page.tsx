import { db } from "@/db/client";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/session";
import { Flash } from "../components/flash";
import { addMember, resetPassword, toggleMember } from "./actions";
import { PageHeader } from "../components/ui/header";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [me, users] = await Promise.all([currentUser(), db().select().from(t.users).orderBy(t.users.name)]);
  return (
    <>
      <PageHeader title="Team" lead={<>Everyone who can sign in. Everybody has the same access.</>} />
      <Flash params={params} />
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>New password</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.id === me?.id && <span className="muted small"> (you)</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  <span className={`badge ${u.active ? "ok" : ""}`}>{u.active ? "Can sign in" : "Switched off"}</span>
                </td>
                <td>
                  <form action={resetPassword} className="row" style={{ alignItems: "center" }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input name="password" type="password" minLength={10} required aria-label={`New password for ${u.name}`} style={{ maxWidth: 180 }} />
                    <button type="submit">Set</button>
                  </form>
                </td>
                <td>
                  {u.id !== me?.id && (
                    <form action={toggleMember}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                      <button type="submit" className="secondary">
                        {u.active ? "Switch off" : "Switch on"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Add a team member</h2>
      <form action={addMember} className="card row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="password">Password (at least 10 characters)</label>
          <input id="password" name="password" type="password" minLength={10} required />
        </div>
        <button type="submit">Add</button>
      </form>
    </>
  );
}
