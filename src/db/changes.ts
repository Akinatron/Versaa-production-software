import { AsyncLocalStorage } from "node:async_hooks";
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError } from "./base";

/*
 * The change history. Every action a person takes (create, change, delete,
 * restore, cancel, a status step) writes one row in `change_log`, in the same
 * transaction as the change itself: no row means it didn't happen.
 *
 * Each row is linked to every record it touches (`change_log_links`), so a
 * corrected ingredient shows on the batch, its run and the lots it moved.
 * Labels and names are stored as they were that day, so the history reads the
 * same after something is renamed.
 */

export type EntityType =
  | "run"
  | "batch"
  | "packaging_session"
  | "incident"
  | "purchase_order"
  | "receipt"
  | "lot"
  | "item"
  | "supplier"
  | "sales_order"
  | "outflow"
  | "stock_adjustment"
  | "customer"
  | "sauce"
  | "format"
  | "product"
  | "recipe"
  | "packaging_list"
  | "yield"
  | "user"
  | "document";

export type Area = "production" | "packaging" | "purchasing" | "sales" | "stock" | "settings";
export const AREAS: Area[] = ["production", "packaging", "purchasing", "sales", "stock", "settings"];

export interface Ref {
  type: EntityType;
  id: string;
  code?: string | null;
}

export interface FieldChange {
  label: string;
  before?: string | null;
  after?: string | null;
}

// ---------------------------------------------------------------- who is acting

export interface Actor {
  id: string;
  name: string;
  role: (typeof t.userRole.enumValues)[number];
}

const store = new AsyncLocalStorage<Actor | null>();

/** Run `fn` as this person: everything it records is put down to them. */
export function withActor<T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> {
  return store.run(actor, fn);
}

export const currentActor = () => store.getStore() ?? null;

// ---------------------------------------------------------------- writing

/** A reason is asked for every change, delete and restore of something already recorded. */
export function needReason(reason: string | null | undefined, what = "Say why"): string {
  const r = reason?.trim();
  if (!r) throw new OperationError(`${what}: a reason is needed (it goes in the history).`);
  return r;
}

const show = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

/** Only the fields that differ, as readable text. */
export function diff(fields: [label: string, before: unknown, after: unknown][]): FieldChange[] {
  return fields.map(([label, b, a]) => ({ label, before: show(b), after: show(a) })).filter((f) => f.before !== f.after);
}

export async function logChange(
  tx: Pick<DB, "insert">,
  input: {
    action: (typeof t.changeAction.enumValues)[number];
    area: Area;
    entity: Ref;
    summary: string;
    changes?: FieldChange[];
    reason?: string | null;
    /** Other records this change affects (the batch's run, the lots it moved…). */
    links?: (Ref | null | undefined)[];
  },
): Promise<string> {
  const actor = currentActor();
  const [row] = await tx
    .insert(t.changeLog)
    .values({
      userId: actor?.id ?? null,
      userName: actor?.name ?? null,
      action: input.action,
      area: input.area,
      entityType: input.entity.type,
      entityId: input.entity.id,
      entityCode: input.entity.code ?? null,
      summary: input.summary,
      changes: input.changes ?? [],
      reason: input.reason?.trim() || null,
    })
    .returning({ id: t.changeLog.id });
  const seen = new Set<string>();
  const links = [input.entity, ...(input.links ?? [])].filter((l): l is Ref => !!l && !!l.id).filter((l) => {
    const k = `${l.type}:${l.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await tx.insert(t.changeLogLinks).values(links.map((l) => ({ changeId: row!.id, entityType: l.type, entityId: l.id, entityCode: l.code ?? null })));
  return row!.id;
}

// ---------------------------------------------------------------- reading

export interface ChangeView {
  id: string;
  at: Date;
  userId: string | null;
  userName: string | null;
  action: (typeof t.changeAction.enumValues)[number];
  area: string;
  entityType: EntityType;
  entityId: string;
  entityCode: string | null;
  summary: string;
  changes: FieldChange[];
  reason: string | null;
}

const cols = {
  id: t.changeLog.id,
  at: t.changeLog.at,
  userId: t.changeLog.userId,
  userName: t.changeLog.userName,
  action: t.changeLog.action,
  area: t.changeLog.area,
  entityType: t.changeLog.entityType,
  entityId: t.changeLog.entityId,
  entityCode: t.changeLog.entityCode,
  summary: t.changeLog.summary,
  changes: t.changeLog.changes,
  reason: t.changeLog.reason,
};

const asView = (r: unknown) => r as ChangeView;

/**
 * Changes for one record's page. `own` only lists changes made to the record
 * itself; otherwise everything linked to it (its batches, sessions, lots…).
 */
export async function changesFor(db: DB, ref: { type: EntityType; id: string }, opts: { own?: boolean; limit?: number } = {}): Promise<ChangeView[]> {
  const limit = opts.limit ?? 200;
  const rows = opts.own
    ? await db
        .select(cols)
        .from(t.changeLog)
        .where(and(eq(t.changeLog.entityType, ref.type), eq(t.changeLog.entityId, ref.id)))
        .orderBy(desc(t.changeLog.at))
        .limit(limit)
    : await db
        .select(cols)
        .from(t.changeLog)
        .innerJoin(t.changeLogLinks, eq(t.changeLogLinks.changeId, t.changeLog.id))
        .where(and(eq(t.changeLogLinks.entityType, ref.type), eq(t.changeLogLinks.entityId, ref.id)))
        .orderBy(desc(t.changeLog.at))
        .limit(limit);
  return rows.map(asView);
}

export interface HistoryFilter {
  area?: string | null;
  userId?: string | null;
  action?: string | null;
  from?: string | null;
  to?: string | null;
  /** Matches a record code (B-…, PO-…, a lot code) on the change or anything it touched. */
  code?: string | null;
  /** Leave out this person's own changes. */
  exceptUserId?: string | null;
  /** Older than this time (for "Show older"). */
  before?: Date | null;
  limit?: number;
}

/** The History page: every change, newest first, filtered. */
export async function listChanges(db: DB, f: HistoryFilter = {}): Promise<ChangeView[]> {
  const conds: SQL[] = [];
  if (f.area) conds.push(eq(t.changeLog.area, f.area));
  if (f.userId) conds.push(eq(t.changeLog.userId, f.userId));
  if (f.exceptUserId) conds.push(sql`${t.changeLog.userId} is distinct from ${f.exceptUserId}`);
  if (f.action && (t.changeAction.enumValues as readonly string[]).includes(f.action)) conds.push(eq(t.changeLog.action, f.action as ChangeView["action"]));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(sql`${t.changeLog.at} >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(sql`${t.changeLog.at} < ${f.to}::date + 1`);
  if (f.before) conds.push(lt(t.changeLog.at, f.before));
  const code = f.code?.trim();
  if (code) {
    const like = `%${code.replaceAll("%", "").replaceAll("_", "")}%`;
    conds.push(
      sql`(${t.changeLog.entityCode} ilike ${like} or exists (select 1 from change_log_links k where k.change_id = ${t.changeLog.id} and k.entity_code ilike ${like}))`,
    );
  }
  const rows = await db
    .select(cols)
    .from(t.changeLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(t.changeLog.at))
    .limit(f.limit ?? 100);
  return rows.map(asView);
}

/** The records each change touched besides its own (for the code chips on the History page). */
export async function linksOf(db: DB, changeIds: string[]) {
  const out = new Map<string, Ref[]>();
  if (!changeIds.length) return out;
  const rows = await db.select().from(t.changeLogLinks).where(inArray(t.changeLogLinks.changeId, changeIds));
  for (const r of rows) {
    const list = out.get(r.changeId) ?? [];
    list.push({ type: r.entityType as EntityType, id: r.entityId, code: r.entityCode });
    out.set(r.changeId, list);
  }
  return out;
}

/** How many times each record was changed after it was made, and the last change (for the "Edited" mark). */
export async function editedInfo(db: DB, type: EntityType, ids: string[]) {
  const out = new Map<string, { count: number; last: ChangeView }>();
  if (!ids.length) return out;
  const rows = await db
    .select(cols)
    .from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, type), inArray(t.changeLog.entityId, ids), inArray(t.changeLog.action, ["update", "delete", "restore", "cancel"])))
    .orderBy(desc(t.changeLog.at));
  for (const r of rows.map(asView)) {
    const cur = out.get(r.entityId);
    if (cur) cur.count++;
    else out.set(r.entityId, { count: 1, last: r });
  }
  return out;
}

/** People who appear in the history, for the History page's filter. */
export async function historyPeople(db: DB) {
  return db
    .selectDistinct({ id: t.users.id, name: t.users.name })
    .from(t.users)
    .innerJoin(t.changeLog, eq(t.changeLog.userId, t.users.id))
    .orderBy(t.users.name);
}
