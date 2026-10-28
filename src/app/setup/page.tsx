import { redirect } from "next/navigation";
import { realDb } from "@/db/client";
import { countUsers } from "@/db/auth";
import { Flash } from "../components/flash";
import { setupFirstAccount } from "../login/actions";
import { BrandMark } from "../components/ui/icons";

export const dynamic = "force-dynamic";

/** Shown only while no account exists yet. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if ((await countUsers(realDb())) > 0) redirect("/login");
  return (
    <>
      <div className="brand">
        <BrandMark size={26} />
        Versaa
      </div>
      <h1>Create the first account</h1>
      <p className="lead">Nobody has an account yet. This first one can add the rest of the team afterwards (Team, in the menu).</p>
      <Flash params={params} />
      <form action={setupFirstAccount} className="card">
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" type="text" autoComplete="name" required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password (at least 10 characters)</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </div>
        <button type="submit" style={{ width: "100%" }}>
          Create account and sign in
        </button>
      </form>
    </>
  );
}
