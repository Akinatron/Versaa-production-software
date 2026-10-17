import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { DB } from "@/db/client";
import { createUser, setUserActive, signIn, signOut, userForToken, setPassword } from "@/db/auth";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

suite("team logins", () => {
  let db: DB;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => db?.$client.end());

  it("first account, sign in, sign out", async () => {
    const owner = await createUser(db, { email: "Owner@Example.com", name: "Owner", password: "correct horse" }, { firstOnly: true });
    expect(owner.email).toBe("owner@example.com");
    expect(owner.passwordHash).not.toContain("correct horse");
    await expect(createUser(db, { email: "x@example.com", name: "X", password: "0123456789" }, { firstOnly: true })).rejects.toThrow(/already exists/);

    await expect(signIn(db, "owner@example.com", "wrong password")).rejects.toThrow(/not right/);
    const { token } = await signIn(db, " OWNER@example.com ", "correct horse");
    expect((await userForToken(db, token))?.id).toBe(owner.id);
    await signOut(db, token);
    expect(await userForToken(db, token)).toBeNull();
  });

  it("short passwords are refused; retired users and changed passwords end sessions", async () => {
    await expect(createUser(db, { email: "a@example.com", name: "A", password: "short" })).rejects.toThrow(/10 characters/);
    const u = await createUser(db, { email: "cook@example.com", name: "Cook", password: "kitchen-1234" });
    const s1 = await signIn(db, "cook@example.com", "kitchen-1234");
    await setPassword(db, u.id, "kitchen-5678");
    expect(await userForToken(db, s1.token)).toBeNull();
    const s2 = await signIn(db, "cook@example.com", "kitchen-5678");
    await setUserActive(db, u.id, false);
    expect(await userForToken(db, s2.token)).toBeNull();
    await expect(signIn(db, "cook@example.com", "kitchen-5678")).rejects.toThrow(/not right/);
  });
});
