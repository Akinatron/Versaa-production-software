import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { countUsers } from "@/db/auth";
import { Flash } from "../components/flash";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if ((await countUsers(db())) === 0) redirect("/setup");
  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p className="lead">Use the email and password your team account was made with.</p>
      <Flash params={params} />
      <form action={login} className="card">
        <input type="hidden" name="next" value={params.next ?? "/"} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password" style={{ marginTop: 12 }}>Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <div style={{ marginTop: 16 }}>
          <button type="submit">Sign in</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Forgot your password? Ask whoever manages the team to set a new one.</p>
      </form>
    </div>
  );
}
