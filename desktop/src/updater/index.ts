/*
 * "Check for updates" for the desktop app, for development. Everything about it
 * lives in this folder; desktop/UPDATER.md says how to take it out.
 *
 * GitHub builds Versaa.app for every commit on main that passes the checks
 * and publishes it as a release (.github/workflows/desktop-release.yml).
 * This file asks GitHub for the latest release and, when it is newer:
 *   1. backs up the database and the uploaded files,
 *   2. downloads the new app and checks it is exactly the published file,
 *   3. quits, swaps the app (the old one is kept aside) and opens the new one.
 * The data folder is never inside the app, so the swap does not touch it.
 * The new app runs the migrations when it opens, as always. If it can't
 * start, it puts the backup back and reopens the old app (recoverFromFailedStart).
 *
 * The repository has to be public: no token or password is kept anywhere.
 */
import { app, dialog, ipcMain } from "electron";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { access, constants, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { build } from "./build-info";
import { isNewer, notesSince, parseManifest, type Manifest } from "./manifest";

const run = promisify(execFile);

type Options = {
  dataDir: string;
  databaseDir: string;
  uploadsDir: string;
  backupsDir: string;
  log: (...parts: unknown[]) => void;
  /** Full copy of the open database into `dir`; returns the file. */
  backupDatabase: (dir: string) => Promise<string>;
  /** Only the app's own pages may use the updater. */
  isAppUrl: (url: string) => boolean;
};

/** What was installed last time, shown in Settings. */
type LastResult = { ok: boolean; at: string; from: number; to: number; message?: string };
/** Written just before the swap; read by the next start to know an update is under way. */
type Pending = { from: typeof build; to: Manifest; backupDir: string; appPath: string; previousApp: string; startedAt: string };

let opts: Options;
let dir: string; // <data>/updater
let busy = false;

const file = (name: string) => path.join(dir, name);
const github = (p: string) => `https://api.github.com/repos/${build.repo}${p}`;
const headers = { Accept: "application/vnd.github+json", "User-Agent": "Versaa-desktop" };

/** The Versaa.app this process runs from, when it is an installed Mac app. */
function appBundle(): string | undefined {
  if (!app.isPackaged || process.platform !== "darwin") return undefined;
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  return bundle.endsWith(".app") ? bundle : undefined;
}

async function readJson<T>(p: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function canInstall(): Promise<string | undefined> {
  const bundle = appBundle();
  if (!bundle) return "Updates install by themselves only in the packaged Mac app (not when run with pnpm desktop:dev). On Windows, build the new installer with pnpm desktop:win and run it.";
  try {
    await access(path.dirname(bundle), constants.W_OK);
  } catch {
    return `Versaa can't replace itself in ${path.dirname(bundle)}. Move Versaa.app to a folder you can write to.`;
  }
  return undefined;
}

async function status() {
  return {
    current: build,
    blocked: await canInstall(),
    last: await readJson<LastResult>(file("last.json")),
    previousKept: existsSync(file("previous/Versaa.app")),
  };
}

async function latestManifest(): Promise<{ manifest: Manifest; zipUrl: string; releaseUrl: string }> {
  let res: Response;
  try {
    res = await fetch(github("/releases/latest"), { headers });
  } catch {
    throw new Error("Couldn't reach GitHub. Check the internet connection and try again.");
  }
  if (res.status === 404) {
    throw new Error(`No published version found on GitHub. The repository (${build.repo}) has to be public, and main needs one finished build.`);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again in a while.`);
  const release = (await res.json()) as { html_url: string; assets: { name: string; browser_download_url: string }[] };
  const json = release.assets.find((a) => a.name === "update.json");
  if (!json) throw new Error("The latest release has no update.json.");
  const manifest = parseManifest(await (await fetch(json.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } })).json());
  const zip = release.assets.find((a) => a.name === manifest.zip);
  if (!zip) throw new Error(`The latest release has no ${manifest.zip}.`);
  return { manifest, zipUrl: zip.browser_download_url, releaseUrl: release.html_url };
}

async function check() {
  const { manifest, releaseUrl } = await latestManifest();
  return {
    available: isNewer(manifest, build),
    latest: { number: manifest.number, commit: manifest.commit, commitTime: manifest.commitTime, releaseUrl },
    notes: notesSince(manifest.notes, build),
    wrongArch: manifest.arch !== process.arch ? `This update is for ${manifest.arch} Macs and this Mac is ${process.arch}.` : undefined,
  };
}

/** Keep only the newest `keep` entries in `parent` whose names start with `prefix`. */
async function prune(parent: string, prefix: string, keep: number) {
  const names = (await readdir(parent).catch(() => [] as string[])).filter((n) => n.startsWith(prefix)).sort();
  for (const n of names.slice(0, Math.max(0, names.length - keep))) await rm(path.join(parent, n), { recursive: true, force: true });
}

/** Database and uploads, copied before anything changes. */
async function backupEverything(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const target = path.join(opts.backupsDir, `before-update-${stamp}`);
  await mkdir(target, { recursive: true });
  await opts.backupDatabase(target);
  if (existsSync(opts.uploadsDir)) await cp(opts.uploadsDir, path.join(target, "uploads"), { recursive: true });
  await prune(opts.backupsDir, "before-update-", 3);
  opts.log("updater: backup saved in", target);
  return target;
}

async function download(url: string, to: string, sha256: string) {
  const res = await fetch(url, { headers: { "User-Agent": headers["User-Agent"] } });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), tap, createWriteStream(to));
  const got = hash.digest("hex");
  if (got !== sha256) throw new Error("The downloaded file doesn't match the published one, so it wasn't installed. Try again.");
}

/**
 * A helper that waits for this app to quit, moves `current` aside to `aside`,
 * puts `next` in its place and opens it. If a move fails, the old app goes
 * back and opens instead.
 */
async function swapAfterQuit(current: string, next: string, aside: string) {
  const script = file("swap.sh");
  await writeFile(
    script,
    `#!/bin/bash
# Written by Versaa's updater (desktop/src/updater). Swaps the app after Versaa quits.
pid="$1"; current="$2"; next="$3"; aside="$4"; log="$5"
for _ in $(seq 1 240); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
echo "[$(date -u +%FT%TZ)] updater: swapping $current" >> "$log"
rm -rf "$aside"; mkdir -p "$(dirname "$aside")"
if mv "$current" "$aside"; then
  if mv "$next" "$current"; then
    xattr -dr com.apple.quarantine "$current" 2>/dev/null
    echo "[$(date -u +%FT%TZ)] updater: new app in place" >> "$log"
  else
    echo "[$(date -u +%FT%TZ)] updater: could not move the new app, putting the old one back" >> "$log"
    mv "$aside" "$current"
  fi
else
  echo "[$(date -u +%FT%TZ)] updater: could not move the old app aside, nothing changed" >> "$log"
fi
open "$current"
`,
    { mode: 0o755 },
  );
  const child = spawn("/bin/bash", [script, String(process.pid), current, next, aside, path.join(opts.dataDir, "versaa.log")], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function install() {
  if (busy) throw new Error("An update is already being installed.");
  const blocked = await canInstall();
  if (blocked) throw new Error(blocked);
  busy = true;
  try {
    const { manifest, zipUrl } = await latestManifest();
    if (!isNewer(manifest, build)) throw new Error("This copy is already the latest version.");
    if (manifest.arch !== process.arch) throw new Error(`This update is for ${manifest.arch} Macs and this Mac is ${process.arch}.`);

    const backupDir = await backupEverything();

    const staging = file("download");
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const zip = path.join(staging, manifest.zip);
    opts.log("updater: downloading build", manifest.number);
    await download(zipUrl, zip, manifest.sha256);
    await run("/usr/bin/ditto", ["-x", "-k", zip, staging]);
    await rm(zip, { force: true });
    const next = path.join(staging, "Versaa.app");
    if (!existsSync(path.join(next, "Contents", "MacOS", "Versaa")) || !existsSync(path.join(next, "Contents", "Resources", "server", "server.js"))) {
      throw new Error("The downloaded app is incomplete, so it wasn't installed.");
    }

    const current = appBundle()!;
    const pending: Pending = {
      from: build,
      to: manifest,
      backupDir,
      appPath: current,
      previousApp: file("previous/Versaa.app"),
      startedAt: new Date().toISOString(),
    };
    await writeFile(file("pending.json"), JSON.stringify(pending, null, 2));
    await swapAfterQuit(current, next, pending.previousApp);
    opts.log("updater: build", manifest.number, "ready; quitting to swap");
    // Let the page show its last message, then quit (the database closes cleanly on quit).
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  } catch (err) {
    busy = false;
    opts.log("updater: install failed", err);
    throw err;
  }
}

/** Sets up the updater. Call once, before the first window loads the app. */
export async function setupUpdater(options: Options) {
  opts = options;
  dir = path.join(opts.dataDir, "updater");
  await mkdir(dir, { recursive: true });
  const guard =
    <T>(fn: () => Promise<T>) =>
    async (event: Electron.IpcMainInvokeEvent) => {
      if (!opts.isAppUrl(event.senderFrame?.url ?? "")) throw new Error("Not allowed.");
      return fn();
    };
  ipcMain.handle("versaa-updates:status", guard(status));
  ipcMain.handle("versaa-updates:check", guard(check));
  ipcMain.handle("versaa-updates:install", guard(install));
}

/** Call once the app has started fine: an update under way is then finished. */
export async function markStarted() {
  const pending = await readJson<Pending>(file("pending.json"));
  if (!pending) return;
  const arrived = pending.to.commit === build.commit;
  const last: LastResult = arrived
    ? { ok: true, at: new Date().toISOString(), from: pending.from.number, to: pending.to.number }
    : {
        ok: false,
        at: new Date().toISOString(),
        from: pending.from.number,
        to: pending.to.number,
        message: "The new version couldn't be put in place, so this copy kept running. Nothing changed. Details are in versaa.log.",
      };
  await writeFile(file("last.json"), JSON.stringify(last, null, 2));
  await rm(file("pending.json"), { force: true });
  await rm(file("download"), { recursive: true, force: true });
  opts.log("updater:", arrived ? `now on build ${build.number}` : "update did not arrive; old copy still running");
}

/**
 * The app failed to start. If that happened right after an update, put the
 * database back as it was before the update, reopen the previous app, and
 * return true. Otherwise return false and leave everything alone.
 */
export async function recoverFromFailedStart(err: unknown, closeDatabase: () => Promise<void>): Promise<boolean> {
  const pending = await readJson<Pending>(file("pending.json"));
  if (!pending || pending.to.commit !== build.commit) return false;
  const current = appBundle();
  if (!current || !existsSync(pending.previousApp)) return false;
  opts.log("updater: the new version failed to start; going back", err);

  await closeDatabase().catch(() => undefined);
  const backup = (await readdir(pending.backupDir)).find((n) => n.endsWith(".tar.gz"));
  if (!backup) return false;
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const failedCopy = path.join(opts.backupsDir, `failed-update-${stamp}`);
  await mkdir(failedCopy, { recursive: true });
  if (existsSync(opts.databaseDir)) await rename(opts.databaseDir, path.join(failedCopy, "database"));
  await mkdir(opts.databaseDir, { recursive: true });
  await run("/usr/bin/tar", ["-xzf", path.join(pending.backupDir, backup), "-C", opts.databaseDir]);

  const message = `Build ${pending.to.number} could not start (${err instanceof Error ? err.message : String(err)}). Versaa went back to build ${pending.from.number} and put the data back as it was just before the update.`;
  await writeFile(
    file("last.json"),
    JSON.stringify({ ok: false, at: new Date().toISOString(), from: pending.from.number, to: pending.to.number, message } satisfies LastResult, null, 2),
  );
  await rm(file("pending.json"), { force: true });
  await swapAfterQuit(current, pending.previousApp, file("failed/Versaa.app"));
  dialog.showMessageBoxSync({
    type: "warning",
    message: "The update didn't work",
    detail: `${message}\n\nVersaa will reopen the previous version now. The data from the failed attempt is kept in ${failedCopy}.`,
  });
  return true;
}
