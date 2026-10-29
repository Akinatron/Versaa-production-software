"use server";

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { activeMock, db } from "@/db/client";
import { OperationError } from "@/db/operations";
import { startMock, stopMock } from "@/db/mock";
import { WIPE_INFO, wipeDatabase } from "@/db/wipe";
import { desktopRequest, isDesktop } from "@/lib/desktop";
import { uploadsRoot } from "@/lib/files";
import { devToolsBuilt, isDeveloperMode, setDeveloperMode } from "@/lib/developer";
import { attempt, withOk } from "../components/flash";

const HERE = "/settings";
/** Back to the developer section of Settings with a message. */
const toDev = (msg: string) => `${withOk(HERE, msg)}#developer`;

function refreshAll() {
  revalidatePath("/", "layout");
}

async function needDeveloperMode() {
  if (!devToolsBuilt()) throw new OperationError("This copy of Versaa has no developer mode.");
  if (!(await isDeveloperMode())) throw new OperationError("Turn on developer mode first.");
}

export async function enterDeveloperModeAction() {
  await attempt(
    HERE,
    async () => {
      if (!devToolsBuilt()) throw new OperationError("This copy of Versaa has no developer mode.");
      await setDeveloperMode(true);
    }
  );
  refreshAll();
  redirect(toDev("Developer mode is on."));
}

export async function leaveDeveloperModeAction() {
  await attempt(
    HERE,
    async () => {
      await stopMock();
      await setDeveloperMode(false);
    }
  );
  refreshAll();
  redirect(withOk(HERE, "Back to normal mode."));
}

export async function startMockAction() {
  await attempt(
    HERE,
    async () => {
      await needDeveloperMode();
      await startMock();
    }
  );
  refreshAll();
  redirect(toDev("Showing mock data. Nothing you change now is kept."));
}

/** Back to the real data. Lands on Settings: a page open on a mock record wouldn't exist in the real data. */
export async function stopMockAction() {
  await attempt(HERE, () => stopMock());
  refreshAll();
  redirect(toDev("Back to your real data. The mock data was thrown away."));
}

/** Empty a folder of uploaded files, keeping the folder. */
async function emptyFolder(dir: string) {
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const e of entries) await rm(path.join(dir, e), { recursive: true, force: true });
}

export async function deleteDatabaseAction(form: FormData) {
  const parts = form.getAll("part").map(String);
  const confirm = String(form.get("confirm") ?? "").trim();
  const mock = activeMock();
  let backup: string | null = null;
  const deleted = await attempt(
    HERE,
    async () => {
      await needDeveloperMode();
      if (parts.length === 0) throw new OperationError("Tick what to delete.");
      if (confirm !== "DELETE") throw new OperationError("Type DELETE (in capitals) to confirm.");
      // The desktop app keeps a copy of the real database and files first.
      if (!mock && isDesktop()) backup = (await desktopRequest<{ file: string }>("/backup")).file;
      const done = await wipeDatabase(db(), parts);
      if (done.has("activity")) await emptyFolder(mock ? mock.uploadsDir : uploadsRoot());
      return done;
    }
  );
  refreshAll();
  const what = [...deleted].map((p) => WIPE_INFO[p].label).join(", ");
  redirect(toDev(`Deleted from the ${mock ? "mock" : "real"} database: ${what}.${backup ? " A copy from just before is in the backups folder." : ""}`));
}
