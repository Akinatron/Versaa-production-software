import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { countUsers } from "@/db/auth";
import { Flash } from "../components/flash";
import { login } from "./actions";
import { BrandMark } from "../components/ui/icons";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if ((await countUsers(db())) === 0) redirect("/setup");
  return (
    <>
      <div className="brand">
        <BrandMark size={26} />
        Versaa
      </div>
      <h1>Sign in</h1>
      <p className="lead">Use the email and password your team account was made with.</p>
      <Flash params={params} />
      <form action={login} className="card keep">
        <input type="hidden" name="next" value={params.next ?? "/"} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" style={{ width: "100%" }}>
          Sign in
        </button>
      </form>
      <p className="small muted">Forgot your password? Ask whoever manages the team to set a new one.</p>
    </>
  );
}
