import { db } from "@/db/client";
import * as t from "@/db/schema";
import { ROLE_LABEL } from "@/db/auth";
import { can, currentUser } from "@/lib/session";
import { Flash } from "../components/flash";
import { addMember, changeRole, resetPassword, toggleMember } from "./actions";
import { PageHeader } from "../components/ui/header";

export const dynamic = "force-dynamic";

const ROLE_HINT = {
  viewer: "Sees everything, changes nothing.",
  editor: "Records, corrects, deletes and restores.",
  admin: "Like an editor, and manages the team.",
} as const;

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [me, users] = await Promise.all([currentUser(), db().select().from(t.users).orderBy(t.users.name)]);
  const admin = can(me?.role, "admin");
  return (
    <>
      <PageHeader
        title="Team"
        lead={
          me && (
            <>
              You are {me.role === "admin" ? "an admin" : `a ${ROLE_LABEL[me.role].toLowerCase()}`}: {ROLE_HINT[me.role].toLowerCase()}
              {!admin && " Ask an admin to change roles or passwords."}
            </>
          )
        }
      />
      <Flash params={params} />
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              {admin && <th>New password</th>}
              {admin && <th></th>}
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
                  {admin ? (
                    <form action={changeRole} className="row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="role" defaultValue={u.role} aria-label={`Role of ${u.name}`}>
                        {t.userRole.enumValues.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="secondary sm">
                        Save
                      </button>
                    </form>
                  ) : (
                    <span title={ROLE_HINT[u.role]}>{ROLE_LABEL[u.role]}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${u.active ? "ok" : ""}`}>{u.active ? "Can sign in" : "Switched off"}</span>
                </td>
                {admin && (
                  <td>
                    <form action={resetPassword} className="row" style={{ alignItems: "center" }}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input name="password" type="password" minLength={10} required aria-label={`New password for ${u.name}`} style={{ maxWidth: 180 }} />
                      <button type="submit">Set</button>
                    </form>
                  </td>
                )}
                {admin && (
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
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {t.userRole.enumValues.map((r) => (
          <span key={r} style={{ marginRight: 16 }}>
            <strong>{ROLE_LABEL[r]}</strong>: {ROLE_HINT[r]}
          </span>
        ))}
      </p>

      {admin && (
        <>
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
            <div style={{ minWidth: 120 }}>
              <label htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="viewer">
                {t.userRole.enumValues.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit">Add</button>
          </form>
        </>
      )}
    </>
  );
}
