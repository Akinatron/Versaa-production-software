import { realDb } from "@/db/client";
import { getSetting, setSetting } from "@/db/app-settings";

/*
 * Developer mode: testing tools in Settings (check for updates, mock data,
 * delete database). Off unless an admin turns it on; the choice is kept in
 * the real database, so it survives closing the app. A build made with
 * VERSAA_DEVTOOLS=0 has no developer mode at all.
 */

export const devToolsBuilt = () => process.env.VERSAA_DEVTOOLS !== "0";

export async function isDeveloperMode() {
  if (!devToolsBuilt()) return false;
  return (await getSetting(realDb(), "developer_mode", false)) === true;
}

export async function setDeveloperMode(on: boolean) {
  await setSetting(realDb(), "developer_mode", on);
}
