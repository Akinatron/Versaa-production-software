import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError } from "./base";
import { diff, logChange } from "./changes";

export type Role = (typeof t.userRole.enumValues)[number];
export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };

/*
 * Team logins: email + password, kept in the app's own database so it works
 * the same on a laptop and on AWS. Passwords are stored as scrypt hashes;
 * sessions as a SHA-256 hash of a random cookie token.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "versaa_session";
export const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function checkPassword(password: string) {
  if (password.length < 10) throw new OperationError("Use a password of at least 10 characters.");
}

export async function countUsers(db: DB) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(t.users);
  return row?.n ?? 0;
}

/** Add a team member. The very first account can only be made while there are none. */
export async function createUser(db: DB, input: { email: string; name: string; password: string; role?: Role }, opts: { firstOnly?: boolean } = {}) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OperationError("Enter a valid email address.");
  if (!name) throw new OperationError("Enter a name.");
  checkPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4444)`);
    if (opts.firstOnly) {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.users);
      if ((row?.n ?? 0) > 0) throw new OperationError("The first account already exists. Sign in instead.");
    }
    const [dup] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email));
    if (dup) throw new OperationError(`${email} already has an account.`);
    // The first account runs the app; everyone else starts as a viewer unless chosen otherwise.
    const role: Role = opts.firstOnly ? "admin" : (input.role ?? "viewer");
    const [user] = await tx.insert(t.users).values({ email, name, role, passwordHash: await hashPassword(input.password) }).returning();
    if (!opts.firstOnly)
      await logChange(tx, { action: "create", area: "settings", entity: { type: "user", id: user!.id, code: name }, summary: `Account made for ${name} (${ROLE_LABEL[role]})` });
    return user!;
  });
}

export async function setUserActive(db: DB, userId: string, active: boolean) {
  const [u] = await db.update(t.users).set({ active }).where(eq(t.users.id, userId)).returning();
  if (!active) await db.delete(t.sessions).where(eq(t.sessions.userId, userId));
  if (u) await logChange(db, { action: "status", area: "settings", entity: { type: "user", id: u.id, code: u.name }, summary: active ? `${u.name}'s account switched back on` : `${u.name}'s account switched off` });
}

export async function setPassword(db: DB, userId: string, password: string) {
  checkPassword(password);
  const [u] = await db.update(t.users).set({ passwordHash: await hashPassword(password) }).where(eq(t.users.id, userId)).returning();
  await db.delete(t.sessions).where(eq(t.sessions.userId, userId));
  if (u) await logChange(db, { action: "update", area: "settings", entity: { type: "user", id: u.id, code: u.name }, summary: `${u.name}'s password changed` });
}

/** Change what a team member may do. There is always at least one admin left. */
export async function setUserRole(db: DB, userId: string, role: Role) {
  if (!(t.userRole.enumValues as readonly string[]).includes(role)) throw new OperationError("Choose a role.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4444)`);
    const [u] = await tx.select().from(t.users).where(eq(t.users.id, userId));
    if (!u) throw new OperationError("Account not found.");
    if (u.role === role) return;
    if (u.role === "admin") {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.users).where(and(eq(t.users.role, "admin"), eq(t.users.active, true)));
      if ((row?.n ?? 0) <= 1) throw new OperationError("This is the only admin. Make someone else an admin first.");
    }
    await tx.update(t.users).set({ role }).where(eq(t.users.id, u.id));
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "user", id: u.id, code: u.name },
      summary: `${u.name} is now ${ROLE_LABEL[role].toLowerCase() === "admin" ? "an admin" : `a ${ROLE_LABEL[role].toLowerCase()}`}`,
      changes: diff([["Role", ROLE_LABEL[u.role], ROLE_LABEL[role]]]),
    });
  });
}

/** Check email + password and open a session. Returns the cookie token. */
export async function signIn(db: DB, email: string, password: string) {
  const [user] = await db.select().from(t.users).where(eq(t.users.email, email.trim().toLowerCase()));
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, await hashPassword("x".repeat(12)));
  if (!user || !ok || !user.active) throw new OperationError("Email or password is not right.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(t.sessions).values({ tokenHash: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt, user };
}

export async function userForToken(db: DB, token: string | undefined | null) {
  if (!token) return null;
  const [row] = await db
    .select({ user: t.users })
    .from(t.sessions)
    .innerJoin(t.users, eq(t.sessions.userId, t.users.id))
    .where(and(eq(t.sessions.tokenHash, hashToken(token)), gt(t.sessions.expiresAt, new Date()), eq(t.users.active, true)));
  return row?.user ?? null;
}

export async function signOut(db: DB, token: string | undefined | null) {
  if (token) await db.delete(t.sessions).where(eq(t.sessions.tokenHash, hashToken(token)));
}
