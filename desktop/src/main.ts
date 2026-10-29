/*
 * Versaa as a desktop app.
 *
 * The app is the same Next.js app as the web version. This file starts three
 * things and shows a window:
 *   1. the database: PGlite (PostgreSQL compiled to WebAssembly) with its data
 *      in the app's data folder, reachable on a private local port;
 *   2. migrations and the starting catalog, exactly as `pnpm db:migrate` and
 *      `pnpm db:seed` do;
 *   3. the Next.js server, as a background process on another local port.
 * Nothing listens outside this computer (127.0.0.1 only).
 */
import { app, BrowserWindow, dialog, Menu, shell, utilityProcess, type UtilityProcess } from "electron";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { startDatabase, startMemoryDatabase, type Database } from "./database";
import { backupDatabase } from "./backup";

// "Check for updates" (development only, see desktop/UPDATER.md). Left out of
// the app entirely when it is built with VERSAA_UPDATER=0.
declare const __VERSAA_UPDATER__: boolean;
// Developer mode (Settings): off in a build made with VERSAA_DEVTOOLS=0.
declare const __VERSAA_DEVTOOLS__: boolean;
const updater = __VERSAA_UPDATER__ ? (require("./updater") as typeof import("./updater")) : undefined;

// Everything Versaa keeps: on Windows %APPDATA%\Versaa\data, on a Mac ~/Library/Application Support/Versaa/data.
const dataDir = path.join(app.getPath("userData"), "data");
const paths = {
  database: path.join(dataDir, "database"),
  uploads: path.join(dataDir, "uploads"),
  backups: path.join(dataDir, "backups"),
  log: path.join(dataDir, "versaa.log"),
};
// Packaged: the server and migrations sit in the app's Resources folder. From source: in desktop/build.
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname);
const serverDir = path.join(resources, "server");
const migrationsDir = path.join(resources, "drizzle");

let database: Database | undefined;
let server: UtilityProcess | undefined;
let appUrl: string | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
/** Windows is shutting down, restarting or signing out. */
let sessionEnding = false;
/** Called when the person chose "Stay" on a page with unsaved changes. */
const onStay = new WeakMap<Electron.WebContents, () => void>();

function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(" ")}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(paths.log, line);
  } catch {
    // The log is only a help for support; never let it stop the app.
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------- requests from the app's server
// Developer mode asks the shell for things only it can do: a backup of the
// built-in database before "Delete database", and an in-memory database for
// "Mock data". Private local port, and a secret only the server knows.
let mockDatabase: Awaited<ReturnType<typeof startMemoryDatabase>> | undefined;
const controlToken = randomBytes(24).toString("hex");

/** A copy of the database and the uploaded files in the backups folder. */
async function backupAll(): Promise<string> {
  const file = await backupDatabase(database!.pg, paths.backups, { kind: "before-delete" });
  if (existsSync(paths.uploads)) {
    const stamp = path.basename(file, ".tar.gz").replace(/^versaa-/, "");
    await cp(paths.uploads, path.join(paths.backups, `uploads-${stamp}`), { recursive: true });
    // Keep the uploads of the last 3 such copies.
    const old = (await readdir(paths.backups)).filter((f) => f.startsWith("uploads-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 3))) await rm(path.join(paths.backups, f), { recursive: true, force: true });
  }
  return file;
}

function startControl(): Promise<string> {
  const server = createHttpServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${controlToken}`) return reply(403, { error: "Not allowed." });
    try {
      if (req.url === "/backup") return reply(200, { file: await backupAll() });
      if (req.url === "/mock/start") {
        await mockDatabase?.stop().catch((e) => log("mock stop failed", e));
        mockDatabase = await startMemoryDatabase(log);
        return reply(200, { url: mockDatabase.url });
      }
      if (req.url === "/mock/stop") {
        await mockDatabase?.stop();
        mockDatabase = undefined;
        return reply(200, { ok: true });
      }
      return reply(404, { error: "Unknown request." });
    } catch (err) {
      log("control request failed", req.url, err);
      return reply(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
}

async function startServer(databaseUrl: string): Promise<string> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  // The window uses "localhost": Next.js writes its redirects with that name, so the
  // whole app stays on one host name.
  const windowUrl = `http://localhost:${port}`;
  server = utilityProcess.fork(path.join(serverDir, "server.js"), [], {
    serviceName: "Versaa server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      // The built-in database serves one connection at a time.
      DATABASE_POOL_MAX: "1",
      UPLOADS_DIR: paths.uploads,
      MIGRATIONS_DIR: migrationsDir,
      VERSAA_DEVTOOLS: __VERSAA_DEVTOOLS__ ? "1" : "0",
      VERSAA_DESKTOP_CONTROL: await startControl(),
      VERSAA_DESKTOP_TOKEN: controlToken,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  server.stdout?.on("data", (d) => log("[server]", String(d).trimEnd()));
  server.stderr?.on("data", (d) => log("[server]", String(d).trimEnd()));
  server.on("exit", (code) => {
    log("server exited with code", code);
    server = undefined;
    if (!quitting) {
      dialog.showErrorBox(
        "Versaa stopped",
        `The app's server stopped unexpectedly (code ${code}). Versaa will close; open it again.\n\nDetails are in ${paths.log}`,
      );
      app.quit();
    }
  });

  // Wait until the server answers (a plain page that needs no database).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!server) throw new Error("The server stopped while starting.");
    try {
      const res = await fetch(`${url}/health`, { redirect: "manual" });
      if (res.status < 500) return windowUrl;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The server did not start within a minute.");
}

const splash = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>Versaa</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f4ef;color:#4a4a45}
@media (prefers-color-scheme: dark){body{background:#171816;color:#b9b9b2}}</style></head><body>Starting Versaa…</body></html>`)}`;

/** The app's own pages (on this computer, on the app's port). */
function isAppUrl(target: string) {
  if (!appUrl) return false;
  try {
    const u = new URL(target);
    return u.protocol === "http:" && u.port === new URL(appUrl).port && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    minHeight: 500,
    title: "Versaa",
    backgroundColor: "#f6f4ef",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: updater?.preloadPath },
  });
  win.once("ready-to-show", () => win.show());
  // App pages (a delivery note opened in a new tab, for example) open in a new window; anything else in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 1100, height: 850 } };
    if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("data:")) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  // A page with unsaved changes asks the browser's "Leave this page?" question
  // before it is closed, reloaded or left. Electron doesn't show that question
  // and silently keeps the page, so the window seemed stuck: ask it here.
  win.webContents.on("will-prevent-unload", (event) => {
    // Windows is shutting down: never hold it up.
    if (sessionEnding) return event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
      message: "You have changes that aren't saved yet.",
      detail: "Leave this page and lose them?",
    });
    if (choice === 0) event.preventDefault();
    else onStay.get(win.webContents)?.();
  });
  // Windows: the mouse's side buttons go back and forward.
  win.on("app-command", (_event, command) => {
    if (command === "browser-backward") win.webContents.navigationHistory.goBack();
    if (command === "browser-forward") win.webContents.navigationHistory.goForward();
  });
  // Windows is shutting down, restarting or signing out. It doesn't quit the
  // app the normal way, so close the database now, while there is time.
  win.on("query-session-end", () => {
    log("Windows is ending the session");
    sessionEnding = true;
    void shutdown();
  });
  win.on("session-end", () => {
    sessionEnding = true;
    void shutdown();
  });
  return win;
}

/** Close every window. False when one of them chose to stay (unsaved changes). */
function closeAllWindows(): Promise<boolean> {
  if (sessionEnding) return Promise.resolve(true);
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return Promise.all(
    windows.map(
      (w) =>
        new Promise<boolean>((resolve) => {
          const contents = w.webContents;
          const closed = () => {
            onStay.delete(contents);
            resolve(true);
          };
          w.once("closed", closed);
          onStay.set(contents, () => {
            w.off("closed", closed);
            onStay.delete(contents);
            resolve(false);
          });
          w.close();
        }),
    ),
  ).then((all) => all.every(Boolean));
}

// Stop the server first, then close the database cleanly so nothing is half
// written. Used when quitting, when Windows shuts down and after a failed start.
let stopping: Promise<void> | undefined;
function shutdown(): Promise<void> {
  quitting = true;
  stopping ??= (async () => {
    try {
      server?.kill();
      await database?.stop();
    } catch (err) {
      log("shutdown problem", err);
    }
  })();
  return stopping;
}

async function backupNow() {
  if (!database) return;
  try {
    const file = await backupDatabase(database.pg, paths.backups, { kind: "manual" });
    const { response } = await dialog.showMessageBox({
      message: "Backup saved",
      detail: `The database was copied to:\n${file}\n\nThis copy is kept until you delete it. Uploaded delivery notes and invoices are in the "uploads" folder of the data folder.`,
      buttons: ["OK", process.platform === "darwin" ? "Show in Finder" : "Show in folder"],
    });
    if (response === 1) shell.showItemInFolder(file);
  } catch (err) {
    log("backup failed", err);
    dialog.showErrorBox("Backup failed", String(err));
  }
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => appUrl && createWindow().loadURL(appUrl) },
        { type: "separator" },
        { label: "Back Up Database Now", click: () => void backupNow() },
        { label: "Show Data Folder", click: () => void shell.openPath(dataDir) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: (_i, w) => w && (w as BrowserWindow).webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: (_i, w) => w && (w as BrowserWindow).webContents.navigationHistory.goForward() },
        { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: (_i, w) => w && appUrl && (w as BrowserWindow).loadURL(appUrl) },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  mkdirSync(dataDir, { recursive: true });
  log(`Versaa ${app.getVersion()} starting. Data folder: ${dataDir}`);
  buildMenu();
  mainWindow = createWindow();
  await mainWindow.loadURL(splash);

  await updater?.setupUpdater({
    dataDir,
    databaseDir: paths.database,
    uploadsDir: paths.uploads,
    backupsDir: paths.backups,
    log,
    backupDatabase: (dir) => backupDatabase(database!.pg, dir, { kind: "before-update" }),
    isAppUrl,
  });

  const firstRun = !existsSync(path.join(paths.database, "PG_VERSION"));
  database = await startDatabase({ dataDir: paths.database, migrationsDir, log });
  // A copy before migrations touch an existing database, so an update can always be undone.
  if (!firstRun) {
    try {
      await backupDatabase(database.pg, paths.backups, { kind: "auto" });
    } catch (err) {
      log("startup backup failed", err);
    }
  }
  await database.prepare();
  appUrl = await startServer(database.url);
  log("ready at", appUrl);
  await updater?.markStarted().catch((err) => log("updater: could not record the update", err));
  if (mainWindow) await mainWindow.loadURL(appUrl);
  else createWindow().loadURL(appUrl);
}

// One copy of the app at a time: two would open the same database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() =>
    start().catch(async (err) => {
      log("start failed", err);
      if (updater) {
        const recovered = await updater.recoverFromFailedStart(err, shutdown).catch((e) => (log("updater: going back failed", e), false));
        if (recovered) return app.exit(1);
      }
      // Close whatever did start (the database may be open) before leaving.
      await shutdown();
      dialog.showErrorBox("Versaa could not start", `${err instanceof Error ? err.message : String(err)}\n\nDetails are in ${paths.log}`);
      app.exit(1);
    }),
  );

  // macOS: clicking the Dock icon with every window closed opens a new one.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0 || !appUrl) return;
    mainWindow = createWindow();
    void mainWindow.loadURL(appUrl);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Quitting waits until the server is stopped and the database closed.
  let stopped = false;
  // Windows are closed first, so a page with unsaved changes can still ask
  // "Leave or stay?" while the server is running. "Stay" cancels the quit.
  let closingWindows = false;
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    if (closingWindows) return;
    const finish = () =>
      void shutdown().finally(() => {
        stopped = true;
        app.quit();
      });
    // Already shutting down (a failed start, or Windows ending the session).
    if (quitting) return finish();
    closingWindows = true;
    void closeAllWindows().then((closed) => {
      closingWindows = false;
      if (closed) finish();
    });
  });
}
